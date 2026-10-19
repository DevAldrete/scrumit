---
id: ISSUE-12
title: Connect to the sidecar and resolve conflicts honestly
status: doing
type: story
epic: EPIC-02
sprint: 2026-S02
points: 5
priority: 1
labels: [ui, server]
created: 2026-10-19
updated: 2026-10-19
order: 10
blocked_by: [ISSUE-11]
assignee: agent-opencode
---

## Context

Discovery and conflict handling are where the sidecar becomes a product rather
than an API. A 409 must never be auto-resolved: the agent and the human may both
be right.

## Acceptance criteria

- [ ] Boot probes `/api/health` with a 600 ms timeout and offers the server path on Welcome.
- [ ] The token is stored per origin; the first URL can carry it and the app cleans the address bar.
- [ ] A 409 keeps the user's text, marks the card, and offers Keep mine / Take theirs.
- [ ] The watcher does not overwrite a conflicted card.
- [ ] A stopped server produces one toast and legible write failures.
