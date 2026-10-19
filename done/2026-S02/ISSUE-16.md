---
id: ISSUE-16
title: "Only offer and claim work in an active sprint"
status: done
type: bug
epic: EPIC-01
sprint: 2026-S02
points: 2
priority: 1
labels: [agents, tooling]
order: 80
created: 2026-10-19
updated: 2026-10-19
assignee: agent-opencode
---

## Context

The board currently treats every backlog/todo task as ready, even when its sprint is still planned or already closed. An agent following the skill could claim work the team has not started.

## Acceptance criteria

- [x] A task in a planned or closed sprint is not listed as ready.
- [x] "scrumit claim" refuses a task in a planned or closed sprint with a clear message.
- [x] A task with no sprint remains claimable (backlog work).
- [x] Tests cover planned, active, and closed sprints.

## Delivery

- Commits: `bdf4711`, `f11a0a2`, `c2edac9`
- Summary: Readiness now respects the sprint state; planned and closed work is refused
- Checks: npm run check (88 tests)
