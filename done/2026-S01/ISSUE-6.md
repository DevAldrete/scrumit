---
id: ISSUE-6
title: Add a validation report for agent-written repositories
status: done
type: story
epic: EPIC-02
sprint: 2026-S01
points: 3
priority: 2
labels: [agents, flow]
created: 2026-10-19
updated: 2026-10-19
order: 60
assignee: agent-opencode
---

## Context

A file with `status: donee` silently becomes `backlog`, and a dangling
`blocked_by` is invisible. Agents need the app to tell them what is wrong before
the mistake becomes board state.

## Acceptance criteria

- [ ] Validation reports unknown raw enums, duplicate ids, dangling `epic`/`sprint`/`blocked_by`, path mismatches, missing `updated`, self-blocks, and cycles.
- [ ] The Flow view lists the issues next to the hygiene checks.
- [ ] Validation is pure over the scan and covered by unit tests.
- [ ] The report is explicit about files that are documentation rather than cards.

## Delivery

- Commits: `d6f483d`, `eecfda4`
- Summary: Validation report in the Flow view, pure and tested
- Checks: npm run check (86 tests), npm run smoke
