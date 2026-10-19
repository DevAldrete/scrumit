/**
 * Run the same RepoSource contract against a real FSA mock, the read-only
 * adapter, and a live HTTP sidecar.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { startServer } from '../server/index.mjs'
import { FsaSource } from '../src/lib/fsa.ts'
import { HttpSource } from '../src/lib/http.ts'
import { ReadOnlySource } from '../src/lib/readonly.ts'
import { sourceContract } from './source-contract.mjs'
import { MockDir } from './mock-fsa.mjs'

const SEED = 'backlog/CONTRACT-1.md'
const SEED_TEXT =
  '---\nid: CONTRACT-1\ntitle: Seed\nstatus: backlog\ntype: story\norder: 10\n---\n\nSeed body.\n'

sourceContract('FSA', {
  make: () => {
    const root = new MockDir()
      .seed('.scrumit/config.yaml', 'version: 1\nproject: Contract\n')
      .seed(SEED, SEED_TEXT)
    return { source: new FsaSource(root, 'contract') }
  },
  capabilities: { canWrite: true, access: 'handle', git: 'branch' },
})

sourceContract('read-only', {
  make: () => ({
    source: new ReadOnlySource(
      [{ path: SEED, file: new File([SEED_TEXT], 'CONTRACT-1.md') }],
      'contract',
    ),
  }),
  capabilities: { canWrite: false, access: 'none', git: 'none' },
  writable: false,
})

sourceContract('HTTP', {
  make: async () => {
    const repo = mkdtempSync(join(tmpdir(), 'scrumit-contract-'))
    mkdirSync(join(repo, '.scrumit'), { recursive: true })
    mkdirSync(join(repo, 'backlog'), { recursive: true })
    mkdirSync(join(repo, '.git'), { recursive: true })
    writeFileSync(join(repo, '.scrumit/config.yaml'), 'version: 1\nproject: Contract\n')
    writeFileSync(join(repo, '.git/HEAD'), 'ref: refs/heads/contract\n')
    writeFileSync(join(repo, SEED), SEED_TEXT)
    const info = await startServer({
      repo,
      port: 0,
      token: 'contract-token',
      quiet: true,
    })
    return {
      source: new HttpSource(info.url, 'contract-token'),
      cleanup: () => info.stop(),
    }
  },
  capabilities: { canWrite: true, access: 'http', git: 'full' },
})
