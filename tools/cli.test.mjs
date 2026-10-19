/**
 * The sprint CLI is the coordination surface for agents. These tests use real
 * temporary git repositories, real commits, and concurrent processes, because
 * the failure modes that matter (double claims, dirty trees, moves) only appear
 * when git is real.
 *
 *   node --test tools/
 */
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../cli/scrumit.mjs', import.meta.url))

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'scrumit-cli-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  const lockDir = join(tmpdir(), `scrumit-locks-${process.pid}-${Date.now()}-${Math.random()}`)
  return { dir, lockDir, env: { ...process.env, SCRUMIT_LOCK_DIR: lockDir } }
}

function run(repo, args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: repo.dir,
    encoding: 'utf8',
    env: { ...repo.env, ...env },
  })
}

function must(repo, args, env = {}) {
  const result = run(repo, args, env)
  assert.equal(
    result.status,
    0,
    `command failed: ${args.join(' ')}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  )
  return result.stdout
}

function board(repo) {
  return JSON.parse(must(repo, ['board', '--json']))
}

function setup(repo) {
  must(repo, ['init', '--project', 'Test'])
  must(repo, ['new', 'epic', '--title', 'Foundation', '--state', 'active'])
  must(repo, ['new', 'sprint', '--name', 'Sprint 1', '--state', 'active', '--capacity', '10'])
  must(repo, [
    'new',
    'issue',
    '--title',
    'First task',
    '--sprint',
    '2026-S01',
    '--epic',
    'EPIC-01',
    '--points',
    '3',
  ])
  return board(repo).ready[0].id
}

function readIssue(repo, path) {
  return readFileSync(join(repo.dir, path), 'utf8')
}

function bodyOf(text) {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/.exec(text)
  return match ? match[1] : text
}

function git(repo, args) {
  return execFileSync('git', args, { cwd: repo.dir, encoding: 'utf8' })
}

test('initialise, create artefacts, and list a ready task', () => {
  const repo = makeRepo()
  const id = setup(repo)
  assert.equal(id, 'TEST-1')
  assert.ok(existsSync(join(repo.dir, '.scrumit/config.yaml')))
  assert.ok(existsSync(join(repo.dir, 'sprints/2026-S01/sprint.md')))
  assert.ok(existsSync(join(repo.dir, 'epics/EPIC-01-foundation.md')))
  assert.ok(existsSync(join(repo.dir, `sprints/2026-S01/${id}.md`)))

  const state = board(repo)
  assert.equal(state.project, 'Test')
  assert.equal(state.sprint.id, '2026-S01')
  assert.equal(state.ready.length, 1)
  assert.equal(state.validation.length, 0)
  assert.equal(git(repo, ['status', '--porcelain']).trim(), '')
})

test('claim updates the task, commits only that file, and preserves the body', () => {
  const repo = makeRepo()
  const id = setup(repo)
  const path = `sprints/2026-S01/${id}.md`
  const before = readIssue(repo, path)

  must(repo, ['claim', id, '--agent', 'alpha'])
  const after = readIssue(repo, path)
  assert.match(after, /^status: doing$/m)
  assert.match(after, /^assignee: agent-alpha$/m)
  assert.match(after, /^updated: \d{4}-\d{2}-\d{2}$/m)
  assert.equal(bodyOf(after), bodyOf(before), 'the markdown body changed during claim')

  const files = git(repo, ['show', '--name-only', '--format=', 'HEAD']).trim().split('\n')
  assert.deepEqual(files, [path])
  assert.equal(git(repo, ['status', '--porcelain']).trim(), '')
})

test('a blocked task cannot be claimed and the tree stays clean', () => {
  const repo = makeRepo()
  const id = setup(repo)
  const blocker = JSON.parse(
    must(repo, ['new', 'issue', '--title', 'Blocker', '--sprint', '2026-S01', '--json']),
  ).id
  const blocked = JSON.parse(
    must(repo, [
      'new',
      'issue',
      '--title',
      'Blocked task',
      '--sprint',
      '2026-S01',
      '--blocked-by',
      blocker,
      '--json',
    ]),
  ).id

  const result = run(repo, ['claim', blocked, '--agent', 'alpha'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /blocked by/i)
  assert.equal(git(repo, ['status', '--porcelain']).trim(), '')
  assert.ok(['backlog', 'todo'].includes(board(repo).tasks.find((task) => task.id === blocked).status))
  assert.ok(board(repo).blocked.some((task) => task.id === blocked))
  assert.ok(!board(repo).ready.some((task) => task.id === blocked))
  assert.ok(id)
})

test('finish moves the card through review into the archive', () => {
  const repo = makeRepo()
  const id = setup(repo)
  must(repo, ['claim', id, '--agent', 'alpha'])

  must(repo, ['finish', id, '--to', 'review', '--summary', 'Implemented'])
  assert.match(readIssue(repo, `sprints/2026-S01/${id}.md`), /^status: review$/m)

  must(repo, ['finish', id, '--to', 'done', '--summary', 'Merged'])
  const donePath = `done/2026-S01/${id}.md`
  assert.ok(existsSync(join(repo.dir, donePath)))
  assert.ok(!existsSync(join(repo.dir, `sprints/2026-S01/${id}.md`)))
  const text = readIssue(repo, donePath)
  assert.match(text, /^status: done$/m)
  assert.match(text, /## Delivery/)
  assert.match(text, /Commits:/)
  assert.equal(git(repo, ['status', '--porcelain']).trim(), '')
  assert.equal(board(repo).done.length, 1)
})

test('block records blocked_by, clears the claim, and is the only blocked state', () => {
  const repo = makeRepo()
  setup(repo)
  const blocker = JSON.parse(
    must(repo, ['new', 'issue', '--title', 'Blocker', '--sprint', '2026-S01', '--json']),
  ).id
  const id = JSON.parse(
    must(repo, ['new', 'issue', '--title', 'Needs blocker', '--sprint', '2026-S01', '--json']),
  ).id

  must(repo, ['claim', id, '--agent', 'alpha'])
  must(repo, ['block', id, '--by', blocker, '--reason', 'contract pending'])

  const text = readIssue(repo, `sprints/2026-S01/${id}.md`)
  assert.match(text, /^status: todo$/m)
  assert.doesNotMatch(text, /^assignee:/m)
  assert.match(text, new RegExp(`^blocked_by: \\[${blocker}\\]$`, 'm'))
  assert.match(text, /## Blocked/)
  assert.match(text, /contract pending/)
  assert.doesNotMatch(text, /^status: blocked$/m)
  assert.ok(board(repo).blocked.some((task) => task.id === id))
  assert.equal(git(repo, ['status', '--porcelain']).trim(), '')
})

test('release returns a claimed card to todo and clears the lock', () => {
  const repo = makeRepo()
  const id = setup(repo)
  must(repo, ['claim', id, '--agent', 'alpha'])
  must(repo, ['release', id])

  const text = readIssue(repo, `sprints/2026-S01/${id}.md`)
  assert.match(text, /^status: todo$/m)
  assert.doesNotMatch(text, /^assignee:/m)
  assert.equal(board(repo).ready[0].id, id)
  assert.equal(git(repo, ['status', '--porcelain']).trim(), '')
})

test('two concurrent claims produce exactly one winner', async () => {
  const repo = makeRepo()
  const id = setup(repo)

  const claim = (agent) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI, 'claim', id, '--agent', agent], {
        cwd: repo.dir,
        env: repo.env,
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => {
        stdout += chunk
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk
      })
      child.on('close', (code) => resolve({ code, stdout, stderr }))
    })

  const results = await Promise.all([claim('alpha'), claim('beta')])
  assert.equal(results.filter((result) => result.code === 0).length, 1)
  assert.equal(results.filter((result) => result.code === 1).length, 1)
  assert.equal(git(repo, ['status', '--porcelain']).trim(), '')

  const claims = git(repo, ['log', '--format=%s', '--grep', 'claim task'])
    .trim()
    .split('\n')
    .filter(Boolean)
  assert.equal(claims.length, 1)
  assert.match(readIssue(repo, `sprints/2026-S01/${id}.md`), /^status: doing$/m)
})

test('nothing ready is a clean no-op, not a failed command', () => {
  const repo = makeRepo()
  must(repo, ['init', '--project', 'Test'])
  must(repo, ['new', 'sprint', '--name', 'Sprint 1', '--state', 'active'])
  must(repo, [
    'new',
    'issue',
    '--title',
    'Human-owned',
    '--sprint',
    '2026-S01',
    '--assignee',
    'ana-marin',
  ])
  const before = git(repo, ['rev-parse', 'HEAD']).trim()
  const out = must(repo, ['board', '--ready'])
  assert.equal(out.trim(), '')
  assert.equal(git(repo, ['rev-parse', 'HEAD']).trim(), before)
  assert.equal(git(repo, ['status', '--porcelain']).trim(), '')
})

test('a claimed task can create a task worktree and finish only after merge', () => {
  const repo = makeRepo()
  const id = setup(repo)
  const worktree = join(tmpdir(), `scrumit-wt-${process.pid}-${Date.now()}`)
  must(repo, ['claim', id, '--agent', 'alpha', '--worktree', worktree])
  assert.ok(existsSync(worktree))
  const branch = git(repo, ['branch', '--show-current']).trim()
  assert.ok(branch.length > 0)

  writeFileSync(join(worktree, 'task-note.txt'), 'work\n')
  execFileSync('git', ['add', 'task-note.txt'], { cwd: worktree })
  execFileSync('git', ['commit', '-m', `feat(${id}): task work`], { cwd: worktree })

  const blocked = run(repo, ['finish', id, '--to', 'done'])
  assert.equal(blocked.status, 1)
  assert.match(blocked.stderr, /not merged/i)

  const taskBranch = git(repo, ['worktree', 'list', '--porcelain'])
    .split('\n')
    .find((line) => line.startsWith('branch refs/heads/task/'))
    .slice('branch refs/heads/'.length)
  git(repo, ['merge', '--no-ff', taskBranch, '-m', 'merge task'])
  must(repo, ['finish', id, '--to', 'done'])
  assert.ok(!existsSync(worktree))
})

test('validation catches duplicate ids, bad enums, and path drift', () => {
  const repo = makeRepo()
  const id = setup(repo)
  mkdirSync(join(repo.dir, 'backlog'), { recursive: true })
  writeFileSync(
    join(repo.dir, 'backlog/DUPLICATE.md'),
    `---
id: ${id}
title: Duplicate
status: donee
type: wizard
order: 1
updated: 2026-10-19
---

Duplicate id and invalid enums.
`,
  )
  const result = run(repo, ['validate', '--json'])
  assert.equal(result.status, 1)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.ok, false)
  const codes = payload.findings.map((finding) => finding.code)
  assert.ok(codes.includes('duplicate-id'))
  assert.ok(codes.includes('bad-status'))
  assert.ok(codes.includes('bad-type'))
  assert.ok(codes.includes('path-mismatch'))
})

test('new issue increments ids and new sprint uses the configured length', () => {
  const repo = makeRepo()
  must(repo, ['init', '--project', 'Test'])
  const first = JSON.parse(must(repo, ['new', 'issue', '--title', 'One', '--json']))
  const second = JSON.parse(must(repo, ['new', 'issue', '--title', 'Two', '--json']))
  assert.equal(first.id, 'TEST-1')
  assert.equal(second.id, 'TEST-2')

  const sprint = JSON.parse(must(repo, ['new', 'sprint', '--name', 'Sprint 1', '--json']))
  assert.equal(sprint.id, '2026-S01')
  assert.equal(sprint.end, '2026-11-02')
})

test('skill install is idempotent and forceable', () => {
  const repo = makeRepo()
  must(repo, ['init', '--project', 'Test'])
  must(repo, ['skill', 'install'])
  assert.ok(existsSync(join(repo.dir, '.skills/scrumit-sprint/SKILL.md')))
  assert.ok(existsSync(join(repo.dir, '.skills/scrumit-sprint/references/cli.md')))

  const second = must(repo, ['skill', 'install'])
  assert.match(second, /skipped 8 existing files|skipped 8 existing file/)

  writeFileSync(join(repo.dir, '.skills/scrumit-sprint/SKILL.md'), 'stale')
  must(repo, ['skill', 'install', '--force'])
  assert.match(readFileSync(join(repo.dir, '.skills/scrumit-sprint/SKILL.md'), 'utf8'), /Scrumit Sprint Workflow/)
})
