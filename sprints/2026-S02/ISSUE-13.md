---
id: ISSUE-13
title: Run the sidecar browser smoke matrix
status: todo
type: story
epic: EPIC-02
sprint: 2026-S02
points: 5
priority: 2
labels: [testing, browser]
created: 2026-10-19
updated: 2026-10-19
order: 60
blocked_by: [ISSUE-11, ISSUE-12]
---

## Context

Phase 1 is only done when Firefox completes the write loop through the sidecar
and WebKit-equivalent renders read-only without console errors.

## Acceptance criteria

- [ ] `tools/smoke.mjs` is parameterised by browser and source tier.
- [ ] Chromium folder keeps the current suite passing.
- [ ] Chromium and Firefox sidecar runs open, write, follow an external edit, and report a stopped server.
- [ ] WebKit read-only renders, refuses writes, and is console-clean.
- [ ] Playwright browser lookup extends the existing cache lookup rather than hardcoding a path.
