---
id: ISSUE-5
title: Make read-only mode legible in the UI
status: done
type: story
epic: EPIC-02
sprint: 2026-S01
points: 3
priority: 2
labels: [ui, browser]
created: 2026-10-19
updated: 2026-10-19
order: 50
blocked_by: [ISSUE-4]
assignee: agent-opencode
---

## Context

A read-only app that looks editable is worse than one that refuses. Drag,
composers, panel fields, settings, and destructive commands all need to reflect
the capability model.

## Acceptance criteria

- [x] A persistent strip explains why the repository is read-only and how to get write access.
- [x] Sortable is disabled rather than removed; cards still look like cards.
- [x] Column composers, Add buttons, Delete, and mutating settings are hidden or disabled.
- [x] The issue panel fields are `readonly`/`disabled`.
- [x] The command palette omits mutating commands.
- [x] A smoke test proves a drag moves nothing and no file is written.

## Delivery

- Commits: `b2feef5`, `35ead03`
- Summary: Read-only UI hides mutators, disables drag, and proves zero writes
- Checks: npm run check (80 tests), npm run smoke
