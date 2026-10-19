---
id: ISSUE-7
title: Measure browser support with a probe script
status: done
type: chore
epic: EPIC-02
sprint: 2026-S01
points: 2
priority: 3
labels: [browser, testing]
created: 2026-10-19
updated: 2026-10-19
order: 70
assignee: agent-opencode
---

## Context

Browser support moves. Before changing the capability model, measure the real
answer instead of trusting the table in the plan.

## Acceptance criteria

- [ ] `tools/probe-support.mjs` prints `showDirectoryPicker`, `FileSystemObserver`, OPFS, `getAsFileSystemHandle`, `color-mix`, and handle cloning per browser.
- [ ] It runs against Chromium, Firefox, and WebKit using the installed Playwright browsers.
- [ ] The measured result is recorded in the PR and reflected in README support copy.

## Delivery

- Commits: `c4d341e`, `5f4d5f6`
- Summary: Measured Chromium, Firefox, and WebKit; WebKit handle clone fails as predicted
- Checks: npm run probe, npm run check (86 tests)
