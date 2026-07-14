# Subagent extension

The global `subagent` tool delegates isolated tasks to specialist Pi subprocesses.

## Included agents

Global agent definitions live in `~/.pi/agent/agents/`:

- `scout` — codebase reconnaissance
- `planner` — implementation plans
- `reviewer` — read-only code review
- `worker` — general delegated work

Agents inherit the parent session's active model by default. To override one agent, add a `model` field to that agent's Markdown frontmatter:

```yaml
---
name: scout
description: Fast codebase reconnaissance
model: openai-codex/gpt-5.6-terra
---
```

The parent model is instructed to use `subagent` proactively for independent research, planning, review, and isolated work. It should avoid delegating trivial direct operations.

Project-local agents in `.pi/agents/` remain opt-in: pass `agentScope: "both"` or `"project"`. Pi asks for confirmation before executing a requested project-local agent when UI is available.

Reload Pi with `/reload` after changing the extension or agent definitions.
