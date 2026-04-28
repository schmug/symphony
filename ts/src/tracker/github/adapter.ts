import type { GitHubTrackerConfig } from "../../config/schema.js";
import type { Issue, Tracker } from "../types.js";
import type { GitHubClient, GitHubIssueRaw } from "./client.js";
import { deriveBranchName, extractState, parseBlockedBy } from "./state.js";

export interface GitHubAdapterOptions {
  config: GitHubTrackerConfig;
  client: GitHubClient;
}

interface IssueLocation {
  owner: string;
  repo: string;
  number: number;
}

export class GitHubAdapter implements Tracker {
  private locations = new Map<string, IssueLocation>();

  constructor(private readonly opts: GitHubAdapterOptions) {}

  async fetchCandidateIssues(): Promise<Issue[]> {
    return this.searchAcrossRepos(this.opts.config.active_states);
  }

  async fetchIssuesByStates(states: readonly string[]): Promise<Issue[]> {
    return this.searchAcrossRepos(states);
  }

  async fetchIssueStatesByIds(
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    if (ids.length === 0) return new Map();
    const raws = await this.opts.client.fetchIssuesByNodeIds(ids);
    const known = this.knownStates();
    const out = new Map<string, string>();
    for (const raw of raws) {
      this.rememberLocation(raw);
      const state = stateForRaw(raw, known);
      if (state !== null) out.set(raw.nodeId, state);
    }
    return out;
  }

  async createComment(issueId: string, body: string): Promise<void> {
    await this.opts.client.addComment(issueId, body);
  }

  async updateIssueState(issueId: string, stateName: string): Promise<void> {
    const location = this.locations.get(issueId);
    if (!location) {
      const [hydrated] = await this.opts.client.fetchIssuesByNodeIds([issueId]);
      if (!hydrated) {
        throw new Error(`Cannot resolve location for issue ${issueId}`);
      }
      this.rememberLocation(hydrated);
    }
    const loc = this.locations.get(issueId)!;
    const known = this.knownStates();

    await this.opts.client.ensureLabel(loc.owner, loc.repo, stateName);

    const current = await this.opts.client.fetchIssuesByNodeIds([issueId]);
    const currentLabels = current[0]?.labels ?? [];
    for (const label of currentLabels) {
      if (label !== stateName && known.has(label)) {
        await this.opts.client.removeLabel(loc.owner, loc.repo, loc.number, label);
      }
    }
    await this.opts.client.addLabels(loc.owner, loc.repo, loc.number, [stateName]);
  }

  private async searchAcrossRepos(states: readonly string[]): Promise<Issue[]> {
    if (states.length === 0) return [];
    const all: Issue[] = [];
    for (const repo of this.opts.config.repos) {
      const query = buildSearchQuery(repo, states);
      const raws = await this.opts.client.searchIssues(query);
      for (const raw of raws) {
        this.rememberLocation(raw);
        const issue = toIssue(raw, this.knownStates());
        if (issue) all.push(issue);
      }
    }
    return all;
  }

  private rememberLocation(raw: GitHubIssueRaw): void {
    this.locations.set(raw.nodeId, {
      owner: raw.owner,
      repo: raw.repo,
      number: raw.number,
    });
  }

  private knownStates(): Set<string> {
    return new Set([
      ...this.opts.config.active_states,
      ...this.opts.config.terminal_states,
    ]);
  }
}

function buildSearchQuery(repo: string, states: readonly string[]): string {
  const labelClause =
    states.length > 0
      ? ` label:${states.map((s) => quoteLabel(s)).join(",")}`
      : "";
  return `is:issue is:open repo:${repo}${labelClause}`;
}

function quoteLabel(label: string): string {
  if (/[\s,"]/.test(label)) return `"${label.replace(/"/g, '\\"')}"`;
  return label;
}

function stateForRaw(raw: GitHubIssueRaw, known: Set<string>): string | null {
  return extractState(raw.labels, [...known]);
}

function toIssue(raw: GitHubIssueRaw, known: Set<string>): Issue | null {
  const state = stateForRaw(raw, known);
  if (state === null) return null;
  return {
    id: raw.nodeId,
    identifier: `${raw.owner}/${raw.repo}#${raw.number}`,
    title: raw.title,
    description: raw.body,
    state,
    priority: null,
    branchName: deriveBranchName(raw.number, raw.title),
    url: raw.url,
    assigneeId: raw.primaryAssigneeId,
    labels: [...raw.labels],
    blockedBy: parseBlockedBy(raw.body, `${raw.owner}/${raw.repo}`).map((ref) => ({
      id: `${ref.repo}#${ref.number}`,
      identifier: `${ref.repo}#${ref.number}`,
      state: "",
    })),
    assignedToWorker: true,
    createdAt: raw.createdAt ? new Date(raw.createdAt) : null,
    updatedAt: raw.updatedAt ? new Date(raw.updatedAt) : null,
  };
}
