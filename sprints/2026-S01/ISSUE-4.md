---
id: ISSUE-4
title: Introduce the capability model and a single write guard
status: doing
type: story
epic: EPIC-02
sprint: 2026-S01
points: 5
priority: 1
labels: [browser, core]
created: 2026-10-19
updated: 2026-10-19
order: 10
assignee: agent-opencode
---

## Context

Read-only cannot be a scattering of browser checks. `RepoSource` needs a
`capabilities` object and every mutation needs one guard. The guard must run
before optimistic state changes, not only before the file write.

## Acceptance criteria

- [ ] `Capabilities` is defined in `model.ts` and exposed by every `RepoSource`.
- [ ] The store exposes a capability signal derived from the source and permission state.
- [ ] Every mutating entry point refuses cleanly when `canWrite` is false, with one explanation.
- [ ] Demo, FSA, read-only, and HTTP sources declare accurate capabilities.
- [ ] A test with a read-only fake source proves no mutation writes or throws.
