---
id: ISSUE-15
title: Land the first everyday wins
status: todo
type: chore
epic: EPIC-04
sprint: 2026-S03
points: 3
priority: 2
labels: [ui, search]
created: 2026-10-19
updated: 2026-10-19
order: 20
---

## Context

A few small changes make the app noticeably better once the source work is safe.
Keep them independent so each can be reviewed and reverted alone.

## Acceptance criteria

- [ ] The command palette searches issue bodies as well as ids, titles, and labels.
- [ ] `#ISSUE-140` opens that card and `?repo=<id>` opens that repository.
- [ ] The last 50 external changes are kept in memory and shown in a panel, not only as the latest toast.
- [ ] Each change has a test and its own commit.
