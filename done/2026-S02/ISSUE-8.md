---
id: ISSUE-8
title: Add a read-only folder source for Safari and Firefox
status: done
type: story
epic: EPIC-02
sprint: 2026-S02
points: 5
priority: 1
labels: [browser, source]
created: 2026-10-19
updated: 2026-10-19
order: 90
blocked_by: [ISSUE-4]
assignee: agent-opencode
---

## Context

`webkitdirectory` and a drop target give every browser a way to open a repository
read-only. On Chromium, a drop can still produce a writable handle; try that
first and fall back.

## Acceptance criteria

- [x] `ReadOnlySource` implements `RepoSource` over a `FileList` or a normalised file map.
- [x] Welcome offers a folder input and a drop target; Chromium drop prefers `getAsFileSystemHandle`.
- [x] Read-only capability is visible and mutations are refused.
- [x] The source is ready for the adapter contract suite, which lands in ISSUE-9.
- [x] A smoke test renders a fixture and proves zero writes were attempted.

## Delivery

- Commits: `b7874b0`, `d42b332`
- Summary: Read-only folder source, input, and drop target; Chromium drops prefer a handle
- Checks: npm run check (93 tests), npm run smoke
