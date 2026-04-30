import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Orchestrator, type RetryEvent } from "../../src/orchestrator.js";
import { MemoryTracker } from "../../src/tracker/memory.js";
import { WorkspaceManager } from "../../src/workspace/manager.js";
import { RetryQueue } from "../../src/orchestrator/retry-queue.js";
import type { Issue } from "../../src/tracker/types.js";
import type { WorkflowConfig } from "../../src/config/schema.js";

function fixture(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "id-1",
    identifier: "owner/repo#1",
    title: "Test",
    description: "",
    state: "status:todo",
    priority: null,
    branchName: "claude/issue-1",
    url: "https://github.com/owner/repo/issues/1",
    assigneeId: null,
    labels: ["status:todo"],
    blockedBy: [],
    assignedToWorker: true,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

const config: WorkflowConfig = {
  tracker: {
    kind: "memory",
    active_states: ["status:todo"],
    terminal_states: ["status:done"],
  },
  polling: { interval_ms: 1000 },
  workspace: { root: "/tmp" },
  hooks: {},
  agent: { max_concurrent_agents: 2, max_turns: 5, no_progress_timeout_ms: 0 },
  codex: {
    // `false` exits 1 immediately. SpawnTransport reports a close event
    // which the runner translates to a failure. This makes the integration
    // test deterministic without needing Codex on PATH.
    command: "false",
    approval_policy: "never",
    thread_sandbox: "workspace-write",
  },
};

describe("Orchestrator + RetryQueue (integration)", () => {
  let root: string;
  let tracker: MemoryTracker;
  let workspace: WorkspaceManager;
  let now: Date;
  let scheduler: { setTimeout: any; now: () => Date };
  let retryEvents: RetryEvent[];
  let retryQueue: RetryQueue;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "symphony-retry-"));
    tracker = new MemoryTracker({
      activeStates: ["status:todo"],
      terminalStates: ["status:done"],
    });
    workspace = new WorkspaceManager({ root });
    now = new Date("2026-04-28T00:00:00Z");
    scheduler = {
      setTimeout: () => ({ clear: () => {} }),
      now: () => now,
    };
    retryEvents = [];
    retryQueue = new RetryQueue({
      maxAttempts: 3,
      ladderMs: [1_000, 10_000, 100_000],
      jitter: () => 0.5,
    });
  });

  function makeOrchestrator() {
    return new Orchestrator({
      config,
      tracker,
      workspace,
      promptTemplate: "x",
      scheduler,
      retryQueue,
      onRetryEvent: (e) => retryEvents.push(e),
    });
  }

  /**
   * Waits up to `timeoutMs` for the retry queue to record at least
   * `expected` failed attempts for `id`. The runner's failure path goes
   * through a real subprocess spawn → close event → fail() chain, which
   * is asynchronous; polling makes the test deterministic across machines.
   */
  async function waitForAttempts(id: string, expected: number, timeoutMs = 5_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if ((retryQueue.snapshot(id)?.attempts ?? 0) >= expected) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(
      `Timed out waiting for ${expected} attempts on ${id} (got ${retryQueue.snapshot(id)?.attempts ?? 0})`,
    );
  }

  it("records a failure and skips dispatch until nextEligibleAt has passed", async () => {
    tracker.seed([fixture({ id: "a", identifier: "owner/repo#1" })]);
    const orch = makeOrchestrator();

    await orch.tick();
    await waitForAttempts("a", 1);

    expect(retryEvents.find((e) => e.type === "failureRecorded")).toBeDefined();
    expect(retryQueue.snapshot("a")?.attempts).toBe(1);
    expect(retryQueue.snapshot("a")?.nextEligibleAt.getTime()).toBe(
      now.getTime() + 1_000,
    );

    // Second tick at the same `now`: candidate is back, but skipped (backoff).
    const info = await orch.tick();
    expect(info.skippedBackoff).toBe(1);
    expect(info.dispatched).toBe(0);

    await orch.stop();
  });

  it("retries when nextEligibleAt has passed and reaches give-up after maxAttempts", async () => {
    tracker.seed([fixture({ id: "a", identifier: "owner/repo#1" })]);
    const orch = makeOrchestrator();

    for (let attempt = 1; attempt <= 3; attempt++) {
      await orch.tick();
      await waitForAttempts("a", attempt);
      const entry = retryQueue.snapshot("a");
      if (entry) {
        now = new Date(entry.nextEligibleAt.getTime() + 1);
      }
    }

    const finalEntry = retryQueue.snapshot("a");
    expect(finalEntry?.attempts).toBe(3);
    expect(finalEntry?.givenUp).toBe(true);
    expect(retryEvents.find((e) => e.type === "givenUp")).toBeDefined();

    // Symphony should have posted a give-up comment via the tracker.
    const comments = tracker.commentsFor("a");
    expect(comments.length).toBeGreaterThan(0);
    expect(comments[0]).toContain("Symphony stopped retrying");
    expect(comments[0]).toContain("3 failed attempts");

    // A subsequent tick must NOT dispatch (tombstoned) and must NOT count
    // as a backoff skip — tombstoned issues are simply ineligible.
    const info = await orch.tick();
    expect(info.dispatched).toBe(0);
    expect(info.skippedBackoff).toBe(1);

    await orch.stop();
  });

  it("clears the tombstone when the issue's state changes", async () => {
    tracker.seed([fixture({ id: "a", identifier: "owner/repo#1" })]);
    const orch = makeOrchestrator();

    // Force three failures via the retry queue directly (skip the spawn dance).
    retryQueue.recordFailure("a", "boom", now, "status:todo");
    retryQueue.recordFailure("a", "boom", now, "status:todo");
    retryQueue.recordFailure("a", "boom", now, "status:todo");
    expect(retryQueue.snapshot("a")?.givenUp).toBe(true);

    // User moves the issue out of the active state (e.g., to rework).
    await tracker.updateIssueState("a", "status:rework");

    const info = await orch.tick();
    expect(info.tombstonesCleared).toBe(1);
    expect(retryQueue.snapshot("a")).toBeUndefined();
    expect(retryEvents.find((e) => e.type === "tombstoneCleared")).toBeDefined();

    await orch.stop();
  });

  it("clears retry state on successful completion (issue moved to terminal)", async () => {
    tracker.seed([fixture({ id: "a", identifier: "owner/repo#1" })]);
    const orch = makeOrchestrator();

    // Seed a partial-failure state.
    retryQueue.recordFailure("a", "transient", now, "status:todo");
    expect(retryQueue.snapshot("a")).toBeDefined();

    // Issue is moved to terminal externally.
    await tracker.updateIssueState("a", "status:done");

    await orch.tick();
    // After reconcile, retry state is forgotten.
    expect(retryQueue.snapshot("a")).toBeUndefined();

    await orch.stop();
  });
});
