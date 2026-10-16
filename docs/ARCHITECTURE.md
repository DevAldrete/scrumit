# scrumit — architecture

A local-first scrum/kanban console for repositories where the artefacts are plain
`.md` files with YAML front-matter. The repo is the database. scrumit is a lens
and an editor over it.

---

## 1. Guiding constraints

1. **The repo is the source of truth.** Every artefact is a file you can read,
   diff, blame and merge without scrumit. Nothing exists only inside the app.
2. **Local-first.** No account, no server, no telemetry. Runs as a static SPA.
3. **Every write is a small write.** One artefact change touches one file, so
   git diffs stay reviewable and merges stay boring.
4. **No lock-in through format.** Front-matter keys are stable, documented, and
   unknown keys are preserved verbatim on round-trip.

## 2. Runtime shape

```
  browser
  ┌──────────────────────────────────────────────────────────┐
  │  Preact SPA                                              │
  │                                                          │
  │   store (signals)        ← in-memory view of the repo    │
  │      │                                                   │
  │      ▼                                                   │
  │   RepoSource (interface)                                 │
  │      ├── FsaSource   → File System Access API (real dir) │
  │      └── Demosource  → seeded in-memory files            │
  │                                                          │
  │   Dexie (IndexedDB) ─── handles, registry, prefs, cache   │
  └──────────────────────────────────────────────────────────┘
              │
              ▼
  your repo on disk            git in your terminal
  .scrumit/  backlog/  ...     (commit / branch / push)
```

Two adapters behind one `RepoSource` interface. The demo adapter makes the app
fully usable with no folder picked, and keeps UI work independent of FS quirks.

### Why Dexie, given the repo holds the data?

IndexedDB is needed for exactly the things a filesystem cannot hold:

| Stored in Dexie | Why |
| --- | --- |
| `FileSystemDirectoryHandle` | Handles are structured-cloneable; this is the only way to reopen a repo without re-granting permission. |
| Repo registry | Name, path, colour, last opened, pinned — so the switcher is instant at cold start. |
| UI preferences | Theme, density, board order, filters, collapsed columns. |
| Parsed index snapshot | Cold start renders the board from cache before the directory is re-scanned. |
| Unsaved drafts | Editor content survives a tab close or crash. |

Dexie never holds authoritative issue state — it holds *caches and keys*.

### Permission model

`showDirectoryPicker()` grants read/write for the session. Handles persisted in
Dexie can be re-used later but need a user gesture to re-grant
(`handle.requestPermission()`), and the browser may silently downgrade to
`prompt`. The app therefore always asks for permission at the moment of use and
degrades to read-only with a visible banner rather than throwing.

## 3. Repository layout

```
repo-root/
  .scrumit/
    config.yaml            # board columns, sprints settings, rituals, vocab
    templates/             # new-issue / new-epic templates
  backlog/
    ISSUE-142.md           # not yet in a sprint
  sprints/
    2026-S08/
      sprint.md            # front-matter: goal, dates, capacity + body: notes
      ISSUE-131.md
  epics/
    EPIC-07-checkout.md
  done/
    2026-S07/              # archived completed issues, by sprint
  people/
    ana-marin.md           # optional: team members, capacity, avatar seed
```

An issue lives in exactly one directory, and **that directory is derived from
its own front-matter**, not the other way around. `status: done` + `sprint:
2026-S07` ⇒ `done/2026-S07/ISSUE-131.md`. The mover is idempotent, so a hand-moved
file and a hand-edited field converge on the same place.

### Issue file

```markdown
---
id: ISSUE-142
title: Retry webhook delivery with backoff
status: doing          # backlog | todo | doing | review | done
type: story            # story | bug | chore | spike
epic: EPIC-07          # epic id, or null
sprint: 2026-S08       # sprint id, or null
points: 3
assignee: ana-marin
labels: [payments, reliability]
created: 2026-08-04
updated: 2026-08-11
blocked_by: [ISSUE-138]
links: ["https://…"]
---

## Context

Webhook consumers see duplicate deliveries when a 5xx is followed by a slow
recovery. Retries need exponential backoff and an idempotency key.

## Acceptance criteria

- [ ] Retries at 1s, 8s, 60s
- [ ] Duplicate deliveries drop to < 0.01%
```

Rules:

- `id` is the only required key. Everything else has a documented default.
- Unknown front-matter keys are preserved on write (forward compatibility).
- The body is untouched by the parser: it is a byte range, not a re-serialised AST.
  This is what keeps diffs honest, and there is a test that asserts the body is
  identical after a status change.
- Dates are ISO `YYYY-MM-DD` strings. No timezone games.
- `order` is scrumit's own key: the manual position of a card inside its column,
  spaced by 10 so a drop normally rewrites exactly one file. Only when two
  neighbours are adjacent does the column get renumbered.
- `priority` (0–3) and `links` are optional and omitted when empty, so a card
  created in the UI produces a file a human would have written.

### config.yaml

```yaml
version: 1
project: Acme Platform
columns:
  - { id: backlog, name: Backlog, wip: null }
  - { id: todo,    name: To do,   wip: 8 }
  - { id: doing,   name: Doing,   wip: 3 }
  - { id: review,  name: Review,  wip: 4 }
  - { id: done,    name: Done,    wip: null, terminal: true }
sprints:
  length_days: 14
  dir: sprints
epics:
  dir: epics
backlog:
  dir: backlog
archive:
  dir: done
vocabulary:
  points: true
  assignees: true
```

`wip` drives the board's limit indicator and the WIP-limit signal in metrics.

## 4. Change model

### Outbound: the app writing

```
user action → store (optimistic) → RepoSource.write() → Dexie cache update
                                            │
                                            └→ file written, dirty flag set
```

- Writes are **debounced per file** (900 ms) so typing in the editor produces one
  write, then flushed on blur/close. Structural changes — a status, a sprint, a
  drag — write immediately, because the file moves when they do.
- A write is *create file* or *replace file*. Never a rewrite of the repo.
- Every write records its path in a short-lived self-write ledger (§4, inbound).

### Inbound: everything else writing

```
FileSystemObserver → filter (ignored dirs, self-writes) → settle 180 ms
   → store debounce 260 ms → flush pending edits → rescan → diff → tell the user
```

The repository is shared with `git`, with editors and, increasingly, with agents.
So the interesting direction of travel is work arriving that scrumit did not do.

- `FileSystemObserver` watches the repository root **recursively**, not each
  artefact directory. An issue anywhere in the tree is a card, so a narrower
  watch would miss files a human or an agent put somewhere unexpected. The cost
  is git's own churn, which is dropped on the first path component because a
  checkout can touch thousands of files under `.git/`. `.git/HEAD` is the one
  exception: it changes the branch, so it is reported separately and handled
  without a rescan.
- **Self-writes are suppressed.** The observer fires for scrumit's own saves, and
  acting on them would be both pointless and disruptive mid-drag. Every write
  lands in a four-second ledger and is ignored on the way back in.
- A refresh **flushes pending edits first**. Otherwise a rescan would read the
  file mid-keystroke and quietly revert the user's last sentence. The window in
  which a local edit wins over an external one is the write debounce, and the
  human is by definition looking at that file.
- A refresh **waits for a drag to finish**. SortableJS owns the DOM for the
  duration, and rebuilding the board underneath it would be a visible glitch.
- Refreshes are **debounced twice** — 180 ms in the adapter to let a burst of
  writes settle, 260 ms in the store to coalesce a longer one. An agent rewriting
  twenty files produces one scan and one sentence.
- What changed is **described, not counted**: "From disk: 1 card moved, 1 added"
  with the moves named. `changes.ts` is a pure function over two snapshots, so it
  is unit-tested rather than eyeballed.
- Where `FileSystemObserver` is unavailable, the app falls back to looking again
  when the tab returns after more than a couple of seconds away. Slower, but the
  user-visible promise is the same: the board is not stale.

`git` stays out of process. scrumit reads the branch name from `.git/HEAD` and
makes no attempt at `git status`.

## 5. Module map

| Path | Responsibility |
| --- | --- |
| `src/lib/model.ts` | Domain types: `Issue`, `Epic`, `Sprint`, `BoardConfig`, `Repo`. |
| `src/lib/frontmatter.ts` | Front-matter split/parse/serialise; preserves body + unknown keys. |
| `src/lib/artefacts.ts` | Issue/epic/sprint ⇄ markdown + YAML, file classification, id generation. |
| `src/lib/config.ts` | `config.yaml` defaults, load, serialise, validate. |
| `src/lib/paths.ts` | Where an artefact *should* live, given its fields. |
| `src/lib/agentGuide.ts` | The per-repository agent guide: live context + the spec. |
| `src/lib/db.ts` | Dexie schema: repos+handles, prefs, snapshot cache, drafts. |
| `src/lib/source.ts` | `RepoSource` interface, the directory scan, the write/move helper. |
| `src/lib/fsa.ts` | File System Access adapter: walk, read, write, permissions, `FileSystemObserver`. |
| `src/lib/demo.ts` | Seeded in-memory adapter, mirrored into Dexie. |
| `src/lib/store.ts` | Signals: active repo, artefacts, filters, selection, all mutations. |
| `src/lib/metrics.ts` | Columns, sprint progress, burndown, velocity, flow, hygiene. |
| `src/lib/changes.ts` | Diffing two scans into a sentence a human can read. |
| `src/lib/md.ts` | Excerpts and checklist counts — no dependencies. |
| `src/lib/render.ts` | Markdown → sanitised HTML, both imported lazily. |
| `src/lib/motion.ts` | The four animations, and the reduced-motion guard. |
| `src/lib/format.ts` | Dates, durations, people, points. |
| `src/ui/*` | Shell, board, backlog, sprint and epic views, flow, settings, palette. |
| `src/ui/charts.tsx` | Burndown, velocity bars, flow band — hand-drawn SVG, no chart library. |
| `src/themes.css` | Token defaults + 23 community themes. |
| `tools/*.test.mjs` | Format and adapter tests (`node --test`). |
| `tools/smoke.mjs` | Real-browser walkthrough with screenshots. |

### Decisions worth knowing

**Drag and drop uses SortableJS in fallback mode.** The fallback clone behaves
identically under a mouse and a finger, lets the carried card be styled, and
keeps a click from being swallowed as a drag (`fallbackTolerance`). Native HTML5
drag has none of those properties. One consequence that took a bug to learn:
Sortable mutates the DOM, Preact owns the DOM, so `onEnd` puts the node back
where it found it and lets the state change drive the re-render. Sorting the DOM
directly desynchronises the virtual tree.

**`git` is read, never reproduced.** The branch comes from `.git/HEAD`, read
directly rather than through the directory walk — the walk deliberately skips
`.git`, which is exactly the kind of bug the adapter tests exist to catch. No
`git status` is attempted.

**Statuses are fixed at five.** Status decides which folder a file lives in, so
it has to be portable between people and machines. Names, order, WIP limits and
visibility are all configurable; the ids are not.

**The burndown is a derivation.** It is reconstructed from `created` and
`updated`, because there is no transition history to read. The UI says so on the
screen rather than implying precision it does not have. Persisting real
transitions is the change that would make it trustworthy.

**Charts are hand-drawn SVG.** Three small components, no charting dependency,
and they inherit the theme tokens like everything else.

**Watching degrades, it does not fail.** `FileSystemObserver` is Chromium-only
and still experimental, and the File System Access API itself is Chromium-only.
Where either is missing the app says so in Settings and falls back to looking
again when the tab returns, rather than leaving you to guess whether the board is
stale. The one thing it never does is claim to be watching when it is not.

**Markdown parsing is loaded on demand.** `marked` and `DOMPurify` are a third of
the JavaScript and are needed only when someone opens the preview tab, so they
sit in their own chunks. That took first load from 148 kB gzipped to 123 kB. The
animation runtime uses `motion/mini` for the same reason: `animate` is the only
thing scrumit calls. The agent specification is a lazy chunk too — 6 kB gzipped,
loaded only when somebody writes the guide.

**The documentation is tested.** `llms.txt` is the interface between scrumit and
every agent that edits a repository on its behalf, so drift in it is a real bug:
an agent following a stale spec writes files the app reads as broken. The test
suite parses the spec and checks it against the code — every status, type and
front-matter key documented, the config example matching `defaultConfig()`
exactly, the path rules matching `paths.ts`. That last check has already caught a
documented WIP limit the defaults did not set.

**Filesystem watching is tested against real files.** A native directory picker
cannot be driven by an automated browser, which is why the File System Access
path went untested for so long. The way out is the Origin Private File System: it
hands out a genuine `FileSystemDirectoryHandle`, so a test can build a fixture
repository, open it through a dev-only seam, and then write to it from outside
the app exactly as an agent would. The suite asserts that the observer starts,
that an external edit produces the right sentence, that the moved card really
moved, that scrumit's *own* write produces no refresh at all, and that the file
it created landed at the path §5 derives. The seam is behind
`import.meta.env.DEV` and is absent from production bundles — verified by
grepping the build output.

## 6. Verification

Two layers, both runnable with `npm run check` and `npm run smoke`.

**Format and adapter tests** (`node --test`, 26 assertions) cover the things that
would damage a checkout: front-matter round-tripping, byte-preservation of the
body, lenient parsing of hand-written shorthand, CRLF and BOM, path derivation
and file moves, config defaults, WIP arithmetic, and the File System Access
adapter driven against a mock of the browser API — including a directory that
creates its own parents, a move that must delete the old file, and a file that
throws on read and must be reported rather than dropped.

**The smoke test** loads the app in real Chrome, opens the demo repository, drags
a card between columns and confirms the move survives a reload, walks all six
views, switches themes, exercises the command palette, and fails on any console
error, page exception or failed request. It also writes a screenshot of every
view, which is how the design gets reviewed rather than assumed.

## 7. Design language

**Chrome is achromatic; colour is data.** The interface shell is near-greyscale
and monospaced so that epic colours, status hues and WIP warnings are the only
chromatic events on screen.

- **Fraunces** — display only: wordmark, empty states, sprint and epic titles.
- **IBM Plex Mono** — all chrome, labels, IDs, counts, paths, points.
- **IBM Plex Sans** — prose: issue bodies, retro notes, descriptions.
- Rules and 1px hairlines instead of shadows; near-square corners (2px).
- Density is a feature: the board shows more work than a Trello column would.
- Structural devices encode real information — a card's top rule is its epic,
  its gutter is its estimate, its footer is its file path.

Motion is used only where it explains a change: a single staggered column
entrance on load, cards settling after a drag, a pulse when a WIP limit breaks.
All of it collapses under `prefers-reduced-motion`.

## 8. Roadmap

**Built** — repository switching with remembered folder handles, Dexie-backed
prefs and snapshot cache, 23 themes, kanban board with drag and drop and WIP
limits, dense backlog with bulk scheduling, full issue panel with markdown
preview, sprint close with carry-over, epics with progress, the flow view, the
command palette, unsaved-draft recovery, live filesystem watching with a
plain-language change report, and a generated agent guide.

**Next** — issue templates from `.scrumit/templates`; an undo stack; bulk edit
across a multi-selection; saved filter views; a change log of recent external
edits rather than only the latest toast.

**Later** — local git sidecar (`status`, `diff`, `log`, `commit`, `checkout`);
burndown from recorded sprint history rather than derivation; a dependency graph
for `blocked_by`; CSV and Notion import; a printable sprint review; a plugin API
over the `RepoSource` interface.
