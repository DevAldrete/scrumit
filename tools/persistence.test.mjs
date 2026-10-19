/**
 * The handle fallback is the difference between "adding a repo throws" and
 * "adding a repo works, but you must reopen it next session". It is tested
 * without IndexedDB by injecting the put function.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isDataCloneError, persistRepo } from '../src/lib/db.ts'

function record(handle) {
  return {
    id: 'repo-1',
    name: 'Acme',
    path: '~/dev/acme',
    kind: 'fsa',
    color: 1,
    createdAt: 1,
    lastOpenedAt: 1,
    handle,
  }
}

test('a cloneable handle is persisted and marked', async () => {
  const handle = { kind: 'directory', name: 'acme' }
  const saved = []
  const result = await persistRepo(record(handle), async (next) => {
    saved.push(next)
  })
  assert.equal(result.handlePersisted, true)
  assert.equal(saved.length, 1)
  assert.equal(saved[0].handle, handle)
})

test('an uncloneable handle is dropped and the repo still persists', async () => {
  const handle = { kind: 'directory', name: 'acme' }
  const saved = []
  const result = await persistRepo(record(handle), async (next) => {
    if (next.handle) throw new DOMException('could not be cloned', 'DataCloneError')
    saved.push(next)
  })
  assert.equal(result.handlePersisted, false)
  assert.equal(result.handle, undefined)
  assert.equal(saved.length, 1)
  assert.equal(saved[0].handle, undefined)
  assert.equal(saved[0].name, 'Acme')
})

test('a record without a handle is persisted untouched', async () => {
  const saved = []
  const result = await persistRepo(record(undefined), async (next) => {
    saved.push(next)
  })
  assert.equal(result.handlePersisted, undefined)
  assert.equal(saved.length, 1)
})

test('a non-clone error is not swallowed', async () => {
  await assert.rejects(
    persistRepo(record({ kind: 'directory', name: 'acme' }), async () => {
      throw new Error('disk on fire')
    }),
    /disk on fire/,
  )
})

test('DataCloneError is recognised by name and message', () => {
  assert.equal(isDataCloneError(new DOMException('x', 'DataCloneError')), true)
  assert.equal(isDataCloneError(new Error('could not be cloned')), true)
  assert.equal(isDataCloneError(new Error('disk on fire')), false)
  assert.equal(isDataCloneError('nope'), false)
})
