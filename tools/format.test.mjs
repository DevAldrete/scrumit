/**
 * The file format is the contract. If a round-trip through scrumit rewrites a
 * line the author did not touch, the diff is a lie and the tool is not safe to
 * point at a shared repository. These tests pin that down.
 *
 *   node --test tools/
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  hueForId,
  parseEpic,
  parseIssue,
  parseSprint,
  serializeEpic,
  serializeIssue,
  serializeSprint,
} from '../src/lib/artefacts.ts'
import { defaultConfig, parseConfig, serializeConfig } from '../src/lib/config.ts'
import { joinFrontmatter, splitFrontmatter } from '../src/lib/frontmatter.ts'
import { boardColumns, hygiene, sprintWip, velocity, velocityMean } from '../src/lib/metrics.ts'
import { epicPath, issuePath, slug } from '../src/lib/paths.ts'

const CANONICAL = `---
id: ISSUE-142
title: Retry webhook delivery with backoff
status: doing
type: story
epic: EPIC-07
sprint: 2026-S08
points: 3
assignee: ana-marin
priority: 1
labels:
  - payments
  - reliability
blocked_by:
  - ISSUE-138
order: 20
created: 2026-08-04
updated: 2026-08-11
---

## Context

Webhook consumers see duplicate deliveries when a 5xx is followed by a slow
recovery.

## Acceptance criteria

- [ ] Retries at 1s, 8s, 60s
- [x] Duplicate deliveries drop to < 0.01%

---

Trailing content after a horizontal rule.
`

test('parses a canonical issue file', () => {
  const issue = parseIssue('sprints/2026-S08/ISSUE-142.md', CANONICAL)
  assert.ok(issue)
  assert.equal(issue.id, 'ISSUE-142')
  assert.equal(issue.title, 'Retry webhook delivery with backoff')
  assert.equal(issue.status, 'doing')
  assert.equal(issue.type, 'story')
  assert.equal(issue.epic, 'EPIC-07')
  assert.equal(issue.sprint, '2026-S08')
  assert.equal(issue.points, 3)
  assert.equal(issue.assignee, 'ana-marin')
  assert.equal(issue.priority, 1)
  assert.deepEqual(issue.labels, ['payments', 'reliability'])
  assert.deepEqual(issue.blockedBy, ['ISSUE-138'])
  assert.equal(issue.order, 20)
  assert.deepEqual(issue.extra, {})
})

test('round-trips without drift', () => {
  const first = parseIssue('a/ISSUE-142.md', CANONICAL)
  const text = serializeIssue(first)
  const second = parseIssue('a/ISSUE-142.md', text)
  const third = parseIssue('a/ISSUE-142.md', serializeIssue(second))
  assert.deepEqual(second, first)
  assert.deepEqual(third, second)
  assert.equal(serializeIssue(second), text)
})

test('changing one field leaves the prose byte-identical', () => {
  const before = parseIssue('a/ISSUE-142.md', CANONICAL)
  const after = parseIssue(
    'a/ISSUE-142.md',
    serializeIssue({ ...before, status: 'review', updated: '2026-08-12' }),
  )
  assert.equal(after.body, before.body)
  assert.equal(after.status, 'review')
  // And the difference really is confined to the front-matter.
  const a = serializeIssue(before).split('\n')
  const b = serializeIssue(after).split('\n')
  const changed = a.filter((line, index) => line !== b[index])
  assert.deepEqual(changed.sort(), ['status: doing', 'updated: 2026-08-11'])
})

test('keeps front-matter keys scrumit does not own', () => {
  const text = joinFrontmatter(
    { id: 'ISSUE-9', title: 'Foreign keys', status: 'todo', jira: 'ACME-2210', design_review: 'not-required' },
    '\nbody\n',
  )
  const issue = parseIssue('backlog/ISSUE-9.md', text)
  assert.deepEqual(issue.extra, { jira: 'ACME-2210', design_review: 'not-required' })
  assert.match(serializeIssue(issue), /jira: ACME-2210/)
  assert.match(serializeIssue(issue), /design_review: not-required/)
})

test('tolerates hand-written shorthand', () => {
  const issue = parseIssue(
    'x.md',
    joinFrontmatter(
      { id: 'ISSUE-1', status: 'nonsense', type: 'nonsense', labels: 'a, b', blockedBy: 'ISSUE-2', points: '5' },
      '\n### Derived title\n\ntext\n',
    ),
  )
  assert.equal(issue.status, 'backlog', 'unknown status falls back')
  assert.equal(issue.type, 'story', 'unknown type falls back')
  assert.deepEqual(issue.labels, ['a', 'b'])
  assert.deepEqual(issue.blockedBy, ['ISSUE-2'])
  assert.equal(issue.points, 5)
  assert.equal(issue.title, 'Derived title', 'title falls back to the first heading')
})

test('an id is required, everything else is not', () => {
  assert.equal(parseIssue('x.md', '---\ntitle: No id\n---\n'), null)
  const bare = parseIssue('x.md', '---\nid: ISSUE-2\n---\n')
  assert.equal(bare.title, 'ISSUE-2')
  assert.equal(bare.status, 'backlog')
  assert.equal(bare.points, null)
  assert.deepEqual(bare.labels, [])
})

test('a file with no front-matter is a body, not an error', () => {
  const text = '# Just documentation\n\nNothing to see.\n'
  const split = splitFrontmatter(text)
  assert.equal(split.hasFrontmatter, false)
  assert.equal(split.body, text)
  assert.equal(parseIssue('docs/x.md', text), null)
})

test('malformed front-matter degrades to a body instead of throwing', () => {
  const text = '---\nid: [unclosed\n---\n\nbody\n'
  const split = splitFrontmatter(text)
  assert.equal(split.hasFrontmatter, false)
  assert.equal(split.body, text)
})

test('handles CRLF and a BOM', () => {
  const text = '\uFEFF---\r\nid: ISSUE-3\r\nstatus: todo\r\n---\r\n\r\nBody line\r\n'
  const issue = parseIssue('x.md', text)
  assert.equal(issue.id, 'ISSUE-3')
  assert.equal(issue.status, 'todo')
  assert.match(issue.body, /Body line/)
})

test('issue paths follow status and sprint', () => {
  const dirs = defaultConfig().dirs
  assert.equal(issuePath({ id: 'A-1', status: 'backlog', sprint: null }, dirs), 'backlog/A-1.md')
  assert.equal(issuePath({ id: 'A-2', status: 'doing', sprint: '2026-S08' }, dirs), 'sprints/2026-S08/A-2.md')
  assert.equal(issuePath({ id: 'A-3', status: 'done', sprint: '2026-S08' }, dirs), 'done/2026-S08/A-3.md')
  assert.equal(issuePath({ id: 'A-4', status: 'done', sprint: null }, dirs), 'done/A-4.md')
})

test('moving a file and editing the field converge', () => {
  const dirs = defaultConfig().dirs
  const byField = issuePath({ id: 'A-5', status: 'done', sprint: '2026-S08' }, dirs)
  // A human who moved the file by hand lands on the same path.
  assert.equal(byField, 'done/2026-S08/A-5.md')
})

test('epic file names are humanised at creation, then never move', () => {
  const dirs = defaultConfig().dirs
  const onDisk = parseEpic('epics/x.md', '---\nid: EPIC-07\ntitle: Checkout reliability\n---\n')
  assert.equal(epicPath(onDisk, dirs), 'epics/x.md', 'a file that exists keeps its name')

  // A brand new epic has no path yet, so the name is derived from the title.
  const created = { id: 'EPIC-07', title: 'Checkout reliability', path: null }
  assert.equal(epicPath(created, dirs), 'epics/EPIC-07-checkout-reliability.md')

  // Retitling goes through patchEpic, which keeps the stored path, so no move.
  const retitled = { ...created, title: 'Renamed entirely', path: 'epics/EPIC-07-checkout-reliability.md' }
  assert.equal(epicPath(retitled, dirs), 'epics/EPIC-07-checkout-reliability.md')

  assert.equal(slug('Ünïcodé & Spaces!'), 'unicode-spaces')
})

test('epics get a stable hue when none is declared', () => {
  const epic = parseEpic('epics/e.md', '---\nid: EPIC-07\ntitle: X\n---\n')
  assert.equal(epic.color, hueForId('EPIC-07'))
  assert.equal(parseEpic('epics/e.md', '---\nid: EPIC-07\ncolor: 4\n---\n').color, 4)
  assert.equal(parseEpic('epics/e.md', '---\nid: EPIC-07\ncolor: 99\n---\n').color, hueForId('EPIC-07'))
})

test('a sprint takes its id from the folder when the file omits it', () => {
  const sprint = parseSprint('sprints/2026-S08/sprint.md', '---\nname: Sprint 8\ncapacity: 30\n---\n\nNotes\n')
  assert.equal(sprint.id, '2026-S08')
  assert.equal(sprint.name, 'Sprint 8')
  assert.equal(sprint.capacity, 30)
  assert.equal(sprint.state, 'planned')
})

test('config round-trips and fills in what is missing', () => {
  const config = parseConfig(
    [
      'version: 1',
      'project: Acme',
      'columns:',
      '  - { id: backlog, name: Ideas }',
      '  - { id: doing, name: In progress, wip: 2 }',
      '  - { id: made-up, name: Nope }',
      'sprints:',
      '  dir: iterations',
      '  length_days: 21',
    ].join('\n'),
  )
  assert.equal(config.project, 'Acme')
  assert.equal(config.dirs.sprints, 'iterations')
  assert.equal(config.sprintLengthDays, 21)
  assert.deepEqual(
    config.columns.map((column) => column.id),
    ['backlog', 'doing', 'todo', 'review', 'done'],
    'declared order wins, unusable ids are dropped, missing statuses are appended',
  )
  assert.equal(config.columns[0].name, 'Ideas')
  assert.equal(config.columns[1].wip, 2)
  assert.equal(config.columns[4].terminal, true)

  const again = parseConfig(serializeConfig(config))
  assert.deepEqual(again.columns, config.columns)
  assert.deepEqual(again.dirs, config.dirs)
  assert.equal(again.sprintLengthDays, config.sprintLengthDays)
})

test('an unreadable config falls back to the defaults', () => {
  const config = parseConfig('columns: [ this is not: valid: yaml')
  assert.deepEqual(config.columns, defaultConfig().columns)
})

test('board columns compute counts, points and WIP breaches', () => {
  const config = defaultConfig()
  const make = (id, status, points, order) => ({
    id, title: id, status, type: 'story', epic: null, sprint: null, points,
    assignee: null, priority: null, labels: [], blockedBy: [], links: [],
    order, created: null, updated: null, body: '', path: null, extra: {},
  })
  const columns = boardColumns(
    [make('A', 'doing', 3, 20), make('B', 'doing', 5, 10), make('C', 'todo', 2, 10)],
    config,
  )
  const doing = columns.find((column) => column.id === 'doing')
  assert.equal(doing.count, 2)
  assert.equal(doing.points, 8)
  assert.equal(doing.issues[0].id, 'B', 'lower order sorts first')
  assert.equal(doing.overWip, false, 'the default WIP limit is 3')
  assert.equal(doing.overSoft, false, 'there is no soft limit by default')
})

test('soft and hard WIP limits round-trip and report separately', () => {
  const config = parseConfig(
    [
      'columns:',
      '  - { id: doing, name: Doing, soft_wip: 2, wip: 4 }',
    ].join('\n'),
  )
  const doing = config.columns.find((column) => column.id === 'doing')
  assert.equal(doing.softWip, 2)
  assert.equal(doing.wip, 4)
  assert.deepEqual(parseConfig(serializeConfig(config)).columns, config.columns)

  const make = (id, status) => ({
    id, title: id, status, type: 'story', epic: null, sprint: 'S1', points: 1,
    assignee: null, priority: null, labels: [], blockedBy: [], links: [],
    order: 10, created: null, updated: null, body: '', path: null, extra: {},
  })
  const columns = boardColumns(
    [make('A', 'doing'), make('B', 'doing'), make('C', 'doing')],
    config,
  )
  const column = columns.find((item) => item.id === 'doing')
  assert.equal(column.overSoft, true, 'three cards cross the flexible limit of two')
  assert.equal(column.overWip, false, 'but not the hard limit of four')
})

test('a sprint carries flexible and hard WIP limits', () => {
  const sprint = parseSprint(
    'sprints/S1/sprint.md',
    '---\nid: S1\nname: One\nwip_soft: 2\nwip_hard: 4\n---\n',
  )
  assert.equal(sprint.wipSoft, 2)
  assert.equal(sprint.wipHard, 4)
  assert.deepEqual(parseSprint('sprints/S1/sprint.md', serializeSprint(sprint)), sprint)

  const issue = (id, status) => ({
    id, title: id, status, type: 'story', epic: null, sprint: 'S1', points: 1,
    assignee: null, priority: null, labels: [], blockedBy: [], links: [],
    order: 10, created: null, updated: null, body: '', path: null, extra: {},
  })
  const wip = sprintWip(
    sprint,
    [issue('A', 'doing'), issue('B', 'review'), issue('C', 'todo'), issue('D', 'done')],
    defaultConfig(),
  )
  assert.equal(wip.count, 2, 'todo and done are not work in progress')
  assert.equal(wip.overSoft, false)
  assert.equal(wip.over, false)
})

test('velocity ignores the running sprint, and hygiene finds blockers', () => {
  const issue = (id, extra) => ({
    id, title: id, status: 'todo', type: 'story', epic: null, sprint: null,
    points: 3, assignee: null, priority: null, labels: [], blockedBy: [], links: [],
    order: 0, created: null, updated: null, body: '', path: null, extra: {}, ...extra,
  })
  const sprints = [
    { id: 'S1', name: 'S1', state: 'closed', goal: '', start: null, end: null, capacity: 10, notes: '', path: null, extra: {} },
    { id: 'S2', name: 'S2', state: 'active', goal: '', start: null, end: null, capacity: 10, notes: '', path: null, extra: {} },
  ]
  const issues = [
    issue('A', { status: 'done', sprint: 'S1' }),
    issue('B', { status: 'done', sprint: 'S1' }),
    issue('C', { status: 'todo', sprint: 'S2' }),
    issue('D', { status: 'todo', blockedBy: ['C'] }),
  ]
  const buckets = velocity(sprints, issues)
  assert.deepEqual(buckets.map((bucket) => [bucket.id, bucket.points]), [['S1', 6], ['S2', 0]])
  assert.equal(velocityMean(buckets), 6, 'the active sprint does not drag the mean down')

  const checks = hygiene(issues, defaultConfig())
  assert.deepEqual(checks.blocked.map((i) => i.id), ['D'])
  assert.deepEqual(checks.unassigned.map((i) => i.id), ['C', 'D'].filter((id) => id !== 'A'))
})

test('serialising an epic and a sprint is stable too', () => {
  const epic = parseEpic('epics/e.md', '---\nid: EPIC-1\ntitle: T\nstate: active\nowner: ana\n---\n\nWhy.\n')
  assert.deepEqual(parseEpic('epics/e.md', serializeEpic(epic)), epic)
  const sprint = parseSprint('sprints/S1/sprint.md', '---\nid: S1\nname: One\ngoal: Ship it\nstart: 2026-01-01\nend: 2026-01-14\ncapacity: 20\n---\n\nRetro notes\n')
  assert.deepEqual(parseSprint('sprints/S1/sprint.md', serializeSprint(sprint)), sprint)
})
