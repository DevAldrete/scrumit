# Git protocol

## Branches

```text
main
  sprint/2026-S20          integration branch for one sprint
    task/ACME-140-retry-webhooks
    task/ACME-141-export-timeouts
```

- Create the sprint branch from the current integration branch.
- Create each task branch from the sprint branch **after** the claim commit.
- Keep worktrees outside the repository:

  ```sh
  git worktree add ../acme-worktrees/ACME-140 \
    -b task/ACME-140-retry-webhooks sprint/2026-S20
  ```

- The orchestrator owns the sprint branch. Child agents own their task branches.

## Commits

Every commit belongs to exactly one task. Use a scope that is the task id:

```text
feat(ACME-140): retry webhook delivery with backoff

- add exponential backoff
- add an idempotency key

Scrumit-Task: ACME-140
Scrumit-Sprint: 2026-S20
Scrumit-Agent: agent-<handle>
```

Lifecycle commits:

```text
chore(ACME-140): claim task
chore(ACME-140): ready for review
chore(ACME-140): complete task
chore(ACME-140): blocked by ACME-138
chore(ACME-140): release task
```

Rules:

- `git add -- <paths>`, never `git add -A`.
- Run checks before committing.
- Do not bypass hooks with `--no-verify` unless the user asks.
- Do not amend or force-push shared history.
- Do not commit build output, caches, secrets, or `node_modules`.
- If a pre-existing staged change is outside your task, unstage it or stop.

## Merging

1. Child finishes with `scrumit finish <id> --to review`.
2. Orchestrator checks out the sprint branch in the coordination worktree.
3. `git merge --no-ff task/<id>-<slug>`.
4. Run the full check suite on the merged result.
5. `scrumit finish <id> --to done`.
6. Keep the task branch. Remove the worktree.

If the merge conflicts:

- Do not auto-resolve a conflict in `.scrumit/` by guessing.
- Resolve code conflicts, rerun checks, and continue.
- If the conflict is semantic or risky, leave the task in `review`, record the
  conflict in the task body under `## Blocked`, and stop.

## Rollback

Before merge:

```sh
git worktree remove ../acme-worktrees/ACME-140
git branch -D task/ACME-140-retry-webhooks
```

The sprint branch is untouched.

After merge:

```sh
git revert -m 1 <merge-sha>
scrumit release ACME-140      # or: scrumit block ACME-140 --by ...
```

Do not `git reset --hard` a shared branch. Do not delete a branch that contains
unmerged work. The completion commit records the branch and commit SHAs so a
revert is mechanical.

## Dirty tree policy

Before a claim, create, finish, block, or release, the tree must be clean. If it
is not:

- If the changes are yours and coherent, commit them with the task trailer.
- If they belong to another task, stop and split them.
- Never stash somebody else's work without asking.
