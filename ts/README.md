# Symphony TS

GitHub-first TypeScript reimplementation of [Symphony](../SPEC.md). Polls GitHub Issues across one or more repos, spawns Codex app-server sessions per issue in isolated workspaces, and renders progress in a terminal dashboard.

> **Status:** Foundation through orchestration is complete (Phases 1–7, 10). 117 tests passing. The web dashboard (Phase 8) is deferred to a follow-up.

## Setup

Requires Node 22+. From this directory:

```bash
npm install
npm run build
```

Set a GitHub personal access token with `repo` scope:

```bash
export GITHUB_TOKEN=ghp_...
```

Edit [`WORKFLOW.md`](./WORKFLOW.md) — set `repos:` to the repos you want Symphony to poll. Then:

```bash
./dist/cli.js                       # uses ./WORKFLOW.md
./dist/cli.js path/to/WORKFLOW.md   # custom path
./dist/cli.js --no-tui              # JSON logs to stdout, no terminal UI
./dist/cli.js --logs-root /tmp/log  # custom log directory
```

## State model — labels, not Linear states

Issue states are GitHub labels prefixed with `status:`. Configure which labels are "active" (Symphony will dispatch agents for them) and which are "terminal" (Symphony will stop active runs and remove workspaces) in `WORKFLOW.md`:

```yaml
tracker:
  kind: github
  active_states:
    - status:todo
    - status:in-progress
    - status:rework
  terminal_states:
    - status:done
    - status:cancelled
```

The agent uses `gh issue edit --remove-label X --add-label Y` to transition issues. Symphony itself only writes labels through the same mechanism when a workflow rule requires it.

## Layout

```
src/
  config/         # WORKFLOW.md loader, Zod schema, $VAR env resolver
  tracker/
    github/       # Octokit-backed adapter (search, comment, label mutations)
    memory.ts     # in-memory adapter for tests
    types.ts      # normalized Issue model + Tracker interface
  workspace/      # per-issue dirs, hooks, path safety
  codex/          # JSON-RPC client + spawn-based transport
  agent/          # AgentRunner state machine + Supervisor (concurrency cap)
  observability/  # PubSub bus, StateStore, Pino file logger
  ui/             # Ink terminal dashboard
  orchestrator.ts # poll tick, dispatch, reconciliation
  symphony.ts     # composition root: buildApp(opts)
  cli.tsx         # entry point + arg parsing
```

## Development

```bash
npm test            # vitest run
npm run test:watch  # vitest --watch
npm run typecheck   # tsc -p . --noEmit (everything)
npm run build       # tsc -p tsconfig.build.json (src only)
```

## What's not yet implemented

- **Retry queue with exponential backoff.** Failed runs do not retry on a schedule. The orchestrator simply removes them from the active set.
- **Web dashboard at `/` and `/api/v1/*`.** The Elixir reference has a Phoenix LiveView UI; the TS port has the equivalent terminal UI but not the web one yet.
- **In-band Codex tool approvals and the `gh_cli` dynamic tool extension.** The current code path assumes `approval_policy: never` and relies on the agent's already-installed `gh` binary. Adding a Codex-side `gh_cli` tool would mirror Elixir's `linear_graphql` extension.
- **Liquid/Jinja prompt features.** `{% if %}` blocks are not supported — the prompt template uses plain `{{ path }}` substitution. The default WORKFLOW.md is written to work without conditionals.

## License

Apache 2.0 — same as the parent project.
