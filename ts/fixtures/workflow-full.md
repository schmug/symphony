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
