---
id: ISSUE-9
title: Add the adapter conformance suite
status: todo
type: story
epic: EPIC-02
sprint: 2026-S02
points: 5
priority: 1
labels: [testing, source]
created: 2026-10-19
updated: 2026-10-19
order: 20
blocked_by: [ISSUE-11]
---

## Context

The three adapters are the risk. One contract run against FSA, HTTP, and
read-only stops "works in Chrome" from being the definition of done.

## Acceptance criteria

- [ ] `tools/source-contract.mjs` asserts list shape, round-trip read/write, nested directory creation, move/delete via `writeAt`, missing-file behaviour, `exists`, and the declared capabilities.
- [ ] It runs against the FSA mock, a live HTTP server on an ephemeral port, and a read-only file map.
- [ ] `watch` is asserted to work or be absent, never silently ignored.
- [ ] `npm run check` stays green with no test weakened.
