/**
 * Real git, through the sidecar API. No mock: a temp repository, the actual
 * `git` binary, and the same HTTP endpoints the Changes view calls.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { startServer } from '../server/index.mjs'

function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'scrumit-git-'))
  mkdirSync(join(repo, '.scrumit'), { recursive: true })
  mkdirSync(join(repo, 'sprints/2026-S01'), { recursive: true })
  writeFileSync(join(repo, '.scrumit/config.yaml'), 'version: 1\nproject: Git test\n')
  writeFileSync(
    join(repo, 'sprints/2026-S01/sprint.md'),
    '---\nid: 2026-S01\nname: Sprint 1\nstate: active\n---\n',
  )
  writeFileSync(
    join(repo, 'sprints/2026-S01/GIT-1.md'),
    '---\nid: GIT-1\ntitle: First card\nstatus: todo\ntype: story\nsprint: 2026-S01\norder: 10\ncreated: 2026-10-19\nupdated: 2026-10-19\n---\n\n## Context\n\nOriginal words.\n',
  )
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' })
  git('init', '-q')
  git('config', 'user.name', 'Test Agent')
  git('config', 'user.email', 'agent@example.com')
  git('add', '.')
  git('commit', '-q', '-m', 'initial')
  return { repo, git }
}

async function api(info, path, init = {}) {
  const response = await fetch(`${info.url}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${info.token}`,
      ...(init.headers ?? {}),
    },
  })
  const text = await response.text()
  return { response, body: text === '' ? null : JSON.parse(text) }
}

test('status, unified diff, log and an explicit commit over the sidecar API', async (t) => {
  const { repo, git } = makeRepo()
  const info = await startServer({ repo, port: 0, token: 'git-token', quiet: true })
  t.after(() => info.stop())

  const issuePath = join(repo, 'sprints/2026-S01/GIT-1.md')
  writeFileSync(
    issuePath,
    '---\nid: GIT-1\ntitle: First card\nstatus: doing\ntype: story\nsprint: 2026-S01\norder: 10\ncreated: 2026-10-19\nupdated: 2026-10-20\n---\n\n## Context\n\nOriginal words.\n',
  )
  writeFileSync(
    join(repo, 'sprints/2026-S01/GIT-2.md'),
    '---\nid: GIT-2\ntitle: New card\nstatus: todo\ntype: story\nsprint: 2026-S01\norder: 20\n---\n',
  )

  const status = await api(info, '/api/git/status')
  assert.equal(status.response.status, 200)
  assert.equal(status.body.branch, git('symbolic-ref', '--short', 'HEAD').toString().trim())
  assert.equal(status.body.clean, false)
  assert.deepEqual(
    status.body.changes.map((change) => change.path).sort(),
    ['sprints/2026-S01/GIT-1.md', 'sprints/2026-S01/GIT-2.md'],
  )
  assert.equal(
    status.body.changes.find((change) => change.path.endsWith('GIT-2.md')).untracked,
    true,
  )

  const diff = await api(
    info,
    '/api/git/diff?path=sprints%2F2026-S01%2FGIT-1.md',
  )
  assert.equal(diff.response.status, 200)
  assert.match(diff.body.diff, /^\+status: doing$/m)
  assert.match(diff.body.diff, /^\+updated: 2026-10-20$/m)

  const log = await api(info, '/api/git/log?limit=5')
  assert.equal(log.response.status, 200)
  assert.equal(log.body.commits.length, 1)
  assert.equal(log.body.commits[0].subject, 'initial')

  const commit = await api(info, '/api/git/commit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: 'feat(GIT-1): move the card\n\nScrumit-Task: GIT-1',
      paths: ['sprints/2026-S01/GIT-1.md', 'sprints/2026-S01/GIT-2.md'],
    }),
  })
  assert.equal(commit.response.status, 200)
  assert.match(commit.body.sha, /^[0-9a-f]{40}$/)

  const after = await api(info, '/api/git/status')
  assert.equal(after.body.clean, true, 'the selected paths are committed and nothing else was staged')
  assert.match(git('log', '-1', '--pretty=%s').toString(), /feat\(GIT-1\): move the card/)
  assert.match(git('log', '-1', '--pretty=%b').toString(), /Scrumit-Task: GIT-1/)
})

test('a commit without explicit paths is refused', async (t) => {
  const { repo } = makeRepo()
  const info = await startServer({ repo, port: 0, token: 'git-token', quiet: true })
  t.after(() => info.stop())

  const empty = await api(info, '/api/git/commit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'nothing to see', paths: [] }),
  })
  assert.equal(empty.response.status, 400)
  assert.match(empty.body.error, /at least one path/i)
})
