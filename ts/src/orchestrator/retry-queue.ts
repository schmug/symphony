import {
  computeBackoffMs,
  DEFAULT_BACKOFF_LADDER_MS,
  DEFAULT_MAX_ATTEMPTS,
  isEligible,
  type BackoffEntry,
} from "./backoff.js";

export interface RetryQueueOptions {
  maxAttempts?: number;
  ladderMs?: readonly number[];
  jitter?: () => number;
}

export interface RecordFailureResult {
  attempts: number;
  givenUp: boolean;
  nextEligibleAt: Date;
}

/**
 * Per-issue retry state owned by the orchestrator. Pure data + math —
 * no IO, no scheduling. The orchestrator drives it.
 */
export class RetryQueue {
  private entries = new Map<string, BackoffEntry>();
  private readonly maxAttempts: number;
  private readonly ladderMs: readonly number[];
  private readonly jitter: () => number;

  constructor(opts: RetryQueueOptions = {}) {
    this.maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.ladderMs = opts.ladderMs ?? DEFAULT_BACKOFF_LADDER_MS;
    this.jitter = opts.jitter ?? Math.random;
  }

  recordFailure(
    issueId: string,
    error: string,
    now: Date,
    currentState: string | null = null,
  ): RecordFailureResult {
    const previous = this.entries.get(issueId);
    const attempts = (previous?.attempts ?? 0) + 1;
    const givenUp = attempts >= this.maxAttempts;
    const waitMs = computeBackoffMs({
      attempts,
      jitter: this.jitter,
      ladderMs: this.ladderMs,
    });
    const entry: BackoffEntry = {
      attempts,
      nextEligibleAt: new Date(now.getTime() + waitMs),
      lastError: error,
      givenUp,
      stateAtGiveUp: givenUp ? currentState : null,
    };
    this.entries.set(issueId, entry);
    return {
      attempts,
      givenUp,
      nextEligibleAt: entry.nextEligibleAt,
    };
  }

  recordSuccess(issueId: string): void {
    this.entries.delete(issueId);
  }

  /** Forget the entry entirely (e.g., issue moved to a terminal state). */
  forget(issueId: string): void {
    this.entries.delete(issueId);
  }

  isEligible(issueId: string, now: Date): boolean {
    return isEligible(this.entries.get(issueId), now);
  }

  snapshot(issueId: string): Readonly<BackoffEntry> | undefined {
    return this.entries.get(issueId);
  }

  givenUpIds(): string[] {
    const out: string[] = [];
    for (const [id, entry] of this.entries) {
      if (entry.givenUp) out.push(id);
    }
    return out;
  }

  allIds(): string[] {
    return [...this.entries.keys()];
  }

  /**
   * If a tombstoned issue's state has changed since give-up, clear the entry
   * so the orchestrator will dispatch it again on the next eligible tick.
   */
  clearIfStateChanged(issueId: string, currentState: string): void {
    const entry = this.entries.get(issueId);
    if (!entry || !entry.givenUp) return;
    if (entry.stateAtGiveUp !== currentState) {
      this.entries.delete(issueId);
    }
  }
}
