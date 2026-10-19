/**
 * A rescan must not silently replace text the user is still resolving.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { overlayConflicts } from '../src/lib/conflicts.ts'

const issue = (id, title) => ({
  id,
  title,
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
  created: null,
  updated: null,
  body: '',
  path: `${id}.md`,
  extra: {},
})

test('without conflicts the snapshot wins', () => {
  const disk = [issue('A', 'disk')]
  const local = [issue('A', 'local')]
  assert.equal(overlayConflicts(disk, local, []), disk)
})

test('a conflicted issue keeps the local text even when the disk copy moved', () => {
  const disk = [issue('A', 'disk'), issue('B', 'disk')]
  const local = [issue('A', 'local'), issue('B', 'local')]
  const out = overlayConflicts(disk, local, ['A'])
  assert.equal(out.find((item) => item.id === 'A').title, 'local')
  assert.equal(out.find((item) => item.id === 'B').title, 'disk')
})

test('a conflicted issue deleted on disk is still shown', () => {
  const disk = [issue('B', 'disk')]
  const local = [issue('A', 'local'), issue('B', 'local')]
  const out = overlayConflicts(disk, local, ['A'])
  assert.equal(out.find((item) => item.id === 'A')?.title, 'local')
})
