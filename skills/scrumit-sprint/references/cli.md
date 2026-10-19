# `scrumit` CLI reference

The CLI reads and writes the same artefacts as the app. It has no runtime
dependencies and does not need the app running.

## Install

From a scrumit checkout:

```sh
npm install -g .     # installs the `scrumit` command
# or
npm link             # links the checkout into your global bin
```

Without installing:

```sh
node /path/to/scrumit/cli/scrumit.mjs board
```

Verify:

```sh
scrumit --version
scrumit board
```

## Global options

| Option | Meaning |
| --- | --- |
| `--repo <path>` | Run against another repository. |
| `--json` | Machine-readable output; errors are JSON too. |
| `--agent <name>` | Agent handle for claims and commit trailers. |
| `--force` | Override a stale claim, a human assignment, an unmerged finish, or an existing config/skill. |
| `-h`, `--help` | Help. |
| `-v`, `--version` | Version. |

Environment:

| Variable | Meaning |
| --- | --- |
| `SCRUMIT_AGENT` | Default agent handle. |
| `SCRUMIT_LOCK_DIR` | Claim lock directory. Defaults to a temp directory keyed by repository. |
| `SCRUMIT_LOCK_TTL_MS` | Claim staleness window. Default: 2 hours. |

Exit codes: `0` success (including “nothing ready”), `1` command failure, `2`
invalid usage.

## Board

```sh
scrumit board [--sprint <id>] [--all] [--ready] [--json]
```

`board` selects the active sprint when there is one. Without an active sprint it
lists every open task. `--all` includes done tasks. `--ready` prints only the ids
of claimable tasks, one per line.

JSON shape:

```json
{
  "repo": "/path/to/repo",
  "project": "Acme",
  "sprint": { "id": "2026-S20", "name": "Sprint 20", "state": "active" },
  "tasks": [],
  "ready": [],
  "inProgress": [],
  "review": [],
  "blocked": [],
  "validation": []
}
```

A task is **ready** when it is `backlog` or `todo`, every `blocked_by` issue is
`done`, no live claim exists, and it is not assigned to a human.

## Validation

```sh
scrumit validate [--strict] [--json]
```

Checks duplicate ids, unknown raw enums, dangling `epic`/`sprint`/`blocked_by`,
path mismatches, missing `updated`, self-blocks, blocked cycles, unsupported
config versions, and unreadable/skipped files. `--strict` treats warnings as
failures.

## Claim

```sh
scrumit claim <id> --agent <name> [--sprint <id>] [--branch <name>] [--worktree <path>] [--force]
```

- Refuses blocked tasks and tasks assigned to a human (unless `--force`).
- Takes an atomic lock; a second claim fails with the holder's name.
- Sets `status: doing`, `assignee`, `updated`, and a fresh `order`.
- Moves the file if `--sprint` changes its directory.
- Commits only the task file.
- With `--worktree`, creates `task/<id>-<slug>` from the claim commit and adds
  the worktree. The branch is created **after** the claim commit, so the claim
  lives on the integration branch and is visible to siblings.

## Finish

```sh
scrumit finish <id> [--to review|done] [--summary <text>] [--checks <text>] [--force]
```

- `review` is the default: the card stays in its sprint folder.
- `done`: requires a clean tree, moves the card to `done/<sprint>/`, adds a
  `## Delivery` section with the branch and commit SHAs, removes the worktree,
  and releases the claim.
- If the lock names a task branch, `done` refuses unless that branch is an
  ancestor of `HEAD` (or `--force` is used). Merge first.
- Refuses a dirty working tree.

## Block

```sh
scrumit block <id> --by <id>[,<id>] [--reason <text>]
```

Appends to `blocked_by`, appends a `## Blocked` note, sets `status: todo`,
clears the assignee, commits, and releases the claim. This is the only blocked
representation; there is no `blocked` status.

## Release

```sh
scrumit release <id>
```

Returns a `doing`/`review` card to `todo`, clears the assignee, commits, and
releases the claim.

## Create

```sh
scrumit new issue --title <title> [--status backlog|todo|doing|review|done]
                  [--type story|bug|chore|spike] [--epic <id>] [--sprint <id>]
                  [--points <n>] [--assignee <name>] [--priority 0-3]
                  [--labels <a,b>] [--blocked-by <id,id>]
                  [--body <text> | --body-file <path>]

scrumit new epic --title <title> [--state planned|active|done] [--color 1-8]
                 [--owner <name>] [--target <date>] [--body <text>]

scrumit new sprint [--id <YYYY-SNN>] [--name <name>] [--goal <text>]
                   [--start <YYYY-MM-DD>] [--end <YYYY-MM-DD>]
                   [--capacity <n>] [--length-days <n>]
                   [--state planned|active|closed]
```

Creation uses the next free id, derives the path from the fields, and commits
only the new file. `new issue` uses `templates/issue.md` when `--body` is not
given; epics and sprints do the same.

## Initialise

```sh
scrumit init [--project <name>] [--force]
```

Writes `.scrumit/config.yaml` from the defaults and commits it. Use `--force`
only when you intend to replace an existing config.

## Skill

```sh
scrumit skill install [--dir .skills] [--force] [--json]
scrumit skill print
scrumit skill path
```

`install` copies the skill to `<dir>/scrumit-sprint` (default `.skills`).
Existing files are skipped unless `--force`. For OpenCode, add the directory to
`opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "skills": [".skills"]
}
```

`skill print` writes every file to stdout; `skill path` prints the package
source.
