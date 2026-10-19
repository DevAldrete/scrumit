import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  openSync,
  closeSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { execFileSync } from 'node:child_process'
import { parseFrontmatter, parseYamlSubset } from './frontmatter.mjs'

export const STATUSES = ['backlog', 'todo', 'doing', 'review', 'done']
export const ISSUE_TYPES = ['story', 'bug', 'chore', 'spike']
export const EPIC_STATES = ['planned', 'active', 'done']
export const SPRINT_STATES = ['planned', 'active', 'closed']

export const IGNORED_DIRS = new Set([
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

const DEFAULT_DIRS = {
  backlog: 'backlog',
  sprints: 'sprints',
  epics: 'epics',
  archive: 'done',
}

const DEFAULT_COLUMNS = [
  { id: 'backlog', name: 'Backlog', wip: null, terminal: false, hidden: false },
  { id: 'todo', name: 'To do', wip: null, terminal: false, hidden: false },
  { id: 'doing', name: 'Doing', wip: 3, terminal: false, hidden: false },
  { id: 'review', name: 'Review', wip: 4, terminal: false, hidden: false },
  { id: 'done', name: 'Done', wip: null, terminal: true, hidden: false },
]

export function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export function slug(text, max = 48) {
  const value = String(text)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '')
  return value || 'untitled'
}

export function isMarkdown(path) {
  return path.toLowerCase().endsWith('.md')
}

export function isIgnoredPath(path) {
  return path.split('/').some((segment) => IGNORED_DIRS.has(segment))
}

export function defaultConfig() {
  return {
    version: 1,
    project: '',
    columns: DEFAULT_COLUMNS.map((column) => ({ ...column })),
    dirs: { ...DEFAULT_DIRS },
    sprintLengthDays: 14,
    ceremony: 'Planning Monday, review and retro every second Friday',
    vocabulary: { points: true, assignees: true, priorities: true },
  }
}

export function parseConfig(text) {
  const base = defaultConfig()
  let raw
  try {
    raw = parseYamlSubset(text)
  } catch {
    return base
  }
  if (!raw || typeof raw !== 'object') return base

  const asString = (value, fallback) =>
    typeof value === 'string' && value.trim() !== '' ? value : fallback
  const asNumber = (value, fallback) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback

  const dirs = raw.dirs && typeof raw.dirs === 'object' ? raw.dirs : {}
  const backlog = raw.backlog && typeof raw.backlog === 'object' ? raw.backlog : {}
  const sprints = raw.sprints && typeof raw.sprints === 'object' ? raw.sprints : {}
  const epics = raw.epics && typeof raw.epics === 'object' ? raw.epics : {}
  const archive = raw.archive && typeof raw.archive === 'object' ? raw.archive : {}

  const dirsOut = {
    backlog: asString(backlog.dir ?? dirs.backlog, base.dirs.backlog),
    sprints: asString(sprints.dir ?? dirs.sprints, base.dirs.sprints),
    epics: asString(epics.dir ?? dirs.epics, base.dirs.epics),
    archive: asString(archive.dir ?? dirs.archive, base.dirs.archive),
  }

  const columns = []
  const seen = new Set()
  if (Array.isArray(raw.columns)) {
    for (const entry of raw.columns) {
      if (!entry || typeof entry !== 'object') continue
      const id = String(entry.id ?? '')
      if (!STATUSES.includes(id) || seen.has(id)) continue
      seen.add(id)
      const fallback = DEFAULT_COLUMNS.find((column) => column.id === id)
      columns.push({
        id,
        name: asString(entry.name, fallback.name),
        wip: typeof entry.wip === 'number' ? entry.wip : null,
        terminal: entry.terminal === true || Boolean(fallback.terminal),
        hidden: entry.hidden === true,
      })
    }
  }
  for (const fallback of DEFAULT_COLUMNS) {
    if (!seen.has(fallback.id)) columns.push({ ...fallback })
  }

  const vocabulary = raw.vocabulary && typeof raw.vocabulary === 'object' ? raw.vocabulary : {}

  return {
    version: asNumber(raw.version, base.version),
    project: asString(raw.project, base.project),
    columns,
    dirs: dirsOut,
    sprintLengthDays: asNumber(sprints.length_days, base.sprintLengthDays),
    ceremony: asString(raw.ceremony, base.ceremony),
    vocabulary: {
      points: vocabulary.points !== false,
      assignees: vocabulary.assignees !== false,
      priorities: vocabulary.priorities !== false,
    },
  }
}

export function serializeConfig(config) {
  const columns = config.columns
    .map((column) => {
      const bits = [`id: ${column.id}`, `name: ${column.name}`, `wip: ${column.wip ?? 'null'}`]
      if (column.terminal) bits.push('terminal: true')
      if (column.hidden) bits.push('hidden: true')
      return `  - { ${bits.join(', ')} }`
    })
    .join('\n')

  return [
    `version: ${config.version}`,
    `project: ${config.project}`,
    'columns:',
    columns,
    `backlog: { dir: ${config.dirs.backlog} }`,
    `sprints: { dir: ${config.dirs.sprints}, length_days: ${config.sprintLengthDays} }`,
    `epics: { dir: ${config.dirs.epics} }`,
    `archive: { dir: ${config.dirs.archive} }`,
    `ceremony: ${config.ceremony}`,
    `vocabulary: { points: ${config.vocabulary.points}, assignees: ${config.vocabulary.assignees}, priorities: ${config.vocabulary.priorities} }`,
    '',
  ].join('\n')
}

export function findRepoRoot(start = process.cwd()) {
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: start,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (root) return root
  } catch {
    // Not a git repository. Fall back to the nearest scrumit board.
  }

  let current = resolve(start)
  for (;;) {
    if (existsSync(join(current, '.scrumit', 'config.yaml'))) return current
    const parent = dirname(current)
    if (parent === current) return resolve(start)
    current = parent
  }
}

export function loadConfig(root) {
  const path = join(root, '.scrumit', 'config.yaml')
  if (!existsSync(path)) return defaultConfig()
  try {
    return parseConfig(readFileSync(path, 'utf8'))
  } catch {
    return defaultConfig()
  }
}

function walk(root, dir, prefix, out) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.scrumit' && entry.name !== '.git') continue
    if (IGNORED_DIRS.has(entry.name)) continue
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      walk(root, join(dir, entry.name), path, out)
    } else if (entry.isFile()) {
      out.push(path)
    }
  }
}

export function listFiles(root) {
  const out = []
  walk(root, root, '', out)
  const head = join(root, '.git', 'HEAD')
  if (existsSync(head)) out.push('.git/HEAD')
  return out.sort()
}

function classify(path, config) {
  if (path.startsWith(`${config.dirs.epics}/`)) return 'epic'
  if (
    path.startsWith(`${config.dirs.sprints}/`) &&
    basename(path) === 'sprint.md'
  ) {
    return 'sprint'
  }
  return 'issue'
}

function parseIssue(path, text, data) {
  const id = typeof data.id === 'string' ? data.id : ''
  if (!id) return null
  const status = STATUSES.includes(data.status) ? data.status : 'backlog'
  const type = ISSUE_TYPES.includes(data.type) ? data.type : 'story'
  const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
  const list = (value) =>
    Array.isArray(value) ? value.map(String) : typeof value === 'string' ? [value] : []

  return {
    id,
    title: typeof data.title === 'string' ? data.title : id,
    status,
    type,
    epic: typeof data.epic === 'string' ? data.epic : null,
    sprint: typeof data.sprint === 'string' ? data.sprint : null,
    points: num(data.points),
    assignee: typeof data.assignee === 'string' ? data.assignee : null,
    priority: num(data.priority),
    labels: list(data.labels),
    blockedBy: list(data.blocked_by ?? data.blockedBy),
    links: list(data.links),
    order: num(data.order) ?? 0,
    created: typeof data.created === 'string' ? data.created : null,
    updated: typeof data.updated === 'string' ? data.updated : null,
    body: parseFrontmatter(text).body,
    path,
    data,
  }
}

function parseEpic(path, text, data) {
  const id = typeof data.id === 'string' ? data.id : ''
  if (!id) return null
  return {
    id,
    title: typeof data.title === 'string' ? data.title : id,
    state: EPIC_STATES.includes(data.state) ? data.state : 'planned',
    owner: typeof data.owner === 'string' ? data.owner : null,
    target: typeof data.target === 'string' ? data.target : null,
    color: typeof data.color === 'number' ? data.color : 1,
    body: parseFrontmatter(text).body.trim(),
    path,
    data,
  }
}

function parseSprint(path, text, data) {
  const folder = basename(dirname(path))
  const id = typeof data.id === 'string' ? data.id : folder
  if (!id) return null
  return {
    id,
    name: typeof data.name === 'string' ? data.name : id,
    goal: typeof data.goal === 'string' ? data.goal : '',
    start: typeof data.start === 'string' ? data.start : null,
    end: typeof data.end === 'string' ? data.end : null,
    capacity: typeof data.capacity === 'number' ? data.capacity : null,
    state: SPRINT_STATES.includes(data.state) ? data.state : 'planned',
    notes: parseFrontmatter(text).body.trim(),
    path,
    data,
  }
}

export function scan(root, config = loadConfig(root)) {
  const files = listFiles(root)
  const issues = []
  const epics = []
  const sprints = []
  const texts = new Map()
  const skipped = []

  for (const path of files) {
    if (!isMarkdown(path)) continue
    if (path.startsWith('.scrumit/')) continue
    let text
    try {
      text = readFileSync(join(root, path), 'utf8')
    } catch (error) {
      skipped.push({ path, reason: error.message })
      continue
    }
    texts.set(path, text)
    const doc = parseFrontmatter(text)
    const kind = classify(path, config)
    try {
      if (kind === 'epic') {
        const epic = parseEpic(path, text, doc.data)
        if (epic) epics.push(epic)
        else skipped.push({ path, reason: 'epic has no id' })
      } else if (kind === 'sprint') {
        const sprint = parseSprint(path, text, doc.data)
        if (sprint) sprints.push(sprint)
      } else {
        const issue = parseIssue(path, text, doc.data)
        if (issue) issues.push(issue)
      }
    } catch (error) {
      skipped.push({ path, reason: error.message })
    }
  }

  const knownSprints = new Set(sprints.map((sprint) => sprint.id))
  for (const issue of issues) {
    if (issue.sprint && !knownSprints.has(issue.sprint)) {
      knownSprints.add(issue.sprint)
      sprints.push({
        id: issue.sprint,
        name: issue.sprint,
        goal: '',
        start: null,
        end: null,
        capacity: null,
        state: 'planned',
        notes: '',
        path: null,
        data: {},
      })
    }
  }

  issues.sort((a, b) => (a.order !== b.order ? a.order - b.order : a.id.localeCompare(b.id)))
  epics.sort((a, b) => a.id.localeCompare(b.id))
  sprints.sort((a, b) => b.id.localeCompare(a.id))

  return { root, config, files, issues, epics, sprints, texts, skipped }
}

export function issuePath(issue, dirs) {
  if (issue.status === 'done') {
    return issue.sprint
      ? `${dirs.archive}/${issue.sprint}/${issue.id}.md`
      : `${dirs.archive}/${issue.id}.md`
  }
  if (issue.sprint) return `${dirs.sprints}/${issue.sprint}/${issue.id}.md`
  return `${dirs.backlog}/${issue.id}.md`
}

export function epicPath(epic, dirs) {
  if (epic.path) return epic.path
  return `${dirs.epics}/${epic.id}-${slug(epic.title)}.md`
}

export function sprintPath(sprint, dirs) {
  return `${dirs.sprints}/${sprint.id}/sprint.md`
}

export function issuePrefix(issues, project) {
  const counts = new Map()
  for (const issue of issues) {
    const match = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/.exec(issue.id)
    if (!match) continue
    const prefix = match[1].toUpperCase()
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1)
  }
  let best = null
  for (const [prefix, count] of counts) {
    if (best === null || count > counts.get(best)) best = prefix
  }
  if (best !== null) return best
  const word = String(project).trim().split(/\s+/)[0] ?? ''
  return word.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase() || 'SCRUM'
}

export function nextIssueId(issues, project) {
  const ids = issues.map((issue) => issue.id)
  const prefix = issuePrefix(issues, project)
  const pattern = new RegExp(`^${prefix}-(\\d+)$`, 'i')
  let max = 0
  for (const id of ids) {
    const match = pattern.exec(id)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `${prefix}-${max + 1}`
}

export function nextEpicId(epics) {
  let max = 0
  for (const epic of epics) {
    const match = /(\d+)/.exec(epic.id)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `EPIC-${String(max + 1).padStart(2, '0')}`
}

export function nextSprintId(sprints, year = new Date().getFullYear()) {
  let n = 1
  const ids = new Set(sprints.map((sprint) => sprint.id))
  while (ids.has(`${year}-S${String(n).padStart(2, '0')}`)) n++
  return `${year}-S${String(n).padStart(2, '0')}`
}

export function nextOrder(issues, status, excludeId = null) {
  let max = 0
  for (const issue of issues) {
    if (issue.status !== status) continue
    if (excludeId !== null && issue.id === excludeId) continue
    max = Math.max(max, issue.order)
  }
  return max + 10
}

export function repoState(root) {
  const config = loadConfig(root)
  return scan(root, config)
}

/* ------------------------------------------------------------------ claims */

function hashPath(path) {
  return createHash('sha1').update(path).digest('hex').slice(0, 12)
}

export function lockDir(root) {
  if (process.env.SCRUMIT_LOCK_DIR) return resolve(process.env.SCRUMIT_LOCK_DIR)
  let real = resolve(root)
  try {
    real = realpathSync(root)
  } catch {
    // Keep the unresolved path.
  }
  return join(tmpdir(), 'scrumit-claims', hashPath(real))
}

export function lockPath(root, id) {
  return join(lockDir(root), `${id}.json`)
}

export function readLock(root, id) {
  const path = lockPath(root, id)
  if (!existsSync(path)) return null
  try {
    const lock = JSON.parse(readFileSync(path, 'utf8'))
    return { ...lock, path }
  } catch {
    return { path, unreadable: true }
  }
}

export function lockTtlMs() {
  const raw = Number(process.env.SCRUMIT_LOCK_TTL_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 2 * 60 * 60 * 1000
}

export function lockIsStale(lock) {
  if (!lock || lock.unreadable) return true
  const at = Date.parse(lock.at ?? '')
  return !Number.isFinite(at) || Date.now() - at > lockTtlMs()
}

export function acquireLock(root, id, info, { force = false } = {}) {
  const dir = lockDir(root)
  mkdirSync(dir, { recursive: true })
  const path = lockPath(root, id)
  const payload = JSON.stringify({ ...info, at: new Date().toISOString(), pid: process.pid }, null, 2)

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = openSync(path, 'wx')
      writeFileSync(fd, payload)
      closeSync(fd)
      return { path, ...info }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const existing = readLock(root, id)
      if (force || lockIsStale(existing)) {
        try {
          unlinkSync(path)
        } catch {
          // Another process may have released it first.
        }
        continue
      }
      return { conflict: true, existing }
    }
  }
  const existing = readLock(root, id)
  return { conflict: true, existing }
}

export function releaseLock(root, id) {
  try {
    unlinkSync(lockPath(root, id))
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ git */

export function isGitRepo(root) {
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return true
  } catch {
    return false
  }
}

export function git(root, args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trimEnd()
}

export function currentBranch(root) {
  return git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
}

export function statusPorcelain(root) {
  return git(root, ['status', '--porcelain'])
}

export function isClean(root) {
  return statusPorcelain(root) === ''
}

export function commitPaths(root, paths, message) {
  const unique = [...new Set(paths)].map((path) => path.split(sep).join('/'))
  if (unique.length === 0) throw new Error('No paths to commit')

  // A `git mv` has already staged the deletion of the old path, and `git add`
  // refuses a pathspec that no longer exists. Add the paths that are present;
  // the allowed set still covers the old path for the staged-change audit.
  const present = unique.filter((path) => existsSync(join(root, path)))
  if (present.length === 0) throw new Error('Nothing to commit')
  git(root, ['add', '--', ...present])

  const staged = git(root, ['diff', '--cached', '--name-only']).split('\n').filter(Boolean)
  const allowed = new Set(unique)
  const extra = staged.filter((path) => !allowed.has(path))
  if (extra.length > 0) {
    throw new Error(
      `Refusing to commit unrelated staged paths: ${extra.join(', ')}. Unstage them first.`,
    )
  }
  if (staged.length === 0) throw new Error('Nothing to commit')
  git(root, ['commit', '-m', message])
  return git(root, ['rev-parse', 'HEAD'])
}

export function moveFile(root, oldPath, newPath) {
  if (oldPath === newPath) return
  const oldAbs = join(root, oldPath)
  const newAbs = join(root, newPath)
  mkdirSync(dirname(newAbs), { recursive: true })

  if (!existsSync(oldAbs)) return
  let tracked = false
  try {
    git(root, ['ls-files', '--error-unmatch', '--', oldPath])
    tracked = true
  } catch {
    tracked = false
  }
  if (tracked) {
    git(root, ['mv', '--', oldPath, newPath])
  } else {
    renameSync(oldAbs, newAbs)
  }
}

export function isMerged(root, branch) {
  try {
    git(root, ['rev-parse', '--verify', '--quiet', branch])
  } catch {
    return null
  }
  try {
    git(root, ['merge-base', '--is-ancestor', branch, 'HEAD'])
    return true
  } catch {
    return false
  }
}

export function worktreeFor(root, path) {
  try {
    const raw = git(root, ['worktree', 'list', '--porcelain'])
    return raw
      .split('\n\n')
      .map((block) => {
        const lines = block.split('\n')
        const worktree = lines.find((line) => line.startsWith('worktree '))?.slice(9)
        const branch = lines.find((line) => line.startsWith('branch '))?.slice(7)
        return worktree ? { path: worktree, branch } : null
      })
      .filter(Boolean)
      .find((entry) => resolve(entry.path) === resolve(path))
  } catch {
    return null
  }
}

export function repoName(root) {
  return basename(root) || 'repository'
}

export function relativePath(root, path) {
  return relative(root, path).split(sep).join('/')
}

export function homePath(path) {
  const home = homedir()
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path
}
