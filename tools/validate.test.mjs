/**
 * Validation is the feedback loop for agent-written repositories. These tests
 * feed it deliberately broken artefacts and assert the codes, then assert a
 * clean board produces nothing.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { defaultConfig } from '../src/lib/config.ts'
import { validateScan } from '../src/lib/validate.ts'

function issue(overrides = {}) {
  return {
    id: 'ISSUE-1',
    title: 'One',
    status: 'todo',
    type: 'story',
    epic: null,
    sprint: null,
    points: null,
    assignee: null,
    priority: null,
    labels: [],
    blockedBy: [],
    links: [],
    order: 10,
    created: '2026-10-01',
    updated: '2026-10-02',
    body: '',
    path: 'backlog/ISSUE-1.md',
    extra: {},
    ...overrides,
  }
}

function codes(findings) {
  return findings.map((finding) => finding.code)
}

test('a clean snapshot has no findings', () => {
  const findings = validateScan({
    config: defaultConfig(),
    issues: [issue()],
    epics: [],
    sprints: [],
    texts: new Map([
      ['backlog/ISSUE-1.md', '---\nid: ISSUE-1\nstatus: todo\ntype: story\n---\n'],
    ]),
    skipped: [],
  })
  assert.deepEqual(findings, [])
})

test('unknown raw enums are reported even though parsing normalises them', () => {
  const findings = validateScan({
    config: defaultConfig(),
    issues: [issue()],
    epics: [],
    sprints: [],
    texts: new Map([
      ['backlog/ISSUE-1.md', '---\nid: ISSUE-1\nstatus: donee\ntype: wizard\n---\n'],
    ]),
    skipped: [],
  })
  assert.ok(codes(findings).includes('bad-status'))
  assert.ok(codes(findings).includes('bad-type'))
})

test('duplicate ids, dangling references, and path drift are all reported', () => {
  const config = defaultConfig()
  const findings = validateScan({
    config,
    issues: [
      issue({ id: 'ISSUE-1', path: 'backlog/ISSUE-1.md' }),
      issue({ id: 'ISSUE-1', path: 'backlog/COPY.md' }),
      issue({
        id: 'ISSUE-2',
        path: 'backlog/ISSUE-2.md',
        epic: 'EPIC-99',
        sprint: '2026-S99',
        blockedBy: ['ISSUE-404', 'ISSUE-2'],
      }),
    ],
    epics: [],
    sprints: [],
    texts: new Map(),
    skipped: [],
  })
  const list = codes(findings)
  assert.ok(list.includes('duplicate-id'))
  assert.ok(list.includes('dangling-epic'))
  assert.ok(list.includes('dangling-sprint'))
  assert.ok(list.includes('dangling-blocker'))
  assert.ok(list.includes('self-block'))
  assert.ok(list.includes('path-mismatch'))
})

test('a blocked_by cycle is reported once', () => {
  const findings = validateScan({
    config: defaultConfig(),
    issues: [
      issue({ id: 'ISSUE-1', path: 'backlog/ISSUE-1.md', blockedBy: ['ISSUE-2'] }),
      issue({ id: 'ISSUE-2', path: 'backlog/ISSUE-2.md', blockedBy: ['ISSUE-1'] }),
    ],
    epics: [],
    sprints: [],
    texts: new Map(),
    skipped: [],
  })
  const cycles = findings.filter((finding) => finding.code === 'blocked-cycle')
  assert.equal(cycles.length, 1)
})

test('missing and backwards dates are warnings, not errors', () => {
  const findings = validateScan({
    config: defaultConfig(),
    issues: [
      issue({ id: 'ISSUE-1', path: 'backlog/ISSUE-1.md', updated: null }),
      issue({
        id: 'ISSUE-2',
        path: 'backlog/ISSUE-2.md',
        created: '2026-10-10',
        updated: '2026-10-01',
      }),
    ],
    epics: [],
    sprints: [],
    texts: new Map(),
    skipped: [],
  })
  const missing = findings.find((finding) => finding.code === 'missing-updated')
  const backwards = findings.find((finding) => finding.code === 'updated-before-created')
  assert.equal(missing?.severity, 'warning')
  assert.equal(backwards?.severity, 'warning')
})

test('a done issue in the wrong folder is a path warning', () => {
  const findings = validateScan({
    config: defaultConfig(),
    issues: [
      issue({ id: 'ISSUE-1', status: 'done', sprint: '2026-S01', path: 'sprints/2026-S01/ISSUE-1.md' }),
    ],
    epics: [],
    sprints: [],
    texts: new Map(),
    skipped: [],
  })
  assert.ok(codes(findings).includes('path-mismatch'))
})
