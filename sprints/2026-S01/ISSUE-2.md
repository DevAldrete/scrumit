---
id: ISSUE-2
title: Document CLI installation and the agent workflow
status: doing
type: chore
epic: EPIC-01
sprint: 2026-S01
points: 2
priority: 2
labels: [docs, agents]
created: 2026-10-19
updated: 2026-10-19
order: 10
assignee: agent-opencode
---

## Context

A CLI nobody can install is a private script. The docs need to cover local and
global installation, every command with an example, the JSON output, exit codes,
and how an orchestrator delegates a task to a child agent.

## Acceptance criteria

- [ ] `docs/CLI.md` covers installation, commands, options, JSON, exit codes, environment variables, and troubleshooting.
- [ ] The README links to the CLI docs and the skill.
- [ ] The skill references the CLI rather than duplicating an inconsistent command set.
- [ ] The browser can write the same skill into a repository from Settings → AI agents.
