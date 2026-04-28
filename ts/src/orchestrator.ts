import type { WorkflowConfig } from "./config/schema.js";
import type { Issue, Tracker } from "./tracker/types.js";
import type { WorkspaceManager } from "./workspace/manager.js";
import { Supervisor } from "./agent/supervisor.js";
import type { AgentEvent } from "./agent/types.js";
import { renderPrompt } from "./prompt.js";
import { RetryQueue } from "./orchestrator/retry-queue.js";

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
  /** Inject a retry queue (tests). Defaults to a new instance. */
  retryQueue?: RetryQueue;
  /** Logger callback for retry queue activity. */
  onRetryEvent?: (event: RetryEvent) => void;
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
  skippedBackoff: number;
  tombstonesCleared: number;
  errors: string[];
}

export type RetryEvent =
  | {
      type: "failureRecorded";
      issueId: string;
      attempts: number;
      nextEligibleAt: Date;
      error: string;
    }
  | { type: "givenUp"; issueId: string; attempts: number; error: string }
  | { type: "tombstoneCleared"; issueId: string; reason: string }
  | { type: "giveUpCommentFailed"; issueId: string; error: string };

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
  private claimedStates = new Map<string, string>();
  private terminalSet: Set<string>;
  private activeSet: Set<string>;
  private retryQueue: RetryQueue;

  constructor(private readonly opts: OrchestratorOptions) {
    this.scheduler = opts.scheduler ?? realScheduler;
    this.retryQueue = opts.retryQueue ?? new RetryQueue();
    this.supervisor = new Supervisor({
      maxConcurrent: opts.config.agent.max_concurrent_agents,
      onEvent: (e) => {
        this.handleAgentEvent(e);
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
    this.claimedStates.clear();
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
      skippedBackoff: 0,
      tombstonesCleared: 0,
      errors: [],
    };
    try {
      info.reconciled = await this.reconcileClaimed(info);
      info.tombstonesCleared = await this.reconcileTombstones(info);
      const candidates = await this.opts.tracker.fetchCandidateIssues();
      info.candidatesSeen = candidates.length;
      const result = await this.dispatchNewCandidates(candidates, info);
      info.dispatched = result.dispatched;
      info.skippedBackoff = result.skippedBackoff;
    } catch (err) {
      info.errors.push(err instanceof Error ? err.message : String(err));
    } finally {
      info.finishedAt = this.scheduler.now();
      this.opts.onTick?.(info);
    }
    return info;
  }

  private handleAgentEvent(event: AgentEvent): void {
    if (event.type === "completed") {
      this.claimed.delete(event.issueId);
      const state = this.claimedStates.get(event.issueId) ?? null;
      this.claimedStates.delete(event.issueId);
      if (event.reason === "ok") {
        this.retryQueue.recordSuccess(event.issueId);
      } else if (event.reason === "stopped") {
        // Stopped by reconciliation (terminal state) — clear retry state.
        this.retryQueue.forget(event.issueId);
      }
      // For reason === "error" the failure was recorded by the matching
      // "error" event before this "completed" event arrives.
      void state; // recorded above for `error` already.
    } else if (event.type === "error") {
      const state = this.claimedStates.get(event.issueId) ?? null;
      const result = this.retryQueue.recordFailure(
        event.issueId,
        event.error,
        this.scheduler.now(),
        state,
      );
      this.opts.onRetryEvent?.({
        type: "failureRecorded",
        issueId: event.issueId,
        attempts: result.attempts,
        nextEligibleAt: result.nextEligibleAt,
        error: event.error,
      });
      if (result.givenUp) {
        this.opts.onRetryEvent?.({
          type: "givenUp",
          issueId: event.issueId,
          attempts: result.attempts,
          error: event.error,
        });
        void this.postGiveUpComment(event.issueId, result.attempts, event.error);
      }
    }
  }

  private async postGiveUpComment(
    issueId: string,
    attempts: number,
    lastError: string,
  ): Promise<void> {
    const body = renderGiveUpComment({ attempts, lastError });
    try {
      await this.opts.tracker.createComment(issueId, body);
    } catch (err) {
      this.opts.onRetryEvent?.({
        type: "giveUpCommentFailed",
        issueId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
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
          this.claimedStates.delete(id);
          this.retryQueue.forget(id);
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

  private async reconcileTombstones(info: TickInfo): Promise<number> {
    const allIds = this.retryQueue.allIds().filter((id) => !this.claimed.has(id));
    if (allIds.length === 0) return 0;
    let cleared = 0;
    try {
      const states = await this.opts.tracker.fetchIssueStatesByIds(allIds);
      for (const id of allIds) {
        const state = states.get(id);
        if (state === undefined) continue;
        const before = this.retryQueue.snapshot(id);
        if (!before) continue;
        // Non-tombstoned entry whose issue moved to terminal: clean up.
        if (!before.givenUp && this.terminalSet.has(state)) {
          this.retryQueue.forget(id);
          cleared++;
          this.opts.onRetryEvent?.({
            type: "tombstoneCleared",
            issueId: id,
            reason: `state ${state} is terminal`,
          });
          continue;
        }
        // Tombstoned entry whose state changed: clear so we'll retry.
        if (before.givenUp) {
          this.retryQueue.clearIfStateChanged(id, state);
          if (!this.retryQueue.snapshot(id)) {
            cleared++;
            this.opts.onRetryEvent?.({
              type: "tombstoneCleared",
              issueId: id,
              reason: `state changed to ${state}`,
            });
          }
        }
      }
    } catch (err) {
      info.errors.push(
        `tombstone-reconcile: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return cleared;
  }

  private async dispatchNewCandidates(
    candidates: readonly Issue[],
    info: TickInfo,
  ): Promise<{ dispatched: number; skippedBackoff: number }> {
    let dispatched = 0;
    let skippedBackoff = 0;
    const now = this.scheduler.now();
    for (const issue of candidates) {
      if (this.claimed.has(issue.id)) continue;
      if (!this.activeSet.has(issue.state)) continue;
      if (!this.retryQueue.isEligible(issue.id, now)) {
        skippedBackoff++;
        continue;
      }
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
          this.claimedStates.set(issue.id, issue.state);
          dispatched++;
        }
      } catch (err) {
        info.errors.push(
          `dispatch ${issue.identifier}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { dispatched, skippedBackoff };
  }
}

function renderGiveUpComment(opts: {
  attempts: number;
  lastError: string;
}): string {
  return [
    `Symphony stopped retrying after ${opts.attempts} failed attempt${opts.attempts === 1 ? "" : "s"}.`,
    "",
    "Last error:",
    "```",
    opts.lastError.trim(),
    "```",
    "",
    "To resume Symphony on this issue, change its state label (for example, remove and re-add the active state).",
  ].join("\n");
}

function extractRepo(identifier: string): string | null {
  const i = identifier.lastIndexOf("#");
  if (i === -1) return null;
  return identifier.slice(0, i);
}
