/**
 * The sidecar is the writable path for Firefox and Safari. These tests run a
 * real server against a real temp repository and exercise the things that must
 * never be wrong: auth, containment, ETag conflicts, and atomic writes.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { startServer } from '../server/index.mjs'
import { IGNORED } from '../server/fs-api.mjs'
import { IGNORED_DIRS } from '../src/lib/source.ts'

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'scrumit-sidecar-'))
  mkdirSync(join(dir, '.scrumit'), { recursive: true })
  mkdirSync(join(dir, '.git'), { recursive: true })
  mkdirSync(join(dir, 'backlog'), { recursive: true })
  mkdirSync(join(dir, 'dist'), { recursive: true })
  writeFileSync(join(dir, '.scrumit/config.yaml'), 'version: 1\nproject: Sidecar Test\n')
  writeFileSync(join(dir, '.git/HEAD'), 'ref: refs/heads/sidecar-branch\n')
  writeFileSync(
    join(dir, 'backlog/A-1.md'),
    '---\nid: A-1\ntitle: One\nstatus: backlog\ntype: story\norder: 10\n---\n\nFirst.\n',
  )
  writeFileSync(join(dir, 'dist/index.html'), '<!doctype html><title>sidecar</title>')
  return dir
}

async function serverFor(repo) {
  return startServer({
    repo,
    port: 0,
    token: 'test-token',
    quiet: true,
    dist: join(repo, 'dist'),
  })
}

function auth() {
  return { authorization: 'Bearer test-token' }
}

async function json(response) {
  return JSON.parse(await response.text())
}

test('the server ignore list matches the app', () => {
  assert.deepEqual([...IGNORED].sort(), [...IGNORED_DIRS].sort())
})

test('health, list, read, and auth', async () => {
  const repo = fixture()
  const info = await serverFor(repo)
  try {
    const denied = await fetch(`${info.url}/api/health`)
    assert.equal(denied.status, 401)

    const health = await fetch(`${info.url}/api/health`, { headers: auth() })
    assert.equal(health.status, 200)
    const body = await json(health)
    assert.equal(body.ok, true)
    assert.equal(body.repo, info.repo)
    assert.equal(body.capabilities.access, 'http')
    assert.equal(body.capabilities.canWrite, true)

    const files = await json(await fetch(`${info.url}/api/files`, { headers: auth() }))
    assert.ok(files.files.some((file) => file.path === 'backlog/A-1.md'))
    assert.ok(files.files.some((file) => file.path === '.git/HEAD'))

    const read = await fetch(`${info.url}/api/file?path=backlog/A-1.md`, {
      headers: auth(),
    })
    assert.equal(read.status, 200)
    assert.match(await read.text(), /First\./)
    assert.ok(read.headers.get('etag'))

    const head = await fetch(`${info.url}/api/file?path=.git/HEAD`, { headers: auth() })
    assert.match(await head.text(), /sidecar-branch/)

    const staticPage = await fetch(`${info.url}/`)
    assert.equal(staticPage.status, 200)
    assert.match(await staticPage.text(), /sidecar/)
  } finally {
    await info.stop()
  }
})

test('writes use ETags and a stale base returns 409 with the current text', async () => {
  const repo = fixture()
  const info = await serverFor(repo)
  const url = `${info.url}/api/file?path=backlog/A-1.md`
  try {
    const first = await fetch(url, { headers: auth() })
    const base = first.headers.get('etag')
    const original = await first.text()

    const written = await fetch(
      `${url}&base=${encodeURIComponent(base)}`,
      { method: 'PUT', headers: auth(), body: original.replace('First.', 'Changed.') },
    )
    assert.equal(written.status, 200)
    const result = await json(written)
    assert.ok(result.etag)
    assert.match(readFileSync(join(repo, 'backlog/A-1.md'), 'utf8'), /Changed\./)

    const stale = await fetch(
      `${url}&base=${encodeURIComponent(base)}`,
      { method: 'PUT', headers: auth(), body: 'stale overwrite\n' },
    )
    assert.equal(stale.status, 409)
    const conflict = await json(stale)
    assert.match(conflict.current, /Changed\./)
    assert.ok(conflict.etag)
    assert.match(readFileSync(join(repo, 'backlog/A-1.md'), 'utf8'), /Changed\./)
  } finally {
    await info.stop()
  }
})

test('create is create-only; overwrite without a base is a conflict', async () => {
  const repo = fixture()
  const info = await serverFor(repo)
  const path = `${info.url}/api/file?path=backlog/NEW-1.md`
  try {
    const created = await fetch(path, {
      method: 'PUT',
      headers: auth(),
      body: '---\nid: NEW-1\nstatus: backlog\n---\n',
    })
    assert.equal(created.status, 200)

    const overwrite = await fetch(path, {
      method: 'PUT',
      headers: auth(),
      body: '---\nid: NEW-1\nstatus: todo\n---\n',
    })
    assert.equal(overwrite.status, 409)
    const conflict = await json(overwrite)
    assert.match(conflict.current, /status: backlog/)
  } finally {
    await info.stop()
  }
})

test('only markdown and config are writable; traversal and symlinks are rejected', async () => {
  const repo = fixture()
  const info = await serverFor(repo)
  const outside = mkdtempSync(join(tmpdir(), 'scrumit-outside-'))
  writeFileSync(join(outside, 'secret.md'), 'secret\n')
  symlinkSync(join(outside, 'secret.md'), join(repo, 'escape.md'))
  try {
    const binary = await fetch(`${info.url}/api/file?path=package.json`, { headers: auth() })
    assert.equal(binary.status, 403)

    const writeBinary = await fetch(`${info.url}/api/file?path=package.json`, {
      method: 'PUT',
      headers: auth(),
      body: '{}',
    })
    assert.equal(writeBinary.status, 403)

    const traversal = await fetch(
      `${info.url}/api/file?path=${encodeURIComponent('../../etc/passwd')}`,
      { headers: auth() },
    )
    assert.equal(traversal.status, 400)

    const escape = await fetch(`${info.url}/api/file?path=escape.md`, { headers: auth() })
    assert.ok([403, 404].includes(escape.status))

    const writeHead = await fetch(`${info.url}/api/file?path=.git/HEAD`, {
      method: 'PUT',
      headers: auth(),
      body: 'ref: refs/heads/evil\n',
    })
    assert.equal(writeHead.status, 403)
  } finally {
    await info.stop()
  }
})

test('delete checks the base and then removes the file', async () => {
  const repo = fixture()
  const info = await serverFor(repo)
  const url = `${info.url}/api/file?path=backlog/A-1.md`
  try {
    const read = await fetch(url, { headers: auth() })
    const base = read.headers.get('etag')
    await read.text()

    const stale = await fetch(`${url}&base="nope"`, { method: 'DELETE', headers: auth() })
    assert.equal(stale.status, 409)

    const deleted = await fetch(`${url}&base=${encodeURIComponent(base)}`, {
      method: 'DELETE',
      headers: auth(),
    })
    assert.equal(deleted.status, 204)
    assert.throws(() => readFileSync(join(repo, 'backlog/A-1.md'), 'utf8'))
  } finally {
    await info.stop()
  }
})

test('SSE reports external changes and git head', async () => {
  const repo = fixture()
  const info = await serverFor(repo)
  const controller = new AbortController()
  try {
    const response = await fetch(`${info.url}/api/events`, {
      headers: auth(),
      signal: controller.signal,
    })
    assert.equal(response.status, 200)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let pending = ''

    const wait = (needle) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${needle}`)), 3000)
        const read = () => {
          reader.read().then(({ value, done }) => {
            if (done) {
              clearTimeout(timer)
              reject(new Error('stream ended'))
              return
            }
            pending += decoder.decode(value, { stream: true })
            if (pending.includes(needle)) {
              clearTimeout(timer)
              resolve(pending)
              return
            }
            read()
          }, reject)
        }
        read()
      })

    await new Promise((resolve) => setTimeout(resolve, 100))
    writeFileSync(join(repo, 'backlog/EXTERNAL.md'), '---\nid: EXTERNAL\ntitle: External\n---\n')
    const changed = await wait('EXTERNAL.md')
    assert.match(changed, /"type":"change"/)

    writeFileSync(join(repo, '.git/HEAD'), 'ref: refs/heads/other\n')
    const branch = await wait('git-head')
    assert.match(branch, /git-head/)
  } finally {
    controller.abort()
    await info.stop()
  }
})

test('a real git repository is recognised as full-git capability', async () => {
  const repo = fixture()
  execFileSync('git', ['init', '-q'], { cwd: repo })
  const info = await serverFor(repo)
  try {
    const body = await json(await fetch(`${info.url}/api/health`, { headers: auth() }))
    assert.equal(body.capabilities.git, 'full')
  } finally {
    await info.stop()
  }
})
