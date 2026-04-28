---
tracker:
  kind: github
  api_key: $GITHUB_TOKEN
  repos:
    - schmug/dmarcheck
    - schmug/donthype-me
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
    if [ -n "$REPO" ]; then
      git clone --depth 1 "https://github.com/$REPO" .
    fi
  before_remove: |
    echo "removing workspace"
agent:
  max_concurrent_agents: 5
  max_turns: 20
codex:
  command: codex --model gpt-5.3-codex app-server
  approval_policy: never
  thread_sandbox: workspace-write
---

You are working on GitHub issue {{ issue.identifier }}.

Issue: {{ issue.title }}
Status: {{ issue.state }}
Labels: {{ issue.labels }}
URL: {{ issue.url }}

Description:
{{ issue.description }}

Instructions:

1. This is an unattended orchestration session — never ask a human for follow-up actions.
2. Only stop early for a true blocker (missing required auth/permissions/secrets).
3. Final message must report completed actions and blockers only.

Work only inside the provided repository copy. Do not touch any other path.

## Default flow

- Determine the issue's current status via `gh` (you have `gh` and `git` available in PATH).
- For `status:todo`, plan an implementation, write tests first, then code, then open a PR.
- For `status:in-progress`, resume the existing branch and finish the work.
- For `status:rework`, address review feedback and push updates.
- When the work is ready for review, set the issue label to `status:human-review` and stop.
- When CI is green and the PR is approved, set the label to `status:merging` and merge.

## State transitions (via `gh`)

```
gh issue edit {{ issue.identifier }} --remove-label status:todo --add-label status:in-progress
gh issue edit {{ issue.identifier }} --remove-label status:in-progress --add-label status:human-review
gh issue edit {{ issue.identifier }} --remove-label status:human-review --add-label status:done
```
