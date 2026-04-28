import type { WorkflowConfig } from "./config/schema.js";
import type { Issue, Tracker } from "./tracker/types.js";
import type { WorkspaceManager } from "./workspace/manager.js";
import { Supervisor } from "./agent/supervisor.js";
import type { AgentEvent } from "./agent/types.js";
import { renderPrompt } from "./prompt.js";

export interface OrchestratorOptions {
  config: WorkflowConfig;
  tracker: Tracker;
  workspace: WorkspaceManager;
  promptTemplate: string;
  /** Override sleep/clock for tests. */
  scheduler?: Scheduler;
  /** Subscribe to agent events. */
  onAgentEvent?: (event: AgentEvent) => void;
  /** Subscribe to orchestrator-level events. */
  onTick?: (info: TickInfo) => void;
}

export interface Scheduler {
  setTimeout(handler: () => void, delayMs: number): { clear: () => void };
  now(): Date;
}

export interface TickInfo {
  startedAt: Date;
  finishedAt: Date;
  candidatesSeen: number;
  dispatched: number;
  reconciled: number;
  errors: string[];
}

const realScheduler: Scheduler = {
  setTimeout(handler, delayMs) {
    const t = setTimeout(handler, delayMs);
    return { clear: () => clearTimeout(t) };
  },
  now: () => new Date(),
};

export class Orchestrator {
  private supervisor: Supervisor;
  private scheduler: Scheduler;
  private timer: { clear: () => void } | null = null;
  private running = false;
  private claimed = new Set<string>();
  private terminalSet: Set<string>;
  private activeSet: Set<string>;

  constructor(private readonly opts: OrchestratorOptions) {
    this.scheduler = opts.scheduler ?? realScheduler;
    this.supervisor = new Supervisor({
      maxConcurrent: opts.config.agent.max_concurrent_agents,
      onEvent: (e) => {
        if (e.type === "completed") {
          this.claimed.delete(e.issueId);
        }
        opts.onAgentEvent?.(e);
      },
    });
    const trackerCfg = opts.config.tracker;
    this.activeSet = new Set(
      "active_states" in trackerCfg ? trackerCfg.active_states : [],
    );
    this.terminalSet = new Set(
      "terminal_states" in trackerCfg ? trackerCfg.terminal_states : [],
    );
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNextTick(0);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.timer?.clear();
    this.timer = null;
    await this.supervisor.stopAll();
    this.claimed.clear();
  }

  /** Snapshot of currently active runs. */
  list() {
    return this.supervisor.list();
  }

  private scheduleNextTick(delayMs: number): void {
    if (!this.running) return;
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      void this.tick().finally(() => {
        this.scheduleNextTick(this.opts.config.polling.interval_ms);
      });
    }, delayMs);
  }

  async tick(): Promise<TickInfo> {
    const startedAt = this.scheduler.now();
    const info: TickInfo = {
      startedAt,
      finishedAt: startedAt,
      candidatesSeen: 0,
      dispatched: 0,
      reconciled: 0,
      errors: [],
    };
    try {
      info.reconciled = await this.reconcileClaimed(info);
      const candidates = await this.opts.tracker.fetchCandidateIssues();
      info.candidatesSeen = candidates.length;
      info.dispatched = await this.dispatchNewCandidates(candidates, info);
    } catch (err) {
      info.errors.push(err instanceof Error ? err.message : String(err));
    } finally {
      info.finishedAt = this.scheduler.now();
      this.opts.onTick?.(info);
    }
    return info;
  }

  private async reconcileClaimed(info: TickInfo): Promise<number> {
    if (this.claimed.size === 0) return 0;
    const ids = [...this.claimed];
    let reconciled = 0;
    try {
      const states = await this.opts.tracker.fetchIssueStatesByIds(ids);
      for (const id of ids) {
        const state = states.get(id);
        if (state && this.terminalSet.has(state)) {
          await this.supervisor.stop(id);
          this.claimed.delete(id);
          reconciled++;
        }
      }
    } catch (err) {
      info.errors.push(
        `reconcile: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return reconciled;
  }

  private async dispatchNewCandidates(
    candidates: readonly Issue[],
    info: TickInfo,
  ): Promise<number> {
    let dispatched = 0;
    for (const issue of candidates) {
      if (this.claimed.has(issue.id)) continue;
      if (!this.activeSet.has(issue.state)) continue;
      try {
        const { path } = await this.opts.workspace.ensure(issue.identifier, {
          ISSUE_ID: issue.id,
          ISSUE_IDENTIFIER: issue.identifier,
          ISSUE_TITLE: issue.title,
          ISSUE_URL: issue.url,
          REPO: extractRepo(issue.identifier) ?? "",
        });
        const prompt = renderPrompt(this.opts.promptTemplate, { issue });
        const runner = this.supervisor.start({
          input: { issue, workspacePath: path, prompt },
          config: this.opts.config,
        });
        if (runner) {
          this.claimed.add(issue.id);
          dispatched++;
        }
      } catch (err) {
        info.errors.push(
          `dispatch ${issue.identifier}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return dispatched;
  }
}

function extractRepo(identifier: string): string | null {
  const i = identifier.lastIndexOf("#");
  if (i === -1) return null;
  return identifier.slice(0, i);
}
