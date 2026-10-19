---
id: ISSUE-1
title: Implement the scrumit sprint CLI and skill
status: done
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

- [x] `scrumit board`, `claim`, `finish`, `block`, `release`, `new`, `validate`, `init`, and `skill install` work without runtime dependencies.
- [x] Claiming a task checks blockers, takes an atomic lock, updates `status`, `assignee`, `updated`, and commits only that task.
- [x] Finishing moves the file to the archive when `status: done`, records delivery commits, and releases the claim.
- [x] Blocked tasks are expressed with `blocked_by`; no `blocked` status is invented.
- [x] The skill at `skills/scrumit-sprint/` teaches solo and orchestrated workflows, and installs cleanly with `scrumit skill install`.
- [x] Tests cover claim, finish, block, validation, concurrency, and body preservation.

## Delivery

- Commits: `fba3215`, `0491e26`, `6885048`, `c9628a6`, `5a556df`
- Summary: Sprint CLI, scrumit-sprint skill, and browser skill writer
- Checks: npm run check (70 tests), npm run smoke
