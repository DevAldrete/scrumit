---
id: ISSUE-11
title: Implement HttpSource with ETag conflicts and SSE watching
status: done
type: story
epic: EPIC-02
sprint: 2026-S02
points: 8
priority: 1
labels: [source, server]
created: 2026-10-19
updated: 2026-10-19
order: 110
blocked_by: [ISSUE-10]
assignee: agent-opencode
---

## Context

`HttpSource` must be invisible to the store: it implements the same `RepoSource`
contract, maps server events into the existing `WatchEvent`, and turns a stale
`PUT` into a typed conflict rather than a generic save failure.

## Acceptance criteria

- [ ] `HttpSource` implements list, read, write, remove, exists, permission, and watch.
- [ ] `list()` records ETags without reading every file; writes send the remembered base.
- [ ] A stale base throws `ConflictError` with the current text and fresh ETag.
- [ ] Watching uses `fetch()` streaming so the bearer token never appears in a URL.
- [ ] A lost server becomes a typed error and one legible toast, not a crash.
- [ ] `'http'` is added to the source and repo kind unions.

## Delivery

- Commits: `acf4551`, `a23859a`
- Summary: HTTP adapter with ETags, typed conflicts, streaming watch, and outage handling
- Checks: npm run check (106 tests)
