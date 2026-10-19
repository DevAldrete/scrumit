import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKILL_ID = 'scrumit-sprint'

export function skillSourceDir() {
  return fileURLToPath(new URL('../../skills/scrumit-sprint/', import.meta.url))
}

function walk(dir, prefix, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) walk(join(dir, entry.name), path, out)
    else if (entry.isFile()) out.push(path)
  }
  return out
}

export function skillFiles() {
  const source = skillSourceDir()
  return walk(source, '', []).sort().map((path) => ({
    path,
    text: readFileSync(join(source, path), 'utf8'),
    mode: statSync(join(source, path)).mode & 0o777,
  }))
}

export function installSkill(root, options = {}) {
  const source = skillSourceDir()
  if (!existsSync(source)) {
    throw new Error(`Skill source not found at ${source}`)
  }
  const parent = resolve(root, options.dir ?? '.skills')
  const target = join(parent, SKILL_ID)
  const files = skillFiles()
  const written = []
  const skipped = []

  for (const file of files) {
    const destination = join(target, file.path)
    if (existsSync(destination) && !options.force) {
      skipped.push(file.path)
      continue
    }
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, file.text)
    written.push(file.path)
  }

  return {
    source,
    target,
    written,
    skipped,
    relativeTarget: relative(root, target).split(sep).join('/'),
  }
}

export function printSkill() {
  return skillFiles()
    .map((file) => `--- ${file.path} ---\n${file.text.replace(/\s*$/, '')}\n`)
    .join('\n')
}
