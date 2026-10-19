---
id: ISSUE-14
title: Add the git changes view and commit API
status: todo
type: story
epic: EPIC-03
sprint: 2026-S03
points: 8
priority: 1
labels: [git, server]
created: 2026-10-19
updated: 2026-10-19
order: 10
blocked_by: [ISSUE-10]
---

## Context

Real git is the feature that makes the sidecar feel complete. It stays small:
status, diff, log, and commit. Merge, rebase, and push are deliberately excluded.

## Acceptance criteria

- [ ] `server/git.mjs` exposes status, diff, log, and commit over the existing API.
- [ ] A Changes view groups working-tree changes by directory and shows a unified diff per file.
- [ ] Commit takes a message and explicit paths; it never stages everything implicitly.
- [ ] Ahead/behind and the last five commits are visible.
- [ ] A test creates a real repository, commits a card through the API, and asserts `git log` plus a clean tree.
