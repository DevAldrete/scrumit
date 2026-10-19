---
id: ISSUE-13
title: Run the sidecar browser smoke matrix
status: done
type: story
epic: EPIC-02
sprint: 2026-S02
points: 5
priority: 2
labels: [testing, browser]
created: 2026-10-19
updated: 2026-10-19
order: 140
blocked_by: [ISSUE-11, ISSUE-12]
assignee: agent-opencode
---

## Context

Phase 1 is only done when Firefox completes the write loop through the sidecar
and WebKit-equivalent renders read-only without console errors.

## Acceptance criteria

- [x] `tools/smoke.mjs` remains the Chromium folder suite; `tools/smoke-sidecar.mjs` is parameterised by browser and tier.
- [x] Chromium folder keeps the current suite passing.
- [x] Chromium, Firefox, and WebKit sidecar runs open, write, follow an external edit, and report a stopped server.
- [x] WebKit read-only renders, refuses writes, and is console-clean.
- [x] Playwright launches each installed browser without a hardcoded executable path.

## Delivery

- Commits: `3c08d8b`, `28531a0`
- Summary: Chromium, Firefox, and WebKit sidecar matrix plus WebKit read-only
- Checks: npm run check (122 tests), npm run build, node tools/smoke-sidecar.mjs --matrix
