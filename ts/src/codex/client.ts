import { EventEmitter } from "node:events";
import type { Transport } from "./transport.js";

export type CodexEvent =
  | { type: "response"; id: number; result?: unknown; error?: unknown }
  | { type: "notification"; method: string; params: unknown }
  | { type: "request"; id: number; method: string; params: unknown }
  | { type: "raw"; payload: unknown };

export interface CodexClientOptions {
  transport: Transport;
  clientName?: string;
  clientVersion?: string;
  /** Default timeout for awaited responses, in ms. */
  responseTimeoutMs?: number;
}

export interface StartThreadOptions {
  cwd: string;
  approvalPolicy: "never" | "on-failure" | "always";
  sandbox: "workspace-write" | "read-only" | "danger-full-access";
  dynamicTools?: unknown[];
}

export interface StartTurnOptions {
  threadId: string;
  prompt: string;
  cwd: string;
  title: string;
  approvalPolicy: "never" | "on-failure" | "always";
  sandboxPolicy: unknown;
}

interface PendingResponse {
  resolveP: (value: unknown) => void;
  rejectP: (err: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CodexClient {
  private transport: Transport;
  private events = new EventEmitter();
  private pending = new Map<number, PendingResponse>();
  private nextId = 1;
  private closed = false;
  private opts: Required<
    Pick<CodexClientOptions, "clientName" | "clientVersion" | "responseTimeoutMs">
  >;

  constructor(opts: CodexClientOptions) {
    this.transport = opts.transport;
    this.opts = {
      clientName: opts.clientName ?? "symphony-orchestrator",
      clientVersion: opts.clientVersion ?? "0.1.0",
      responseTimeoutMs: opts.responseTimeoutMs ?? 60_000,
    };
    this.transport.onLine((line) => this.handleLine(line));
    this.transport.onClose((info) => {
      this.closed = true;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.rejectP(
          new Error(
            `Codex transport closed before response (exitCode=${info.exitCode})`,
          ),
        );
      }
      this.pending.clear();
      this.events.emit("close", info);
    });
  }

  on(event: "event", handler: (e: CodexEvent) => void): () => void;
  on(
    event: "close",
    handler: (info: { exitCode: number | null; signal: NodeJS.Signals | null }) => void,
  ): () => void;
  on(event: string, handler: (...args: any[]) => void): () => void {
    this.events.on(event, handler);
    return () => this.events.off(event, handler);
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      capabilities: { experimentalApi: true },
      clientInfo: {
        name: this.opts.clientName,
        title: "Symphony Orchestrator",
        version: this.opts.clientVersion,
      },
    });
    this.notify("initialized", {});
  }

  async startThread(opts: StartThreadOptions): Promise<string> {
    const result = (await this.request("thread/start", {
      approvalPolicy: opts.approvalPolicy,
      sandbox: opts.sandbox,
      cwd: opts.cwd,
      dynamicTools: opts.dynamicTools ?? [],
    })) as { thread?: { id?: string } };
    const threadId = result.thread?.id;
    if (!threadId) throw new Error(`Invalid thread/start response`);
    return threadId;
  }

  async startTurn(opts: StartTurnOptions): Promise<string> {
    const result = (await this.request("turn/start", {
      threadId: opts.threadId,
      input: [{ type: "text", text: opts.prompt }],
      cwd: opts.cwd,
      title: opts.title,
      approvalPolicy: opts.approvalPolicy,
      sandboxPolicy: opts.sandboxPolicy,
    })) as { turn?: { id?: string } };
    const turnId = result.turn?.id;
    if (!turnId) throw new Error(`Invalid turn/start response`);
    return turnId;
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("CodexClient is closed"));
    const id = this.nextId++;
    const payload = JSON.stringify({ method, id, params });
    return new Promise<unknown>((resolveP, rejectP) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          rejectP(new Error(`Codex request ${method} (id=${id}) timed out`));
        }
      }, this.opts.responseTimeoutMs);
      this.pending.set(id, { resolveP, rejectP, timer });
      this.transport.send(payload);
    });
  }

  notify(method: string, params: unknown): void {
    if (this.closed) throw new Error("CodexClient is closed");
    this.transport.send(JSON.stringify({ method, params }));
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.transport.close();
  }

  private handleLine(line: string): void {
    let payload: unknown;
    try {
      payload = JSON.parse(line);
    } catch {
      this.events.emit("event", { type: "raw", payload: line });
      return;
    }
    if (!payload || typeof payload !== "object") {
      this.events.emit("event", { type: "raw", payload });
      return;
    }
    const obj = payload as { id?: number; method?: string; result?: unknown; error?: unknown; params?: unknown };
    if (typeof obj.id === "number" && (obj.result !== undefined || obj.error !== undefined)) {
      const pending = this.pending.get(obj.id);
      if (pending) {
        this.pending.delete(obj.id);
        clearTimeout(pending.timer);
        if (obj.error !== undefined) pending.rejectP(obj.error);
        else pending.resolveP(obj.result);
      }
      this.events.emit("event", {
        type: "response",
        id: obj.id,
        result: obj.result,
        error: obj.error,
      });
      return;
    }
    if (typeof obj.method === "string" && typeof obj.id === "number") {
      this.events.emit("event", {
        type: "request",
        id: obj.id,
        method: obj.method,
        params: obj.params,
      });
      return;
    }
    if (typeof obj.method === "string") {
      this.events.emit("event", {
        type: "notification",
        method: obj.method,
        params: obj.params,
      });
      return;
    }
    this.events.emit("event", { type: "raw", payload });
  }
}
