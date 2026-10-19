# Plan: cross-browser sources, and the next slice of value

> **For the agent picking this up.** Read this whole document, then read
> `docs/ARCHITECTURE.md` §2 and §4. Run `npm run check` and `npm run smoke` before
> you change anything so you know the baseline is green. Work the phases in order
> and stop at each checkpoint — Phase 1 is independently shippable and does not
> depend on the sidecar.
>
> **Do not** add a dependency, change the on-disk format, or weaken a test to make
> something pass. If a step looks impossible, say so in the pull request rather
> than silently narrowing the goal.

**Effort scale:** S ≈ half a day, M ≈ one to three days, L ≈ a week, for one
agent with the test suite green.

**Goal in one sentence:** make the app usable in Firefox and Safari without
regressing the zero-install Chromium experience, and land a small set of
high-value features while the file format is already open.

---

## 1. Where we are

A static Preact SPA over one interface, `RepoSource`, with two implementations:
`FsaSource` (File System Access) and `DemoSource` (an in-memory map mirrored into
Dexie). 53 unit tests, plus a browser walkthrough that drives a real repository
built over the Origin Private File System.

Four things are Chromium-only today, and only one of them actually matters:

| Capability | Chromium | Firefox | Safari |
| --- | --- | --- | --- |
| `showDirectoryPicker()` — the writable folder | yes | no | no |
| `FileSystemObserver` — live watching | yes | no | no |
| OPFS (`navigator.storage.getDirectory`) | yes | yes | yes |
| `DataTransferItem.getAsFileSystemHandle()` — a handle from a dropped folder | yes | no | read-only |

Everything else — Preact, Dexie, SortableJS, Tailwind, `color-mix`, `:has`,
IndexedDB, the file format, the diffing, the tests — works everywhere. **The
blocker is writable directory access, not the UI.**

Firefox has declined to implement the File System Access API; WebKit has not
shipped `showDirectoryPicker`. Neither is a schedule risk to bet on. So the plan
does not wait for them.

### Verify before you build

Browser support moves. Before Phase 0, write `tools/probe-support.mjs` — modelled
on the probe used for `FileSystemObserver` — that prints, per browser:

```
showDirectoryPicker, FileSystemObserver, OPFS, getAsFileSystemHandle,
CSS.supports('color-mix: …'), handle-cloneable-into-IndexedDB
```

Run it against Chromium (already cached), plus Firefox and WebKit after
`npx playwright install firefox webkit`. Note in the PR what you measured; the
rest of this plan assumes the table above and should be corrected if it is wrong.

---

## 2. The decision: three tiers, one interface

Keep `RepoSource` as the seam and add implementations. The app never learns which
one it is talking to beyond a `capabilities` object.

| Tier | How you get there | Write | Live watch | Git | Install |
| --- | --- | --- | --- | --- | --- |
| **1. Folder** | `showDirectoryPicker` | yes | `FileSystemObserver` | branch only | none |
| **2. Sidecar** | `npx scrumit serve --repo .` | yes | SSE from `fs.watch` | **real** | one command |
| **3. Read-only** | open or drop a folder | **no** | focus refresh | branch only | none |
| Demo | bundled | in-memory | n/a | no | none |

Tier 2 is the answer to the question. It is also the only way to get real git, and
it gives Firefox and Safari *better* watching than Chromium has today, because
`fs.watch` on the server is not limited to one browser.

Tier 3 exists because a scrum master reviewing a board, printing a sprint
review, or showing someone the flow should not need to install anything.

### What we are deliberately not doing

- **A `browser-fs-access` style polyfill.** It degrades writes into per-file
  "Save as" downloads. For a board of sixty files that is not an app, it is a
  prank.
- **Electron or Tauri.** It would solve everything and cost a build pipeline, a
  signing story and 100 MB, to duplicate what a 200-line local server does.
- **`isomorphic-git` in the browser.** It needs a filesystem adapter over FSA
  anyway (so still Chromium-only), it is large, and it still cannot write a
  folder in Firefox. Rejected for the same reason as the polyfill.
- **OPFS as the repository.** That is just the demo repo with extra steps, and it
  abandons "git-versioned files" — the premise of the product.

---

## 3. Phase 0 — fix what will break first (S)

Small, unblocks everything else, and one of these is a real bug.

### 0a. Persisting the handle can throw `DataCloneError`

`putRepo(record)` stores a `FileSystemDirectoryHandle` in IndexedDB. That only
works where handles are structured-cloneable. Safari exposes handles (from a drop)
without supporting that clone. Today `addLocalRepo` awaits `putRepo` with no
guard, so on such a browser **adding a repo throws and nothing opens**.

- **Files:** `src/lib/db.ts`, `src/lib/store.ts`
- **Do:** attempt with the handle; on `DataCloneError`, persist the record
  without it, set a `handlePersisted: false` flag, and show "this browser cannot
  remember this folder — you will need to reopen it each session".
- **Accept:** a unit test with a fake un-cloneable handle proves the repo still
  opens, and `listRepos` / `openRepo` tolerate a record with no handle instead of
  failing with "scrumit no longer has access to this folder".

### 0b. The capability model

Read-only cannot be a scattering of `if (chromium)` checks. Introduce it once.

```ts
// src/lib/model.ts
export interface Capabilities {
  canWrite: boolean
  canWatch: boolean
  /** 'handle' | 'http' | 'none' — how the folder was obtained. */
  access: 'handle' | 'http' | 'none'
  git: 'branch' | 'full' | 'none'
}
```

- `RepoSource` gains `readonly capabilities: Capabilities`.
- The store exposes `capabilities = signal<Capabilities>(…)`, defaulted to the
  most restrictive value before a repo is open.
- **Every** write path calls one guard: `if (!capabilities.value.canWrite) return
  refuseWrite()`, where `refuseWrite()` toasts once and explains how to get write
  access.
- **Files:** `model.ts`, `source.ts`, `fsa.ts`, `demo.ts`, `store.ts`
- **Accept:** setting `canWrite: false` on a fake source makes every mutation a
  no-op with one explanation, and nothing throws.

### 0c. Make read-only legible in the UI

A read-only app that *looks* editable is worse than one that refuses. With
`canWrite === false`:

- Hide the column composers and the "Add…" buttons.
- Disable SortableJS (`new Sortable(el, { disabled: !canWrite })`) rather than
  removing drag — the cards should still look like cards.
- Make the panel's fields `readonly` / `disabled`; hide Delete.
- Show a persistent strip under the header: "Read-only — this browser can open
  the folder but not write to it. Run `npx scrumit serve` for full access."
- Command palette: filter out mutating commands.

**Accept:** the existing smoke suite can open a repo with a read-only fake source
and assert that a drag does not move a card and that no file is written.

---

## 4. Phase 1 — the sidecar (M → L, the main work)

### 4a. Shape

One process, one origin, no CORS:

```sh
npx scrumit serve --repo ~/dev/acme --port 5180
#  scrumit  http://127.0.0.1:5180   ·  /Users/me/dev/acme  ·  token 4f3a…
```

It serves `dist/` **and** the API from the same origin. In development, Vite
proxies `/api` to it, so there is still one URL to remember.

- **New:** `server/index.mjs` (plain Node, no framework — `node:http` is enough),
  `server/fs-api.mjs`, `server/git.mjs`, `server/security.mjs`
- **Dependencies:** none required. `chokidar` only if `fs.watch({recursive:true})`
  proves unreliable on Linux; measure before adding it.

### 4b. API

```
GET    /api/health                      → { ok, version, repo, capabilities }
GET    /api/files                       → [{ path, mtime, size }]
GET    /api/file?path=…                 → text/plain  (+ ETag = mtime:size)
PUT    /api/file?path=…&base=<etag>     → 200 | 409 { current }
DELETE /api/file?path=…                 → 204
GET    /api/events                      → text/event-stream { type, path }
GET    /api/git/status                  → { branch, ahead, behind, changes[] }
GET    /api/git/diff?path=…             → unified diff
POST   /api/git/commit                  → { sha }   body: { message, paths[] }
```

Rules that are not optional:

- **Bind to `127.0.0.1` only.** Never `0.0.0.0`.
- **Path containment.** `path.resolve(root, rel)` must `startsWith(root + sep)`.
  Reject absolute paths, `..`, and symlinks that escape (use `realpath`).
- **Refuse non-markdown writes.** Only `*.md` and `.scrumit/config.yaml`.
- **Token.** Printed on start, required as `Authorization: Bearer`. Stored in
  `localStorage` per origin. Same-origin serving makes it belt-and-braces; the
  Vite proxy case needs it.
- **`base` is a concurrency check, not a lock.** `PUT` with a stale `base`
  returns `409` and the current text. This is how two agents editing one card
  stop silently clobbering each other — the biggest correctness gap in the
  current app.
- **SSE and auth interact badly.** `EventSource` cannot set an `Authorization`
  header. Either accept `?token=` on `/api/events` only (and strip it from logs),
  or drop `EventSource` and stream with `fetch()` + `ReadableStream`. Decide once
  and note it in the README; do not discover it twice.

### 4c. `HttpSource implements RepoSource`

- **New:** `src/lib/http.ts`
- `list()` reads `/api/files`; `read`/`write`/`remove` hit the file endpoints;
  `watch()` opens an `EventSource` and maps events into the same `WatchEvent`
  shape `FsaSource` already produces, so `queueExternal` and everything above it
  is unchanged. **Do not touch the watcher logic in `store.ts`.**
- Add `'http'` to `RepoSource['kind']` and `RepoMeta['kind']`.

### 4d. Connect and discover

- On boot, `GET /api/health` with a 600 ms timeout. If it answers, offer tier 2.
- Welcome screen gets a third path: "Connect to a local server", with the URL
  prefilled to `http://127.0.0.1:5180`.
- `RepoMeta.path` for these is the server's repo path; the switcher shows it.
- If the server disappears mid-session: one toast, and every write fails with
  "the local server is not responding" rather than throwing.

### 4e. Conflict handling

`persistIssue` currently treats every failure the same way: toast and move on.
A `409` is not that. When it arrives:

1. Stop retrying. Do **not** overwrite.
2. Keep the user's text in memory and mark the card with a conflict badge.
3. Show both versions: "This file changed on disk while you were editing" with
   **Keep mine** (re-`PUT` with the fresh `base`) and **Take theirs** (discard the
   local edit and rescan).
4. Never auto-resolve. The agent and the human may both be right.

This is the only place in the app where "the file changed under you" is not
solved by a rescan, so it deserves its own path rather than a generic catch.

**Accept for Phase 1:**

- A smoke run against the sidecar opens a real temp directory, writes a card,
  confirms the file exists on disk, writes a card *outside* the app and confirms
  the board follows, and stops the server to confirm the failure is legible.
- `npm run check` still passes with no test changed to accommodate it.

---

## 5. Phase 2 — real git, because we now can (M)

This is the feature that makes the app feel complete rather than a good viewer.
Only available when `capabilities.git === 'full'`; degrade to the branch chip
otherwise.

- A **Changes** view in the rail: working-tree status grouped by directory, with
  the unified diff per file.
- **Commit** from a textarea: message + staged paths, button disabled when
  nothing is selected. Never `git add -A` implicitly.
- Show **ahead/behind**, and the last five commits with author and subject.
- Optional and clearly labelled: **checkout an existing branch**. Do not offer
  branch creation, rebase, merge or push in this phase — those need conflict
  handling the app cannot honestly provide.

**Accept:** a test creates a real git repo in a temp dir, commits a card through
the API, and asserts `git log` shows it and the tree is clean.

---

## 6. Phase 3 — read-only folder access anywhere (S)

Independent of the sidecar, and the cheapest way to be useful in Safari.

- `<input type="file" webkitdirectory>` and a drop target on the welcome screen.
- Build a `ReadOnlySource` over the resulting `FileList`: paths come from
  `file.webkitRelativePath`, reads from `file.text()`. Watching is the existing
  focus-refresh fallback in `store.ts`.
- On Chromium, prefer `DataTransferItem.getAsFileSystemHandle()` on drop: that
  yields a **writable** handle, so a drop becomes a full tier-1 repo. Try that
  first and fall back.
- `canWrite: false`, `access: 'none'`, and Phase 0c already does the UI.

**Accept:** the smoke suite opens a fixture read-only and asserts the board
renders, a drag does nothing, and zero writes were attempted.

---

## 7. Known limitations

Recorded honestly; several become work items above.

| # | Limitation | Impact | Where it is handled |
| --- | --- | --- | --- |
| 1 | No writable local folder outside Chromium | App is read-only or demo-only in Firefox/Safari | Phases 1 and 3 |
| 2 | No `FileSystemObserver` outside Chromium | Stale board until refresh | Sidecar SSE (Phase 1) |
| 3 | **Last-write-wins; no merge, no lock** | Two agents editing one card silently clobber | `base`/409 in Phase 1 |
| 4 | Only the branch is read from git | No diff, no commit, no history in-app | Phase 2 |
| 5 | Burndown is derived from `updated` | Editing an old issue moves the curve | Format change; out of scope |
| 6 | Five fixed statuses | Cannot model a custom workflow | Deliberate; see ARCHITECTURE §5 |
| 7 | Full rescan on every external change | O(files) reads; noticeable past ~5k files | Incremental rescan (win #6) |
| 8 | Watcher observes the root recursively | Heavy on a monorepo; the API has no exclude list | Prefer tier 2; filter is cheap but the events are not free |
| 9 | No validation surfacing | A typo'd `status:` silently becomes `backlog` | Win #1 |
| 10 | Touch and small screens underserved | Hover-only affordances; dense 5-column board | Win #9 |
| 11 | No keyboard navigation on the board | Poor for keyboard-first users and screen readers | Win #10 |
| 12 | No conflict/merge UI of any kind | By design: git is the merge tool | Documented in `llms.txt` §9 |
| 13 | Demo repo is a second code path | Bugs can hide there or not | Conformance suite, §9 |
| 14 | No comments, attachments or audit trail | Users will ask; the format is deliberately small | Out of scope |
| 15 | `config.version` is written but unused | No migration mechanism for format changes | Add when the first change lands |
| 16 | English only | Dates use `Intl`, copy does not | Out of scope |
| 17 | No i18n of the format docs | `llms.txt` is English | Out of scope |

---

## 8. Small wins, ranked by value per hour

Each is self-contained and can be picked up in any order after Phase 0.

| # | Win | Why it earns its place | Effort |
| --- | --- | --- | --- |
| 1 | **Validation report** | A file with `status: donee` silently becomes `backlog`; a `blocked_by` pointing at a deleted id is invisible. An agent-written repo needs this more than a human one. Surface unknown enums, duplicate ids, dangling `epic`/`sprint`/`blocked_by`, and files with no `id`. Put it in the Flow view next to the hygiene checks. | S |
| 2 | **Tick a checkbox from the preview** | Acceptance criteria are the point of the format, and today you must edit raw markdown to tick one. Replace exactly the matched `- [ ]` → `- [x]` in the body string; the byte-preservation test already guards this. | S |
| 3 | **Search bodies** | The filter only looks at id, title and labels. Including `body` is a one-line change and makes ⌘K genuinely useful. | S |
| 4 | **Two-tab sync** | `BroadcastChannel` on the existing snapshot signal. Board on one monitor, editor on the other, which is how a scrum master actually works. | S |
| 5 | **Deep links** | `#ACME-140` opens that card; `?repo=<id>` opens that repo. Makes the app shareable with a colleague running the same checkout. | S |
| 6 | **Incremental rescan** | The watcher already knows which paths changed. Re-read only those and merge into the snapshot, instead of walking the repo. Fixes limitation #7 and makes the observer cheap on big repos. | M |
| 7 | **External change log** | Today only the latest diff survives as a toast. Keep the last 50 in memory and show them in a panel — the agent workflow is a stream, not an event. | S |
| 8 | **Standup mode** | Step the active sprint one card at a time: `→` next, `1`–`5` set the column, `b` block, `n` note. Distinctive, small, and exactly what the persona does every morning. | M |
| 9 | **Touch affordances** | Show grips and row actions permanently under `@media (pointer: coarse)`; the backlog cannot be reordered on a phone today. | S |
| 10 | **Board keyboard model** | Roving tabindex over cards, arrow keys to move focus, Enter to open, `Esc` to close. Also fixes the accessibility gap in limitation #11. | M |
| 11 | **Undo** | A 10-deep stack for the destructive set: delete, bulk status, sprint close. Most mistakes here are one keystroke from recoverable. | M |
| 12 | **Print / export sprint review** | A print stylesheet plus a "review" layout: goal, delivered, carry-over, retro. A PDF a scrum master can paste into a stakeholder update. | S |
| 13 | **PWA** | Manifest + service worker so it installs and works offline. A local tool that needs a network to load is silly. | S |
| 14 | **Cycle-time histogram** | One chart beside lead time, still derived and still labelled as such; a median hides the tail that hurts. | M |

Note on #11: undo must be implemented as *file writes* (restore the previous
content), not as an in-memory patch, or it will fight the watcher.

---

## 9. Test strategy

The three adapters are the risk. Make them prove themselves against one contract.

**9a. A conformance suite.** `tools/source-contract.test.mjs` exports a function
that takes a `RepoSource` factory and an expected capability set, and asserts the
full contract: `list` shape, round-trip read/write, nested directory creation,
move-and-delete via `writeAt`, `remove` on a missing file, `exists`, and that
`watch` either works or is absent. Then run it three times: FSA over the mock
(from `tools/fsa.test.mjs`), HTTP against a live server on an ephemeral port, and
read-only over a `FileList`-like object.

This is the single highest-leverage test in the plan: it is what stops "works in
Chrome" from being the definition of done.

**9b. Browser matrix in the smoke script.** Parameterise `tools/smoke.mjs` with a
browser name and a source tier. Minimum matrix before shipping Phase 1:

| Browser | Tier | What must pass |
| --- | --- | --- |
| Chromium | folder (OPFS) | current suite |
| Chromium | sidecar | open, write, external edit, server stopped |
| Firefox | sidecar | same |
| WebKit | read-only | renders, refuses writes, no console errors |

`npx playwright install firefox webkit` adds the browsers; `tools/smoke.mjs`
already finds Chromium in the Playwright cache — extend that lookup rather than
hardcoding a path. Note in the PR that Playwright's WebKit is not Safari.

**9c. Gates.** `npm run check` must stay at 53+ tests with no test weakened.
`npm run smoke` must stay console-clean in every row of the matrix it can run.

---

## 10. Suggested session split

| Session | Scope | Ends when |
| --- | --- | --- |
| **A** | Phase 0 + probe script | Capability model in place, read-only mode tested, docs updated |
| **B** | Phase 1a–1c (server, `HttpSource`, SSE) | A card written through the sidecar lands on disk and the board follows an external edit |
| **C** | Phase 1d + Phase 3 + conformance suite | Firefox passes the matrix via the sidecar; Safari-equivalent renders read-only |
| **D** | Phase 2 (git) | Commit a card from the UI; `git log` agrees |
| **Any** | Wins from §8 | One win, one PR, tests included |

Do not start Phase 2 before Phase 1 is merged. Do not start §8 wins before Phase 0.

---

## 11. Definition of done for this plan

- [ ] `showDirectoryPicker` is no longer the only way to write.
- [ ] Firefox can complete the full read/write loop (via the sidecar).
- [ ] WebKit-equivalent can render a repo and is visibly, unambiguously read-only.
- [ ] Every adapter passes the same contract suite.
- [ ] A stale `PUT` returns `409` and the UI says what happened.
- [ ] `canWrite: false` makes every mutation a no-op with one explanation, proven
      by a test.
- [ ] `README.md`, `docs/ARCHITECTURE.md` and `llms.txt` agree with the code —
      including the browser-support table, which is the first thing a new user
      reads and the easiest thing to leave lying.
- [ ] `llms.txt` gains a note on the `409` behaviour, so an agent knows to re-read
      rather than overwrite.

---

## 12. Open questions for the human

1. **Is installing a local server acceptable for the primary workflow?** The plan
   assumes yes for Firefox/Safari, with Chromium keeping zero-install. If not,
   tier 3 becomes the whole answer and writes never work outside Chromium.
2. **Should the sidecar be part of this package or its own?** Bundling keeps
   `npx scrumit serve` honest; a separate package keeps the browser build free of
   Node-only code. Bundling is recommended, with `server/` outside `src/`.
3. **How much git is too much git?** The plan stops at status, diff and commit.
   Anything that can conflict — merge, rebase, push — is deliberately excluded.
4. **Does read-only need edits that can be exported?** It would be a nice
   compromise (edit locally, download the changed files or a patch), but it is
   scope the plan does not assume.
