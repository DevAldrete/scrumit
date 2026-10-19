# Orchestrating several agents

The parent is the only writer of task state. Children write code.

## Why

A worktree is a separate checkout. If every child edited its own `.scrumit/`
copy, siblings would never see the claim, and two agents could implement the
same card. The coordination root keeps one authoritative board.

## Setup

```sh
# coordination root: the main worktree on the sprint branch
git switch sprint/2026-S20
git status --porcelain          # must be empty

# claim before spawning
scrumit claim ACME-140 --agent agent-alpha \
  --branch task/ACME-140-retry-webhooks \
  --worktree ../acme-worktrees/ACME-140
```

Repeat for each disjoint ready task. Do not spawn a child for a task you have
not claimed. Do not spawn more children than there are ready tasks.

## Child prompt

```text
You are implementing one scrumit task.

Task: ACME-140 — Retry webhook delivery with backoff
Branch: task/ACME-140-retry-webhooks
Worktree: /path/to/acme-worktrees/ACME-140
Coordination root: /path/to/acme

Read the task and the canonical format from the coordination root:
  /path/to/acme/sprints/2026-S20/ACME-140.md
  /path/to/acme/.scrumit/AGENTS.md

Rules:
- Work only in your worktree.
- Do not edit any .scrumit/ artefact or any file outside the task scope.
- Commit in logical units with a `Scrumit-Task: ACME-140` trailer.
- Run the repository checks before each commit.
- If the task is already claimed by someone else, blocked, or missing, stop
  without changing anything and report why.
- Do not merge, rebase, push, or force-push.

Report: commit SHAs, files changed, checks run, and anything that blocks you.
```

## Integrating

1. Child reports commits and checks.
2. Parent merges task branches one at a time into the sprint branch.
3. Parent reruns the full checks after each merge.
4. Parent runs `scrumit finish <id> --to done`.
5. Parent updates the board before spawning the next batch.

Do not merge two task branches blindly and hope. If they touch the same files,
run them sequentially or split the tasks.

## When to stop

- No ready tasks: stop; do not spawn.
- All remaining tasks blocked: stop; report the blockers.
- A child's task becomes blocked: child stops; parent records the block and
  releases the claim.
- A merge conflicts: parent stops, marks the task `review` or `blocked`, and
  leaves the branch for a human.
- A child fails checks: parent does not merge; the task stays in `doing` or goes
  to `review` with the failure recorded.
