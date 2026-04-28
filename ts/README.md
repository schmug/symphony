# Symphony TS

GitHub-first TypeScript reimplementation of [Symphony](../SPEC.md). Polls GitHub Issues across one or more repos, spawns Codex app-server sessions per issue in isolated workspaces, and renders progress in a terminal dashboard.

> **Status:** Phases 1–8 + 10 complete. 122 tests passing. Terminal TUI and web dashboard both shipped.

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
./dist/cli.js --web-port 4242       # change web dashboard port (default 4200)
./dist/cli.js --no-web              # disable the web dashboard
```

The web dashboard is at `http://127.0.0.1:4200/` by default. It uses Server-Sent Events
(`/api/v1/stream`) to push state updates and exposes a JSON snapshot at `/api/v1/state`.

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

## Retry behavior

Failed runs are not re-dispatched immediately. The orchestrator records each failure in an in-memory retry queue with exponential backoff:

| Attempt | Wait until next try (jittered ±20%) |
|---|---|
| 1 | 5s |
| 2 | 30s |
| 3 | 2m |
| 4 | 10m |
| 5 | 1h |

After **5 failed attempts** Symphony posts a give-up comment on the issue (`Symphony stopped retrying after 5 failed attempts. Last error: ...`) and stops trying. To resume, change the issue's state label — Symphony detects the change on the next tick and clears the tombstone.

**No-progress watchdog:** if Codex produces no events for `agent.no_progress_timeout_ms` (default 5 minutes), the run is killed and counts as a failure. Set to `0` to disable. This is the safety net for the "Codex unexpectedly hung waiting for an approval reply we don't send" case.

## What's not yet implemented

- **In-band Codex tool approvals and a `gh_cli` dynamic tool extension.** The current code path assumes `approval_policy: never` and relies on the agent's already-installed `gh` binary. Adding a Codex-side `gh_cli` tool would mirror Elixir's `linear_graphql` extension.
- **Liquid/Jinja prompt features.** `{% if %}` blocks are not supported — the prompt template uses plain `{{ path }}` substitution. The default WORKFLOW.md is written to work without conditionals.
- **Live-tested GitHub adapter.** Every test mocks the GitHub client. Run a single-issue smoke against a real repo before running unattended (see "First run" below).

## First run — real GitHub smoke test

Before letting Symphony run unattended, verify the GitHub adapter against a real repo:

1. Create a label `status:todo` on a single repo.
2. Open one issue and apply that label.
3. Edit `WORKFLOW.md` so `repos:` lists only that repo.
4. `export GITHUB_TOKEN=...`
5. Run `./dist/cli.js --no-tui` for ~10 seconds and look for `"candidates":1,"dispatched":1` in the log. The agent run will fail because Codex isn't actually present (or Codex will start and immediately have no work) — that's expected. The signal you want is `candidates: 1`. If it's `candidates: 0`, the search query failed.

## License

Apache 2.0 — same as the parent project.
