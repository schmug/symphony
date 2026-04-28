import { describe, it, expect, beforeEach } from "vitest";
import { MemoryTracker } from "../../src/tracker/memory.js";
import type { Issue } from "../../src/tracker/types.js";

function fixture(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "id-1",
    identifier: "owner/repo#1",
    title: "Test issue",
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

describe("MemoryTracker", () => {
  let tracker: MemoryTracker;
  beforeEach(() => {
    tracker = new MemoryTracker({
      activeStates: ["status:todo", "status:in-progress"],
      terminalStates: ["status:done"],
    });
  });

  it("returns no candidates when empty", async () => {
    expect(await tracker.fetchCandidateIssues()).toEqual([]);
  });

  it("returns issues whose state is in activeStates", async () => {
    tracker.seed([
      fixture({ id: "a", state: "status:todo" }),
      fixture({ id: "b", state: "status:done" }),
      fixture({ id: "c", state: "status:in-progress" }),
    ]);
    const candidates = await tracker.fetchCandidateIssues();
    expect(candidates.map((i) => i.id).sort()).toEqual(["a", "c"]);
  });

  it("fetches issues by explicit state list", async () => {
    tracker.seed([
      fixture({ id: "a", state: "status:todo" }),
      fixture({ id: "b", state: "status:done" }),
    ]);
    const result = await tracker.fetchIssuesByStates(["status:done"]);
    expect(result.map((i) => i.id)).toEqual(["b"]);
  });

  it("fetches state map by ids, omitting unknown", async () => {
    tracker.seed([fixture({ id: "a", state: "status:todo" })]);
    const map = await tracker.fetchIssueStatesByIds(["a", "missing"]);
    expect(map.get("a")).toBe("status:todo");
    expect(map.has("missing")).toBe(false);
  });

  it("appends comments addressable by issue id", async () => {
    tracker.seed([fixture({ id: "a" })]);
    await tracker.createComment("a", "first");
    await tracker.createComment("a", "second");
    expect(tracker.commentsFor("a")).toEqual(["first", "second"]);
  });

  it("updates issue state and reflects it in subsequent reads", async () => {
    tracker.seed([fixture({ id: "a", state: "status:todo" })]);
    await tracker.updateIssueState("a", "status:in-progress");
    const map = await tracker.fetchIssueStatesByIds(["a"]);
    expect(map.get("a")).toBe("status:in-progress");
  });

  it("throws when commenting on or updating an unknown issue", async () => {
    await expect(tracker.createComment("nope", "x")).rejects.toThrow(/nope/);
    await expect(tracker.updateIssueState("nope", "x")).rejects.toThrow(/nope/);
  });
});
