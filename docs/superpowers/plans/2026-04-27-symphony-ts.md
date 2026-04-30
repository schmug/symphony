# Symphony TS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reimplement Symphony in TypeScript with a GitHub Issues tracker (labels-based state mapping), preserving full UX parity with the Elixir reference implementation.

**Architecture:** A long-running Node 22+ daemon that polls GitHub for candidate issues, dispatches Codex app-server sessions in per-issue workspaces, and exposes both a terminal TUI and a web dashboard. The tracker is abstracted behind an interface; the GitHub adapter uses the GraphQL API for reads (search across multiple repos in one query) and REST for label mutations. State is in-memory; restart recovery comes from the tracker, not a database.

**Tech Stack:** TypeScript 5.x · Node 22 · Vitest · Hono (web) · Ink (TUI) · Pino (logs) · Zod (config schema) · `@octokit/graphql` + `@octokit/rest` (GitHub) · `js-yaml` + `gray-matter` (WORKFLOW.md) · `chokidar` (hot reload) · `node:spawn` from `node:child_process` (Codex subprocess; never `exec`)

---

## Phase Roadmap

This plan covers **Phase 1 only**. Each subsequent phase will get its own detailed plan written when its predecessor lands.

| Phase | Scope | Status |
|---|---|---|
| 1 | Workspace scaffold + WORKFLOW.md loader + tracker interface + memory adapter | **THIS PLAN** |
| 2 | GitHub tracker adapter (search, fetch by id, fetch by state, label mutations, issue comments) | future |
| 3 | Workspace manager (per-issue dirs, lifecycle hooks, path safety) | future |
| 4 | Codex app-server JSON-RPC client + agent runner with supervisor | future |
| 5 | Orchestrator (poll tick, dispatch, retry queue, reconciliation) | future |
| 6 | Observability pubsub + structured logs + token accounting | future |
| 7 | Terminal TUI (Ink) matching the Elixir screenshot | future |
| 8 | Web dashboard (Hono + SSE) at `/` and `/api/v1/*` | future |
| 9 | `gh` dynamic tool extension for the in-session agent | future |
| 10 | WORKFLOW.md template rewritten for GitHub vocabulary + skill scaffolds | future |

---

## Phase 1: Foundation — workspace scaffold, config, tracker contract

**Why this slice:** Everything downstream depends on a typed config, a stable tracker interface, and a working test harness. This phase produces zero runtime behavior on its own but unblocks every other phase. It is fully testable without GitHub credentials or Codex.

### File Structure

```
ts/
  package.json
  tsconfig.json
  vitest.config.ts
  .gitignore
  src/
    config/
      schema.ts          # Zod schema for WORKFLOW.md frontmatter
      loader.ts          # parses WORKFLOW.md → {config, promptTemplate}
      env.ts             # $VAR indirection resolver
    tracker/
      types.ts           # Issue type + Tracker interface
      memory.ts          # in-memory adapter for tests
      index.ts           # adapter factory keyed off config.tracker.kind
  test/
    config/
      loader.test.ts
      env.test.ts
    tracker/
      memory.test.ts
  fixtures/
    workflow-minimal.md
    workflow-full.md
```

Each file has one job. `loader.ts` does not validate semantics — that is `schema.ts`. `env.ts` does not parse — it only resolves `$VAR`. `memory.ts` only stores issues; it does not validate the tracker contract beyond TypeScript types.

---

### Task 1: Scaffold the `ts/` workspace

**Files:**
- Create: `ts/package.json`
- Create: `ts/tsconfig.json`
- Create: `ts/vitest.config.ts`
- Create: `ts/.gitignore`

- [ ] **Step 1: Create `ts/package.json`**

```json
{
  "name": "symphony",
  "version": "0.0.0",
  "type": "module",
  "private": true,
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "build": "tsc -p .",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p . --noEmit"
  },
  "dependencies": {
    "gray-matter": "^4.0.3",
    "js-yaml": "^4.1.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^22.10.0",
    "typescript": "^5.6.3",
    "vitest": "^2.1.5"
  }
}
```

- [ ] **Step 2: Create `ts/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src/**/*", "test/**/*", "vitest.config.ts"]
}
```

- [ ] **Step 3: Create `ts/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
```

- [ ] **Step 4: Create `ts/.gitignore`**

```
node_modules/
dist/
coverage/
*.log
```

- [ ] **Step 5: Install and verify**

```bash
cd ts && npm install && npm run typecheck
```

Expected: install succeeds, `tsc --noEmit` exits 0 (no source files yet, so the only check is config validity).

- [ ] **Step 6: Commit**

```bash
git add ts/
git commit -m "feat(ts): scaffold Symphony TypeScript workspace"
```

---

### Task 2: WORKFLOW.md fixtures

**Files:**
- Create: `ts/fixtures/workflow-minimal.md`
- Create: `ts/fixtures/workflow-full.md`

These fixtures are used by every config test. Make them real — they should round-trip through the loader unchanged.

- [ ] **Step 1: Create `ts/fixtures/workflow-minimal.md`**

```markdown
---
tracker:
  kind: memory
polling:
  interval_ms: 5000
agent:
  max_concurrent_agents: 1
  max_turns: 5
---

You are working on issue {{ issue.identifier }}.
```

- [ ] **Step 2: Create `ts/fixtures/workflow-full.md`**

```markdown
---
tracker:
  kind: github
  repos:
    - schmug/dmarcheck
    - schmug/donthype-me
  api_key: $GITHUB_TOKEN
  active_states:
    - status:todo
    - status:in-progress
    - status:rework
  terminal_states:
    - status:done
    - status:cancelled
polling:
  interval_ms: 5000
workspace:
  root: ~/code/symphony-workspaces
hooks:
  after_create: |
    git clone --depth 1 https://github.com/{{ repo }} .
  before_remove: |
    echo cleanup
agent:
  max_concurrent_agents: 10
  max_turns: 20
codex:
  command: codex --model gpt-5.3-codex app-server
  approval_policy: never
  thread_sandbox: workspace-write
---

You are working on a GitHub issue {{ issue.identifier }}.

Issue: {{ issue.title }}
Status: {{ issue.state }}
URL: {{ issue.url }}

Description:
{{ issue.description }}
```

- [ ] **Step 3: Commit**

```bash
git add ts/fixtures/
git commit -m "test(ts): add WORKFLOW.md fixtures for config tests"
```

---

### Task 3: Env var indirection resolver

**Files:**
- Create: `ts/src/config/env.ts`
- Test: `ts/test/config/env.test.ts`

`$VAR` strings in WORKFLOW.md should be resolved against `process.env`. Anything not starting with `$` is returned as-is.

- [ ] **Step 1: Write the failing tests**

```ts
// ts/test/config/env.test.ts
import { describe, it, expect } from "vitest";
import { resolveEnvIndirection } from "../../src/config/env.js";

describe("resolveEnvIndirection", () => {
  it("returns plain strings unchanged", () => {
    expect(resolveEnvIndirection("hello", {})).toBe("hello");
  });

  it("resolves $VAR against the provided env map", () => {
    expect(resolveEnvIndirection("$GITHUB_TOKEN", { GITHUB_TOKEN: "abc" })).toBe("abc");
  });

  it("throws when $VAR is missing", () => {
    expect(() => resolveEnvIndirection("$MISSING", {})).toThrow(/MISSING/);
  });

  it("treats a bare $ as a literal string", () => {
    expect(resolveEnvIndirection("$", {})).toBe("$");
  });

  it("only resolves when the entire value is a $VAR token", () => {
    expect(resolveEnvIndirection("price: $10", {})).toBe("price: $10");
    expect(resolveEnvIndirection("$lower", {})).toBe("$lower");
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd ts && npm test -- env`
Expected: FAIL with "Cannot find module '../../src/config/env.js'".

- [ ] **Step 3: Implement `env.ts`**

```ts
// ts/src/config/env.ts
const ENV_VAR_RE = /^\$([A-Z][A-Z0-9_]*)$/;

export function resolveEnvIndirection(
  value: string,
  env: Record<string, string | undefined>,
): string {
  const match = ENV_VAR_RE.exec(value);
  if (!match) return value;
  const name = match[1]!;
  const resolved = env[name];
  if (resolved === undefined) {
    throw new Error(`Environment variable not set: ${name}`);
  }
  return resolved;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd ts && npm test -- env`
Expected: 5/5 passing.

- [ ] **Step 5: Commit**

```bash
git add ts/src/config/env.ts ts/test/config/env.test.ts
git commit -m "feat(ts): add env var indirection resolver"
```

---

### Task 4: Workflow config schema

**Files:**
- Create: `ts/src/config/schema.ts`
- Test: `ts/test/config/schema.test.ts`

Zod schema for the parsed YAML frontmatter. Validation only — no env resolution, no IO.

- [ ] **Step 1: Write the failing tests**

```ts
// ts/test/config/schema.test.ts
import { describe, it, expect } from "vitest";
import { WorkflowConfigSchema } from "../../src/config/schema.js";

describe("WorkflowConfigSchema", () => {
  const minimal = {
    tracker: { kind: "memory" },
    polling: { interval_ms: 5000 },
    agent: { max_concurrent_agents: 1, max_turns: 5 },
  };

  it("accepts a minimal memory tracker config", () => {
    expect(() => WorkflowConfigSchema.parse(minimal)).not.toThrow();
  });

  it("requires github repos list when tracker.kind is github", () => {
    const result = WorkflowConfigSchema.safeParse({
      ...minimal,
      tracker: { kind: "github", api_key: "$GITHUB_TOKEN" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts a github tracker with one or more repos", () => {
    const result = WorkflowConfigSchema.safeParse({
      ...minimal,
      tracker: {
        kind: "github",
        api_key: "$GITHUB_TOKEN",
        repos: ["owner/repo"],
        active_states: ["status:todo"],
        terminal_states: ["status:done"],
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown tracker kinds", () => {
    const result = WorkflowConfigSchema.safeParse({
      ...minimal,
      tracker: { kind: "jira" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects polling intervals below 1000ms", () => {
    const result = WorkflowConfigSchema.safeParse({
      ...minimal,
      polling: { interval_ms: 100 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects max_concurrent_agents below 1", () => {
    const result = WorkflowConfigSchema.safeParse({
      ...minimal,
      agent: { max_concurrent_agents: 0, max_turns: 5 },
    });
    expect(result.success).toBe(false);
  });

  it("defaults workspace.root to ~/code/symphony-workspaces", () => {
    const parsed = WorkflowConfigSchema.parse(minimal);
    expect(parsed.workspace.root).toBe("~/code/symphony-workspaces");
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd ts && npm test -- schema`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `schema.ts`**

```ts
// ts/src/config/schema.ts
import { z } from "zod";

const MemoryTrackerSchema = z.object({
  kind: z.literal("memory"),
});

const GitHubTrackerSchema = z.object({
  kind: z.literal("github"),
  api_key: z.string().min(1),
  repos: z.array(z.string().regex(/^[^/]+\/[^/]+$/)).min(1),
  active_states: z.array(z.string()).default([]),
  terminal_states: z.array(z.string()).default([]),
});

const TrackerSchema = z.discriminatedUnion("kind", [
  MemoryTrackerSchema,
  GitHubTrackerSchema,
]);

const PollingSchema = z.object({
  interval_ms: z.number().int().min(1000),
});

const WorkspaceSchema = z
  .object({
    root: z.string().default("~/code/symphony-workspaces"),
  })
  .default({ root: "~/code/symphony-workspaces" });

const HooksSchema = z
  .object({
    after_create: z.string().optional(),
    before_remove: z.string().optional(),
  })
  .default({});

const AgentSchema = z.object({
  max_concurrent_agents: z.number().int().min(1),
  max_turns: z.number().int().min(1),
});

const CodexSchema = z
  .object({
    command: z.string().default("codex app-server"),
    approval_policy: z.enum(["never", "on-failure", "always"]).default("never"),
    thread_sandbox: z
      .enum(["workspace-write", "read-only", "danger-full-access"])
      .default("workspace-write"),
  })
  .default({});

export const WorkflowConfigSchema = z.object({
  tracker: TrackerSchema,
  polling: PollingSchema,
  workspace: WorkspaceSchema,
  hooks: HooksSchema,
  agent: AgentSchema,
  codex: CodexSchema,
});

export type WorkflowConfig = z.infer<typeof WorkflowConfigSchema>;
export type GitHubTrackerConfig = z.infer<typeof GitHubTrackerSchema>;
export type MemoryTrackerConfig = z.infer<typeof MemoryTrackerSchema>;
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd ts && npm test -- schema`
Expected: 7/7 passing.

- [ ] **Step 5: Commit**

```bash
git add ts/src/config/schema.ts ts/test/config/schema.test.ts
git commit -m "feat(ts): add workflow config schema with github + memory tracker variants"
```

---

### Task 5: WORKFLOW.md loader

**Files:**
- Create: `ts/src/config/loader.ts`
- Test: `ts/test/config/loader.test.ts`

The loader reads a file, splits frontmatter from prompt body, validates the frontmatter against the schema, resolves `$VAR` indirection, and returns `{config, promptTemplate, sourcePath}`.

- [ ] **Step 1: Write the failing tests**

```ts
// ts/test/config/loader.test.ts
import { describe, it, expect } from "vitest";
import { loadWorkflow } from "../../src/config/loader.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "..", "fixtures");

describe("loadWorkflow", () => {
  it("loads the minimal fixture and returns parsed config + prompt", async () => {
    const result = await loadWorkflow(join(fixturesDir, "workflow-minimal.md"), {});
    expect(result.config.tracker.kind).toBe("memory");
    expect(result.config.polling.interval_ms).toBe(5000);
    expect(result.promptTemplate.trim()).toBe(
      "You are working on issue {{ issue.identifier }}.",
    );
    expect(result.sourcePath).toContain("workflow-minimal.md");
  });

  it("resolves $GITHUB_TOKEN against the provided env", async () => {
    const result = await loadWorkflow(join(fixturesDir, "workflow-full.md"), {
      GITHUB_TOKEN: "ghp_fake",
    });
    expect(result.config.tracker.kind).toBe("github");
    if (result.config.tracker.kind === "github") {
      expect(result.config.tracker.api_key).toBe("ghp_fake");
      expect(result.config.tracker.repos).toEqual([
        "schmug/dmarcheck",
        "schmug/donthype-me",
      ]);
    }
  });

  it("throws a clear error when the file does not exist", async () => {
    await expect(loadWorkflow("/nonexistent/path.md", {})).rejects.toThrow(
      /not found|ENOENT/i,
    );
  });

  it("throws a clear error when frontmatter is missing", async () => {
    const path = join(fixturesDir, "workflow-no-frontmatter.md");
    const fs = await import("node:fs/promises");
    await fs.writeFile(path, "Just a prompt, no frontmatter.\n");
    try {
      await expect(loadWorkflow(path, {})).rejects.toThrow(/frontmatter/i);
    } finally {
      await fs.unlink(path);
    }
  });

  it("throws a clear error when frontmatter fails schema validation", async () => {
    const path = join(fixturesDir, "workflow-invalid.md");
    const fs = await import("node:fs/promises");
    await fs.writeFile(
      path,
      "---\ntracker:\n  kind: jira\n---\nbody\n",
    );
    try {
      await expect(loadWorkflow(path, {})).rejects.toThrow();
    } finally {
      await fs.unlink(path);
    }
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd ts && npm test -- loader`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `loader.ts`**

```ts
// ts/src/config/loader.ts
import matter from "gray-matter";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { WorkflowConfigSchema, type WorkflowConfig } from "./schema.js";
import { resolveEnvIndirection } from "./env.js";

export interface LoadedWorkflow {
  config: WorkflowConfig;
  promptTemplate: string;
  sourcePath: string;
}

export async function loadWorkflow(
  path: string,
  env: Record<string, string | undefined>,
): Promise<LoadedWorkflow> {
  const absolute = resolve(path);
  let raw: string;
  try {
    raw = await readFile(absolute, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`WORKFLOW.md not found at ${absolute}`);
    }
    throw err;
  }

  const parsed = matter(raw);
  if (!parsed.data || Object.keys(parsed.data).length === 0) {
    throw new Error(
      `WORKFLOW.md at ${absolute} is missing YAML frontmatter`,
    );
  }

  const resolved = resolveStrings(parsed.data, env);
  const config = WorkflowConfigSchema.parse(resolved);

  return {
    config,
    promptTemplate: parsed.content,
    sourcePath: absolute,
  };
}

function resolveStrings(
  value: unknown,
  env: Record<string, string | undefined>,
): unknown {
  if (typeof value === "string") return resolveEnvIndirection(value, env);
  if (Array.isArray(value)) return value.map((v) => resolveStrings(v, env));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveStrings(v, env);
    }
    return out;
  }
  return value;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd ts && npm test -- loader`
Expected: 5/5 passing.

- [ ] **Step 5: Commit**

```bash
git add ts/src/config/loader.ts ts/test/config/loader.test.ts
git commit -m "feat(ts): load and validate WORKFLOW.md with env indirection"
```

---

### Task 6: Tracker types

**Files:**
- Create: `ts/src/tracker/types.ts`

The normalized issue model and the tracker interface. No tests here — these are pure types and will be exercised by every adapter.

- [ ] **Step 1: Write `types.ts`**

```ts
// ts/src/tracker/types.ts

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
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd ts && npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add ts/src/tracker/types.ts
git commit -m "feat(ts): define Issue model and Tracker interface"
```

---

### Task 7: Memory tracker adapter

**Files:**
- Create: `ts/src/tracker/memory.ts`
- Test: `ts/test/tracker/memory.test.ts`

Pure in-memory implementation. Used by tests and as a smoke-check that the interface is implementable. Comments are appended to a per-issue list. State changes mutate the issue's `state`.

- [ ] **Step 1: Write the failing tests**

```ts
// ts/test/tracker/memory.test.ts
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
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd ts && npm test -- memory`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `memory.ts`**

```ts
// ts/src/tracker/memory.ts
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
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd ts && npm test -- memory`
Expected: 7/7 passing.

- [ ] **Step 5: Commit**

```bash
git add ts/src/tracker/memory.ts ts/test/tracker/memory.test.ts
git commit -m "feat(ts): add memory tracker adapter for tests"
```

---

### Task 8: Tracker factory

**Files:**
- Create: `ts/src/tracker/index.ts`

A factory that selects the adapter based on `config.tracker.kind`. The GitHub branch throws "not yet implemented" — that adapter lands in Phase 2.

- [ ] **Step 1: Write `index.ts`**

```ts
// ts/src/tracker/index.ts
import type { WorkflowConfig } from "../config/schema.js";
import { MemoryTracker } from "./memory.js";
import type { Tracker } from "./types.js";

export type { Issue, Tracker, BlockedReference } from "./types.js";
export { MemoryTracker } from "./memory.js";

export function createTracker(config: WorkflowConfig): Tracker {
  switch (config.tracker.kind) {
    case "memory":
      return new MemoryTracker({
        activeStates: [],
        terminalStates: [],
      });
    case "github":
      throw new Error(
        "GitHub tracker not yet implemented (Phase 2). Use tracker.kind: memory.",
      );
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd ts && npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add ts/src/tracker/index.ts
git commit -m "feat(ts): add tracker factory keyed off config.tracker.kind"
```

---

### Task 9: Run the full test suite and lock in Phase 1

**Files:** none — this is the verification gate.

- [ ] **Step 1: Run all tests**

Run: `cd ts && npm test`
Expected: all tests passing across config and tracker suites. Capture the exact count and report it.

- [ ] **Step 2: Run typecheck**

Run: `cd ts && npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Verify the build compiles**

Run: `cd ts && npm run build`
Expected: exits 0 and produces `dist/`.

- [ ] **Step 4: Add `dist/` to `.gitignore` if absent**

Already in `.gitignore` from Task 1 — verify, no commit needed if present.

---

## Self-Review Checklist

- **Spec coverage for Phase 1:** Workflow loader (§3.1.1, §6), Config Layer (§3.1.2, §7), Tracker contract subset (§3.1.3, §11). Phase 1 deliberately defers the rest.
- **Placeholder scan:** No "TBD", no "implement later", no narrative-only steps. Every code step contains the actual code.
- **Type consistency:** `Issue` fields used in `MemoryTracker` match `types.ts`. `WorkflowConfig` fields used in `loader.ts` and `tracker/index.ts` match `schema.ts`. The `tracker.kind` discriminator is `"memory"` or `"github"` everywhere.

## Out of Scope for Phase 1

- GitHub API client (Phase 2)
- Workspace creation, hooks, path safety (Phase 3)
- Codex JSON-RPC, agent runner, supervisor (Phase 4)
- Orchestrator poll loop, retries, reconciliation (Phase 5)
- Logs, pubsub, token accounting (Phase 6)
- Terminal TUI (Phase 7)
- Web dashboard (Phase 8)
- `gh` dynamic tool (Phase 9)
- WORKFLOW.md template + skills (Phase 10)
