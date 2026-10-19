import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, dirname, resolve, sep } from 'node:path'
import { randomBytes, timingSafeEqual } from 'node:crypto'

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.extra = extra
  }
}

export function createToken() {
  return randomBytes(32).toString('hex')
}

export function tokenMatches(header, token) {
  if (typeof header !== 'string' || typeof token !== 'string' || token === '') return false
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (!match) return false
  const supplied = Buffer.from(match[1])
  const expected = Buffer.from(token)
  if (supplied.length !== expected.length) return false
  try {
    return timingSafeEqual(supplied, expected)
  } catch {
    return false
  }
}

export function repoRoot(root) {
  const real = realpathSync(root)
  return real.endsWith(sep) ? real.slice(0, -1) : real
}

/**
 * Resolve a repository-relative path and prove it stays inside the repository.
 *
 * The check walks to the nearest existing ancestor so a write can create nested
 * directories, and it realpaths that ancestor so a symlink cannot escape. For an
 * existing target, the target's own realpath is checked too.
 */
export function resolveInside(rootReal, relativePath, { write = false } = {}) {
  if (typeof relativePath !== 'string' || relativePath.trim() === '') {
    throw new HttpError(400, 'path is required')
  }
  if (relativePath.includes('\0')) throw new HttpError(400, 'path contains a null byte')
  if (isAbsolute(relativePath)) throw new HttpError(400, 'absolute paths are not allowed')
  if (relativePath.split('/').some((segment) => segment === '..' || segment === '.')) {
    throw new HttpError(400, 'path traversal is not allowed')
  }

  const target = resolve(rootReal, relativePath)
  if (target !== rootReal && !target.startsWith(`${rootReal}${sep}`)) {
    throw new HttpError(400, 'path escapes the repository')
  }

  if (existsSync(target)) {
    const realTarget = realpathSync(target)
    if (!realTarget.startsWith(`${rootReal}${sep}`) && realTarget !== rootReal) {
      throw new HttpError(403, 'path resolves outside the repository')
    }
  }

  if (write) {
    let parent = dirname(target)
    while (!existsSync(parent)) {
      const next = dirname(parent)
      if (next === parent) break
      parent = next
    }
    if (existsSync(parent)) {
      const realParent = realpathSync(parent)
      if (!realParent.startsWith(`${rootReal}${sep}`) && realParent !== rootReal) {
        throw new HttpError(403, 'path resolves outside the repository')
      }
    }
  }

  return target
}

export function isWritablePath(relativePath) {
  if (relativePath === '.scrumit/config.yaml') return true
  if (!relativePath.endsWith('.md')) return false
  const segments = relativePath.split('/')
  if (segments.includes('.git') || segments.includes('node_modules')) return false
  return true
}

export function isReadablePath(relativePath) {
  if (relativePath === '.git/HEAD') return true
  if (relativePath === '.scrumit/config.yaml') return true
  return relativePath.endsWith('.md')
}
