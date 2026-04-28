import type { Issue } from "../tracker/types.js";
import type { WorkflowConfig } from "../config/schema.js";
import { CodexClient, type CodexEvent } from "../codex/client.js";
import { SpawnTransport, type Transport } from "../codex/transport.js";
import type {
  AgentEvent,
  AgentRunInput,
  RunSnapshot,
  RunStage,
  TokenUsage,
} from "./types.js";

const DEFAULT_TURN_SANDBOX = { type: "workspaceWrite" };

export interface AgentRunnerOptions {
  input: AgentRunInput;
  config: WorkflowConfig;
  /** Inject a transport factory in tests. */
  createTransport?: (workspacePath: string) => Transport;
  /** Inject a client factory in tests. */
  createClient?: (transport: Transport) => CodexClient;
  /** Subscribe to lifecycle events. */
  onEvent?: (event: AgentEvent) => void;
}

export class AgentRunner {
  private snapshot: RunSnapshot;
  private client: CodexClient | null = null;
  private transport: Transport | null = null;
  private done: Promise<RunSnapshot> | null = null;
  private resolveDone: ((snap: RunSnapshot) => void) | null = null;
  private stopRequested = false;

  constructor(private readonly opts: AgentRunnerOptions) {
    this.snapshot = {
      issueId: opts.input.issue.id,
      identifier: opts.input.issue.identifier,
      stage: "pending",
      startedAt: null,
      finishedAt: null,
      threadId: null,
      turnId: null,
      sessionId: null,
      turnNumber: 0,
      tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      lastEventAt: null,
      lastEventSummary: null,
      error: null,
    };
  }

  current(): RunSnapshot {
    return { ...this.snapshot, tokens: { ...this.snapshot.tokens } };
  }

  start(): Promise<RunSnapshot> {
    if (this.done) return this.done;
    this.done = new Promise<RunSnapshot>((resolveP) => {
      this.resolveDone = resolveP;
    });
    void this.run();
    return this.done;
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    if (this.client) await this.client.close().catch(() => {});
    this.transport = null;
    this.client = null;
    if (this.snapshot.stage !== "completed" && this.snapshot.stage !== "failed") {
      this.setStage("stopped");
      this.snapshot.finishedAt = new Date();
      this.emit({ type: "completed", issueId: this.snapshot.issueId, reason: "stopped" });
      this.resolveDone?.(this.snapshot);
    }
  }

  private async run(): Promise<void> {
    try {
      this.setStage("starting");
      this.snapshot.startedAt = new Date();
      const transport =
        this.opts.createTransport?.(this.opts.input.workspacePath) ??
        this.makeDefaultTransport();
      const client =
        this.opts.createClient?.(transport) ?? new CodexClient({ transport });
      this.transport = transport;
      this.client = client;

      client.on("event", (e) => this.handleCodexEvent(e));
      client.on("close", () => this.handleClose());

      await client.initialize();
      const threadId = await client.startThread({
        cwd: this.opts.input.workspacePath,
        approvalPolicy: this.opts.config.codex.approval_policy,
        sandbox: this.opts.config.codex.thread_sandbox,
      });
      this.snapshot.threadId = threadId;

      const turnId = await client.startTurn({
        threadId,
        prompt: this.opts.input.prompt,
        cwd: this.opts.input.workspacePath,
        title: `${this.opts.input.issue.identifier}: ${this.opts.input.issue.title}`,
        approvalPolicy: this.opts.config.codex.approval_policy,
        sandboxPolicy: DEFAULT_TURN_SANDBOX,
      });
      this.snapshot.turnId = turnId;
      this.snapshot.turnNumber = 1;
      this.setStage("running");
    } catch (err) {
      this.fail(err);
    }
  }

  private makeDefaultTransport(): Transport {
    const [command, ...args] = parseCommand(this.opts.config.codex.command);
    return new SpawnTransport({
      command: command ?? "codex",
      args,
      cwd: this.opts.input.workspacePath,
    });
  }

  private handleCodexEvent(event: CodexEvent): void {
    const now = new Date();
    this.snapshot.lastEventAt = now;
    if (event.type === "notification") {
      this.snapshot.lastEventSummary = event.method;
      if (event.method === "thread/tokenUsage/updated") {
        const usage = extractTokens(event.params);
        if (usage) {
          this.snapshot.tokens = usage;
          this.emit({
            type: "tokenUsage",
            issueId: this.snapshot.issueId,
            usage,
          });
        }
      }
      if (event.method === "turn/completed") {
        this.snapshot.finishedAt = now;
        this.setStage("completed");
        this.emit({
          type: "completed",
          issueId: this.snapshot.issueId,
          reason: "ok",
        });
        this.resolveDone?.(this.snapshot);
      }
    } else if (event.type === "response") {
      this.snapshot.lastEventSummary = `response id=${event.id}`;
    } else if (event.type === "request") {
      this.snapshot.lastEventSummary = `request ${event.method}`;
    }
    this.emit({
      type: "rawCodexEvent",
      issueId: this.snapshot.issueId,
      payload: event,
      summary: this.snapshot.lastEventSummary ?? "event",
    });
  }

  private handleClose(): void {
    if (
      this.snapshot.stage === "completed" ||
      this.snapshot.stage === "failed" ||
      this.snapshot.stage === "stopped"
    ) {
      return;
    }
    if (this.stopRequested) return;
    this.fail(new Error("Codex transport closed before turn completed"));
  }

  private fail(err: unknown): void {
    if (
      this.stopRequested ||
      this.snapshot.stage === "completed" ||
      this.snapshot.stage === "stopped" ||
      this.snapshot.stage === "failed"
    ) {
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    this.snapshot.error = message;
    this.snapshot.finishedAt = new Date();
    this.setStage("failed");
    this.emit({ type: "error", issueId: this.snapshot.issueId, error: message });
    this.emit({
      type: "completed",
      issueId: this.snapshot.issueId,
      reason: "error",
    });
    this.resolveDone?.(this.snapshot);
  }

  private setStage(stage: RunStage): void {
    if (this.snapshot.stage === stage) return;
    this.snapshot.stage = stage;
    this.emit({ type: "stageChanged", stage, issueId: this.snapshot.issueId });
  }

  private emit(event: AgentEvent): void {
    try {
      this.opts.onEvent?.(event);
    } catch {
      // observer errors are not fatal
    }
  }
}

function extractTokens(params: unknown): TokenUsage | null {
  if (!params || typeof params !== "object") return null;
  const obj = params as Record<string, unknown>;
  const total = (obj.totalTokenUsage ?? obj.total_token_usage) as
    | Record<string, unknown>
    | undefined;
  if (!total || typeof total !== "object") return null;
  const input = num(total.inputTokens ?? total.input_tokens);
  const output = num(total.outputTokens ?? total.output_tokens);
  const summed = num(total.totalTokens ?? total.total_tokens) ?? input + output;
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: summed,
  };
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function parseCommand(command: string): string[] {
  return command.trim().split(/\s+/).filter((s) => s.length > 0);
}
