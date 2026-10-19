/**
 * The deliberately small git surface the sidecar exposes.
 *
 * Everything here shells out to the real `git` binary with an argv array (never
 * a shell), validates every path against the repository root, and commits only
 * the paths the caller named. Merge, rebase, push and branch creation are not
 * implemented: those need conflict handling the app cannot honestly provide.
 */
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { HttpError, resolveInside } from './security.mjs'

const exec = promisify(execFile)
const MAX_OUTPUT = 8 * 1024 * 1024

export function hasGit(root) {
  return existsSync(join(root, '.git'))
}

function ensureGit(root) {
  if (!hasGit(root)) throw new HttpError(400, 'this repository is not a git checkout')
}

async function git(root, args, { allow = [] } = {}) {
  try {
    const result = await exec('git', args, {
      cwd: root,
      maxBuffer: MAX_OUTPUT,
      windowsHide: true,
    })
    return result.stdout
  } catch (error) {
    if (allow.includes(error.code) && typeof error.stdout === 'string') {
      return error.stdout
    }
    const detail =
      typeof error.stderr === 'string' && error.stderr.trim() !== ''
        ? error.stderr.trim()
        : error instanceof Error
          ? error.message
          : String(error)
    throw new HttpError(400, detail.slice(0, 500))
  }
}

function safePath(root, path) {
  if (typeof path !== 'string') throw new HttpError(400, 'path is required')
  if (path.split('/').includes('.git')) throw new HttpError(403, 'refusing to touch .git')
  resolveInside(root, path)
  return path
}

function statusLabel(index, worktree) {
  if (index === '?' && worktree === '?') return 'untracked'
  if (index === 'R') return 'renamed'
  if (index === 'C') return 'copied'
  if (index === 'U' || worktree === 'U') return 'conflicted'
  if (index === 'A') return 'added'
  if (index === 'D' || worktree === 'D') return 'deleted'
  if (index === 'M' || worktree === 'M') return 'modified'
  return 'changed'
}

function parsePorcelain(stdout) {
  const parts = stdout.split('\0')
  const changes = []
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if (!entry) continue
    const index = entry[0] ?? ' '
    const worktree = entry[1] ?? ' '
    const path = entry.slice(3)
    if (!path) continue
    const change = {
      path,
      index,
      worktree,
      label: statusLabel(index, worktree),
      staged: index !== ' ' && index !== '?',
      unstaged: worktree !== ' ' || index === '?',
      untracked: index === '?' && worktree === '?',
    }
    if ((index === 'R' || index === 'C') && parts[i + 1]) {
      change.origPath = parts[++i]
    }
    changes.push(change)
  }
  return changes
}

async function branchName(root) {
  try {
    const branch = (await git(root, ['symbolic-ref', '--short', '-q', 'HEAD'])).trim()
    if (branch !== '') return branch
  } catch {
    // A detached HEAD has no branch. Fall through to the short sha.
  }
  try {
    return (await git(root, ['rev-parse', '--short', 'HEAD'])).trim() || null
  } catch {
    // No commits yet: read the intended branch from .git/HEAD.
    try {
      const head = readFileSync(join(root, '.git', 'HEAD'), 'utf8').trim()
      return head.startsWith('ref: refs/heads/') ? head.slice('ref: refs/heads/'.length) : null
    } catch {
      return null
    }
  }
}

export async function gitStatus(root) {
  ensureGit(root)
  const [branch, upstream, changes] = await Promise.all([
    branchName(root),
    git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
      .then((value) => value.trim() || null)
      .catch(() => null),
    git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).then(parsePorcelain),
  ])

  let ahead = 0
  let behind = 0
  if (upstream) {
    try {
      const counts = (await git(root, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`]))
        .trim()
        .split(/\s+/)
        .map(Number)
      behind = Number.isFinite(counts[0]) ? counts[0] : 0
      ahead = Number.isFinite(counts[1]) ? counts[1] : 0
    } catch {
      // An upstream that no longer resolves is not a status failure.
    }
  }

  return {
    branch,
    upstream,
    ahead,
    behind,
    changes,
    clean: changes.length === 0,
  }
}

export async function gitDiff(root, path) {
  ensureGit(root)
  const relative = safePath(root, path)
  let diff = ''

  // HEAD covers staged and unstaged changes in one diff. A repository without a
  // first commit has no HEAD, so fall back to the index and working tree.
  try {
    diff = await git(root, ['diff', '--no-ext-diff', '--no-color', 'HEAD', '--', relative])
  } catch {
    diff = (
      (await git(root, ['diff', '--no-ext-diff', '--no-color', '--cached', '--', relative])) +
      (await git(root, ['diff', '--no-ext-diff', '--no-color', '--', relative]))
    )
  }

  if (diff.trim() === '') {
    // Untracked files have no diff against HEAD. `--no-index` produces the same
    // unified shape, and exit code 1 just means "differences exist".
    diff = await git(root, ['diff', '--no-ext-diff', '--no-color', '--no-index', '--', '/dev/null', relative], {
      allow: [1],
    }).catch(() => '')
  }

  return { path: relative, diff: diff === '' ? 'No textual diff for this file.\n' : diff }
}

export async function gitLog(root, limit = 5) {
  ensureGit(root)
  const count = Math.min(Math.max(Number(limit) || 5, 1), 50)
  let stdout
  try {
    stdout = await git(root, [
      'log',
      '-n',
      String(count),
      '--date=short',
      '--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s',
    ])
  } catch {
    // A freshly initialised repository has no commits yet.
    return []
  }
  if (stdout.trim() === '') return []
  return stdout.split('\n').map((line) => {
    const [sha, short, author, date, subject] = line.split('\x1f')
    return { sha, short, author, date, subject }
  })
}

export async function gitCommit(root, { message, paths } = {}) {
  ensureGit(root)
  if (typeof message !== 'string' || message.trim() === '') {
    throw new HttpError(400, 'a commit message is required')
  }
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new HttpError(400, 'choose at least one path to commit')
  }
  if (paths.length > 500) throw new HttpError(400, 'too many paths in one commit')
  const unique = [...new Set(paths.map((path) => safePath(root, path)))]

  // Explicit paths only. There is deliberately no `git add -A` anywhere in this
  // file; a caller has to name what belongs in the commit.
  await git(root, ['add', '--', ...unique])
  await git(root, ['commit', '-m', message.slice(0, 5000), '--', ...unique])
  const sha = (await git(root, ['rev-parse', 'HEAD'])).trim()
  return { ok: true, sha, short: sha.slice(0, 7), paths: unique }
}
