export const DEFAULT_BACKOFF_LADDER_MS: readonly number[] = [
  5_000,
  30_000,
  120_000,
  600_000,
  3_600_000,
];

export const DEFAULT_MAX_ATTEMPTS = 5;

const JITTER_FRACTION = 0.2;

export interface BackoffEntry {
  /** Number of completed failed attempts. 1 means "first failure recorded." */
  attempts: number;
  nextEligibleAt: Date;
  lastError: string;
  /** Once true, the issue is tombstoned until its tracker state changes. */
  givenUp: boolean;
  /** Tracker state observed at give-up time, used to detect "user nudged it." */
  stateAtGiveUp: string | null;
}

export interface ComputeBackoffOptions {
  attempts: number;
  /** Returns a value in [0, 1). Default uses Math.random. */
  jitter?: () => number;
  ladderMs?: readonly number[];
}

/**
 * Returns the wait duration in ms for a given attempt count, with ±20% jitter.
 * `attempts == 1` selects the first rung; values exceeding the ladder length
 * clamp to the final rung.
 */
export function computeBackoffMs(opts: ComputeBackoffOptions): number {
  const ladder = opts.ladderMs ?? DEFAULT_BACKOFF_LADDER_MS;
  if (ladder.length === 0) return 0;
  const attempts = Math.max(1, opts.attempts);
  const idx = Math.min(attempts - 1, ladder.length - 1);
  const base = ladder[idx]!;
  const jitter = (opts.jitter ?? Math.random)();
  const jitterFactor = 1 + (jitter * 2 - 1) * JITTER_FRACTION;
  return Math.floor(base * jitterFactor);
}

export function isEligible(
  entry: BackoffEntry | undefined,
  now: Date,
): boolean {
  if (!entry) return true;
  if (entry.givenUp) return false;
  return entry.nextEligibleAt.getTime() <= now.getTime();
}
