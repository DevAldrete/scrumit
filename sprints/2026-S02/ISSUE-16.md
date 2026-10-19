---
id: ISSUE-16
title: "Only offer and claim work in an active sprint"
status: todo
type: bug
epic: EPIC-01
sprint: 2026-S02
points: 2
priority: 1
labels: [agents, tooling]
order: 70
created: 2026-10-19
updated: 2026-10-19
---

## Context

The board currently treats every backlog/todo task as ready, even when its sprint is still planned or already closed. An agent following the skill could claim work the team has not started.

## Acceptance criteria

- [ ] A task in a planned or closed sprint is not listed as ready.
- [ ] "scrumit claim" refuses a task in a planned or closed sprint with a clear message.
- [ ] A task with no sprint remains claimable (backlog work).
- [ ] Tests cover planned, active, and closed sprints.