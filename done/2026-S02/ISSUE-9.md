---
id: ISSUE-9
title: Add the adapter conformance suite
status: done
type: story
epic: EPIC-02
sprint: 2026-S02
points: 5
priority: 1
labels: [testing, source]
created: 2026-10-19
updated: 2026-10-19
order: 130
blocked_by: [ISSUE-11]
assignee: agent-opencode
---

## Context

The three adapters are the risk. One contract run against FSA, HTTP, and
read-only stops "works in Chrome" from being the definition of done.

## Acceptance criteria

- [x] `tools/source-contract.mjs` asserts list shape, round-trip read/write, nested directory creation, move/delete via `writeAt`, missing-file behaviour, `exists`, and the declared capabilities.
- [x] It runs against the FSA mock, a live HTTP server on an ephemeral port, and a read-only file map.
- [x] `watch` is asserted to work or be absent, never silently ignored.
- [x] `npm run check` stays green with no test weakened.

## Delivery

- Commits: `68ff669`, `bf67802`
- Summary: One RepoSource contract across FSA, read-only, and HTTP
- Checks: npm run check (122 tests)
