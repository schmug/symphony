import { describe, it, expect } from "vitest";
import { StateStore } from "../../src/observability/state-store.js";
import type { RunSnapshot } from "../../src/agent/types.js";

function snap(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    issueId: "a",
    identifier: "owner/repo#1",
    stage: "running",
    startedAt: new Date(),
    finishedAt: null,
    threadId: null,
    turnId: null,
    sessionId: null,
    turnNumber: 1,
    tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    lastEventAt: null,
    lastEventSummary: null,
    error: null,
    ...overrides,
  };
}

describe("StateStore", () => {
  it("aggregates token usage across runs", () => {
    const s = new StateStore();
    s.upsertRun(snap({ issueId: "a", tokens: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } }));
    s.upsertRun(snap({ issueId: "b", tokens: { inputTokens: 200, outputTokens: 75, totalTokens: 275 } }));
    const snapshot = s.snapshot();
    expect(snapshot.totalTokens.totalTokens).toBe(425);
    expect(snapshot.totalTokens.inputTokens).toBe(300);
    expect(snapshot.totalTokens.outputTokens).toBe(125);
  });

  it("applies stageChanged events to existing runs", () => {
    const s = new StateStore();
    s.upsertRun(snap({ issueId: "a", stage: "running" }));
    s.apply({
      kind: "agent",
      event: { type: "stageChanged", stage: "completed", issueId: "a" },
    });
    expect(s.snapshot().runs.get("a")?.stage).toBe("completed");
  });

  it("accumulates tick metrics", () => {
    const s = new StateStore();
    const t1 = new Date();
    s.apply({
      kind: "tick",
      tick: {
        startedAt: t1,
        finishedAt: t1,
        candidatesSeen: 3,
        dispatched: 2,
        reconciled: 0,
        errors: [],
      },
    });
    s.apply({
      kind: "tick",
      tick: {
        startedAt: t1,
        finishedAt: t1,
        candidatesSeen: 1,
        dispatched: 0,
        reconciled: 1,
        errors: ["api 500"],
      },
    });
    const snap = s.snapshot();
    expect(snap.totalCandidatesSeen).toBe(4);
    expect(snap.totalDispatched).toBe(2);
    expect(snap.totalErrors).toBe(1);
    expect(snap.recentErrors[0]).toContain("api 500");
  });

  it("caps recentErrors at 50", () => {
    const s = new StateStore();
    for (let i = 0; i < 60; i++) {
      s.apply({
        kind: "agent",
        event: { type: "error", issueId: "x", error: `err-${i}` },
      });
    }
    expect(s.snapshot().recentErrors).toHaveLength(50);
    expect(s.snapshot().recentErrors[0]).toContain("err-10");
  });
});
