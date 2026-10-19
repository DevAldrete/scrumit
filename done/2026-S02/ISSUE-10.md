---
id: ISSUE-10
title: Build the local sidecar server core
status: done
type: story
epic: EPIC-02
sprint: 2026-S02
points: 8
priority: 1
labels: [server, security]
created: 2026-10-19
updated: 2026-10-19
order: 100
blocked_by: [ISSUE-4]
assignee: agent-opencode
---

## Context

The sidecar is the only way to get writable folders in Firefox and Safari, and
the only way to get real git. It must be small, local, and hostile to path
escapes.

## Acceptance criteria

- [ ] `server/index.mjs`, `server/fs-api.mjs`, and `server/security.mjs` use only Node built-ins.
- [ ] It binds to `127.0.0.1` only and serves `dist/` and the API from one origin.
- [ ] A generated bearer token is required and printed once.
- [ ] Path containment rejects absolute paths, `..`, and symlink escapes.
- [ ] Only `*.md` and `.scrumit/config.yaml` are writable; `.git/HEAD` is read-only.
- [ ] Writes are atomic and return an ETag.
- [ ] `GET /api/health`, `/api/files`, `/api/file`, `PUT`, `DELETE` and SSE events are implemented.

## Delivery

- Commits: `eb26bc3`, `66f7671`
- Summary: Dependency-free sidecar with token auth, containment, ETags, and SSE
- Checks: npm run check (101 tests)
