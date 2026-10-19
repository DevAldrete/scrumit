---
name: Scrumit Sprint Workflow
description: Use when a repository stores epics, sprints and issues as scrumit markdown artefacts. Discover and create the board, claim ready tasks, implement them on task branches with per-task commits, update status and blockers, coordinate parallel agents with git worktrees, and roll back safely. Use for planning a sprint, picking up a task, moving a card, closing a sprint, or running several coding agents against one board.
---

# Scrumit Sprint Workflow

The repository is the source of truth. The board is not a dashboard beside the
work; it is the work's state. Every claim, implementation, block, and completion
leaves both a file change and a git commit.

## Non-negotiables

- Read `.scrumit/AGENTS.md` and `llms.txt` if they exist. They are the canonical
  format. If they are absent, read `references/format.md`.
- The five statuses are fixed: `backlog`, `todo`, `doing`, `review`, `done`.
  Issue types are fixed too: `story`, `bug`, `chore`, `spike`. Never invent
  `blocked` or any other status. Blocking is `blocked_by`.
- Never renumber or reuse an id. Never create a second file for the same id.
- Change only the front-matter keys the task needs. The markdown body is a byte
  range: do not reformat, reflow, or "tidy" it.
- Set `updated` to today's ISO date whenever you change an issue.
- Derive the file path from the issue's own `status` and `sprint`; never leave a
  card in a folder its fields disagree with.
- Commit only the files a task owns. Never `git add -A`.
- Never force-push, rewrite shared history, or `git reset --hard` work you did
  not create.
- If nothing is ready, stop. Do not invent work and do not pick a blocked task.

## 0. Orient

1. Find the repository root and confirm the tree is clean:
   ```sh
   git status --porcelain
   scrumit board --json
   ```
2. Read the board's `ready`, `inProgress`, `blocked`, and `validation` arrays.
   A task is ready only when its sprint is `active` (or it has no sprint),
   every blocker is done, no claim exists, and it is not assigned to a human.
3. Read the task file. Read the referenced epic and sprint when they exist.
4. Load any project skill the task clearly needs (for example a UI skill for a
   front-end change). Do not load irrelevant skills.
5. Decide whether you are working **solo** or as an **orchestrator**. Never do
   both against the same task.

If `ready` is empty, report the blockers and stop. That is a successful outcome.

## 1. Claim

```sh
scrumit claim ISSUE-140 --agent agent-<your-handle>
```

Add `--worktree <path>` when the task will run in parallel with another agent:

```sh
scrumit claim ISSUE-140 --agent agent-<handle> \
  --branch task/ISSUE-140-retry-webhooks \
  --worktree ../scrumit-worktrees/ISSUE-140
```

The command:

- refuses blocked tasks and tasks assigned to a human;
- takes a local atomic lock so two agents cannot claim the same card;
- writes `status: doing`, `assignee`, `updated`, and a fresh `order`;
- moves the file if the sprint changed;
- commits only that task file.

If the task is already `doing`, `review`, or `done`, leave it alone unless you
are the orchestrator resolving a stale claim with `--force`.

## 2. Implement

Work in the task worktree or on the task branch. Keep the task branch small.

- Commit in logical units. Every commit belongs to exactly one task.
- Use this message shape:
  ```text
  feat(ISSUE-140): retry webhook delivery with backoff

  - add exponential backoff and an idempotency key
  - cover duplicate deliveries and 5xx recovery

  Scrumit-Task: ISSUE-140
  Scrumit-Sprint: 2026-S20
  Scrumit-Agent: agent-<handle>
  ```
- Run the repository's checks before each commit. Do not bypass hooks unless the
  user explicitly asks.
- `git diff --check` and `git status --porcelain` are part of the audit.
- If a change does not belong to the task, stop and split it into another task.
- In orchestrated mode, a child agent must never edit `.scrumit/` artefacts. The
  orchestrator owns status writes.

## 3. Finish, block, or release

```sh
# Ready for a human or the orchestrator to merge.
scrumit finish ISSUE-140 --to review --summary "Webhook retries implemented" --checks "npm run check"

# After the branch is merged into the sprint branch.
scrumit finish ISSUE-140 --to done --summary "Merged in abc1234" --checks "npm run check, npm run smoke"
```

| Event | Status | Assignee | File | Commit |
| --- | --- | --- | --- | --- |
| Claim | `doing` | agent handle | sprint/backlog | `chore(<id>): claim task` |
| Ready | `review` | keep | unchanged | `chore(<id>): ready for review` |
| Complete | `done` | keep | `done/<sprint>/` | `chore(<id>): complete task` |
| Blocked | `todo` | cleared | unchanged | `chore(<id>): blocked by <id>` |
| Abandoned | `todo` | cleared | unchanged | `chore(<id>): release task` |

`finish --to done` refuses an unmerged task branch unless `--force` is used. It
adds a `## Delivery` section with the branch and commit SHAs, then removes the
worktree and releases the claim.

Blocking:

```sh
scrumit block ISSUE-140 --by ISSUE-138 --reason "Waiting for the webhook contract"
```

This is the only way to express a block. It appends a `## Blocked` note, clears
the assignee, returns the card to `todo`, and releases the claim.

## 4. Orchestrated agents

The orchestrator owns the board. Children own code.

1. Read the board and select only `ready` tasks with disjoint scopes.
2. Claim every task before spawning a child.
3. Create one worktree per task from the sprint branch.
4. Send each child a self-contained prompt:
   - task id, branch, worktree, and the coordination root;
   - read the task from the coordination root, not from the child's stale copy;
   - do not edit `.scrumit/`;
   - commit with the `Scrumit-Task` trailer;
   - report commit SHAs, checks, changed files, and blockers;
   - stop without changes if the task is claimed, blocked, or missing.
5. Merge each task branch into the sprint branch sequentially, rerun checks,
   then `scrumit finish <id> --to done`.
6. Never spawn a child for a task that has not been claimed. Never spawn more
   children than there are ready tasks.

See `references/orchestration.md` for the full child prompt and merge protocol.

## 5. Rollback

- Before merge: remove the worktree and delete the task branch. The sprint
  branch is untouched.
- After merge: `git revert -m 1 <merge-sha>` on the sprint branch, then reopen
  the task with `scrumit release <id>` or `scrumit block <id> --by ...`.
- Keep task branches after merge. They are the cheapest rollback evidence.
- The completion commit records the branch and implementation SHAs, so a revert
  is mechanical.

## 6. CLI quick reference

```sh
scrumit board [--sprint <id>] [--all] [--ready] [--json]
scrumit validate [--strict] [--json]
scrumit claim <id> [--agent <name>] [--sprint <id>] [--branch <name>] [--worktree <path>] [--force]
scrumit finish <id> [--to review|done] [--summary <text>] [--checks <text>] [--force]
scrumit block <id> --by <id>[,<id>] [--reason <text>]
scrumit release <id>
scrumit new issue|epic|sprint ...
scrumit init [--project <name>]
scrumit skill install [--dir .skills] [--force]
```

All commands accept `--repo <path>` and `--json`. The full reference, including
installation and exit codes, is in `references/cli.md`.

## 7. Stop conditions

Stop and report, without inventing work or committing half-finished changes,
when:

- `ready` is empty;
- every remaining task is blocked;
- your task is claimed by another agent;
- the working tree is dirty with changes you did not make;
- a merge conflict cannot be resolved safely;
- checks fail in a way the task did not cause.

A clean stop is part of the workflow, not a failure.
