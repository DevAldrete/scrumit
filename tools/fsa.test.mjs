/**
 * The File System Access adapter, tested against an in-memory mock of the
 * browser API. This is the code that reads and writes real files, and it is the
 * one part a headless browser cannot drive (the picker needs a real gesture),
 * so it gets mocked rather than skipped.
 *
 *   node --test tools/
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { FsaSource } from '../src/lib/fsa.ts'
import { issuePath } from '../src/lib/paths.ts'
import { serializeEpic, serializeIssue, serializeSprint } from '../src/lib/artefacts.ts'
import { defaultConfig, serializeConfig } from '../src/lib/config.ts'
import { scanRepo, writeAt } from '../src/lib/source.ts'
import { MockDir } from './mock-fsa.mjs'

/* ------------------------------------------------------------- fixture repo */

function fixtureRepo() {
  const root = new MockDir()
  const config = { ...defaultConfig(), project: 'Test Platform' }
  root.seed('.scrumit/config.yaml', serializeConfig(config))
  root.seed('.git/HEAD', 'ref: refs/heads/feature/kanban\n')
  root.seed('README.md', '# Not an issue\n\nNo id here.\n')
  root.seed('node_modules/junk/README.md', '---\nid: SHOULD-NOT-APPEAR\n---\n')
  root.seed(
    'epics/EPIC-01-payments.md',
    serializeEpic({
      id: 'EPIC-01', title: 'Payments', state: 'active', owner: 'ana', target: null,
      color: 2, description: 'Ship money.', path: null, extra: {},
    }),
  )
  root.seed(
    'sprints/2026-S08/sprint.md',
    serializeSprint({
      id: '2026-S08', name: 'Sprint 8', state: 'active', goal: 'Retries',
      start: '2026-08-01', end: '2026-08-14', capacity: 20, notes: 'Retro', path: null, extra: {},
    }),
  )
  root.seed(
    'sprints/2026-S08/ISSUE-1.md',
    serializeIssue({
      id: 'ISSUE-1', title: 'Retry deliveries', status: 'doing', type: 'story',
      epic: 'EPIC-01', sprint: '2026-S08', points: 3, assignee: 'ana', priority: 1,
      labels: ['reliability'], blockedBy: [], links: [], order: 10,
      created: '2026-08-01', updated: '2026-08-05', body: '\nContext.\n', path: null, extra: {},
    }),
  )
  root.seed(
    'backlog/ISSUE-2.md',
    serializeIssue({
      id: 'ISSUE-2', title: 'Rate limit webhooks', status: 'backlog', type: 'story',
      epic: null, sprint: null, points: 2, assignee: null, priority: null,
      labels: [], blockedBy: ['ISSUE-1'], links: [], order: 10,
      created: '2026-07-20', updated: '2026-07-21', body: '\nContext.\n', path: null, extra: {},
    }),
  )
  // Something unreadable: a directory where a file is expected.
  root.seed('backlog/ISSUE-3.md', '---\nid: ISSUE-3\nstatus: todo\n---\n')
  return root
}

/* -------------------------------------------------------------------- tests */

test('lists the repo without walking into build or vendor directories', async () => {
  const source = new FsaSource(fixtureRepo(), 'fixture')
  const files = await source.list()
  assert.ok(files.includes('.scrumit/config.yaml'))
  assert.ok(files.includes('backlog/ISSUE-2.md'))
  assert.ok(
    !files.some((path) => path.includes('node_modules') || path.startsWith('.git/')),
    'no node_modules, no .git internals',
  )
  assert.deepEqual(files.filter((path) => path.startsWith('backlog/')).sort(), [
    'backlog/ISSUE-2.md',
    'backlog/ISSUE-3.md',
  ])
})

test('scans a real-shaped directory into a snapshot', async () => {
  const source = new FsaSource(fixtureRepo(), 'fixture')
  const { snapshot, skipped } = await scanRepo(source, 'fixture-id')

  assert.equal(snapshot.config.project, 'Test Platform')
  assert.deepEqual(snapshot.issues.map((issue) => issue.id).sort(), ['ISSUE-1', 'ISSUE-2', 'ISSUE-3'])
  assert.deepEqual(snapshot.epics.map((epic) => epic.id), ['EPIC-01'])
  assert.deepEqual(snapshot.sprints.map((sprint) => sprint.id), ['2026-S08'])
  assert.equal(snapshot.orphanSprints.length, 0)
  assert.equal(skipped.length, 0, 'README.md without an id is not an error')
  assert.equal(
    snapshot.gitBranch,
    'feature/kanban',
    'the branch is read from .git/HEAD even though the walk skips .git',
  )

  const one = snapshot.issues.find((issue) => issue.id === 'ISSUE-1')
  assert.equal(one.title, 'Retry deliveries')
  assert.equal(one.epic, 'EPIC-01')
  assert.equal(one.points, 3)
})

test('a missing .git directory is not an error', async () => {
  const root = fixtureRepo()
  const source = new FsaSource(root, 'fixture')
  // Remove .git by listing then deleting through the public API.
  const git = await root.getDirectoryHandle('.git')
  void git
  root.children.delete('.git')
  const { snapshot } = await scanRepo(source, 'id')
  assert.equal(snapshot.gitBranch, null)
  assert.equal(snapshot.issues.length, 3)
})

test('writes create the directories an artefact needs', async () => {
  const root = fixtureRepo()
  const source = new FsaSource(root, 'fixture')
  const dirs = defaultConfig().dirs

  const issue = {
    id: 'ISSUE-9', title: 'Persist onboarding progress', status: 'doing', type: 'story',
    epic: null, sprint: '2026-S09', points: 5, assignee: 'priya', priority: null,
    labels: [], blockedBy: [], links: [], order: 10,
    created: '2026-08-20', updated: '2026-08-20', body: '\nBody.\n', path: null, extra: {},
  }
  issue.path = issuePath(issue, dirs)
  await source.write(issue.path, serializeIssue(issue))

  const files = root.flatten()
  assert.ok(files['sprints/2026-S09/ISSUE-9.md'], 'the sprint folder was created implicitly')
  assert.match(files['sprints/2026-S09/ISSUE-9.md'], /id: ISSUE-9/)

  const { snapshot } = await scanRepo(source, 'id')
  assert.ok(snapshot.issues.some((parsed) => parsed.id === 'ISSUE-9'))
  assert.deepEqual(
    snapshot.orphanSprints,
    ['2026-S09'],
    'a sprint folder without a sprint.md is registered as a stub',
  )
  assert.equal(
    snapshot.sprints.find((sprint) => sprint.id === '2026-S09').path,
    null,
    'and is marked as having no file yet',
  )

  // Writing the sprint.md resolves the stub.
  await source.write(
    'sprints/2026-S09/sprint.md',
    serializeSprint({
      id: '2026-S09', name: 'Sprint 9', state: 'planned', goal: '', start: null,
      end: null, capacity: null, notes: '', path: null, extra: {},
    }),
  )
  const resolved = await scanRepo(source, 'id')
  assert.deepEqual(resolved.orphanSprints, [])
  assert.equal(
    resolved.snapshot.sprints.find((sprint) => sprint.id === '2026-S09').path,
    'sprints/2026-S09/sprint.md',
  )
})

test('moving an artefact writes the new file and removes the old one', async () => {
  const root = fixtureRepo()
  const source = new FsaSource(root, 'fixture')
  const dirs = defaultConfig().dirs

  const before = (await scanRepo(source, 'id')).snapshot.issues.find((i) => i.id === 'ISSUE-2')
  assert.equal(before.path, 'backlog/ISSUE-2.md')

  const moved = { ...before, sprint: '2026-S08', status: 'todo' }
  await writeAt(source, issuePath(moved, dirs), serializeIssue(moved), before.path)

  const files = root.flatten()
  assert.equal(files['backlog/ISSUE-2.md'], undefined, 'the old file is gone')
  assert.ok(files['sprints/2026-S08/ISSUE-2.md'], 'the new file is there')

  const after = (await scanRepo(source, 'id')).snapshot.issues.find((i) => i.id === 'ISSUE-2')
  assert.equal(after.path, 'sprints/2026-S08/ISSUE-2.md')
  assert.equal(after.status, 'todo')
  assert.equal(after.sprint, '2026-S08')
})

test('deletes, reports existence, and refuses to guess', async () => {
  const root = fixtureRepo()
  const source = new FsaSource(root, 'fixture')
  assert.equal(await source.exists('backlog/ISSUE-2.md'), true)
  assert.equal(await source.exists('backlog/NOPE.md'), false)

  await source.remove('backlog/ISSUE-2.md')
  assert.equal(await source.exists('backlog/ISSUE-2.md'), false)
  await assert.rejects(() => source.remove('backlog/ISSUE-2.md'), /NotFoundError/)
  await assert.rejects(() => source.read('backlog/ISSUE-2.md'), /NotFoundError/)
})

test('a file that cannot be read is reported, never silently dropped', async () => {
  const root = new MockDir()
  const source = new FsaSource(root, 'fixture')
  await source.write('backlog/ISSUE-1.md', '---\nid: ISSUE-1\n---\n')
  await source.write('backlog/ISSUE-2.md', '---\nid: ISSUE-2\n---\n')

  // Break one file at the browser-API level, the way a revoked permission or a
  // network drive dropping out would.
  const backlog = await root.getDirectoryHandle('backlog')
  backlog.children.get('ISSUE-2.md').getFile = async () => {
    throw new Error('NotReadableError: the file is locked')
  }

  const { snapshot, skipped } = await scanRepo(source, 'id')
  assert.deepEqual(snapshot.issues.map((issue) => issue.id), ['ISSUE-1'])
  assert.equal(skipped.length, 1)
  assert.equal(skipped[0].path, 'backlog/ISSUE-2.md')
  assert.match(skipped[0].reason, /NotReadableError/)
})
