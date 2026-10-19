# scrumit

A local-first console for sprints, boards and epics that live in a git repository
as plain markdown. Every card is a file with a YAML header. Drag a card and one
file moves. Edit a field and one diff appears. Nothing is stored only inside
scrumit, so nothing is lost if you stop using it.

```
┌──────────────────────────────────────────────────────────────┐
│ scrumit  ▸ Acme Payments Platform   ⑂ main      Find ⌘K      │
├────┬─────────────────────────────────────────────────────────┤
│ ▦  │ Board · Sprint 20 · 5/44 pts · 12 days left             │
│ ☰ 8│ ┌─────────┬─────────┬─────────┬─────────┬─────────┐     │
│ ◎  │ │ Backlog │ To do   │ Doing   │ Review  │ Done    │     │
│ ▤  │ │ ACME-118│ ACME-141│ ACME-140│ ACME-137│ ACME-120│     │
│ ⌁  │ │ ACME-121│ ACME-143│ ACME-131│ ACME-139│ ACME-122│     │
│ ⚙  │ └─────────┴─────────┴─────────┴─────────┴─────────┘     │
└────┴─────────────────────────────────────────────────────────┘
```

## What it does

- **Board** with drag and drop, per-column WIP limits, and a manual card order
  that is stored in the file rather than in the app.
- **Backlog** as a dense list with multi-select, bulk scheduling, and
  grip-drag reordering.
- **Issue panel** for every field, with a markdown editor and a rendered
  preview. The body is never rewritten by the app.
- **Sprints** with goals, dates, capacity, close-with-carry-over, and a
  burndown derived from the files.
- **Epics** with owner, target, theme-derived hue, and progress.
- **Flow** — velocity, flow distribution, lead time, and the pre-standup checks
  (blocked, unassigned, unestimated, no acceptance criteria, gone quiet).
- **Command palette** (`⌘K` / `Ctrl+K`) across issues, views, sprints, epics,
  repositories and themes.
- **Live watching** — the board follows edits made outside the app and tells you
  what changed in plain words: "From disk: 1 card moved, 1 added", naming the
  moves. An agent can work the repo while you watch it happen.
- **23 themes** — scrumit's own light and dark, plus Catppuccin, Kanagawa,
  Gruvbox, Everforest, Nord, Tokyo Night, Rosé Pine, Solarized and One.
- **Multiple repositories**, switchable from the header. Folder handles are
  remembered in IndexedDB, so reopening is one click.

## Running it

```sh
npm install
npm run dev          # http://localhost:5178
npm run check        # typecheck + unit tests
npm run smoke        # drive a real browser, screenshot every view
```

Opening a folder uses the File System Access API, so it needs Chrome, Edge or
another Chromium browser. Everything else — including the whole interface —
works in the built-in demo repository, which is seeded in IndexedDB so your
edits survive a reload.

```sh
npm run build && npm run preview
```

### Browser support, measured

Browser support moves, so it is measured rather than assumed:

```sh
npx playwright install chromium firefox webkit
npm run probe
```

The current result on this machine:

| Capability | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| `showDirectoryPicker()` | yes | no | no |
| `FileSystemObserver` | yes | no | no |
| OPFS | yes | yes | yes |
| `getAsFileSystemHandle()` | yes | no | no |
| `color-mix()` | yes | yes | yes |
| handle cloneable into IndexedDB | yes | n/a | **no** |

The last row is why adding a repository no longer throws in Safari: the handle is
dropped and the cached board stays readable. Writable folders in Firefox and
Safari are the sidecar's job, not a polyfill's.

## Letting an agent run the board

Every card is a file, so an agent that can read and write markdown can run this
board without the app at all — which is the point of the format. Two files make
that practical:

- **[`llms.txt`](llms.txt)** is the complete specification: the front-matter
  reference, the invariants, path derivation, and a recipe for every operation.
  It is written to be read by a model, and it is tested against the
  implementation so it cannot quietly go stale.
- **`.scrumit/AGENTS.md`** is generated per repository from **Settings → AI
  agents**. It prepends the facts an agent cannot infer — the configured folders,
  the columns and their WIP limits, which epics and sprints exist, and the next
  free issue id — to the same specification.

```
Settings → AI agents → Write .scrumit/AGENTS.md
```

Then point your agent at it. Most agents look for `AGENTS.md` at the repository
root, and that file usually belongs to somebody else, so append the pointer from
Settings rather than replacing it:

```markdown
<!-- scrumit -->
This repository's sprint, board and epic artefacts are markdown files with YAML
front-matter. Read `.scrumit/AGENTS.md` before creating, moving or closing any
issue.
```

From there, "add a task for the retry work", "move ACME-140 to review", "close
sprint 20 and carry the rest over" are all file edits an agent can make and you
can review as a diff. In Chrome and Edge the board follows along by itself: it
watches the folder and tells you what changed, so you see the agent working
rather than a stale screen you have to refresh.

One caveat worth knowing before you rely on it: the correction only runs one way.
A write from the app puts a card back at the path its own fields imply, so a
misplaced file gets tidied rather than reported as wrong. Get the path right, or
let the test suite tell you.

## The `scrumit` CLI and the sprint skill

Writing markdown is enough for a single agent. Coordinating several needs a
little more: a way to see what is ready, claim one card without racing someone
else, move it through the statuses, and leave a commit for every state change.
That is the `scrumit` CLI.

```sh
npm link                 # puts `scrumit` on your PATH
scrumit board            # ready, in progress, blocked, review
scrumit validate         # duplicate ids, dangling refs, path drift
scrumit claim ACME-140 --agent agent-claude
scrumit finish ACME-140 --to review --summary "Implemented retries"
```

Full reference, including installation in another repository, JSON output, exit
codes, and troubleshooting: **[`docs/CLI.md`](docs/CLI.md)**.

The CLI is paired with a skill, `scrumit-sprint`, that teaches an agent the
solo and multi-agent workflows:

```sh
scrumit skill install                         # .skills/scrumit-sprint
scrumit skill install --dir .opencode/skills  # OpenCode's automatic location
```

OpenCode discovers `.skills` when `opencode.jsonc` lists it:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "skills": [".skills"]
}
```

The browser writes the same skill from **Settings → AI agents → Write the sprint
skill**, so a repository can carry the workflow even if the CLI is not installed
yet. The source of truth is [`skills/scrumit-sprint/`](skills/scrumit-sprint/).

The rules the CLI and the skill share: one task per branch, one lifecycle commit
per state change, never `git add -A`, never force-push, and never invent a
`blocked` status — blocking is always `blocked_by`. If nothing is ready, the
agent stops cleanly instead of inventing work.

## The repository format

scrumit writes one file per artefact. The directory an issue lives in is derived
from its own front-matter, so a hand-moved file and a hand-edited field converge
on the same place.

```
repo-root/
  .scrumit/
    config.yaml            # columns, directories, sprint length, vocabulary
  backlog/
    ACME-118.md            # no sprint yet
  sprints/
    2026-S20/
      sprint.md            # goal, dates, capacity, retro notes
      ACME-140.md
  epics/
    EPIC-01-checkout-reliability.md
  done/
    2026-S19/              # completed work, archived by sprint
      ACME-120.md
```

An issue:

```markdown
---
id: ACME-140
title: Retry webhook delivery with backoff
status: doing          # backlog | todo | doing | review | done
type: story            # story | bug | chore | spike
epic: EPIC-01
sprint: 2026-S20
points: 3
assignee: tobias-rehn
priority: 1            # 0–3, optional
labels: [reliability]
blocked_by: [ACME-138]
order: 20              # manual position within its column
created: 2026-10-14
updated: 2026-10-16
---

## Acceptance criteria

- [ ] Retry at 1s, 8s, 60s, then dead-letter
```

Rules that matter:

- **`id` is the only required key.** Everything else has a documented default.
- **Unknown front-matter keys are preserved.** If your repo carries `jira:` or
  `okr:`, scrumit reads past it and writes it back untouched.
- **The body is a byte range, not a re-serialised AST.** Moving a card rewrites
  `status` and `order`; your prose — including trailing horizontal rules and
  code fences — comes back identical. There is a test for exactly this.
- **Any markdown file with an `id` is an issue.** Files without one are treated
  as documentation and ignored, so a `README.md` next to your issues is fine.
- **`git` stays yours.** scrumit shows the branch name from `.git/HEAD` and
  deliberately makes no attempt at `git status`: a wrong dirty count is worse
  than none. Commit and branch in your terminal.

### config.yaml

Column ids are fixed to the five statuses — status decides which folder a file
lives in, so it has to be portable between teams. Names, order, WIP limits and
visibility are yours.

```yaml
version: 1
project: Acme Payments Platform
columns:
  - { id: backlog, name: Backlog, wip: null }
  - { id: todo,    name: To do,   wip: null }
  - { id: doing,   name: Doing,   wip: 3 }
  - { id: review,  name: Review,  wip: 4 }
  - { id: done,    name: Done,    wip: null, terminal: true }
backlog: { dir: backlog }
sprints: { dir: sprints, length_days: 14 }
epics:   { dir: epics }
archive: { dir: done }
vocabulary: { points: true, assignees: true, priorities: true }
```

## Keyboard

| Key | Does |
| --- | --- |
| `⌘K` / `Ctrl+K` | Find an issue, view, sprint, epic, repository or theme |
| `↑` `↓` `Enter` | Move and open in the palette |
| `Esc` | Close the panel, menu or dialog |
| `Enter` | Add a card from a column composer |
| `Shift+Enter` | New line in a composer |
| `⌫` | Remove the last label or blocker from an empty field |

## How it is built

Preact + Vite + TypeScript, Tailwind v4, Dexie for IndexedDB, SortableJS for
drag and drop, Motion for the handful of animations, `yaml` for the file format,
and `marked` + DOMPurify for the preview — the last two loaded lazily, since the
board never needs them.

Two adapters sit behind one `RepoSource` interface: one over the File System
Access API and one over an in-memory map for the demo repository. Both are
covered by tests, which is why the file-format layer can be trusted with a real
checkout.

The interface is deliberately monospaced and near-greyscale: colour is reserved
for the data, so epics, statuses and WIP breaches are the only chromatic events
on screen. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the data model,
the change model, the design language and the roadmap.

## Testing

```sh
npm run test
```

26 tests over the parts that would damage a repository if they were wrong:
front-matter round-tripping and byte-preservation, lenient parsing of
hand-written files, CRLF and BOM handling, path derivation and file moves,
config parsing and defaults, column/WIP arithmetic, and the File System Access
adapter driven against a mock of the browser API.

A further 27 tests cover the agent workflow and live watching: that `llms.txt`
still documents every status, type and front-matter key the code accepts, that
its config example matches the real defaults, that the generated
`.scrumit/AGENTS.md` reports the repository it was built from, and that the diff
between two scans reads as a sentence rather than a file count.

`npm run smoke` additionally loads the app in a real Chrome and drives the whole
thing: it opens the demo repository, drags a card between columns, walks all six
views, switches themes, writes the agent guide and reads it back out of
IndexedDB, reloads to confirm persistence, and then opens a second repository
built over the Origin Private File System to test watching for real — asserting
that an external write produces the right report, that the moved card moves, that
scrumit's own write produces no refresh, and that the file it created landed at
the right path. It fails on any console error and writes screenshots to
`tools/shots/`.

## Roadmap

Next: file watching via `FileSystemObserver`, issue templates from
`.scrumit/templates`, an undo stack, bulk edit, and saved filter views.

Later: a local git sidecar for `status`, `diff`, `log` and `commit`, burndown
from real sprint history, a dependency graph for `blocked_by`, importer from
CSV and Notion, and a printable sprint review.

**The cross-browser strategy and the next session's work are planned in
[`docs/PLAN.md`](docs/PLAN.md)** — three source tiers (folder, local sidecar,
read-only), the sidecar API, a conformance suite for adapters, the known
limitations, and a ranked list of small wins.

## Where I would push back

Two things are deliberately limited, and it is worth knowing before you plan
around them.

**Statuses are fixed at five.** Custom workflows would mean custom folders and
custom colour semantics, and the whole point of the layout is that a file's
location is predictable. If you genuinely need `blocked` as a column rather than
a flag, the better answer is a label plus the existing `blocked_by` — which the
flow view already reports.

**The burndown is derived, not recorded.** It reconstructs progress from
`created` and `updated`, so editing an old issue shifts it. Recording real
transitions would mean a history file per sprint; if you want a burndown you can
defend in a retro, that is the change to make, and the UI already says so on the
screen.
