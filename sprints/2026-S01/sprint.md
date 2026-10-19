---
id: 2026-S01
name: Foundation
state: closed
goal: Ship the sprint CLI and skill, then make the capability model and Phase 0 fixes safe.
start: 2026-10-19
end: 2026-11-02
capacity: 24
---

This sprint is deliberately small. The CLI and skill are the bootstrap: once
they land, every later task is claimed, committed, and closed through the board.

## Retro

Shipped: the `scrumit` sprint CLI, the `scrumit-sprint` skill, the dogfooded
board, the browser skill writer, the handle-clone fallback, the capability model
and single write guard, the read-only UI, the artefact validation report, and the
browser support probe.

Learned: WebKit really does refuse to structured-clone a directory handle into
IndexedDB, so `0a` was not theoretical. The clean-tree rule and the atomic claim
made a long run of small tasks stay readable in `git log`.

Next: Sprint 2026-S02 — the read-only folder source, the adapter conformance
suite, and the sidecar server.
