/**
 * The capability model is one seam instead of scattered browser checks. These
 * tests pin the combination rule and the sources' declared capabilities.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  RESTRICTIVE_CAPABILITIES,
  resolveCapabilities,
  writeRefusalMessage,
} from '../src/lib/capabilities.ts'
import { DemoSource } from '../src/lib/demo.ts'
import { FsaSource } from '../src/lib/fsa.ts'

const HANDLE = { canWrite: true, canWatch: true, access: 'handle', git: 'branch' }
const READ_ONLY = { canWrite: false, canWatch: false, access: 'handle', git: 'branch' }
const DEMO = { canWrite: true, canWatch: false, access: 'none', git: 'none' }
const HTTP = { canWrite: true, canWatch: true, access: 'http', git: 'full' }

test('a writable handle is writable only when permission is granted', () => {
  assert.equal(resolveCapabilities(HANDLE, 'granted').canWrite, true)
  assert.equal(resolveCapabilities(HANDLE, 'prompt').canWrite, false)
  assert.equal(resolveCapabilities(HANDLE, 'denied').canWrite, false)
  // Watching is intrinsic, not permission-dependent.
  assert.equal(resolveCapabilities(HANDLE, 'prompt').canWatch, true)
})

test('a source that cannot write stays read-only whatever permission says', () => {
  assert.equal(resolveCapabilities(READ_ONLY, 'granted').canWrite, false)
  assert.equal(resolveCapabilities(RESTRICTIVE_CAPABILITIES, 'granted').canWrite, false)
})

test('permission is irrelevant for a demo or HTTP source', () => {
  assert.equal(resolveCapabilities(DEMO, 'denied').canWrite, true)
  assert.equal(resolveCapabilities(HTTP, 'denied').canWrite, true)
})

test('the refusal explains the tier', () => {
  assert.match(writeRefusalMessage(HANDLE, 'prompt'), /grant access/i)
  assert.match(writeRefusalMessage(HTTP, 'granted'), /local server/i)
  assert.match(writeRefusalMessage(DEMO, 'granted'), /read-only/i)
})

test('every source declares its capabilities', () => {
  const fsa = new FsaSource({ kind: 'directory', name: 'acme' }, 'acme')
  assert.equal(fsa.capabilities.canWrite, true)
  assert.equal(fsa.capabilities.access, 'handle')
  assert.equal(fsa.capabilities.git, 'branch')

  const demo = new DemoSource(new Map())
  assert.equal(demo.capabilities.canWrite, true)
  assert.equal(demo.capabilities.canWatch, false)
  assert.equal(demo.capabilities.access, 'none')
})
