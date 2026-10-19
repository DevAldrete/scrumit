/**
 * The published specification is the interface between scrumit and every agent
 * that edits a repository on its behalf. If it drifts from the implementation,
 * agents will write files the app reads as broken — so the spec is tested
 * against the code rather than trusted.
 *
 *   node --test tools/
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse as parseYaml } from 'yaml'

import { AGENT_GUIDE_PATH, AGENT_POINTER, buildAgentPreamble } from '../src/lib/agentGuide.ts'
import { defaultConfig } from '../src/lib/config.ts'
import { EPIC_STATES, ISSUE_TYPES, STATUSES } from '../src/lib/model.ts'

const spec = readFileSync(new URL('../llms.txt', import.meta.url), 'utf8')

/* ------------------------------------------------- the spec matches the code */

test('every status is documented', () => {
  for (const status of STATUSES) {
    assert.match(
      spec,
      new RegExp(`\`${status}\``),
      `llms.txt does not mention the \`${status}\` status`,
    )
  }
})

test('every issue type is documented', () => {
  for (const type of ISSUE_TYPES) {
    assert.match(spec, new RegExp(`\`${type}\``), `llms.txt is missing the \`${type}\` type`)
  }
})

test('every epic and sprint state is documented', () => {
  for (const state of EPIC_STATES) {
    assert.match(spec, new RegExp(`\`${state}\``), `llms.txt is missing the \`${state}\` state`)
  }
  for (const state of ['planned', 'active', 'closed']) {
    assert.match(spec, new RegExp(`\`${state}\``), `llms.txt is missing the \`${state}\` sprint state`)
  }
})

test('every front-matter key an issue can carry is documented', () => {
  const keys = [
    'id', 'title', 'status', 'type', 'epic', 'sprint', 'points', 'assignee',
    'priority', 'labels', 'blocked_by', 'links', 'order', 'created', 'updated',
  ]
  for (const key of keys) {
    assert.match(spec, new RegExp(`\`${key}\``), `llms.txt does not document the \`${key}\` key`)
  }
})

test('the spec tells an agent how to handle a sidecar conflict', () => {
  assert.match(spec, /409/)
  assert.match(spec, /scrumit serve|local sidecar/i)
  assert.match(spec, /Re-read the file/i)
})

test('every config key is documented', () => {
  for (const key of ['columns', 'wip', 'terminal', 'length_days', 'vocabulary', 'ceremony', 'dir']) {
    assert.match(spec, new RegExp(`\`?${key}\`?`), `llms.txt does not document config key \`${key}\``)
  }
})

test('the documented default directories are the ones the code uses', () => {
  const { dirs } = defaultConfig()
  for (const dir of Object.values(dirs)) {
    assert.ok(spec.includes(`${dir}/`), `llms.txt does not show the \`${dir}/\` directory`)
  }
  assert.ok(spec.includes(AGENT_GUIDE_PATH), 'the spec should name its own installed path')
})

test('the documented path derivation is plausible', () => {
  // The four rules stated in section 5.
  assert.match(spec, /done\/<sprint>\/<id>\.md/)
  assert.match(spec, /done\/<id>\.md/)
  assert.match(spec, /sprints\/<sprint>\/<id>\.md/)
  assert.match(spec, /backlog\/<id>\.md/)
})

test('the spec carries the hard rules, not just the schema', () => {
  for (const phrase of [
    'Keep `id` stable',
    'ISO `YYYY-MM-DD`',
    'MUST NOT',
    'Preserve every front-matter key',
    'Before you finish',
  ]) {
    assert.ok(spec.includes(phrase), `llms.txt no longer states: ${phrase}`)
  }
})

test('the spec says how an edit becomes visible', () => {
  assert.match(spec, /Rescan/, 'agents should know how to nudge a stale board')
  assert.match(spec, /watches the repository/, 'and that watching usually removes the need')
})

/* -------------------------------------------------------- the generated guide */

function context() {
  const config = {
    ...defaultConfig(),
    project: 'Acme Payments Platform',
    dirs: { backlog: 'todo-inbox', sprints: 'iterations', epics: 'themes', archive: 'shipped' },
    columns: [
      { id: 'backlog', name: 'Ideas', wip: null, terminal: false, hidden: false },
      { id: 'todo', name: 'To do', wip: 8, terminal: false, hidden: false },
      { id: 'doing', name: 'Doing', wip: 3, terminal: false, hidden: false },
      { id: 'review', name: 'Review', wip: 4, terminal: false, hidden: false },
      { id: 'done', name: 'Done', wip: null, terminal: true, hidden: false },
    ],
  }
  const issue = (id, extra) => ({
    id, title: id, status: 'todo', type: 'story', epic: null, sprint: null,
    points: 3, assignee: 'ana-marin', priority: null, labels: ['payments'],
    blockedBy: [], links: [], order: 10, created: '2026-10-01', updated: '2026-10-02',
    body: '', path: null, extra: {}, ...extra,
  })
  return {
    repoName: 'acme-platform',
    config,
    issues: [
      issue('ACME-7'),
      issue('ACME-12', { status: 'done', sprint: '2026-S20', epic: 'EPIC-01', points: 5 }),
      issue('ACME-40', { assignee: 'marco-diaz', labels: ['reliability'] }),
    ],
    epics: [
      { id: 'EPIC-01', title: 'Checkout reliability', state: 'active', owner: 'ana-marin', target: null, color: 1, description: '', path: null, extra: {} },
    ],
    sprints: [
      { id: '2026-S20', name: 'Sprint 20', state: 'active', goal: 'Retries', start: '2026-10-15', end: '2026-10-28', capacity: 34, notes: '', path: null, extra: {} },
    ],
  }
}

test('the generated preamble reports the repository as it actually is', () => {
  const preamble = buildAgentPreamble(context())

  assert.match(preamble, /working agreement for acme-platform/)
  assert.match(preamble, /Acme Payments Platform/)
  assert.ok(preamble.includes('`ACME-41`'), 'the preamble states the next free id')
  assert.ok(
    !preamble.includes('ACMEPA'),
    'the prefix comes from the existing ids, not from the project name',
  )

  // Real configured directories, not the defaults.
  for (const dir of ['todo-inbox', 'iterations', 'themes', 'shipped']) {
    assert.ok(preamble.includes(dir), `preamble should mention the configured ${dir} directory`)
  }

  // Live board facts an agent cannot derive from the format alone.
  assert.ok(preamble.includes('**Ideas**'), 'renamed columns are reported')
  assert.ok(preamble.includes('WIP limit 3'))
  assert.ok(preamble.includes('EPIC-01'), 'existing epics are listed')
  assert.ok(preamble.includes('Sprint 20'), 'existing sprints are listed')
  assert.ok(preamble.includes('`2026-S20`'), 'with the exact id to reference')
  assert.ok(preamble.includes('`reliability`'), 'labels already in use')
  assert.ok(preamble.includes('`marco-diaz`'), 'assignees already in use')
  assert.ok(preamble.includes('3 issues'), 'scale is reported')
})

test('an empty repository still gets a usable prefix', () => {
  const empty = { ...context(), epics: [], sprints: [], issues: [] }
  const preamble = buildAgentPreamble(empty)
  assert.match(preamble, /_None yet/)
  assert.ok(
    preamble.includes('`ACME-1`'),
    'an empty repo falls back to the first word of the project name',
  )

  const unnamed = { ...empty, config: { ...empty.config, project: '' } }
  assert.ok(
    buildAgentPreamble(unnamed).includes('`SCRUM-1`'),
    'and to SCRUM when there is no project name at all',
  )
})

test('the config example in the spec is the code’s real default', () => {
  const block = /```yaml\n([\s\S]*?)```/.exec(spec)
  assert.ok(block, 'llms.txt should contain a yaml example')
  const doc = parseYaml(block[1])
  const defaults = defaultConfig()

  assert.deepEqual(
    doc.columns.map((column) => ({
      id: column.id,
      name: column.name,
      wip: column.wip ?? null,
      terminal: column.terminal ?? false,
    })),
    defaults.columns.map((column) => ({
      id: column.id,
      name: column.name,
      wip: column.wip,
      terminal: column.terminal,
    })),
    'a documented column no longer matches defaultConfig()',
  )

  assert.equal(doc.backlog.dir, defaults.dirs.backlog)
  assert.equal(doc.sprints.dir, defaults.dirs.sprints)
  assert.equal(doc.sprints.length_days, defaults.sprintLengthDays)
  assert.equal(doc.epics.dir, defaults.dirs.epics)
  assert.equal(doc.archive.dir, defaults.dirs.archive)
  assert.equal(doc.ceremony, defaults.ceremony)
  assert.deepEqual(doc.vocabulary, defaults.vocabulary)
})

test('the pointer is safe to paste into somebody else’s AGENTS.md', () => {
  assert.ok(AGENT_POINTER.startsWith('<!-- scrumit -->'), 'it is labelled and hidden in rendered markdown')
  assert.ok(AGENT_POINTER.includes(AGENT_GUIDE_PATH), 'it names the file to read')
})
