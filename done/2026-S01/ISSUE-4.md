---
id: ISSUE-4
title: Introduce the capability model and a single write guard
status: done
type: story
epic: EPIC-02
sprint: 2026-S01
points: 5
priority: 1
labels: [browser, core]
created: 2026-10-19
updated: 2026-10-19
order: 40
assignee: agent-opencode
---

## Context

Read-only cannot be a scattering of browser checks. `RepoSource` needs a
`capabilities` object and every mutation needs one guard. The guard must run
before optimistic state changes, not only before the file write.

## Acceptance criteria

- [x] `Capabilities` is defined in `model.ts` and exposed by every `RepoSource`.
- [x] The store exposes a capability signal derived from the source and permission state.
- [x] Every mutating entry point refuses cleanly when `canWrite` is false, with one explanation.
- [x] Demo, FSA, read-only, and HTTP sources declare accurate capabilities.
- [x] A test with a read-only fake source proves no mutation writes or throws.

## Delivery

- Commits: `5dbb4e5`, `6c8c0cc`
- Summary: One capability seam; every mutation guarded before optimistic state
- Checks: npm run check (80 tests), npm run smoke
