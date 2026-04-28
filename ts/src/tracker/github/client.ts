import { Octokit } from "@octokit/rest";
import { graphql } from "@octokit/graphql";

export interface GitHubIssueRaw {
  nodeId: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  url: string;
  state: "open" | "closed";
  labels: string[];
  assigneeIds: string[];
  primaryAssigneeId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubClient {
  searchIssues(query: string): Promise<GitHubIssueRaw[]>;
  fetchIssuesByNodeIds(ids: readonly string[]): Promise<GitHubIssueRaw[]>;
  addComment(issueNodeId: string, body: string): Promise<void>;
  addLabels(
    owner: string,
    repo: string,
    issueNumber: number,
    labels: readonly string[],
  ): Promise<void>;
  removeLabel(
    owner: string,
    repo: string,
    issueNumber: number,
    label: string,
  ): Promise<void>;
  ensureLabel(owner: string, repo: string, name: string): Promise<void>;
}

export interface OctokitGitHubClientOptions {
  token: string;
}

export class OctokitGitHubClient implements GitHubClient {
  private rest: Octokit;
  private gql: typeof graphql;

  constructor(opts: OctokitGitHubClientOptions) {
    this.rest = new Octokit({ auth: opts.token });
    this.gql = graphql.defaults({
      headers: { authorization: `token ${opts.token}` },
    });
  }

  async searchIssues(query: string): Promise<GitHubIssueRaw[]> {
    const out: GitHubIssueRaw[] = [];
    const iter = this.rest.paginate.iterator(
      this.rest.search.issuesAndPullRequests,
      { q: query, per_page: 100 },
    );
    for await (const page of iter) {
      for (const item of page.data) {
        if (item.pull_request) continue;
        out.push(normalizeRestIssue(item));
      }
    }
    return out;
  }

  async fetchIssuesByNodeIds(
    ids: readonly string[],
  ): Promise<GitHubIssueRaw[]> {
    if (ids.length === 0) return [];
    const query = `
      query SymphonyIssuesByIds($ids: [ID!]!) {
        nodes(ids: $ids) {
          __typename
          ... on Issue {
            id
            number
            title
            body
            url
            state
            createdAt
            updatedAt
            repository { owner { login } name }
            labels(first: 50) { nodes { name } }
            assignees(first: 10) { nodes { id } }
          }
        }
      }
    `;
    const result = await this.gql<{ nodes: Array<GqlIssueNode | null> }>(
      query,
      { ids: [...ids] },
    );
    const out: GitHubIssueRaw[] = [];
    for (const node of result.nodes) {
      if (!node || node.__typename !== "Issue") continue;
      out.push(normalizeGqlIssue(node));
    }
    return out;
  }

  async addComment(issueNodeId: string, body: string): Promise<void> {
    const mutation = `
      mutation SymphonyAddComment($id: ID!, $body: String!) {
        addComment(input: { subjectId: $id, body: $body }) {
          commentEdge { node { id } }
        }
      }
    `;
    await this.gql(mutation, { id: issueNodeId, body });
  }

  async addLabels(
    owner: string,
    repo: string,
    issueNumber: number,
    labels: readonly string[],
  ): Promise<void> {
    if (labels.length === 0) return;
    await this.rest.issues.addLabels({
      owner,
      repo,
      issue_number: issueNumber,
      labels: [...labels],
    });
  }

  async removeLabel(
    owner: string,
    repo: string,
    issueNumber: number,
    label: string,
  ): Promise<void> {
    try {
      await this.rest.issues.removeLabel({
        owner,
        repo,
        issue_number: issueNumber,
        name: label,
      });
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 404) return;
      throw err;
    }
  }

  async ensureLabel(owner: string, repo: string, name: string): Promise<void> {
    try {
      await this.rest.issues.getLabel({ owner, repo, name });
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 404) throw err;
      await this.rest.issues.createLabel({
        owner,
        repo,
        name,
        color: "ededed",
      });
    }
  }
}

interface RestIssue {
  node_id: string;
  number: number;
  title?: string;
  body?: string | null;
  html_url: string;
  state: string;
  labels: Array<string | { name?: string | null }>;
  user?: { node_id?: string } | null;
  assignee?: { node_id?: string } | null;
  assignees?: Array<{ node_id?: string } | null> | null;
  created_at: string;
  updated_at: string;
  repository_url: string;
  pull_request?: unknown;
}

function normalizeRestIssue(item: unknown): GitHubIssueRaw {
  const it = item as RestIssue;
  const { owner, repo } = parseRepositoryUrl(it.repository_url);
  const labels = (it.labels ?? [])
    .map((l) => (typeof l === "string" ? l : l?.name))
    .filter((n): n is string => typeof n === "string" && n.length > 0);
  const assigneeIds = (it.assignees ?? [])
    .map((a) => a?.node_id)
    .filter((n): n is string => typeof n === "string" && n.length > 0);
  const primary = it.assignee?.node_id ?? assigneeIds[0] ?? null;
  return {
    nodeId: it.node_id,
    owner,
    repo,
    number: it.number,
    title: it.title ?? "",
    body: it.body ?? "",
    url: it.html_url,
    state: it.state === "closed" ? "closed" : "open",
    labels,
    assigneeIds,
    primaryAssigneeId: primary,
    createdAt: it.created_at,
    updatedAt: it.updated_at,
  };
}

interface GqlIssueNode {
  __typename: "Issue" | string;
  id: string;
  number: number;
  title: string;
  body: string | null;
  url: string;
  state: "OPEN" | "CLOSED";
  createdAt: string;
  updatedAt: string;
  repository: { owner: { login: string }; name: string };
  labels: { nodes: Array<{ name: string }> };
  assignees: { nodes: Array<{ id: string }> };
}

function normalizeGqlIssue(node: GqlIssueNode): GitHubIssueRaw {
  const labels = node.labels.nodes.map((n) => n.name);
  const assigneeIds = node.assignees.nodes.map((n) => n.id);
  return {
    nodeId: node.id,
    owner: node.repository.owner.login,
    repo: node.repository.name,
    number: node.number,
    title: node.title ?? "",
    body: node.body ?? "",
    url: node.url,
    state: node.state === "CLOSED" ? "closed" : "open",
    labels,
    assigneeIds,
    primaryAssigneeId: assigneeIds[0] ?? null,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
}

function parseRepositoryUrl(url: string): { owner: string; repo: string } {
  const m = url.match(/\/repos\/([^/]+)\/([^/]+)$/);
  if (!m) throw new Error(`Unrecognized repository_url: ${url}`);
  return { owner: m[1]!, repo: m[2]! };
}
