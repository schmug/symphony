import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Orchestrator } from "../src/orchestrator.js";
import { MemoryTracker } from "../src/tracker/memory.js";
import { WorkspaceManager } from "../src/workspace/manager.js";
import type { Issue } from "../src/tracker/types.js";
import type { WorkflowConfig } from "../src/config/schema.js";

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

const baseConfig: WorkflowConfig = {
  tracker: {
    kind: "memory",
    active_states: ["status:todo", "status:in-progress"],
    terminal_states: ["status:done"],
  },
  polling: { interval_ms: 1000 },
  workspace: { root: "/tmp" },
  hooks: {},
  agent: { max_concurrent_agents: 2, max_turns: 5, no_progress_timeout_ms: 0 },
  codex: {
    command: "codex app-server",
    approval_policy: "never",
    thread_sandbox: "workspace-write",
  },
};

describe("Orchestrator.tick", () => {
  let root: string;
  let tracker: MemoryTracker;
  let workspace: WorkspaceManager;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "symphony-orch-"));
    tracker = new MemoryTracker({
      activeStates: baseConfig.tracker.kind === "memory"
        ? baseConfig.tracker.active_states
        : [],
      terminalStates: baseConfig.tracker.kind === "memory"
        ? baseConfig.tracker.terminal_states
        : [],
    });
    workspace = new WorkspaceManager({
      root,
      hooks: {},
      runHook: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    });
  });

  it("dispatches new candidates up to max_concurrent_agents", async () => {
    tracker.seed([
      fixture({ id: "a", identifier: "owner/repo#1" }),
      fixture({ id: "b", identifier: "owner/repo#2" }),
      fixture({ id: "c", identifier: "owner/repo#3" }),
    ]);
    const orch = new Orchestrator({
      config: baseConfig,
      tracker,
      workspace,
      promptTemplate: "do {{ issue.identifier }}",
    });
    const info = await orch.tick();
    expect(info.candidatesSeen).toBe(3);
    expect(info.dispatched).toBe(2);
    await orch.stop();
  });

  it("does not re-dispatch already-claimed issues on the next tick", async () => {
    tracker.seed([fixture({ id: "a", identifier: "owner/repo#1" })]);
    const orch = new Orchestrator({
      config: baseConfig,
      tracker,
      workspace,
      promptTemplate: "x",
    });
    await orch.tick();
    const info2 = await orch.tick();
    expect(info2.dispatched).toBe(0);
    await orch.stop();
  });

  it("reconciles claimed issues that moved to a terminal state and stops them", async () => {
    tracker.seed([fixture({ id: "a", identifier: "owner/repo#1" })]);
    const orch = new Orchestrator({
      config: baseConfig,
      tracker,
      workspace,
      promptTemplate: "x",
    });
    await orch.tick();
    expect(orch.list()).toHaveLength(1);
    // The issue gets marked done externally
    await tracker.updateIssueState("a", "status:done");
    const info = await orch.tick();
    expect(info.reconciled).toBe(1);
    await orch.stop();
  });

  it("collects errors from tracker failures into TickInfo", async () => {
    const failingTracker = {
      ...tracker,
      fetchCandidateIssues: async () => {
        throw new Error("api down");
      },
      fetchIssuesByStates: tracker.fetchIssuesByStates.bind(tracker),
      fetchIssueStatesByIds: tracker.fetchIssueStatesByIds.bind(tracker),
      createComment: tracker.createComment.bind(tracker),
      updateIssueState: tracker.updateIssueState.bind(tracker),
    } as unknown as MemoryTracker;
    const orch = new Orchestrator({
      config: baseConfig,
      tracker: failingTracker,
      workspace,
      promptTemplate: "x",
    });
    const info = await orch.tick();
    expect(info.errors.length).toBeGreaterThan(0);
    await orch.stop();
  });

  it("ensures the workspace before dispatching", async () => {
    tracker.seed([fixture({ id: "a", identifier: "owner/repo#1" })]);
    const orch = new Orchestrator({
      config: baseConfig,
      tracker,
      workspace,
      promptTemplate: "x",
    });
    await orch.tick();
    expect(await workspace.exists("owner/repo#1")).toBe(true);
    await orch.stop();
  });
});

describe("Orchestrator.start (with injected scheduler)", () => {
  it("schedules a tick on start and reschedules at polling.interval_ms", async () => {
    const root = await mkdtemp(join(tmpdir(), "symphony-orch-"));
    const tracker = new MemoryTracker({
      activeStates: ["status:todo"],
      terminalStates: ["status:done"],
    });
    const workspace = new WorkspaceManager({ root });

    const queue: Array<{ handler: () => void; delayMs: number }> = [];
    const scheduler = {
      setTimeout: (handler: () => void, delayMs: number) => {
        queue.push({ handler, delayMs });
        return { clear: () => {} };
      },
      now: () => new Date(),
    };

    const tickInfos: Array<{ candidatesSeen: number }> = [];
    const orch = new Orchestrator({
      config: baseConfig,
      tracker,
      workspace,
      promptTemplate: "x",
      scheduler,
      onTick: (info) => tickInfos.push(info),
    });
    orch.start();
    expect(queue).toHaveLength(1);
    expect(queue[0]!.delayMs).toBe(0);
    queue[0]!.handler();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(tickInfos).toHaveLength(1);
    // After tick, next is scheduled at interval_ms
    expect(queue[1]?.delayMs).toBe(1000);
    await orch.stop();
  });
});
