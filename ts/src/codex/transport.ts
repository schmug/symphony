import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

export interface Transport {
  /** Write one newline-delimited JSON line. The trailing \n is added automatically. */
  send(line: string): void;
  /** Subscribe to incoming lines (one JSON object per line, no trailing \n). */
  onLine(handler: (line: string) => void): () => void;
  /** Subscribe to abnormal termination. */
  onClose(handler: (info: { exitCode: number | null; signal: NodeJS.Signals | null }) => void): () => void;
  /** Subscribe to stderr lines for logging. */
  onStderr(handler: (chunk: string) => void): () => void;
  /** Terminate the underlying process. */
  close(): Promise<void>;
}

export interface SpawnTransportOptions {
  command: string;
  args?: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

export class SpawnTransport implements Transport {
  private child: ChildProcess;
  private emitter = new EventEmitter();
  private stdoutBuf = "";
  private closed = false;

  constructor(opts: SpawnTransportOptions) {
    this.child = spawn(opts.command, opts.args ?? [], {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdout!.setEncoding("utf8");
    this.child.stdout!.on("data", (chunk: string) => {
      this.stdoutBuf += chunk;
      let idx;
      while ((idx = this.stdoutBuf.indexOf("\n")) !== -1) {
        const line = this.stdoutBuf.slice(0, idx);
        this.stdoutBuf = this.stdoutBuf.slice(idx + 1);
        if (line.length > 0) this.emitter.emit("line", line);
      }
    });

    this.child.stderr!.setEncoding("utf8");
    this.child.stderr!.on("data", (chunk: string) => {
      this.emitter.emit("stderr", chunk);
    });

    this.child.on("close", (code, signal) => {
      this.closed = true;
      this.emitter.emit("close", { exitCode: code, signal });
    });

    this.child.on("error", (err) => {
      this.emitter.emit("close", { exitCode: -1, signal: null, error: err });
    });
  }

  send(line: string): void {
    if (this.closed) throw new Error("Transport is closed");
    this.child.stdin!.write(`${line}\n`);
  }

  onLine(handler: (line: string) => void): () => void {
    this.emitter.on("line", handler);
    return () => this.emitter.off("line", handler);
  }

  onClose(
    handler: (info: { exitCode: number | null; signal: NodeJS.Signals | null }) => void,
  ): () => void {
    this.emitter.on("close", handler);
    return () => this.emitter.off("close", handler);
  }

  onStderr(handler: (chunk: string) => void): () => void {
    this.emitter.on("stderr", handler);
    return () => this.emitter.off("stderr", handler);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    return await new Promise<void>((resolveP) => {
      const done = () => {
        this.closed = true;
        resolveP();
      };
      this.child.once("close", done);
      this.child.once("error", done);
      try {
        this.child.stdin?.end();
        this.child.kill("SIGTERM");
      } catch {
        done();
      }
      setTimeout(() => {
        if (!this.closed) {
          try {
            this.child.kill("SIGKILL");
          } catch {
            done();
          }
        }
      }, 2000);
    });
  }
}
