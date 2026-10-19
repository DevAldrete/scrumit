# The `scrumit` CLI

`scrumit` is the sprint-board CLI. It reads and writes the same markdown
artefacts as the browser app, needs no runtime dependencies, and does not need
the app running.

It exists because a repository board is only useful to an agent if the agent can:

- discover what is ready and what is blocked;
- claim one card without racing another agent;
- move that card through the fixed statuses;
- leave a reviewable git commit for every state change.

The CLI is deliberately smaller than the app. It does not render a board, run a
server, or resolve merges. It edits files and commits them.

---

## Install

### From this checkout

```sh
npm install
npm link          # puts `scrumit` on your PATH
```

Or install globally:

```sh
npm install -g .
```

Or run it without installing:

```sh
node /path/to/scrumit/cli/scrumit.mjs board
```

The package is currently private (`"private": true`), so it is installed from a
checkout rather than from the npm registry. When it is published, the same
command becomes `npm install -g scrumit`.

Verify:

```sh
scrumit --version
scrumit help
```

### In another repository

```sh
cd /path/to/your/repo
scrumit init --project "Acme Platform"
scrumit skill install
```

`init` writes `.scrumit/config.yaml` and commits it. `skill install` writes the
agent skill to `.skills/scrumit-sprint/`.

For OpenCode, make that directory discoverable by adding this to
`opencode.jsonc` (or `.opencode/opencode.jsonc`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "skills": [".skills"]
}
```

OpenCode also discovers `.opencode/skills` automatically. Use either location:

```sh
scrumit skill install --dir .opencode/skills
```

The browser app can write the same skill from **Settings → AI agents → Write the
sprint skill**. It defaults to `.skills/scrumit-sprint`.

---

## The board

```sh
scrumit board
```

```text
scrumit · 2026-S01 Foundation
Goal: Ship the sprint CLI and skill, then make the capability model safe.
2026-10-19 → 2026-11-02 · capacity 24 pts
8 tasks · 24 pts · 4 ready

READY (4)
  ISSUE-2    todo     2 pts  chore  EPIC-01  Document CLI installation
  ISSUE-3    todo     3 pts  bug    EPIC-02  Persist repos without a cloneable handle
  ...

IN PROGRESS (1)
  ISSUE-1    doing    5 pts  story  EPIC-01  agent-opencode  Implement the sprint CLI

BLOCKED (1)
  ISSUE-5    todo     3 pts  story  EPIC-02  blocked by ISSUE-4 (todo)

REVIEW (0)
  nothing waiting for review
```

`board` selects the active sprint when there is one. Without an active sprint it
lists every open task. Use `--sprint <id>` to choose one, `--all` to include
done work, and `--ready` to print only claimable ids:

```sh
scrumit board --sprint 2026-S01 --json
scrumit board --ready
```

A task is **ready** when:

- it is `backlog` or `todo`;
- every id in `blocked_by` exists and is `done`;
- no live claim lock exists;
- it is not assigned to a human.

If `ready` is empty, there is nothing to do. That is a successful result, not a
failure.

### JSON

`--json` is the machine interface. It returns the board plus every task's
`ready`, `blocked`, `claimed`, `claimedBy`, `path`, and `validation` fields.

```json
{
  "repo": "/Users/me/dev/acme",
  "project": "Acme",
  "sprint": { "id": "2026-S01", "state": "active" },
  "tasks": [],
  "ready": [],
  "inProgress": [],
  "review": [],
  "blocked": [],
  "validation": []
}
```

---

## Validate

```sh
scrumit validate
scrumit validate --strict --json
```

Checks duplicate ids, unknown raw enums, dangling `epic`/`sprint`/`blocked_by`,
path mismatches, missing `updated`, self-blocks, blocked cycles, unsupported
config versions, and unreadable files.

Exit code is `1` when there is an error. `--strict` also fails on warnings.

---

## Claim a task

```sh
scrumit claim ISSUE-140 --agent agent-claude
```

What it does:

1. Refuses a task that is blocked or assigned to a human.
2. Takes an atomic lock so two agents cannot claim the same card.
3. Writes `status: doing`, `assignee`, `updated`, and a fresh `order`.
4. Moves the file if `--sprint` changes its directory.
5. Commits **only that task file**.

```text
chore(ISSUE-140): claim task

Scrumit-Task: ISSUE-140
Scrumit-Sprint: 2026-S01
Scrumit-Agent: agent-claude
```

Use `--worktree` for parallel work:

```sh
scrumit claim ISSUE-140 --agent agent-claude \
  --branch task/ISSUE-140-retry-webhooks \
  --worktree ../acme-worktrees/ISSUE-140
```

The claim commit lands on the integration branch **before** the task branch is
created, so siblings can see it.

If another agent already holds the card, the command fails and names the holder.
`--force` is for taking over a stale claim or a human assignment; it is not a way
to ignore `blocked_by`.

---

## Finish, block, release

```sh
scrumit finish ISSUE-140 --to review --summary "Implemented retries" --checks "npm run check"
scrumit finish ISSUE-140 --to done --summary "Merged abc1234" --checks "npm run check, npm run smoke"
```

`review` is the default. `done` requires a clean tree and, when the lock names a
task branch, that branch must be merged into the current branch. It moves the
card to `done/<sprint>/`, adds a `## Delivery` section with the branch and commit
SHAs, removes the worktree, and releases the claim.

```sh
scrumit block ISSUE-140 --by ISSUE-138 --reason "Waiting for the webhook contract"
scrumit release ISSUE-140
```

Blocking is the **only** way to express a block. It appends to `blocked_by`,
appends a `## Blocked` note, returns the card to `todo`, clears the assignee, and
releases the claim. There is no `blocked` status.

---

## Create artefacts

```sh
scrumit new issue --title "Reject duplicate refund requests" \
  --type bug --sprint 2026-S01 --epic EPIC-02 --points 3 \
  --labels payments,reliability

scrumit new epic --title "Checkout reliability" --state active --color 2

scrumit new sprint --name "Sprint 2" --state planned \
  --start 2026-11-02 --end 2026-11-16 --capacity 24
```

The CLI chooses the next free id, derives the path from the fields, uses the
template in `templates/` when no body is supplied, and commits only the new file.

---

## Initialise

```sh
scrumit init --project "Acme Platform"
```

Writes `.scrumit/config.yaml` from the defaults and commits it. `--force`
overwrites an existing config.

---

## Skill

```sh
scrumit skill install                 # .skills/scrumit-sprint
scrumit skill install --dir .opencode/skills
scrumit skill install --force         # overwrite existing files
scrumit skill print                   # stream every file
scrumit skill path                    # package source directory
```

The skill teaches an agent the solo and orchestrated workflows. Its reference
files cover the artefact format, git protocol, orchestration, and this CLI.

---

## Parallel agents

The parent is the only writer of task state. Children write code.

```sh
# coordination root, on the sprint branch
git switch sprint/2026-S01
scrumit claim ISSUE-140 --agent agent-alpha \
  --branch task/ISSUE-140-retry-webhooks \
  --worktree ../acme-worktrees/ISSUE-140

scrumit claim ISSUE-141 --agent agent-beta \
  --branch task/ISSUE-141-export-timeouts \
  --worktree ../acme-worktrees/ISSUE-141
```

Child prompt:

```text
You are implementing one scrumit task.

Task: ISSUE-140 — Retry webhook delivery with backoff
Branch: task/ISSUE-140-retry-webhooks
Worktree: /path/to/acme-worktrees/ISSUE-140
Coordination root: /path/to/acme

Read the task and .scrumit/AGENTS.md from the coordination root.
Do not edit any .scrumit/ artefact.
Commit with `Scrumit-Task: ISSUE-140`.
Run the repository checks.
If the task is claimed, blocked, or missing, stop without changes.

Report: commits, files changed, checks, blockers.
```

The parent merges each task branch sequentially, reruns checks, and then runs
`scrumit finish <id> --to done`. If there are no ready tasks, spawn no agents.

---

## Git rules

- One task branch per task: `task/<id>-<slug>`.
- One sprint integration branch: `sprint/<sprint-id>`.
- Worktrees live outside the repository.
- Every commit belongs to one task and carries `Scrumit-Task: <id>`.
- Never `git add -A`; the CLI stages only the files it owns.
- Never force-push or rewrite shared history.
- Roll back a merged task with `git revert -m 1 <merge-sha>`, then reopen the
  card with `scrumit release` or `scrumit block`.
- Keep task branches after merge as rollback evidence.

---

## Environment

| Variable | Meaning |
| --- | --- |
| `SCRUMIT_AGENT` | Default agent handle. |
| `SCRUMIT_LOCK_DIR` | Claim lock directory. Defaults to a temp directory keyed by repository. |
| `SCRUMIT_LOCK_TTL_MS` | Claim staleness window. Default: 2 hours. |

The lock is local-machine coordination. The durable claim is the committed
`status: doing` + `assignee` in the task file.

---

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success, including “nothing is ready”. |
| `1` | A command failed: blocked task, dirty tree, missing artefact, invalid state. |
| `2` | Invalid usage. |

With `--json`, errors are JSON too:

```json
{ "ok": false, "error": "ISSUE-140 is blocked by ISSUE-138 (todo). Do not claim blocked work.", "exitCode": 1 }
```

---

## Troubleshooting

**“Working tree is not clean”**
Commit or stash your changes first. A claim and a finish are state changes; they
must be isolated commits.

**“already claimed by …”**
Another agent holds the card. Leave it alone. If the holder crashed, wait for
the TTL or use `--force` after confirming no process is working.

**“not merged into …”**
You are trying to finish `--to done` on an unmerged task branch. Merge it into
the sprint branch first, or finish `--to review`.

**“blocked by …”**
The dependency is not done. Do not claim it. Either finish the blocker or leave
the card for later.

**The lock directory grows**
Locks are released on finish, block, and release. Stale locks expire after the
TTL. You can point `SCRUMIT_LOCK_DIR` at a directory you clean up yourself.

**The CLI is not on PATH**
From the checkout: `npm link`. Or use `node cli/scrumit.mjs`.

---

## Design constraints

- The repository is the source of truth.
- The body is a byte range; status changes never rewrite prose.
- Optional front-matter keys are omitted, not written as `null`.
- Ids are stable forever and never reused.
- The five statuses are fixed; blocking is `blocked_by`.
- A task is claimed by `status: doing` plus `assignee`, not by a separate file.
- Every state change is a small git commit.
