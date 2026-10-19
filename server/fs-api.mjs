import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  watch,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { HttpError, isReadablePath, isWritablePath, resolveInside } from './security.mjs'

/** Kept in step with `src/lib/source.ts`; a test asserts they are equal. */
export const IGNORED = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'vendor',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.venv',
  '__pycache__',
  'target',
])

export function isIgnoredPath(path) {
  return path.split('/').some((segment) => IGNORED.has(segment))
}

function walk(dir, prefix, out) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) walk(join(dir, entry.name), path, out)
    else if (entry.isFile()) out.push(path)
  }
}

export function etagFor(stat) {
  const mtime = stat.mtimeNs ?? BigInt(Math.round(Number(stat.mtimeMs) * 1e6))
  return `"${mtime}-${stat.size}"`
}

export function listFiles(rootReal) {
  const paths = []
  walk(rootReal, '', paths)
  if (existsSync(join(rootReal, '.git', 'HEAD'))) paths.push('.git/HEAD')
  paths.sort()
  return paths.map((path) => {
    try {
      const stat = statSync(join(rootReal, path), { bigint: true })
      return {
        path,
        mtime: Number(stat.mtimeMs),
        size: Number(stat.size),
        etag: etagFor(stat),
      }
    } catch {
      return { path, mtime: null, size: null, etag: null }
    }
  })
}

export function readTextFile(rootReal, relativePath) {
  const target = resolveInside(rootReal, relativePath)
  if (!isReadablePath(relativePath)) {
    throw new HttpError(403, `${relativePath} is not a readable artefact`)
  }
  if (!existsSync(target)) throw new HttpError(404, `${relativePath} not found`)
  const stat = statSync(target, { bigint: true })
  return {
    text: readFileSync(target, 'utf8'),
    etag: etagFor(stat),
    mtime: Number(stat.mtimeMs),
  }
}

export function writeTextFile(rootReal, relativePath, text, base = null) {
  const target = resolveInside(rootReal, relativePath, { write: true })
  if (!isWritablePath(relativePath)) {
    throw new HttpError(403, `${relativePath} is not a writable artefact`)
  }
  if (typeof text !== 'string') throw new HttpError(400, 'body must be text')
  const exists = existsSync(target)
  const current = exists ? statSync(target, { bigint: true }) : null
  const currentEtag = current ? etagFor(current) : null

  if (base === null || base === undefined || base === '') {
    // A missing base is a create. Overwriting an existing file requires the
    // caller to have read it, which is what stops two agents clobbering.
    if (exists) {
      throw new HttpError(409, `${relativePath} already exists`, {
        current: readFileSync(target, 'utf8'),
        etag: currentEtag,
      })
    }
  } else if (!exists || base !== currentEtag) {
    throw new HttpError(409, `${relativePath} changed on disk`, {
      current: exists ? readFileSync(target, 'utf8') : null,
      etag: currentEtag,
    })
  }

  mkdirSync(dirname(target), { recursive: true })
  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`)
  writeFileSync(temporary, text)
  renameSync(temporary, target)
  const next = statSync(target, { bigint: true })
  return { etag: etagFor(next), mtime: Number(next.mtimeMs) }
}

export function removeTextFile(rootReal, relativePath, base = null) {
  const target = resolveInside(rootReal, relativePath)
  if (!isWritablePath(relativePath)) {
    throw new HttpError(403, `${relativePath} is not a removable artefact`)
  }
  if (!existsSync(target)) throw new HttpError(404, `${relativePath} not found`)
  const stat = statSync(target, { bigint: true })
  const currentEtag = etagFor(stat)
  if (base && base !== currentEtag) {
    throw new HttpError(409, `${relativePath} changed on disk`, {
      current: readFileSync(target, 'utf8'),
      etag: currentEtag,
    })
  }
  unlinkSync(target)
}

/**
 * Watch the repository on the server. `fs.watch({ recursive: true })` is a
 * native feature on macOS and Windows and is available on current Linux Node;
 * if it is not, the server says so and the client falls back to refresh.
 */
export function watchRepo(rootReal, onChange) {
  let paths = new Set()
  let gitHead = false
  let timer = null
  let closed = false

  const flush = () => {
    timer = null
    if (closed) return
    const batch = [...paths]
    const branch = gitHead
    paths = new Set()
    gitHead = false
    if (batch.length > 0 || branch) onChange({ paths: batch, gitHead: branch })
  }

  const watcher = watch(rootReal, { recursive: true }, (_event, filename) => {
    if (!filename) return
    const path = String(filename).split('\\').join('/')
    if (path === '.git/HEAD') {
      gitHead = true
    } else if (path.startsWith('.git/')) {
      return
    } else if (isIgnoredPath(path)) {
      return
    } else {
      paths.add(path)
    }
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(flush, 120)
  })

  return () => {
    closed = true
    if (timer !== null) clearTimeout(timer)
    watcher.close()
  }
}
