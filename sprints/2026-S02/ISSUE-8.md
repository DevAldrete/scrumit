---
id: ISSUE-8
title: Add a read-only folder source for Safari and Firefox
status: todo
type: story
epic: EPIC-02
sprint: 2026-S02
points: 5
priority: 1
labels: [browser, source]
created: 2026-10-19
updated: 2026-10-19
order: 10
blocked_by: [ISSUE-4]
---

## Context

`webkitdirectory` and a drop target give every browser a way to open a repository
read-only. On Chromium, a drop can still produce a writable handle; try that
first and fall back.

## Acceptance criteria

- [ ] `ReadOnlySource` implements `RepoSource` over a `FileList` or a normalised file map.
- [ ] Welcome offers a folder input and a drop target; Chromium drop prefers `getAsFileSystemHandle`.
- [ ] Read-only capability is visible and mutations are refused.
- [ ] The adapter contract suite runs against the read-only source.
- [ ] A smoke test renders a fixture and proves zero writes were attempted.
