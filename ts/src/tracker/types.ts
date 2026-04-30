export interface Issue {
  /** Stable identifier — for GitHub, the GraphQL node id. */
  id: string;
  /** Human-readable identifier — for GitHub, "owner/repo#123". */
  identifier: string;
  title: string;
  description: string;
  /** Mapped state name — for GitHub, the active label without the `status:` prefix. */
  state: string;
  /** Optional priority. GitHub doesn't have one natively; left null. */
  priority: number | null;
  /** Suggested branch name; derived from issue number + slugified title. */
  branchName: string;
  url: string;
  assigneeId: string | null;
  labels: string[];
  /** Issues this one is blocked by. Derived from "Blocked by #N" mentions or task lists. */
  blockedBy: BlockedReference[];
  assignedToWorker: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface BlockedReference {
  id: string;
  identifier: string;
  state: string;
}

export interface Tracker {
  fetchCandidateIssues(): Promise<Issue[]>;
  fetchIssuesByStates(states: readonly string[]): Promise<Issue[]>;
  fetchIssueStatesByIds(
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
  createComment(issueId: string, body: string): Promise<void>;
  updateIssueState(issueId: string, stateName: string): Promise<void>;
}
