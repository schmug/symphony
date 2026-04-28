import { AgentRunner, type AgentRunnerOptions } from "./runner.js";
import type { AgentEvent, RunSnapshot } from "./types.js";

export interface SupervisorOptions {
  maxConcurrent: number;
  onEvent?: (event: AgentEvent) => void;
}

export class Supervisor {
  private runners = new Map<string, AgentRunner>();

  constructor(private readonly opts: SupervisorOptions) {}

  size(): number {
    return this.runners.size;
  }

  has(issueId: string): boolean {
    return this.runners.has(issueId);
  }

  list(): RunSnapshot[] {
    return [...this.runners.values()].map((r) => r.current());
  }

  /**
   * Start an agent for the given input. Returns the started runner, or `null`
   * if at capacity / already running for this issue.
   */
  start(
    runnerOptions: Omit<AgentRunnerOptions, "onEvent">,
  ): AgentRunner | null {
    const issueId = runnerOptions.input.issue.id;
    if (this.runners.has(issueId)) return null;
    if (this.runners.size >= this.opts.maxConcurrent) return null;
    const runner = new AgentRunner({
      ...runnerOptions,
      onEvent: (e) => {
        this.opts.onEvent?.(e);
        if (e.type === "completed") {
          this.runners.delete(issueId);
        }
      },
    });
    this.runners.set(issueId, runner);
    void runner.start();
    return runner;
  }

  async stop(issueId: string): Promise<void> {
    const runner = this.runners.get(issueId);
    if (!runner) return;
    await runner.stop();
    this.runners.delete(issueId);
  }

  async stopAll(): Promise<void> {
    const all = [...this.runners.values()];
    this.runners.clear();
    await Promise.allSettled(all.map((r) => r.stop()));
  }
}
