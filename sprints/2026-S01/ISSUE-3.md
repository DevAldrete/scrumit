---
id: ISSUE-3
title: Persist repos without a cloneable handle
status: doing
type: bug
epic: EPIC-02
sprint: 2026-S01
points: 3
priority: 1
labels: [browser, persistence]
created: 2026-10-19
updated: 2026-10-19
order: 10
assignee: agent-opencode
---

## Context

`putRepo()` stores a `FileSystemDirectoryHandle` in IndexedDB. Safari can expose
a handle from a drop without allowing it to be structured-cloned. Adding a repo
then throws `DataCloneError`, so nothing opens. The record must be saved without
the handle and the cached view must remain usable.

## Acceptance criteria

- [ ] `putRepo()` retries without the handle on `DataCloneError` and records `handlePersisted: false`.
- [ ] `openRepo()` and `bootstrap()` tolerate a record with no handle by showing the cached snapshot read-only.
- [ ] The UI explains that the folder must be reopened each session.
- [ ] A unit test and a smoke seam prove the fallback path.
