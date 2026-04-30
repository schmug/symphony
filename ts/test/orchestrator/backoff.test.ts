import { describe, it, expect } from "vitest";
import {
  computeBackoffMs,
  DEFAULT_BACKOFF_LADDER_MS,
  DEFAULT_MAX_ATTEMPTS,
  isEligible,
} from "../../src/orchestrator/backoff.js";

describe("computeBackoffMs", () => {
  it("uses the first ladder rung after 1 attempt", () => {
    const ms = computeBackoffMs({ attempts: 1, jitter: () => 0.5 });
    expect(ms).toBe(DEFAULT_BACKOFF_LADDER_MS[0]);
  });

  it("walks the ladder by attempt count", () => {
    const ms2 = computeBackoffMs({ attempts: 2, jitter: () => 0.5 });
    const ms3 = computeBackoffMs({ attempts: 3, jitter: () => 0.5 });
    expect(ms2).toBe(DEFAULT_BACKOFF_LADDER_MS[1]);
    expect(ms3).toBe(DEFAULT_BACKOFF_LADDER_MS[2]);
  });

  it("clamps to the last rung once attempts exceed the ladder length", () => {
    const last = DEFAULT_BACKOFF_LADDER_MS[DEFAULT_BACKOFF_LADDER_MS.length - 1]!;
    const ms = computeBackoffMs({ attempts: 99, jitter: () => 0.5 });
    expect(ms).toBe(last);
  });

  it("applies jitter in the [-20%, +20%] band", () => {
    const minMs = computeBackoffMs({ attempts: 1, jitter: () => 0 });
    const maxMs = computeBackoffMs({ attempts: 1, jitter: () => 1 });
    const base = DEFAULT_BACKOFF_LADDER_MS[0]!;
    expect(minMs).toBe(Math.floor(base * 0.8));
    expect(maxMs).toBe(Math.floor(base * 1.2));
  });

  it("treats attempts <= 0 as attempts=1", () => {
    expect(computeBackoffMs({ attempts: 0, jitter: () => 0.5 })).toBe(
      DEFAULT_BACKOFF_LADDER_MS[0],
    );
    expect(computeBackoffMs({ attempts: -3, jitter: () => 0.5 })).toBe(
      DEFAULT_BACKOFF_LADDER_MS[0],
    );
  });

  it("uses a custom ladder when provided", () => {
    const ms = computeBackoffMs({
      attempts: 2,
      jitter: () => 0.5,
      ladderMs: [100, 200, 400],
    });
    expect(ms).toBe(200);
  });
});

describe("isEligible", () => {
  it("is eligible when no entry exists", () => {
    expect(isEligible(undefined, new Date())).toBe(true);
  });

  it("is not eligible while nextEligibleAt is in the future", () => {
    const future = new Date(Date.now() + 60_000);
    expect(
      isEligible(
        { attempts: 1, nextEligibleAt: future, lastError: "x", givenUp: false, stateAtGiveUp: null },
        new Date(),
      ),
    ).toBe(false);
  });

  it("is eligible once nextEligibleAt has passed", () => {
    const past = new Date(Date.now() - 1);
    expect(
      isEligible(
        { attempts: 1, nextEligibleAt: past, lastError: "x", givenUp: false, stateAtGiveUp: null },
        new Date(),
      ),
    ).toBe(true);
  });

  it("is never eligible while givenUp is true", () => {
    const past = new Date(Date.now() - 10_000);
    expect(
      isEligible(
        { attempts: DEFAULT_MAX_ATTEMPTS, nextEligibleAt: past, lastError: "x", givenUp: true, stateAtGiveUp: "status:todo" },
        new Date(),
      ),
    ).toBe(false);
  });
});
