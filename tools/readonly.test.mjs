/**
 * The read-only adapter is the Safari/Firefox entry point. It must read a real
 * folder-shaped FileList, strip the selected root, and refuse every write with
 * a useful explanation.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ReadOnlySource, entriesFromFiles } from '../src/lib/readonly.ts'
import { scanRepo } from '../src/lib/source.ts'

function fileAt(path, text) {
  const name = path.split('/').pop()
  const file = new File([text], name, { type: 'text/markdown' })
  Object.defineProperty(file, 'webkitRelativePath', { value: `acme/${path}` })
  return file
}

function fixture() {
  return [
    fileAt('.scrumit/config.yaml', 'version: 1\nproject: Read-only test\n'),
    fileAt(
      'sprints/2026-S01/sprint.md',
      '---\nid: 2026-S01\nname: Sprint 1\nstate: active\n---\n\nSprint notes.\n',
    ),
    fileAt(
      'sprints/2026-S01/RO-1.md',
      '---\nid: RO-1\ntitle: Only read\nstatus: todo\ntype: story\nsprint: 2026-S01\norder: 10\ncreated: 2026-10-19\nupdated: 2026-10-19\n---\n\n## Context\n\nRead it.\n',
    ),
    fileAt('node_modules/junk/README.md', 'ignored\n'),
    fileAt('.git/HEAD', 'ref: refs/heads/read-only-branch\n'),
  ]
}

test('a FileList loses its selected root and keeps the repository shape', () => {
  const entries = entriesFromFiles(fixture())
  assert.ok(entries.some((entry) => entry.path === 'sprints/2026-S01/RO-1.md'))
  assert.ok(entries.every((entry) => !entry.path.startsWith('acme/')))
})

test('the read-only source lists, reads, and refuses writes', async () => {
  const source = ReadOnlySource.fromFiles(fixture(), 'acme')
  assert.equal(source.kind, 'readonly')
  assert.equal(source.capabilities.canWrite, false)
  assert.equal(source.capabilities.canWatch, false)
  assert.equal(source.capabilities.access, 'none')
  assert.equal(source.capabilities.git, 'branch')

  const files = await source.list()
  assert.ok(files.includes('sprints/2026-S01/RO-1.md'))
  assert.ok(files.includes('.git/HEAD'))
  assert.ok(!files.some((path) => path.includes('node_modules')))

  assert.match(await source.read('sprints/2026-S01/RO-1.md'), /Only read|RO-1/)
  assert.equal(await source.exists('sprints/2026-S01/RO-1.md'), true)
  assert.equal(await source.exists('nope.md'), false)
  await assert.rejects(source.write('backlog/NEW.md', 'x'), /read-only/i)
  await assert.rejects(source.remove('sprints/2026-S01/RO-1.md'), /read-only|deleted/i)
})

test('a read-only source scans into a real snapshot', async () => {
  const source = ReadOnlySource.fromFiles(fixture(), 'acme')
  const { snapshot, skipped, validation } = await scanRepo(source, 'readonly-fixture')
  assert.equal(snapshot.repoId, 'readonly-fixture')
  assert.equal(snapshot.config.project, 'Read-only test')
  assert.equal(snapshot.issues.length, 1)
  assert.equal(snapshot.issues[0].id, 'RO-1')
  assert.equal(snapshot.sprints.length, 1)
  assert.equal(snapshot.gitBranch, 'read-only-branch')
  assert.deepEqual(skipped, [])
  assert.deepEqual(validation, [])
})

test('a folder without .git still works and has no branch capability', async () => {
  const files = fixture().filter((file) => !file.webkitRelativePath.endsWith('.git/HEAD'))
  const source = ReadOnlySource.fromFiles(files, 'acme')
  assert.equal(source.capabilities.git, 'none')
  assert.equal((await scanRepo(source, 'readonly-fixture')).snapshot.gitBranch, null)
})

test('files without a relative path use their own name', () => {
  const file = new File(['hello'], 'README.md')
  const entries = entriesFromFiles([file])
  assert.equal(entries[0].path, 'README.md')
})
