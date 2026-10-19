/**
 * A deliberately small front-matter reader/writer.
 *
 * The CLI runs in repositories that do not have scrumit's dependencies
 * installed, so it cannot use the app's YAML parser. The artefact format is a
 * narrow, documented subset: top-level scalar keys, inline lists, and short
 * block lists. Anything outside that subset is preserved verbatim when scrumit
 * edits a key it owns.
 *
 * The body is never re-serialised. It is a byte range, exactly as in the app.
 */

const KEY_RE = /^([A-Za-z0-9_.-]+):(.*)$/
const BULLET_RE = /^\s+-\s+(.*)$/

function stripComment(value) {
  let quote = null
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (quote) {
      if (ch === quote && value[i - 1] !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '#' && (i === 0 || /\s/.test(value[i - 1]))) {
      return value.slice(0, i).trimEnd()
    }
  }
  return value
}

function unquote(value) {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    const last = trimmed[trimmed.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      const inner = trimmed.slice(1, -1)
      if (first === '"') {
        try {
          return JSON.parse(`"${inner.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
        } catch {
          return inner
        }
      }
      return inner
    }
  }
  return trimmed
}

function splitTopLevel(inner) {
  const out = []
  let current = ''
  let quote = null
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (quote) {
      current += ch
      if (ch === quote && inner[i - 1] !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    if (ch === ',') {
      out.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim() !== '') out.push(current)
  return out
}

function splitInlineList(value) {
  return splitTopLevel(value.trim().slice(1, -1))
    .map((item) => unquote(item))
    .filter((item) => item !== '')
}

function parseInlineMap(value) {
  const inner = value.trim().slice(1, -1)
  const out = {}
  for (const part of splitTopLevel(inner)) {
    const match = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(part.trim())
    if (!match) continue
    out[match[1]] = parseScalar(match[2])
  }
  return out
}

export function parseScalar(raw) {
  const value = stripComment(raw).trim()
  if (value === '') return null
  if (value === 'null' || value === '~') return null
  if (value === 'true') return true
  if (value === 'false') return false
  if (value.startsWith('[') && value.endsWith(']')) return splitInlineList(value)
  if (value.startsWith('{') && value.endsWith('}')) return parseInlineMap(value)
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  return unquote(value)
}

export function parseFrontmatter(text) {
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : ''
  const source = bom ? text.slice(1) : text
  const opening = /^---[ \t]*\r?\n/.exec(source)
  if (!opening) {
    return {
      data: {},
      body: text,
      frontmatter: '',
      fmText: '',
      hasFrontmatter: false,
      bom,
    }
  }

  const start = opening[0].length
  let index = start
  while (index <= source.length) {
    const lineEnd = source.indexOf('\n', index)
    const end = lineEnd === -1 ? source.length : lineEnd
    const line = source.slice(index, end).replace(/\r$/, '')
    if (line.trim() === '---') {
      const bodyStart = lineEnd === -1 ? source.length : lineEnd + 1
      const fmText = source.slice(start, index)
      return {
        data: parseYamlSubset(fmText),
        body: source.slice(bodyStart),
        frontmatter: source.slice(0, bodyStart),
        fmText,
        hasFrontmatter: true,
        bom,
      }
    }
    if (lineEnd === -1) break
    index = lineEnd + 1
  }

  return {
    data: {},
    body: text,
    frontmatter: '',
    fmText: '',
    hasFrontmatter: false,
    bom,
  }
}

export function parseYamlSubset(text) {
  const lines = text.split(/\r?\n/)
  const data = {}
  let index = 0

  while (index < lines.length) {
    const raw = lines[index]
    const line = raw.replace(/\s+$/, '')
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      index++
      continue
    }
    if (/^\s/.test(line)) {
      index++
      continue
    }
    const match = KEY_RE.exec(line)
    if (!match) {
      index++
      continue
    }
    const key = match[1]
    const rest = match[2].trim()
    if (rest !== '') {
      data[key] = parseScalar(rest)
      index++
      continue
    }

    const items = []
    let nested = null
    let lookahead = index + 1
    while (lookahead < lines.length) {
      const next = lines[lookahead]
      if (next.trim() === '' || next.trimStart().startsWith('#')) {
        lookahead++
        continue
      }
      if (!/^\s/.test(next)) break
      const bullet = BULLET_RE.exec(next)
      if (bullet) {
        items.push(parseScalar(bullet[1]))
        lookahead++
        continue
      }
      const nestedMatch = /^\s+([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(next)
      if (nestedMatch) {
        nested ??= {}
        nested[nestedMatch[1]] = parseScalar(nestedMatch[2])
        lookahead++
        continue
      }
      break
    }

    if (items.length > 0) data[key] = items
    else if (nested !== null) data[key] = nested
    else data[key] = null
    index = lookahead
  }

  return data
}

export function stringifyScalar(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null || value === undefined) return 'null'
  const text = String(value)
  if (text === '') return '""'
  if (/^[A-Za-z0-9_./@+-]+$/.test(text) && !/^(true|false|null|~)$/i.test(text)) {
    return text
  }
  return JSON.stringify(text)
}

export function serializeFrontmatter(data) {
  const lines = ['---']
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      lines.push(`${key}: [${value.map(stringifyScalar).join(', ')}]`)
      continue
    }
    if (typeof value === 'object') {
      const inner = Object.entries(value)
        .filter(([, item]) => item !== null && item !== undefined)
        .map(([itemKey, item]) => `${itemKey}: ${stringifyScalar(item)}`)
        .join(', ')
      lines.push(`${key}: { ${inner} }`)
      continue
    }
    lines.push(`${key}: ${stringifyScalar(value)}`)
  }
  lines.push('---', '')
  return lines.join('\n')
}

/**
 * Set or remove top-level keys without touching anything else. Removing a key
 * also removes the block list or nested map that belongs to it.
 */
export function setKeys(text, patch) {
  const doc = parseFrontmatter(text)
  if (!doc.hasFrontmatter) {
    const data = { ...patch }
    return `${serializeFrontmatter(data)}\n${text}`
  }

  const lines = doc.fmText.split(/\r?\n/)
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  for (const [key, value] of Object.entries(patch)) {
    let found = -1
    for (let i = 0; i < lines.length; i++) {
      const match = KEY_RE.exec(lines[i])
      if (match && match[1] === key) {
        found = i
        break
      }
    }

    if (found >= 0) {
      let end = found + 1
      while (end < lines.length && (/^\s/.test(lines[end]) || lines[end].trim() === '')) {
        if (lines[end].trim() === '') break
        end++
      }
      const replacement =
        value === null || value === undefined
          ? []
          : [
              Array.isArray(value)
                ? `${key}: [${value.map(stringifyScalar).join(', ')}]`
                : `${key}: ${stringifyScalar(value)}`,
            ]
      if (Array.isArray(value) && value.length === 0) replacement.length = 0
      lines.splice(found, end - found, ...replacement)
    } else if (value !== null && value !== undefined) {
      if (Array.isArray(value) && value.length === 0) continue
      const rendered = Array.isArray(value)
        ? `${key}: [${value.map(stringifyScalar).join(', ')}]`
        : `${key}: ${stringifyScalar(value)}`
      lines.push(rendered)
    }
  }

  const body = doc.body
  const prefix = doc.bom
  return `${prefix}---\n${lines.join('\n')}\n---\n${body}`
}

export function appendBodySection(text, heading, lines) {
  const doc = parseFrontmatter(text)
  const body = doc.body
  const headingRe = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm')
  const match = headingRe.exec(body)
  let nextBody

  if (match) {
    const afterHeading = match.index + match[0].length
    const nextHeading = body.slice(afterHeading).search(/^##\s+/m)
    const insertAt = nextHeading === -1 ? body.length : afterHeading + nextHeading
    const before = body.slice(0, insertAt).replace(/\s*$/, '')
    const after = body.slice(insertAt).replace(/^\s*/, '')
    nextBody = `${before}\n\n${lines.join('\n')}\n${after ? `\n${after}` : ''}`
  } else {
    const trimmed = body.replace(/\s*$/, '')
    nextBody = `${trimmed}${trimmed === '' ? '' : '\n\n'}## ${heading}\n\n${lines.join('\n')}\n`
  }

  return `${doc.frontmatter}${nextBody}`
}

export function bodyOf(text) {
  return parseFrontmatter(text).body
}
