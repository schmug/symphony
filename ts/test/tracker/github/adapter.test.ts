import { describe, it, expect, beforeEach } from "vitest";
import { GitHubAdapter } from "../../../src/tracker/github/adapter.js";
import type {
  GitHubClient,
  GitHubIssueRaw,
} from "../../../src/tracker/github/client.js";

interface MockCall {
  method: string;
  args: unknown[];
}

class MockClient implements GitHubClient {
  searchResults: GitHubIssueRaw[] = [];
  nodeResults: GitHubIssueRaw[] = [];
  calls: MockCall[] = [];
  searchQueries: string[] = [];
  existingLabels = new Set<string>();

  async searchIssues(query: string): Promise<GitHubIssueRaw[]> {
    this.searchQueries.push(query);
    this.calls.push({ method: "searchIssues", args: [query] });
    return [...this.searchResults];
  }
  async fetchIssuesByNodeIds(ids: readonly string[]): Promise<GitHubIssueRaw[]> {
    this.calls.push({ method: "fetchIssuesByNodeIds", args: [[...ids]] });
    return this.nodeResults.filter((r) => ids.includes(r.nodeId));
  }
  async addComment(id: string, body: string): Promise<void> {
    this.calls.push({ method: "addComment", args: [id, body] });
  }
  async addLabels(
    owner: string,
    repo: string,
    n: number,
    labels: readonly string[],
  ): Promise<void> {
    this.calls.push({ method: "addLabels", args: [owner, repo, n, [...labels]] });
  }
  async removeLabel(
    owner: string,
    repo: string,
    n: number,
    label: string,
  ): Promise<void> {
    this.calls.push({ method: "removeLabel", args: [owner, repo, n, label] });
  }
  async ensureLabel(owner: string, repo: string, name: string): Promise<void> {
    this.calls.push({ method: "ensureLabel", args: [owner, repo, name] });
    this.existingLabels.add(`${owner}/${repo}:${name}`);
  }
}

function rawIssue(overrides: Partial<GitHubIssueRaw> = {}): GitHubIssueRaw {
  return {
    nodeId: "I_node_1",
    owner: "schmug",
    repo: "dmarcheck",
    number: 42,
    title: "Add OAuth",
    body: "",
    url: "https://github.com/schmug/dmarcheck/issues/42",
    state: "open",
    labels: ["status:todo"],
    assigneeIds: [],
    primaryAssigneeId: null,
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

const baseConfig = {
  kind: "github" as const,
  api_key: "ghp_test",
  repos: ["schmug/dmarcheck", "schmug/donthype-me"],
  active_states: ["status:todo", "status:in-progress"],
  terminal_states: ["status:done"],
};

describe("GitHubAdapter", () => {
  let client: MockClient;
  let adapter: GitHubAdapter;

  beforeEach(() => {
    client = new MockClient();
    adapter = new GitHubAdapter({ config: baseConfig, client });
  });

  describe("fetchCandidateIssues", () => {
    it("issues one search per configured repo with active_states OR'd", async () => {
      client.searchResults = [];
      await adapter.fetchCandidateIssues();
      expect(client.searchQueries).toHaveLength(2);
      expect(client.searchQueries[0]).toContain("repo:schmug/dmarcheck");
      expect(client.searchQueries[0]).toContain(
        "label:status:todo,status:in-progress",
      );
      expect(client.searchQueries[0]).toContain("is:issue");
      expect(client.searchQueries[0]).toContain("is:open");
      expect(client.searchQueries[1]).toContain("repo:schmug/donthype-me");
    });

    it("normalizes results into Issue records with correct identifier and branch", async () => {
      client.searchResults = [
        rawIssue({ nodeId: "n1", number: 7, title: "Fix Login Bug" }),
      ];
      const issues = await adapter.fetchCandidateIssues();
      expect(issues).toHaveLength(2);
      const first = issues[0]!;
      expect(first.id).toBe("n1");
      expect(first.identifier).toBe("schmug/dmarcheck#7");
      expect(first.state).toBe("status:todo");
      expect(first.branchName).toBe("claude/issue-7-fix-login-bug");
      expect(first.url).toContain("github.com/schmug/dmarcheck/issues/");
    });

    it("filters out issues whose labels don't include any known state", async () => {
      client.searchResults = [
        rawIssue({ nodeId: "match", labels: ["status:todo"] }),
        rawIssue({ nodeId: "no-match", labels: ["bug"] }),
      ];
      const issues = await adapter.fetchCandidateIssues();
      const ids = issues.map((i) => i.id);
      expect(ids).toContain("match");
      expect(ids).not.toContain("no-match");
    });

    it("extracts blockedBy from `Blocked by #N` mentions in the body", async () => {
      client.searchResults = [
        rawIssue({ nodeId: "n1", body: "Blocked by #5 and #6 (unrelated)" }),
      ];
      const [issue] = await adapter.fetchCandidateIssues();
      expect(issue!.blockedBy).toEqual([
        { id: "schmug/dmarcheck#5", identifier: "schmug/dmarcheck#5", state: "" },
      ]);
    });

    it("returns [] when active_states is empty", async () => {
      const empty = new GitHubAdapter({
        config: { ...baseConfig, active_states: [] },
        client,
      });
      expect(await empty.fetchCandidateIssues()).toEqual([]);
      expect(client.searchQueries).toHaveLength(0);
    });
  });

  describe("fetchIssuesByStates", () => {
    it("uses provided states instead of active_states", async () => {
      await adapter.fetchIssuesByStates(["status:done"]);
      expect(client.searchQueries[0]).toContain("label:status:done");
    });
  });

  describe("fetchIssueStatesByIds", () => {
    it("returns a map of nodeId → mapped state, omitting unknown states", async () => {
      client.nodeResults = [
        rawIssue({ nodeId: "a", labels: ["status:in-progress"] }),
        rawIssue({ nodeId: "b", labels: ["bug"] }),
      ];
      const map = await adapter.fetchIssueStatesByIds(["a", "b"]);
      expect(map.get("a")).toBe("status:in-progress");
      expect(map.has("b")).toBe(false);
    });

    it("returns empty for empty input without making a request", async () => {
      const map = await adapter.fetchIssueStatesByIds([]);
      expect(map.size).toBe(0);
      expect(client.calls).toHaveLength(0);
    });
  });

  describe("createComment", () => {
    it("delegates to client.addComment with the node id", async () => {
      await adapter.createComment("I_xyz", "hello");
      expect(client.calls).toContainEqual({
        method: "addComment",
        args: ["I_xyz", "hello"],
      });
    });
  });

  describe("updateIssueState", () => {
    it("ensures the new label, removes other known-state labels, and adds the new label", async () => {
      client.searchResults = [
        rawIssue({ nodeId: "n1", labels: ["status:todo"] }),
      ];
      client.nodeResults = [
        rawIssue({ nodeId: "n1", labels: ["status:todo"] }),
      ];
      await adapter.fetchCandidateIssues();
      client.calls.length = 0;

      await adapter.updateIssueState("n1", "status:in-progress");

      const methods = client.calls.map((c) => c.method);
      expect(methods).toContain("ensureLabel");
      expect(methods).toContain("removeLabel");
      expect(methods).toContain("addLabels");

      const remove = client.calls.find((c) => c.method === "removeLabel");
      expect(remove!.args).toEqual([
        "schmug",
        "dmarcheck",
        42,
        "status:todo",
      ]);
      const add = client.calls.find((c) => c.method === "addLabels");
      expect(add!.args).toEqual([
        "schmug",
        "dmarcheck",
        42,
        ["status:in-progress"],
      ]);
    });

    it("hydrates location via fetchIssuesByNodeIds when not previously seen", async () => {
      client.nodeResults = [
        rawIssue({ nodeId: "n2", number: 99, labels: ["status:todo"] }),
      ];
      await adapter.updateIssueState("n2", "status:done");
      const fetchCalls = client.calls.filter(
        (c) => c.method === "fetchIssuesByNodeIds",
      );
      expect(fetchCalls.length).toBeGreaterThanOrEqual(1);
      const add = client.calls.find((c) => c.method === "addLabels");
      expect(add!.args[2]).toBe(99);
    });

    it("throws when the issue cannot be located", async () => {
      client.nodeResults = [];
      await expect(
        adapter.updateIssueState("nope", "status:done"),
      ).rejects.toThrow(/nope/);
    });

    it("does not remove the new label if it's already present", async () => {
      client.searchResults = [
        rawIssue({ nodeId: "n1", labels: ["status:in-progress"] }),
      ];
      client.nodeResults = [
        rawIssue({ nodeId: "n1", labels: ["status:in-progress"] }),
      ];
      await adapter.fetchCandidateIssues();
      client.calls.length = 0;

      await adapter.updateIssueState("n1", "status:in-progress");

      const removes = client.calls.filter((c) => c.method === "removeLabel");
      expect(removes).toHaveLength(0);
    });
  });
});
