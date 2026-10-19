/**
 * HttpSource is the browser side of the sidecar. It has to be invisible to the
 * store: same contract, same WatchEvent shape, and a typed conflict instead of a
 * silent overwrite.
 */
import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { startServer } from '../server/index.mjs'
import {
  ConflictError,
  HttpSource,
  ServerUnavailableError,
} from '../src/lib/http.ts'

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'scrumit-http-source-'))
  mkdirSync(join(dir, '.scrumit'), { recursive: true })
  mkdirSync(join(dir, 'backlog'), { recursive: true })
  writeFileSync(join(dir, '.scrumit/config.yaml'), 'version: 1\nproject: HTTP Test\n')
  writeFileSync(
    join(dir, 'backlog/H-1.md'),
    '---\nid: H-1\ntitle: One\nstatus: backlog\ntype: story\norder: 10\n---\n\nFirst.\n',
  )
  return dir
}

async function setup() {
  const repo = fixture()
  const info = await startServer({ repo, port: 0, token: 'http-token', quiet: true })
  return { repo, info, source: new HttpSource(info.url, 'http-token') }
}

test('HttpSource lists, reads, and declares the HTTP tier', async () => {
  const { info, source } = await setup()
  try {
    const files = await source.list()
    assert.ok(files.includes('backlog/H-1.md'))
    assert.ok(files.includes('.scrumit/config.yaml'))
    assert.equal(source.capabilities.access, 'http')
    assert.equal(source.capabilities.canWrite, true)

    const text = await source.read('backlog/H-1.md')
    assert.match(text, /First\./)
    assert.equal(await source.exists('backlog/H-1.md'), true)
    assert.equal(await source.exists('backlog/NOPE.md'), false)

    const health = await source.health()
    assert.equal(health.ok, true)
    assert.equal(health.repo, info.repo)
  } finally {
    await info.stop()
  }
})

test('a stale base throws ConflictError with the current text', async () => {
  const { info, source } = await setup()
  try {
    const first = await source.read('backlog/H-1.md')
    await source.write('backlog/H-1.md', first.replace('First.', 'Changed.'))
    assert.match(await source.read('backlog/H-1.md'), /Changed\./)

    const stale = new HttpSource(info.url, 'http-token')
    // No list/read: the new source has no ETag, so an overwrite is create-only.
    await assert.rejects(
      stale.write('backlog/H-1.md', 'blind overwrite\n'),
      (error) => {
        assert.ok(error instanceof ConflictError)
        assert.match(error.current ?? '', /Changed\./)
        assert.ok(error.etag)
        return true
      },
    )
  } finally {
    await info.stop()
  }
})

test('create, remove, and missing-file behaviour', async () => {
  const { info, source } = await setup()
  try {
    await source.write('backlog/H-2.md', '---\nid: H-2\nstatus: backlog\n---\n')
    assert.match(await source.read('backlog/H-2.md'), /H-2/)

    await source.remove('backlog/H-2.md')
    assert.equal(await source.exists('backlog/H-2.md'), false)
    await assert.rejects(source.read('backlog/H-2.md'))
    await assert.rejects(source.remove('backlog/H-2.md'))
  } finally {
    await info.stop()
  }
})

test('watch maps SSE changes into WatchEvent', async () => {
  const { repo, info, source } = await setup()
  const events = []
  const stop = await source.watch((event) => events.push(event))
  try {
    await new Promise((resolve) => setTimeout(resolve, 150))
    writeFileSync(
      join(repo, 'backlog/H-3.md'),
      '---\nid: H-3\ntitle: External\nstatus: backlog\n---\n',
    )
    const deadline = Date.now() + 4000
    while (Date.now() < deadline) {
      if (events.some((event) => event.paths.includes('backlog/H-3.md'))) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.ok(
      events.some((event) => event.paths.includes('backlog/H-3.md')),
      `no change event received: ${JSON.stringify(events)}`,
    )
  } finally {
    stop()
    await info.stop()
  }
})

test('a stopped server becomes ServerUnavailableError', async () => {
  const { info, source } = await setup()
  await info.stop()
  await assert.rejects(source.read('backlog/H-1.md'), ServerUnavailableError)
})
