/**
 * One contract, every adapter.
 *
 * The browser folder adapter, the read-only folder adapter, and the HTTP
 * sidecar all claim to implement RepoSource. Running the same assertions against
 * all three is what stops "works in Chrome" from being the definition of done.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { writeAt } from '../src/lib/source.ts'

const SEED = 'backlog/CONTRACT-1.md'
const SEED_TEXT =
  '---\nid: CONTRACT-1\ntitle: Seed\nstatus: backlog\ntype: story\norder: 10\n---\n\nSeed body.\n'

async function withSource(make, fn) {
  const made = await make()
  const source = made.source ?? made
  try {
    await fn(source)
  } finally {
    await made.cleanup?.()
  }
}

export function sourceContract(name, { make, capabilities, writable = true }) {
  test(`${name}: declares capabilities`, async () => {
    await withSource(make, async (source) => {
      assert.equal(source.capabilities.canWrite, capabilities.canWrite)
      assert.equal(source.capabilities.access, capabilities.access)
      assert.equal(source.capabilities.git, capabilities.git)
      assert.equal(typeof source.capabilities.canWatch, 'boolean')
    })
  })

  test(`${name}: lists, reads, and reports existence`, async () => {
    await withSource(make, async (source) => {
      const files = await source.list()
      assert.ok(Array.isArray(files))
      assert.ok(files.every((file) => typeof file === 'string'))
      assert.ok(files.includes(SEED), `${name} did not list ${SEED}`)
      assert.match(await source.read(SEED), /Seed body/)
      assert.equal(await source.exists(SEED), true)
      assert.equal(await source.exists('backlog/NOPE.md'), false)
      await assert.rejects(source.read('backlog/NOPE.md'))
    })
  })

  test(`${name}: watch is either implemented or absent`, async () => {
    await withSource(make, async (source) => {
      assert.ok(source.watch === undefined || typeof source.watch === 'function')
    })
  })

  if (writable) {
    test(`${name}: writes, moves, and removes through the contract`, async () => {
      await withSource(make, async (source) => {
        const created = 'backlog/CONTRACT-2.md'
        await source.write(created, '---\nid: CONTRACT-2\n---\n\nSecond.\n')
        assert.match(await source.read(created), /Second\./)
        assert.ok((await source.list()).includes(created))

        const moved = 'backlog/CONTRACT-3.md'
        await writeAt(source, moved, '---\nid: CONTRACT-3\n---\n\nThird.\n', created)
        assert.match(await source.read(moved), /Third\./)
        assert.equal(await source.exists(created), false)

        await source.remove(moved)
        assert.equal(await source.exists(moved), false)
        await assert.rejects(source.remove(moved))

        const nested = 'deep/nested/CONTRACT-4.md'
        await source.write(nested, '---\nid: CONTRACT-4\n---\n\nNested.\n')
        assert.match(await source.read(nested), /Nested\./)
        await source.remove(nested)
      })
    })
  } else {
    test(`${name}: refuses writes and removals`, async () => {
      await withSource(make, async (source) => {
        await assert.rejects(
          source.write('backlog/CONTRACT-2.md', '---\nid: CONTRACT-2\n---\n'),
          /read-only|writable|refuses/i,
        )
        await assert.rejects(
          source.remove(SEED),
          /read-only|writable|refuses/i,
        )
        // Reads still work after a refused write.
        assert.match(await source.read(SEED), /Seed body/)
      })
    })
  }
}
