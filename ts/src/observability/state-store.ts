import type { RunSnapshot, TokenUsage } from "../agent/types.js";
import type { TickInfo } from "../orchestrator.js";
import type { SymphonyEvent } from "./pubsub.js";

export interface ObservabilitySnapshot {
  startedAt: Date;
  lastTickAt: Date | null;
  nextTickAt: Date | null;
  totalCandidatesSeen: number;
  totalDispatched: number;
  totalErrors: number;
  totalTokens: TokenUsage;
  runs: Map<string, RunSnapshot>;
  recentErrors: string[];
}

const MAX_RECENT_ERRORS = 50;

/**
 * Aggregates events from PubSub into a single snapshot used by the TUI and
 * the web dashboard. Pure data — render concerns belong to the consumer.
 */
export class StateStore {
  private startedAt = new Date();
  private lastTickAt: Date | null = null;
  private nextTickAt: Date | null = null;
  private totalCandidatesSeen = 0;
  private totalDispatched = 0;
  private totalErrors = 0;
  private runs = new Map<string, RunSnapshot>();
  private recentErrors: string[] = [];

  apply(event: SymphonyEvent): void {
    if (event.kind === "agent") {
      this.applyAgentEvent(event.event);
    } else {
      this.applyTick(event.tick);
    }
  }

  snapshot(): ObservabilitySnapshot {
    return {
      startedAt: this.startedAt,
      lastTickAt: this.lastTickAt,
      nextTickAt: this.nextTickAt,
      totalCandidatesSeen: this.totalCandidatesSeen,
      totalDispatched: this.totalDispatched,
      totalErrors: this.totalErrors,
      totalTokens: this.computeTotalTokens(),
      runs: new Map(this.runs),
      recentErrors: [...this.recentErrors],
    };
  }

  setNextTickAt(at: Date | null): void {
    this.nextTickAt = at;
  }

  upsertRun(snap: RunSnapshot): void {
    this.runs.set(snap.issueId, snap);
  }

  private applyAgentEvent(event: import("../agent/types.js").AgentEvent): void {
    switch (event.type) {
      case "stageChanged": {
        const existing = this.runs.get(event.issueId);
        if (existing) {
          this.runs.set(event.issueId, { ...existing, stage: event.stage });
        }
        break;
      }
      case "tokenUsage": {
        const existing = this.runs.get(event.issueId);
        if (existing) {
          this.runs.set(event.issueId, { ...existing, tokens: event.usage });
        }
        break;
      }
      case "rawCodexEvent": {
        const existing = this.runs.get(event.issueId);
        if (existing) {
          this.runs.set(event.issueId, {
            ...existing,
            lastEventAt: new Date(),
            lastEventSummary: event.summary,
          });
        }
        break;
      }
      case "error":
        this.totalErrors++;
        this.pushError(`${event.issueId}: ${event.error}`);
        break;
      case "completed":
        // Keep the snapshot in `runs` so the dashboard can show recently
        // finished items; downstream code can prune as needed.
        break;
    }
  }

  private applyTick(tick: TickInfo): void {
    this.lastTickAt = tick.finishedAt;
    this.totalCandidatesSeen += tick.candidatesSeen;
    this.totalDispatched += tick.dispatched;
    for (const err of tick.errors) {
      this.totalErrors++;
      this.pushError(`tick: ${err}`);
    }
  }

  private pushError(msg: string): void {
    this.recentErrors.push(msg);
    if (this.recentErrors.length > MAX_RECENT_ERRORS) {
      this.recentErrors.shift();
    }
  }

  private computeTotalTokens(): TokenUsage {
    let input = 0;
    let output = 0;
    let total = 0;
    for (const run of this.runs.values()) {
      input += run.tokens.inputTokens;
      output += run.tokens.outputTokens;
      total += run.tokens.totalTokens;
    }
    return { inputTokens: input, outputTokens: output, totalTokens: total };
  }
}
