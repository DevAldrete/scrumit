/**
 * The diff is what turns "the files changed" into "ACME-140 moved to Done". It
 * is also what decides whether a change is worth interrupting someone over, so
 * both its accuracy and its restraint matter.
 *
 *   node --test tools/
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { diffSnapshots } from '../src/lib/changes.ts'
import { defaultConfig } from '../src/lib/config.ts'

const config = { ...defaultConfig(), project: 'Test', dirs: { backlog: 'backlog', sprints: 'sprints', epics: 'epics', archive: 'done' } }

function issue(id, extra = {}) {
  return {
    id,
    title: id,
    status: 'backlog',
    type: 'story',
    epic: null,
    sprint: null,
    points: 3,
    assignee: null,
    priority: null,
    labels: [],
    blockedBy: [],
    links: [],
    order: 10,
    created: '2026-10-01',
    updated: '2026-10-02',
    body: '\nbody\n',
    path: `backlog/${id}.md`,
    extra: {},
    ...extra,
  }
}

function snapshot(overrides = {}) {
  return {
    repoId: 'r',
    scannedAt: 1000,
    config,
    issues: [],
    epics: [],
    sprints: [],
    fileCount: 3,
    stale: false,
    gitBranch: 'main',
    orphanSprints: [],
    ...overrides,
  }
}

test('a first scan has nothing to report', () => {
  const diff = diffSnapshots(null, snapshot({ issues: [issue('A-1')] }))
  assert.equal(diff.total, 0)
  assert.equal(diff.summary, '')
  assert.deepEqual(diff.details, [])
})

test('nothing changed means nothing said', () => {
  const before = snapshot({ issues: [issue('A-1'), issue('A-2')] })
  const after = snapshot({ issues: [issue('A-1'), issue('A-2')], scannedAt: 2000 })
  const diff = diffSnapshots(before, after)
  assert.equal(diff.total, 0)
  assert.equal(diff.summary, '', 'a rescan that found nothing new must stay quiet')
})

test('a file that moved without changing says nothing new', () => {
  const before = snapshot({ issues: [issue('A-1', { path: 'backlog/A-1.md' })] })
  const after = snapshot({ issues: [issue('A-1', { path: 'somewhere-else/A-1.md' })] })
  assert.equal(
    diffSnapshots(before, after).total,
    0,
    'a tidy-up is not a statement about the work',
  )
})

test('reports an issue appearing', () => {
  const diff = diffSnapshots(snapshot({ issues: [issue('A-1')] }), snapshot({ issues: [issue('A-1'), issue('A-2')] }))
  assert.equal(diff.added.length, 1)
  assert.equal(diff.total, 1)
  assert.match(diff.summary, /1 added/)
  assert.deepEqual(diff.details, ['A-2 added to the backlog'])
})

test('reports an issue appearing straight into a sprint', () => {
  const diff = diffSnapshots(
    snapshot(),
    snapshot({ issues: [issue('A-2', { sprint: '2026-S20', status: 'todo' })] }),
  )
  assert.deepEqual(diff.details, ['A-2 added to 2026-S20'])
})

test('reports an issue disappearing', () => {
  const diff = diffSnapshots(snapshot({ issues: [issue('A-1')] }), snapshot())
  assert.equal(diff.removed.length, 1)
  assert.deepEqual(diff.details, ['A-1 is no longer in the repository'])
})

test('a status change reads as a move, in the columns you configured', () => {
  // Renaming a column is a config change, so that is reported too — but the move
  // itself must use the configured name, not the raw status id.
  const renamed = {
    ...config,
    columns: config.columns.map((column) =>
      column.id === 'doing' ? { ...column, name: 'In progress' } : column,
    ),
  }
  const diff = diffSnapshots(
    snapshot({ issues: [issue('A-1', { status: 'todo', sprint: '2026-S20' })] }),
    snapshot({
      config: renamed,
      issues: [issue('A-1', { status: 'doing', sprint: '2026-S20' })],
    }),
  )
  assert.equal(diff.moved.length, 1)
  assert.equal(diff.updated.length, 0, 'a move is not also an edit')
  assert.match(diff.summary, /1 card moved/)
  assert.equal(diff.details[0], 'A-1 To do → In progress')
  assert.deepEqual(diff.details, ['A-1 To do → In progress', 'config.yaml changed'])
})

test('scheduling and de-scheduling read differently from a status move', () => {
  const into = diffSnapshots(
    snapshot({ issues: [issue('A-1', { status: 'todo' })] }),
    snapshot({ issues: [issue('A-1', { status: 'todo', sprint: '2026-S20' })] }),
  )
  assert.deepEqual(into.details, ['A-1 scheduled into 2026-S20'])

  const out = diffSnapshots(
    snapshot({ issues: [issue('A-1', { status: 'todo', sprint: '2026-S20' })] }),
    snapshot({ issues: [issue('A-1', { status: 'todo', sprint: null })] }),
  )
  assert.deepEqual(out.details, ['A-1 returned to the backlog'])
})

test('a move that changes both status and sprint states both', () => {
  const diff = diffSnapshots(
    snapshot({ issues: [issue('A-1', { status: 'review', sprint: '2026-S20' })] }),
    snapshot({ issues: [issue('A-1', { status: 'done', sprint: null })] }),
  )
  assert.deepEqual(diff.details, ['A-1 Review → Done, backlog'])
})

test('an edit that leaves the board alone is still reported', () => {
  const diff = diffSnapshots(
    snapshot({ issues: [issue('A-1')] }),
    snapshot({ issues: [issue('A-1', { title: 'A better title' })] }),
  )
  assert.equal(diff.updated.length, 1)
  assert.deepEqual(diff.details, ['A-1 edited'])
})

test('counts epics, sprints and config separately from cards', () => {
  const epic = { id: 'EPIC-01', title: 'E', state: 'planned', owner: null, target: null, color: 1, description: '', path: 'epics/EPIC-01.md', extra: {} }
  const sprint = { id: '2026-S20', name: 'Sprint 20', state: 'planned', goal: '', start: null, end: null, capacity: null, notes: '', path: 'sprints/2026-S20/sprint.md', extra: {} }

  const diff = diffSnapshots(
    snapshot(),
    snapshot({
      epics: [epic],
      sprints: [sprint],
      config: { ...config, project: 'Renamed' },
    }),
  )
  assert.equal(diff.epicsAdded, 1)
  assert.equal(diff.sprintsAdded, 1)
  assert.equal(diff.configChanged, true)
  assert.equal(diff.total, 3)
  assert.match(diff.summary, /config\.yaml changed/)
  assert.match(diff.summary, /epics changed/)
  assert.match(diff.summary, /sprints changed/)
  assert.deepEqual(diff.details, ['config.yaml changed', 'and 2 more'])
})

test('an epic that was only retitled counts as changed, not added', () => {
  const base = { id: 'EPIC-01', title: 'E', state: 'planned', owner: null, target: null, color: 1, description: '', path: 'epics/E.md', extra: {} }
  const diff = diffSnapshots(
    snapshot({ epics: [base] }),
    snapshot({ epics: [{ ...base, state: 'active' }] }),
  )
  assert.equal(diff.epicsAdded, 0)
  assert.equal(diff.epicsChanged, 1)
  assert.equal(diff.total, 1)
})

test('details are capped so a big change does not become a wall of text', () => {
  const ids = [1, 2, 3, 4, 5, 6, 7].map((n) => `A-${n}`)
  const before = snapshot({ issues: ids.map((id) => issue(id)) })
  const after = snapshot({ issues: ids.map((id) => issue(id, { status: 'done' })) })
  const diff = diffSnapshots(before, after)
  assert.equal(diff.moved.length, 7)
  assert.equal(diff.details.length, 5, 'four named changes and a count')
  assert.equal(diff.details[4], 'and 3 more')
})

test('a busy agent burst produces one sentence, not twelve', () => {
  const before = snapshot({ issues: [issue('A-1'), issue('A-2')] })
  const after = snapshot({
    issues: [
      issue('A-1', { status: 'done', title: 'plural' }),
      issue('A-3', { title: 'new' }),
      issue('A-4', { title: 'newer' }),
      issue('A-5', { title: 'newest' }),
    ],
  })
  const diff = diffSnapshots(before, after)

  assert.equal(diff.moved.length, 1)
  assert.equal(diff.updated.length, 0)
  assert.equal(diff.added.length, 3)
  assert.equal(diff.removed.length, 1)
  assert.equal(diff.total, 5)
  assert.equal(diff.summary, 'From disk: 1 card moved, 3 added, 1 removed')
})
