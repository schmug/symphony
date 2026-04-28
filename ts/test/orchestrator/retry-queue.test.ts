import { describe, it, expect, beforeEach } from "vitest";
import { RetryQueue } from "../../src/orchestrator/retry-queue.js";

const FIXED_NOW = new Date("2026-04-28T00:00:00Z");

describe("RetryQueue", () => {
  let queue: RetryQueue;
  beforeEach(() => {
    queue = new RetryQueue({
      maxAttempts: 3,
      ladderMs: [1_000, 10_000, 100_000],
      jitter: () => 0.5,
    });
  });

  it("recordFailure increments attempts and sets nextEligibleAt = now + ladder[attempts-1]", () => {
    queue.recordFailure("a", "boom", FIXED_NOW);
    const entry = queue.snapshot("a")!;
    expect(entry.attempts).toBe(1);
    expect(entry.lastError).toBe("boom");
    expect(entry.nextEligibleAt.getTime()).toBe(FIXED_NOW.getTime() + 1_000);
    expect(entry.givenUp).toBe(false);
  });

  it("subsequent failures walk the ladder", () => {
    queue.recordFailure("a", "first", FIXED_NOW);
    queue.recordFailure("a", "second", FIXED_NOW);
    const entry = queue.snapshot("a")!;
    expect(entry.attempts).toBe(2);
    expect(entry.nextEligibleAt.getTime()).toBe(FIXED_NOW.getTime() + 10_000);
    expect(entry.lastError).toBe("second");
  });

  it("recordSuccess clears the entry", () => {
    queue.recordFailure("a", "boom", FIXED_NOW);
    queue.recordSuccess("a");
    expect(queue.snapshot("a")).toBeUndefined();
  });

  it("isEligible respects the nextEligibleAt cursor", () => {
    queue.recordFailure("a", "boom", FIXED_NOW);
    expect(queue.isEligible("a", FIXED_NOW)).toBe(false);
    expect(queue.isEligible("a", new Date(FIXED_NOW.getTime() + 999))).toBe(false);
    expect(queue.isEligible("a", new Date(FIXED_NOW.getTime() + 1_001))).toBe(true);
  });

  it("after maxAttempts, the entry is given up and includes stateAtGiveUp", () => {
    queue.recordFailure("a", "1", FIXED_NOW, "status:todo");
    queue.recordFailure("a", "2", FIXED_NOW, "status:todo");
    const result = queue.recordFailure("a", "3", FIXED_NOW, "status:todo");
    expect(result.givenUp).toBe(true);
    const entry = queue.snapshot("a")!;
    expect(entry.givenUp).toBe(true);
    expect(entry.stateAtGiveUp).toBe("status:todo");
    expect(entry.attempts).toBe(3);
    expect(queue.isEligible("a", new Date(FIXED_NOW.getTime() + 1_000_000))).toBe(false);
  });

  it("clearIfStateChanged removes a tombstone whose state has changed", () => {
    queue.recordFailure("a", "1", FIXED_NOW, "status:todo");
    queue.recordFailure("a", "2", FIXED_NOW, "status:todo");
    queue.recordFailure("a", "3", FIXED_NOW, "status:todo");
    expect(queue.snapshot("a")?.givenUp).toBe(true);
    queue.clearIfStateChanged("a", "status:rework");
    expect(queue.snapshot("a")).toBeUndefined();
  });

  it("clearIfStateChanged is a no-op when state is unchanged", () => {
    queue.recordFailure("a", "1", FIXED_NOW, "status:todo");
    queue.recordFailure("a", "2", FIXED_NOW, "status:todo");
    queue.recordFailure("a", "3", FIXED_NOW, "status:todo");
    queue.clearIfStateChanged("a", "status:todo");
    expect(queue.snapshot("a")?.givenUp).toBe(true);
  });

  it("clearIfStateChanged is a no-op for non-given-up entries", () => {
    queue.recordFailure("a", "boom", FIXED_NOW, "status:todo");
    queue.clearIfStateChanged("a", "status:rework");
    // Still present (just throttled, not tombstoned)
    expect(queue.snapshot("a")).toBeDefined();
  });

  it("givenUpIds returns only tombstoned ids", () => {
    queue.recordFailure("a", "1", FIXED_NOW, "status:todo");
    queue.recordFailure("a", "2", FIXED_NOW, "status:todo");
    queue.recordFailure("a", "3", FIXED_NOW, "status:todo");
    queue.recordFailure("b", "1", FIXED_NOW, "status:todo");
    expect(queue.givenUpIds().sort()).toEqual(["a"]);
  });
});
