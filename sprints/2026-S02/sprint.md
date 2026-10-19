---
id: 2026-S02
name: Read-only and sidecar
state: closed
goal: Make Safari and Firefox useful, then give every browser a writable local server with stale-write protection.
start: 2026-10-19
end: 2026-11-02
capacity: 36
---

The order matters: the capability model from the foundation sprint is the seam
the read-only source and the HTTP source both plug into.

## Retro

Shipped: the read-only folder source and Welcome drop/input, the sidecar server
with token auth and path containment, `HttpSource` with ETags and typed
conflicts, the connect flow with a 409 comparison UI, the cross-adapter contract
suite, and the Chromium/Firefox/WebKit sidecar matrix plus WebKit read-only.

Learned: a clean SSE end had to be treated as an outage too; WebKit and Firefox
made the matrix worth running. The contract suite caught nothing embarrassing,
which is the point of writing it before the adapters diverge.

Next: Sprint 2026-S03 — real git in the app (status, diff, commit) and the first
everyday wins.
