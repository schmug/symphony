export function extractState(
  labels: readonly string[],
  knownStates: readonly string[],
): string | null {
  const known = new Set(knownStates);
  for (const label of labels) {
    if (known.has(label)) return label;
  }
  return null;
}

const MAX_BRANCH_LEN = 80;

export function deriveBranchName(issueNumber: number, title: string): string {
  const slug = (title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = `claude/issue-${issueNumber}`;
  if (!slug) return base;
  const full = `${base}-${slug}`;
  if (full.length <= MAX_BRANCH_LEN) return full;
  return full.slice(0, MAX_BRANCH_LEN).replace(/-+$/, "");
}

export interface BlockedByRef {
  repo: string;
  number: number;
}

const BLOCKED_BY_RE =
  /blocked by\s+(?:([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+))?#(\d+)/gi;

export function parseBlockedBy(
  body: string | null | undefined,
  fallbackRepo: string,
): BlockedByRef[] {
  if (!body) return [];
  const seen = new Set<string>();
  const out: BlockedByRef[] = [];
  for (const match of body.matchAll(BLOCKED_BY_RE)) {
    const repo = match[1] ?? fallbackRepo;
    const number = Number(match[2]);
    const key = `${repo}#${number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ repo, number });
  }
  return out;
}

const ISSUE_URL_RE =
  /^https?:\/\/github\.com\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)\/issues\/(\d+)/;

export function parseRepoFromUrl(url: string): {
  owner: string;
  repo: string;
  number: number;
} | null {
  const match = url.match(ISSUE_URL_RE);
  if (!match) return null;
  return {
    owner: match[1]!,
    repo: match[2]!,
    number: Number(match[3]!),
  };
}
