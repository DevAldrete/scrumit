import { defaultConfig, parseConfig } from './config.ts'
import { classify, isMarkdown, parseEpic, parseIssue, parseSprint } from './artefacts.ts'
import { validateScan, type ValidationIssue } from './validate.ts'
import type { BoardConfig, Capabilities, Epic, Issue, RepoSnapshot, Sprint } from './model.ts'

export type PermissionState = 'granted' | 'prompt' | 'denied' | 'unsupported'

export const CONFIG_PATH = '.scrumit/config.yaml'

export interface WatchEvent {
  /** Repo-relative paths that changed outside the app, already filtered. */
  paths: string[]
  /** `.git/HEAD` moved, which changes the branch but not the board. */
  gitHead: boolean
}

export type StopWatching = () => void

export interface WriteOptions {
  /**
   * The version the caller read. HTTP uses it as a concurrency check; local
   * file sources can ignore it.
   */
  base?: string | null
}

export interface RepoSource {
  readonly kind: 'fsa' | 'demo' | 'readonly' | 'http'
  /** Human-readable origin, shown in the repo switcher. */
  readonly label: string
  /** What this source can actually do. The store gates every write on it. */
  readonly capabilities: Capabilities
  /** Every file in the repo, as posix-style relative paths. */
  list(): Promise<string[]>
  read(path: string): Promise<string>
  write(path: string, text: string, options?: WriteOptions): Promise<void>
  remove(path: string, options?: WriteOptions): Promise<void>
  exists(path: string): Promise<boolean>
  permission(): Promise<PermissionState>
  request(): Promise<PermissionState>
  /**
   * Watch for changes made outside the app. Optional: only a source backed by a
   * real directory can offer it. Throws when the browser refuses, so the caller
   * can tell "not supported" from "nothing changed".
   */
  watch?(onChange: (event: WatchEvent) => void): Promise<StopWatching>
}

/** Directories worth walking past. Repos contain more than scrum. */
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

export function isIgnoredPath(path: string): boolean {
  return path.split('/').some((segment) => IGNORED_DIRS.has(segment))
}

/** Read `count` files at a time — fast on SSDs without exhausting descriptors. */
export async function mapLimit<T, R>(
  items: readonly T[],
  count: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(count, items.length) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

export interface ScanResult {
  snapshot: RepoSnapshot
  /** Markdown files that could not be read or parsed. Surfaced, never hidden. */
  skipped: { path: string; reason: string }[]
  /** Sprint ids referenced by issues but missing a sprint.md. */
  orphanSprints: string[]
  /** Artefact problems an agent-written repository tends to have. */
  validation: ValidationIssue[]
}

export async function scanRepo(
  source: RepoSource,
  repoId: string,
): Promise<ScanResult> {
  const files = await source.list()

  let config: BoardConfig = defaultConfig()
  let configFound = false
  if (files.includes(CONFIG_PATH)) {
    try {
      config = parseConfig(await source.read(CONFIG_PATH))
      configFound = true
    } catch {
      config = defaultConfig()
    }
  }

  const gitBranch = await readGitBranch(source)

  const markdown = files.filter(
    (path) => isMarkdown(path) && !path.startsWith('.scrumit/') && !isIgnoredPath(path),
  )

  const skipped: ScanResult['skipped'] = []
  const issues: Issue[] = []
  const epics: Epic[] = []
  const sprints: Sprint[] = []

  const texts = await mapLimit(markdown, 24, async (path) => {
    try {
      return { path, text: await source.read(path) }
    } catch (error) {
      skipped.push({ path, reason: describeError(error) })
      return null
    }
  })

  for (const entry of texts) {
    if (!entry) continue
    const kind = classify(entry.path, config)
    try {
      if (kind === 'epic') {
        const epic = parseEpic(entry.path, entry.text)
        if (epic) epics.push(epic)
        else skipped.push({ path: entry.path, reason: 'no id in front-matter' })
        continue
      }
      if (kind === 'sprint') {
        const sprint = parseSprint(entry.path, entry.text)
        if (sprint) sprints.push(sprint)
        continue
      }
      const issue = parseIssue(entry.path, entry.text)
      if (issue) issues.push(issue)
      // A markdown file with no `id` is just documentation. Not an error.
    } catch (error) {
      skipped.push({ path: entry.path, reason: describeError(error) })
    }
  }

  const orphanSprints: string[] = []
  const known = new Set(sprints.map((s) => s.id))
  for (const issue of issues) {
    if (issue.sprint && !known.has(issue.sprint)) {
      known.add(issue.sprint)
      orphanSprints.push(issue.sprint)
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
        extra: {},
      })
    }
  }

  issues.sort(byColumnThenOrder)
  epics.sort((a, b) => a.id.localeCompare(b.id))
  sprints.sort((a, b) => b.id.localeCompare(a.id))

  const textByPath = new Map<string, string>()
  for (const entry of texts) {
    if (entry) textByPath.set(entry.path, entry.text)
  }

  return {
    snapshot: {
      repoId,
      scannedAt: Date.now(),
      config,
      issues,
      epics,
      sprints,
      fileCount: files.length,
      stale: !configFound,
      gitBranch,
      orphanSprints,
    },
    skipped,
    orphanSprints,
    validation: validateScan({ config, issues, epics, sprints, texts: textByPath, skipped }),
  }
}

/**
 * The branch name, read straight out of `.git/HEAD`.
 *
 * This reads the file directly rather than looking for it in `list()`, because
 * the directory walk deliberately skips `.git`. scrumit does not try to
 * reproduce `git status`: a wrong dirty count is worse than none, and the
 * terminal is one keystroke away.
 */
async function readGitBranch(source: RepoSource): Promise<string | null> {
  try {
    const head = (await source.read('.git/HEAD')).trim()
    const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head)
    if (ref) return ref[1]
    return head.length >= 7 && /^[0-9a-f]+$/i.test(head) ? head.slice(0, 7) : null
  } catch {
    return null
  }
}

function byColumnThenOrder(a: Issue, b: Issue): number {
  if (a.order !== b.order) return a.order - b.order
  return a.id.localeCompare(b.id)
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** Write a file, and delete the old one when an artefact has moved. */
export async function writeAt(
  source: RepoSource,
  path: string,
  text: string,
  previousPath: string | null,
): Promise<void> {
  await source.write(path, text)
  if (previousPath && previousPath !== path) {
    try {
      await source.remove(previousPath)
    } catch {
      // The old file may already be gone; a stale duplicate is worse than none.
    }
  }
}
