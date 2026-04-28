import { pino, type Logger } from "pino";
import { mkdirSync, createWriteStream } from "node:fs";
import { join } from "node:path";

export interface LoggerOptions {
  logsRoot: string;
  /** When true, also mirror logs to stdout (development convenience). */
  alsoStdout?: boolean;
}

export function createLogger(opts: LoggerOptions): Logger {
  mkdirSync(opts.logsRoot, { recursive: true });
  const filePath = join(opts.logsRoot, "orchestrator.log");
  const stream = createWriteStream(filePath, { flags: "a" });
  if (opts.alsoStdout) {
    return pino(
      { level: "info", base: { service: "symphony" } },
      pino.multistream([{ stream }, { stream: process.stdout }]),
    );
  }
  return pino({ level: "info", base: { service: "symphony" } }, stream);
}
