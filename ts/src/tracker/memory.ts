import type { Issue, Tracker } from "./types.js";

export interface MemoryTrackerOptions {
  activeStates: readonly string[];
  terminalStates: readonly string[];
}

export class MemoryTracker implements Tracker {
  private issues = new Map<string, Issue>();
  private comments = new Map<string, string[]>();

  constructor(private readonly opts: MemoryTrackerOptions) {}

  seed(issues: readonly Issue[]): void {
    this.issues.clear();
    this.comments.clear();
    for (const issue of issues) {
      this.issues.set(issue.id, { ...issue });
    }
  }

  async fetchCandidateIssues(): Promise<Issue[]> {
    const active = new Set(this.opts.activeStates);
    return [...this.issues.values()].filter((i) => active.has(i.state));
  }

  async fetchIssuesByStates(states: readonly string[]): Promise<Issue[]> {
    const wanted = new Set(states);
    return [...this.issues.values()].filter((i) => wanted.has(i.state));
  }

  async fetchIssueStatesByIds(
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    const out = new Map<string, string>();
    for (const id of ids) {
      const issue = this.issues.get(id);
      if (issue) out.set(id, issue.state);
    }
    return out;
  }

  async createComment(issueId: string, body: string): Promise<void> {
    if (!this.issues.has(issueId)) {
      throw new Error(`Unknown issue: ${issueId}`);
    }
    const list = this.comments.get(issueId) ?? [];
    list.push(body);
    this.comments.set(issueId, list);
  }

  async updateIssueState(issueId: string, stateName: string): Promise<void> {
    const issue = this.issues.get(issueId);
    if (!issue) throw new Error(`Unknown issue: ${issueId}`);
    this.issues.set(issueId, { ...issue, state: stateName });
  }

  commentsFor(issueId: string): readonly string[] {
    return this.comments.get(issueId) ?? [];
  }
}
