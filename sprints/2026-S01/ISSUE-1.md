---
id: ISSUE-1
title: Implement the scrumit sprint CLI and skill
status: doing
type: story
epic: EPIC-01
sprint: 2026-S01
points: 5
priority: 1
assignee: agent-opencode
labels: [agents, tooling]
created: 2026-10-19
updated: 2026-10-19
order: 10
---

## Context

The format is already agent-readable, but coordinating several agents needs more
than prose. We need one CLI that can discover the board, claim work atomically,
move cards through the fixed statuses, and make every state change a git commit.
The skill is the operating manual on top of that CLI.

## Acceptance criteria

- [ ] `scrumit board`, `claim`, `finish`, `block`, `release`, `new`, `validate`, `init`, and `skill install` work without runtime dependencies.
- [ ] Claiming a task checks blockers, takes an atomic lock, updates `status`, `assignee`, `updated`, and commits only that task.
- [ ] Finishing moves the file to the archive when `status: done`, records delivery commits, and releases the claim.
- [ ] Blocked tasks are expressed with `blocked_by`; no `blocked` status is invented.
- [ ] The skill at `skills/scrumit-sprint/` teaches solo and orchestrated workflows, and installs cleanly with `scrumit skill install`.
- [ ] Tests cover claim, finish, block, validation, concurrency, and body preservation.
