import { describe, it, expect } from "vitest";
import { snapshotToJson } from "../../src/ui/web-json.js";
import { StateStore } from "../../src/observability/state-store.js";

describe("snapshotToJson", () => {
  it("serializes the snapshot with formatted runtime, tokens, and runs", () => {
    const store = new StateStore();
    store.upsertRun({
      issueId: "a",
      identifier: "schmug/dmarcheck#42",
      stage: "running",
      startedAt: new Date(Date.now() - 30_000),
      finishedAt: null,
      threadId: null,
      turnId: null,
      sessionId: "019cabcdef0123456789",
      turnNumber: 2,
      tokens: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      lastEventAt: new Date(),
      lastEventSummary: "command output streaming",
      error: null,
    });
    const json = snapshotToJson(store.snapshot(), {
      pollingIntervalMs: 5000,
      maxConcurrent: 5,
      projectLabel: "schmug/dmarcheck",
    });
    expect(json.agentsActive).toBe(1);
    expect(json.agentsMax).toBe(5);
    expect(json.totalTokens.total).toBe(150);
    expect(json.runs).toHaveLength(1);
    const r = json.runs[0]!;
    expect(r.identifier).toBe("schmug/dmarcheck#42");
    expect(r.stage).toBe("running");
    expect(r.turnNumber).toBe(2);
    expect(r.sessionShort).toMatch(/019c\.\.\./);
    expect(r.ageMs).toBeGreaterThan(0);
  });

  it("reports zero throughput before any runtime", () => {
    const store = new StateStore();
    const json = snapshotToJson(store.snapshot(), {
      pollingIntervalMs: 1000,
      maxConcurrent: 1,
      projectLabel: "x",
    });
    expect(json.throughputTps).toBeGreaterThanOrEqual(0);
  });

  it("clamps recentErrors to the last 10", () => {
    const store = new StateStore();
    for (let i = 0; i < 25; i++) {
      store.apply({
        kind: "agent",
        event: { type: "error", issueId: "x", error: `err-${i}` },
      });
    }
    const json = snapshotToJson(store.snapshot(), {
      pollingIntervalMs: 1000,
      maxConcurrent: 1,
      projectLabel: "x",
    });
    expect(json.recentErrors.length).toBe(10);
    expect(json.recentErrors[0]).toContain("err-15");
  });
});
