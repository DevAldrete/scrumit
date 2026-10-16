import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

export interface SplitResult {
  data: Record<string, unknown>
  body: string
  hasFrontmatter: boolean
}

const FRONTMATTER = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

/**
 * Split a markdown file into YAML front-matter and body.
 *
 * The body is returned as a plain substring, never re-serialised. That is the
 * whole point: a write that only changes `status` leaves the prose — and
 * therefore the diff — byte-identical.
 */
export function splitFrontmatter(text: string): SplitResult {
  const match = FRONTMATTER.exec(text)
  if (!match) return { data: {}, body: text, hasFrontmatter: false }

  let data: Record<string, unknown> = {}
  try {
    const parsed = parseYaml(match[1])
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>
    }
  } catch {
    // Malformed front-matter: treat the whole file as a body so the user can
    // see and fix it in the editor rather than losing the file from the board.
    return { data: {}, body: text, hasFrontmatter: false }
  }

  return { data, body: text.slice(match[0].length), hasFrontmatter: true }
}

export function joinFrontmatter(
  data: Record<string, unknown>,
  body: string,
): string {
  const yaml = stringifyYaml(data, {
    lineWidth: 0,
    defaultStringType: 'PLAIN',
    defaultKeyType: 'PLAIN',
  }).trimEnd()

  const trimmed = body.replace(/^\r?\n+/, '').replace(/\s+$/, '')
  const tail = trimmed.length > 0 ? `\n\n${trimmed}\n` : '\n'
  return `---\n${yaml}\n---${tail}`
}

/** Read a string field, tolerating YAML's habit of coercing scalars. */
export function str(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.trim() === '' ? null : value
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  return null
}

export function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

export function strList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => str(v)).filter((v): v is string => v !== null)
  }
  const single = str(value)
  if (single === null) return []
  // Tolerate `labels: a, b` as well as a real YAML sequence.
  return single
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function bool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value === 'true'
  return fallback
}
