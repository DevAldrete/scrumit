# Scrumit artefact format

This is the fallback summary. If the repository has `.scrumit/AGENTS.md` or
`llms.txt`, read those first; they are generated from and tested against the
application.

## Layout

Every path is configurable in `.scrumit/config.yaml`. Defaults:

```text
repo-root/
  .scrumit/
    config.yaml
    AGENTS.md
    templates/
  backlog/
    ISSUE-118.md
  sprints/
    2026-S20/
      sprint.md
      ISSUE-140.md
  epics/
    EPIC-01-checkout-reliability.md
  done/
    2026-S19/
      ISSUE-120.md
    ISSUE-161.md
```

An issue lives in exactly one directory. The directory is derived from the
issue's own front-matter:

| Fields | Path |
| --- | --- |
| `status: done` + `sprint: 2026-S20` | `done/2026-S20/<id>.md` |
| `status: done` + `sprint: null` | `done/<id>.md` |
| `sprint: 2026-S20` | `sprints/2026-S20/<id>.md` |
| otherwise | `backlog/<id>.md` |

The front-matter wins. If the folder disagrees, move the file on your next edit.

## Issue

```markdown
---
id: ACME-140
title: Retry webhook delivery with backoff
status: doing
type: story
epic: EPIC-01
sprint: 2026-S20
points: 3
assignee: ana-marin
priority: 1
labels: [reliability]
blocked_by: [ACME-138]
links: ["https://example.com"]
order: 20
created: 2026-10-14
updated: 2026-10-16
---

## Context

Webhook consumers see duplicate deliveries when a 5xx is followed by a slow
recovery.

## Acceptance criteria

- [ ] Retry at 1s, 8s, 60s, then dead-letter
- [ ] Duplicate deliveries drop below 0.01%
```

Only `id` is required. Defaults: `status: backlog`, `type: story`, `order: 0`,
everything else empty.

- `status`: `backlog`, `todo`, `doing`, `review`, `done`. Fixed forever.
- `type`: `story`, `bug`, `chore`, `spike`.
- `epic`: an epic id or omitted.
- `sprint`: a sprint id or omitted.
- `points`: number or omitted.
- `assignee`: lowercase hyphenated handle. Agent handles start with `agent-`.
- `priority`: 0–3 or omitted.
- `labels`: list.
- `blocked_by`: issue ids. This is the only representation of "blocked".
- `links`: list.
- `order`: manual position inside a status, spaced by 10.
- `created`, `updated`: ISO `YYYY-MM-DD`.
- Unknown front-matter keys are preserved verbatim.

## Epic

`epics/EPIC-NN-<slug>.md`

```markdown
---
id: EPIC-01
title: Checkout reliability
state: active
color: 2
owner: ana-marin
target: 2026-12-01
---

Why this epic exists, and what done looks like.
```

`state`: `planned`, `active`, `done`. `color`: 1–8. The file name is fixed at
creation; retitling does not move it.

## Sprint

`sprints/<id>/sprint.md`

```markdown
---
id: 2026-S20
name: Sprint 20
state: active
goal: Make retries boring
start: 2026-10-05
end: 2026-10-19
capacity: 24
---

Notes, decisions, and the retrospective.
```

`state`: `planned`, `active`, `closed`. Issues reference the sprint by id.

## Invariants

- YAML front-matter first, delimited by exactly `---`.
- `id` is stable forever.
- Dates are ISO `YYYY-MM-DD`.
- Do not reformat the body.
- Do not duplicate an id.
- Do not invent enum values.
- Do not touch `.git/`.
- Update `updated` on every issue change.
- `done` is an archive, not a delete.
