import { computed, signal } from '@preact/signals'
import { AGENT_GUIDE_PATH, buildAgentGuide } from './agentGuide.ts'
import { diffSnapshots, appendChangeLog, type ChangeLogEntry, type SnapshotDiff } from './changes.ts'
import {
  overlayConflicts,
  type ConflictInfo,
} from './conflicts.ts'
import {
  newEpicId,
  newIssueId,
  serializeEpic,
  serializeIssue,
  serializeSprint,
} from './artefacts.ts'
import { defaultConfig, serializeConfig } from './config.ts'
import {
  clearDraft,
  db,
  getPref,
  listDrafts,
  listRepos,
  putRepo,
  readSnapshot,
  removeRepo,
  saveDraft,
  setPref,
  writeSnapshot,
  type DraftRecord,
  type RepoRecord,
} from './db.ts'
import { DemoSource } from './demo.ts'
import { FsaSource, fsaSupported, pickDirectory } from './fsa.ts'
import {
  ConflictError,
  HttpSource,
  ServerUnavailableError,
} from './http.ts'
import { ReadOnlySource, type ReadOnlyEntry } from './readonly.ts'
import { loadSprintSkillFiles, SPRINT_SKILL_FOLDER } from './skill.ts'
import type { ValidationIssue } from './validate.ts'
import { personHue, todayISO } from './format.ts'
import type { GitCommit, GitDiff, GitStatus } from './git.ts'
import type {
  BoardColumnSpec,
  BoardConfig,
  BoardLayout,
  Capabilities,
  Epic,
  Issue,
  RepoSnapshot,
  Sprint,
  Status,
} from './model.ts'
import {
  RESTRICTIVE_CAPABILITIES,
  resolveCapabilities,
  writeRefusalMessage,
} from './capabilities.ts'
import { boardColumns, compareOrder, countsAsSprintWip } from './metrics.ts'
import { epicPath, issuePath, sprintPath } from './paths.ts'
import {
  CONFIG_PATH,
  describeError,
  scanRepo,
  writeAt,
  type PermissionState,
  type RepoSource,
  type StopWatching,
  type WatchEvent,
} from './source.ts'

export type View = 'board' | 'backlog' | 'sprints' | 'epics' | 'metrics' | 'changes' | 'settings'
export type LoadState = 'welcome' | 'loading' | 'ready' | 'error'

export interface Filters {
  text: string
  assignee: string | null
  epic: string | null
  label: string | null
  sprint: string | null
}

/* -------------------------------------------------------------------------- */
/* State                                                                      */
/* -------------------------------------------------------------------------- */

export const view = signal<View>('board')
export const theme = signal('scrumit-light')
export const compact = signal(false)
export const layout = signal<BoardLayout>({
  columnWidth: 268,
  cardGap: 6,
  separators: true,
  cardBorders: true,
  grid: false,
})
export const repos = signal<RepoRecord[]>([])
export const activeRepo = signal<RepoRecord | null>(null)
export const permission = signal<PermissionState>('granted')
/**
 * True when the registry remembers a repo but not its directory handle, so the
 * cached board is showing and the folder must be reopened to write.
 */
export const handleLost = signal(false)

/** What the current source declares it can do, before permission is applied. */
export const sourceCapabilities = signal<Capabilities>({ ...RESTRICTIVE_CAPABILITIES })

/** The one answer the UI and every mutation consult. */
export const capabilities = computed<Capabilities>(() =>
  resolveCapabilities(sourceCapabilities.value, permission.value),
)
export const loadState = signal<LoadState>('welcome')
export const busy = signal(false)
export const saving = signal(false)
export const errorMessage = signal<string | null>(null)
export const skippedFiles = signal<{ path: string; reason: string }[]>([])
export const validation = signal<ValidationIssue[]>([])
/** Cards whose file changed on disk while the user had unsaved local text. */
export const conflicts = signal<Map<string, ConflictInfo>>(new Map())
export const drafts = signal<DraftRecord[]>([])

export const config = signal<BoardConfig>(defaultConfig())
export const issues = signal<Issue[]>([])
export const epics = signal<Epic[]>([])
export const sprints = signal<Sprint[]>([])
export const fileCount = signal(0)
export const scannedAt = signal(0)
export const gitBranch = signal<string | null>(null)
export const orphanSprints = signal<string[]>([])

export const selectedId = signal<string | null>(null)

export function select(id: string | null): void {
  selectedId.value = id
}

/** Clicking the open card closes the panel — the same gesture both ways. */
export function toggleSelected(id: string): void {
  selectedId.value = selectedId.value === id ? null : id
}

export const filters = signal<Filters>({
  text: '',
  assignee: null,
  epic: null,
  label: null,
  sprint: null,
})
export const paletteOpen = signal(false)

export interface ToastMessage {
  message: string
  kind: 'info' | 'error' | 'ok'
  /** Extra lines explaining what changed. Kept short; a toast is not a log. */
  details?: string[]
}

export const toast = signal<ToastMessage | null>(null)

/* Live filesystem watching. */
export const watching = signal(false)
export const watchNotice = signal<string | null>(null)
/** Increments each time the board was rebuilt from disk. */
export const externalUpdates = signal(0)
export const lastExternalAt = signal<number | null>(null)
/** The last 50 changes that arrived from outside the app. */
export const externalLog = signal<ChangeLogEntry[]>([])

/* Git is available only on the sidecar tier; everything here is inert otherwise. */
export const gitStatus = signal<GitStatus | null>(null)
export const gitLogEntries = signal<GitCommit[]>([])
export const gitDiff = signal<GitDiff | null>(null)
export const gitBusy = signal(false)
export const gitError = signal<string | null>(null)

let source: RepoSource | null = null

/* -------------------------------------------------------------------------- */
/* Derived                                                                    */
/* -------------------------------------------------------------------------- */

export const epicById = computed(() => new Map(epics.value.map((e) => [e.id, e])))
export const sprintById = computed(() => new Map(sprints.value.map((s) => [s.id, s])))
export const issueById = computed(() => new Map(issues.value.map((i) => [i.id, i])))
export const selectedIssue = computed(() => {
  const id = selectedId.value
  return id === null ? null : (issueById.value.get(id) ?? null)
})

export const assignees = computed(() => {
  const set = new Set<string>()
  for (const issue of issues.value) if (issue.assignee) set.add(issue.assignee)
  return [...set].sort()
})

export const allLabels = computed(() => {
  const set = new Set<string>()
  for (const issue of issues.value) for (const label of issue.labels) set.add(label)
  return [...set].sort()
})

export const visibleIssues = computed(() => {
  const f = filters.value
  const text = f.text.trim().toLowerCase()
  return issues.value.filter((issue) => {
    if (f.assignee && issue.assignee !== f.assignee) return false
    if (f.epic && issue.epic !== f.epic) return false
    // '' means "not scheduled", which is distinct from "any sprint".
    if (f.sprint === '') {
      if (issue.sprint !== null) return false
    } else if (f.sprint && issue.sprint !== f.sprint) {
      return false
    }
    if (f.label && !issue.labels.includes(f.label)) return false
    if (text) {
      const haystack =
        `${issue.id} ${issue.title} ${issue.labels.join(' ')} ${issue.body}`.toLowerCase()
      if (!haystack.includes(text)) return false
    }
    return true
  })
})

export function setFilter(patch: Partial<Filters>): void {
  filters.value = { ...filters.value, ...patch }
}

export function clearFilters(): void {
  filters.value = { text: '', assignee: null, epic: null, label: null, sprint: null }
}

/** Jump straight to a board with a sprint lens applied. */
export async function openBoardForSprint(sprint: string | null): Promise<void> {
  setFilter({ sprint })
  await setView('board')
}

export function clearExternalLog(): void {
  externalLog.value = []
}

export const board = computed(() => boardColumns(visibleIssues.value, config.value))

export const issueIds = computed(() => issues.value.map((issue) => issue.id))

export const blockedIds = computed(() => {
  const open = new Set(issues.value.filter((i) => i.status !== 'done').map((i) => i.id))
  const blocked = new Set<string>()
  for (const issue of issues.value) {
    if (issue.blockedBy.some((dep) => open.has(dep))) blocked.add(issue.id)
  }
  return blocked
})

export const filterCount = computed(() => {
  const f = filters.value
  let count = 0
  if (f.text.trim() !== '') count++
  if (f.assignee) count++
  if (f.epic) count++
  if (f.label) count++
  if (f.sprint !== null) count++
  return count
})

/* -------------------------------------------------------------------------- */
/* Feedback                                                                   */
/* -------------------------------------------------------------------------- */

let toastTimer: ReturnType<typeof setTimeout> | null = null

let lastRefusalAt = 0

/**
 * Refuse a write once, with the reason that matches the tier. Every mutation
 * calls this before it touches optimistic state, so a read-only repository never
 * shows a change it cannot save.
 */
export function refuseWrite(): false {
  const now = Date.now()
  if (now - lastRefusalAt > 4000) {
    lastRefusalAt = now
    notify(writeRefusalMessage(capabilities.value, permission.value), 'error')
  }
  return false
}

function setConflict(info: ConflictInfo): void {
  const next = new Map(conflicts.value)
  next.set(info.issueId, info)
  conflicts.value = next
}

export function clearConflict(id: string): void {
  if (!conflicts.value.has(id)) return
  const next = new Map(conflicts.value)
  next.delete(id)
  conflicts.value = next
}

export function notify(
  message: string,
  kind: 'info' | 'error' | 'ok' = 'info',
  details?: string[],
): void {
  toast.value = { message, kind, details: details?.slice(0, 4) }
  if (toastTimer !== null) clearTimeout(toastTimer)
  toastTimer = setTimeout(
    () => {
      toast.value = null
    },
    kind === 'error' ? 7000 : details && details.length > 0 ? 6500 : 4000,
  )
}

/* -------------------------------------------------------------------------- */
/* Noticing writes that were not ours                                          */
/* -------------------------------------------------------------------------- */

/**
 * Every path scrumit wrote recently, with the time it wrote it.
 *
 * The observer fires for our own saves, and a refresh triggered by our own
 * debounced write would be both pointless and disruptive mid-drag. Four seconds
 * is comfortably longer than the write debounce plus the observer's own settle
 * window, and short enough that a real external edit to the same file is still
 * noticed.
 */
const selfWrites = new Map<string, number>()
const SELF_WRITE_WINDOW = 4000

function noteSelfWrite(...paths: (string | null | undefined)[]): void {
  const now = Date.now()
  for (const path of paths) if (path) selfWrites.set(path, now)
  for (const [path, at] of selfWrites) {
    if (now - at > SELF_WRITE_WINDOW) selfWrites.delete(path)
  }
}

let stopWatch: StopWatching | null = null
let serverDownNotified = false
let externalTimer: ReturnType<typeof setTimeout> | null = null

/** The sidecar token is per origin and never stored in the repo or Dexie. */
export function serverTokenKey(url: string): string {
  return `scrumit.server.${url.replace(/\/+$/, '')}`
}
let pendingPaths = new Set<string>()
let pendingGitHead = false
/** While true, an external refresh waits: SortableJS owns the DOM mid-drag. */
let interacting = false

export function beginInteraction(): void {
  interacting = true
}

export function endInteraction(): void {
  interacting = false
}

export async function startWatching(): Promise<void> {
  stopWatching()
  const src = source
  watchNotice.value = null
  if (!src?.watch) {
    watchNotice.value =
      'This repository lives in the browser, so there is nothing to watch.'
    return
  }
  if (src instanceof HttpSource) {
    src.setConnectionListener((up, message) => {
      if (up) {
        if (serverDownNotified) notify('The local server is responding again.', 'ok')
        serverDownNotified = false
        return
      }
      if (serverDownNotified) return
      serverDownNotified = true
      notify(message || 'The local server is not responding.', 'error')
    })
  }
  try {
    stopWatch = await src.watch(queueExternal)
    watching.value = true
  } catch (error) {
    watching.value = false
    watchNotice.value = describeError(error)
  }
}

export function stopWatching(): void {
  stopWatch?.()
  stopWatch = null
  if (source instanceof HttpSource) source.setConnectionListener(null)
  serverDownNotified = false
  watching.value = false
  interacting = false
  if (externalTimer !== null) {
    clearTimeout(externalTimer)
    externalTimer = null
  }
  pendingPaths = new Set()
  pendingGitHead = false
}

function queueExternal(event: WatchEvent): void {
  let ours = 0
  for (const path of event.paths) {
    if (selfWrites.has(path)) {
      ours++
      continue
    }
    pendingPaths.add(path)
  }
  const interesting = pendingPaths.size > 0 || event.gitHead
  if (!interesting) {
    void ours
    return
  }
  pendingGitHead = pendingGitHead || event.gitHead
  if (externalTimer !== null) clearTimeout(externalTimer)
  externalTimer = setTimeout(() => {
    externalTimer = null
    void applyExternal()
  }, 260)
}

/** Re-read the repository and rebuild the board. Returns what changed. */
async function refreshFromDisk(): Promise<SnapshotDiff | null> {
  const src = source
  const repo = activeRepo.value
  if (!src || !repo) return null

  const before = snapshotOf()
  // Land anything the user is still typing first, so their edit is not
  // silently reverted by a refresh that read the file mid-keystroke.
  await flush()
  const { snapshot, skipped, validation: findings } = await scanRepo(src, repo.id)
  applySnapshot(snapshot)
  skippedFiles.value = skipped
  validation.value = findings
  await writeSnapshot(snapshot)

  externalUpdates.value += 1
  lastExternalAt.value = Date.now()
  return diffSnapshots(before, snapshot)
}

async function applyExternal(attempt = 0): Promise<void> {
  if (pendingPaths.size === 0 && !pendingGitHead) return

  if (interacting && attempt < 16) {
    // The user is mid-drag. Try again shortly rather than yanking the board.
    externalTimer = setTimeout(() => {
      externalTimer = null
      void applyExternal(attempt + 1)
    }, 220)
    return
  }

  const paths = [...pendingPaths]
  const gitHead = pendingGitHead
  pendingPaths = new Set()
  pendingGitHead = false

  try {
    const diff = await refreshFromDisk()
    if (!diff) return
    if (diff.total > 0) {
      externalLog.value = appendChangeLog(externalLog.value, diff)
      notify(diff.summary, 'ok', diff.details)
    } else if (gitHead && paths.length === 0) {
      notify(`Branch is now ${gitBranch.value ?? 'detached'}`, 'info')
    }
  } catch (error) {
    notify(`Could not refresh from disk: ${describeError(error)}`, 'error')
  }
}

/**
 * Fallback for browsers without `FileSystemObserver`: look again when the tab
 * comes back. Only fires when nothing is watching, so the two never race.
 */
export async function refreshOnReturn(hiddenForMs: number): Promise<void> {
  if (watching.value) return
  if (loadState.value !== 'ready') return
  const repo = activeRepo.value
  if (!source || !repo || repo.kind === 'demo') return
  if (hiddenForMs < 2500) return
  if (Date.now() - (lastExternalAt.value ?? 0) < 3000) return
  try {
    const diff = await refreshFromDisk()
    if (diff && diff.total > 0) {
      externalLog.value = appendChangeLog(externalLog.value, diff)
      notify(diff.summary, 'ok', diff.details)
    }
  } catch {
    // A background refresh that fails is not worth interrupting anyone over.
  }
}

function snapshotOf(): RepoSnapshot {
  return {
    repoId: activeRepo.value?.id ?? '',
    scannedAt: scannedAt.value,
    config: config.value,
    issues: issues.value,
    epics: epics.value,
    sprints: sprints.value,
    fileCount: fileCount.value,
    stale: false,
    gitBranch: gitBranch.value,
    orphanSprints: orphanSprints.value,
  }
}

/* -------------------------------------------------------------------------- */
/* Persistence queue                                                          */
/* -------------------------------------------------------------------------- */

const fileTimers = new Map<string, ReturnType<typeof setTimeout>>()
const draftTimers = new Map<string, ReturnType<typeof setTimeout>>()
let savingCount = 0

function markSaving(delta: number): void {
  savingCount = Math.max(0, savingCount + delta)
  saving.value = savingCount > 0
}

export function queueIssueWrite(id: string, delay = 900): void {
  const existing = fileTimers.get(id)
  if (existing !== undefined) clearTimeout(existing)
  fileTimers.set(
    id,
    setTimeout(() => {
      fileTimers.delete(id)
      void persistIssue(id)
    }, delay),
  )
}

function queueDraft(id: string): void {
  const existing = draftTimers.get(id)
  if (existing !== undefined) clearTimeout(existing)
  draftTimers.set(
    id,
    setTimeout(() => {
      draftTimers.delete(id)
      void persistDraft(id)
    }, 300),
  )
}

async function persistDraft(id: string): Promise<void> {
  const repo = activeRepo.value
  const issue = issues.value.find((i) => i.id === id)
  if (!repo || !issue) return
  try {
    await saveDraft({
      repoId: repo.id,
      issueId: id,
      at: Date.now(),
      title: issue.title,
      body: issue.body,
      fields: JSON.stringify({
        status: issue.status,
        type: issue.type,
        epic: issue.epic,
        sprint: issue.sprint,
        points: issue.points,
        assignee: issue.assignee,
        priority: issue.priority,
        labels: issue.labels,
        blockedBy: issue.blockedBy,
        links: issue.links,
      }),
    })
    const repo2 = activeRepo.value
    if (repo2) drafts.value = await listDrafts(repo2.id)
  } catch {
    // Drafts are a safety net, not a guarantee. Never interrupt typing for one.
  }
}

export async function persistIssue(id: string): Promise<void> {
  const src = source
  const issue = issues.value.find((i) => i.id === id)
  if (!src || !issue) return
  // The entry points explain a refusal; this is the backstop for a source that
  // lost permission while a debounced write was pending.
  if (!capabilities.value.canWrite) return

  const previousPath = issue.path
  const path = issuePath(issue, config.value.dirs)
  const text = serializeIssue({ ...issue, path })

  markSaving(1)
  try {
    await writeAt(src, path, text, previousPath)
    noteSelfWrite(path, previousPath)
    if (issue.path !== path) {
      issues.value = issues.value.map((i) => (i.id === id ? { ...i, path } : i))
    }
    await clearDraft(activeRepo.value?.id ?? '', id)
    const repo = activeRepo.value
    if (repo) drafts.value = (await listDrafts(repo.id)).filter((d) => d.issueId !== id)
  } catch (error) {
    if (error instanceof ConflictError) {
      setConflict({
        issueId: id,
        path,
        mine: text,
        theirs: error.current,
        etag: error.etag,
        at: Date.now(),
      })
      notify(
        `Could not save ${issue.id}: the file changed on disk while you were editing.`,
        'error',
      )
    } else if (error instanceof ServerUnavailableError) {
      notify(`Could not save ${issue.id}: the local server is not responding.`, 'error')
    } else {
      notify(`Could not save ${issue.id}: ${describeError(error)}`, 'error')
    }
  } finally {
    markSaving(-1)
  }
}

/**
 * Resolve a 409 honestly. There is no auto-merge: the user picks a version.
 *
 * `mine` writes the local text with the fresh ETag from the conflict, so it is
 * a deliberate overwrite rather than a blind one. `theirs` discards the local
 * text and rescans.
 */
export async function resolveConflict(
  id: string,
  choice: 'mine' | 'theirs',
): Promise<void> {
  const info = conflicts.value.get(id)
  if (!info) return
  const repo = activeRepo.value
  const issue = issues.value.find((item) => item.id === id)

  if (choice === 'theirs') {
    clearConflict(id)
    if (repo) await clearDraft(repo.id, id)
    await rescan()
    notify(`Loaded the disk version of ${id}.`, 'info')
    return
  }

  const src = source
  if (!src || !issue) {
    notify('Could not keep your version: the repository is not open.', 'error')
    return
  }

  const path = issuePath(issue, config.value.dirs)
  const text = serializeIssue({ ...issue, path })
  try {
    await src.write(path, text, { base: info.etag })
    noteSelfWrite(path, issue.path)
    if (issue.path !== path) {
      issues.value = issues.value.map((item) =>
        item.id === id ? { ...item, path } : item,
      )
    }
    clearConflict(id)
    if (repo) await clearDraft(repo.id, id)
    notify(`Kept your version of ${id}.`, 'ok')
  } catch (error) {
    if (error instanceof ConflictError) {
      setConflict({
        ...info,
        theirs: error.current,
        etag: error.etag,
        at: Date.now(),
      })
      notify('The file changed again. Compare the versions and choose again.', 'error')
    } else {
      notify(describeError(error), 'error')
    }
  }
}

/** Write everything still pending. Called on blur, hide and unload. */
export async function flush(): Promise<void> {
  const ids = new Set([...fileTimers.keys(), ...draftTimers.keys()])
  for (const id of ids) {
    const timer = fileTimers.get(id)
    if (timer !== undefined) clearTimeout(timer)
    fileTimers.delete(id)
    const draftTimer = draftTimers.get(id)
    if (draftTimer !== undefined) clearTimeout(draftTimer)
    draftTimers.delete(id)
  }
  // A conflicted card is not retried: the user has to choose a version.
  const writable = [...ids].filter((id) => !conflicts.value.has(id))
  await Promise.all(writable.map((id) => persistIssue(id)))
}

/* -------------------------------------------------------------------------- */
/* Loading                                                                    */
/* -------------------------------------------------------------------------- */

function applySnapshot(snapshot: RepoSnapshot): void {
  config.value = snapshot.config
  issues.value = overlayConflicts(
    snapshot.issues,
    issues.value,
    conflicts.value.keys(),
  )
  epics.value = snapshot.epics
  sprints.value = snapshot.sprints
  fileCount.value = snapshot.fileCount
  scannedAt.value = snapshot.scannedAt
  gitBranch.value = snapshot.gitBranch
  orphanSprints.value = snapshot.orphanSprints ?? []
  const id = selectedId.value
  if (id !== null && !snapshot.issues.some((i) => i.id === id)) selectedId.value = null
}

export async function refreshRepos(): Promise<void> {
  repos.value = await listRepos()
}

export interface OpenOptions {
  /** True when the call is inside a click handler and may raise a prompt. */
  gesture?: boolean
  /** Supply the source directly (read-only fixtures and tests). */
  source?: RepoSource
  /** Do not register this repo in the switcher or preferences. */
  transient?: boolean
}

export async function openRepo(record: RepoRecord, options: OpenOptions = {}): Promise<void> {
  loadState.value = 'loading'
  errorMessage.value = null
  serverDownNotified = false
  conflicts.value = new Map()
  gitStatus.value = null
  gitLogEntries.value = []
  gitDiff.value = null
  gitError.value = null
  try {
    if (options.source) {
      // Read-only fixtures and tests hand scrumit a source directly. It is not
      // registered in the switcher unless the caller asks for that.
      const supplied = options.source
      source = supplied
      sourceCapabilities.value = supplied.capabilities
      permission.value = 'granted'
      handleLost.value = false
      activeRepo.value = record
      await rescan()
      drafts.value = []
      if (!options.transient) {
        const updated = { ...record, lastOpenedAt: Date.now() }
        activeRepo.value = updated
        await putRepo(updated)
        await setPref('activeRepoId', record.id)
        await refreshRepos()
        await startWatching()
      }
      return
    }

    let next: RepoSource
    if (record.kind === 'demo') {
      next = await DemoSource.load()
      sourceCapabilities.value = next.capabilities
      permission.value = 'granted'
    } else if (record.kind === 'http') {
      const url = record.serverUrl
      const token = url ? localStorage.getItem(serverTokenKey(url)) : null
      if (!url || !token) {
        throw new Error('Connect to the local server again; its token is missing.')
      }
      const http = new HttpSource(url, token)
      try {
        const health = await http.health()
        http.applyCapabilities(health.capabilities)
      } catch {
        // The watch listener reports the outage once; keep the tier otherwise.
      }
      sourceCapabilities.value = http.capabilities
      permission.value = 'granted'
      next = http
    } else {
      if (!record.handle) {
        // The registry knows the repo but not its handle. Show the cached board
        // read-only, or send the user back to pick the folder again.
        stopWatching()
        source = null
        sourceCapabilities.value = {
          canWrite: false,
          canWatch: false,
          access: 'handle',
          git: 'branch',
        }
        const cached = await readSnapshot(record.id)
        if (cached) {
          handleLost.value = true
          permission.value = 'denied'
          activeRepo.value = { ...record, handlePersisted: false }
          applySnapshot(cached)
          validation.value = []
          loadState.value = 'ready'
        } else {
          handleLost.value = false
          activeRepo.value = null
          loadState.value = 'welcome'
          notify('This browser cannot remember this folder. Open it again to continue.', 'error')
        }
        return
      }
      const fsa = new FsaSource(record.handle, record.path || record.name)
      sourceCapabilities.value = fsa.capabilities
      let state = await fsa.permission()
      if (state !== 'granted' && options.gesture) state = await fsa.request()
      permission.value = state
      if (state !== 'granted') {
        // Show the cached view read-only rather than an empty board.
        stopWatching()
        source = null
        handleLost.value = false
        activeRepo.value = record
        const cached = await readSnapshot(record.id)
        if (cached) applySnapshot(cached)
        validation.value = []
        loadState.value = 'ready'
        return
      }
      next = fsa
    }

    source = next
    sourceCapabilities.value = next.capabilities
    activeRepo.value = record
    permission.value = 'granted'
    handleLost.value = false
    await rescan()
    drafts.value = await listDrafts(record.id)

    const updated = { ...record, lastOpenedAt: Date.now() }
    activeRepo.value = updated
    await putRepo(updated)
    await setPref('activeRepoId', record.id)
    await refreshRepos()
    await startWatching()
  } catch (error) {
    errorMessage.value = describeError(error)
    loadState.value = 'error'
  }
}

export async function reconnect(): Promise<void> {
  const record = activeRepo.value
  if (!record) return
  // A handle the browser refused to clone cannot be re-granted; the only way
  // forward is to pick the folder again.
  if (record.kind === 'fsa' && (!record.handle || handleLost.value)) {
    await addLocalRepo()
    return
  }
  await openRepo(record, { gesture: true })
}

export async function rescan(): Promise<void> {
  const src = source
  const repo = activeRepo.value
  if (!src || !repo) return
  loadState.value = 'loading'
  try {
    const { snapshot, skipped, validation: findings } = await scanRepo(src, repo.id)
    applySnapshot(snapshot)
    skippedFiles.value = skipped
    validation.value = findings
    await writeSnapshot(snapshot)
    loadState.value = 'ready'
  } catch (error) {
    const cached = await readSnapshot(repo.id)
    if (cached) {
      applySnapshot(cached)
      validation.value = []
      notify('Rescan failed — showing the last saved view.', 'error')
    }
    errorMessage.value = describeError(error)
    loadState.value = 'error'
  }
}

export async function addLocalRepo(): Promise<void> {
  if (!fsaSupported()) {
    notify('This browser cannot open local folders. Use the demo repo instead.', 'error')
    return
  }
  const handle = await pickDirectory()
  if (!handle) return
  const id = crypto.randomUUID()
  const record: RepoRecord = {
    id,
    name: handle.name,
    path: handle.name,
    kind: 'fsa',
    color: personHue(handle.name),
    createdAt: Date.now(),
    lastOpenedAt: Date.now(),
    handle,
  }
  const saved = await putRepo(record)
  await refreshRepos()
  await openRepo(record, { gesture: true })
  notify(
    `Opened ${handle.name}`,
    'ok',
    saved.handlePersisted === false
      ? ['This browser cannot remember the folder — you will need to open it again next session.']
      : undefined,
  )
}

/**
 * Open a folder the browser can only read. This is the Safari/Firefox path:
 * the board and every artefact are real, but mutations are refused by the same
 * capability guard as any other read-only source.
 */
export async function openReadOnlyRepo(
  entries: readonly ReadOnlyEntry[],
  name: string,
): Promise<void> {
  if (entries.length === 0) {
    notify('That folder has no readable files.', 'error')
    return
  }
  const src = new ReadOnlySource(entries, name)
  const record: RepoRecord = {
    id: `readonly-${crypto.randomUUID()}`,
    name,
    path: name,
    kind: 'readonly',
    color: personHue(name),
    createdAt: Date.now(),
    lastOpenedAt: Date.now(),
    handlePersisted: false,
  }
  await openRepo(record, { source: src, transient: true })
  notify(`Opened ${name} read-only`, 'info')
}

/**
 * Connect to a running sidecar. The health check happens before the repo is
 * registered, so a wrong URL or token fails without leaving a broken entry in
 * the switcher.
 */
export async function connectToServer(url: string, token: string): Promise<void> {
  const base = url.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(base)) {
    throw new Error('The server URL must start with http:// or https://.')
  }
  const src = new HttpSource(base, token)
  const health = await src.health()
  src.applyCapabilities(health.capabilities)
  localStorage.setItem(serverTokenKey(base), token)
  const name = health.repo.split(/[\\/]/).filter(Boolean).pop() ?? 'Local server'
  const record: RepoRecord = {
    id: `http-${crypto.randomUUID()}`,
    name,
    path: health.repo,
    kind: 'http',
    color: personHue(name),
    createdAt: Date.now(),
    lastOpenedAt: Date.now(),
    serverUrl: base,
  }
  await openRepo(record, { source: src })
  notify(`Connected to ${name}`, 'ok')
}

/**
 * Test seam. A native directory picker cannot be driven by an automated browser,
 * so the suite hands scrumit a handle built over the Origin Private File System
 * instead — which is a real `FileSystemDirectoryHandle`, so the whole File
 * System Access path including watching is exercised for real. The reference to
 * this function is behind an `import.meta.env.DEV` guard and is dropped from
 * production builds.
 */
export async function openHandleAsRepo(
  handle: FileSystemDirectoryHandle,
  name: string,
): Promise<void> {
  const id = crypto.randomUUID()
  const record: RepoRecord = {
    id,
    name,
    path: name,
    kind: 'fsa',
    color: personHue(name),
    createdAt: Date.now(),
    lastOpenedAt: Date.now(),
    handle,
  }
  const saved = await putRepo(record)
  await refreshRepos()
  await openRepo(record)
  if (saved.handlePersisted === false) {
    notify(
      'This browser cannot remember the folder — you will need to open it again next session.',
      'info',
    )
  }
}

export async function openDemo(): Promise<void> {
  const existing = repos.value.find((r) => r.kind === 'demo')
  const record: RepoRecord =
    existing ?? {
      id: 'demo-acme',
      name: 'Acme Payments Platform',
      path: 'demo://acme-payments',
      kind: 'demo',
      color: 3,
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
    }
  const fresh = { ...record, lastOpenedAt: Date.now() }
  await putRepo(fresh)
  await refreshRepos()
  await openRepo(fresh)
}

export async function resetDemo(): Promise<void> {
  if (!capabilities.value.canWrite) {
    refuseWrite()
    return
  }
  await DemoSource.reset()
  await rescan()
  notify('Demo repo restored to its original state.', 'ok')
}

export async function closeRepo(): Promise<void> {
  await flush()
  stopWatching()
  source = null
  sourceCapabilities.value = { ...RESTRICTIVE_CAPABILITIES }
  handleLost.value = false
  activeRepo.value = null
  validation.value = []
  conflicts.value = new Map()
  gitStatus.value = null
  gitLogEntries.value = []
  gitDiff.value = null
  gitError.value = null
  issues.value = []
  epics.value = []
  sprints.value = []
  config.value = defaultConfig()
  selectedId.value = null
  drafts.value = []
  loadState.value = 'welcome'
  await setPref('activeRepoId', null)
}

export async function forgetRepo(id: string): Promise<void> {
  await removeRepo(id)
  if (activeRepo.value?.id === id) await closeRepo()
  await refreshRepos()
}

/**
 * Write the agent guide into the repository, generated from the live board so an
 * agent knows this repo's real ids, folders and next issue number.
 */
export async function writeAgentGuide(): Promise<void> {
  const src = source
  const repo = activeRepo.value
  if (!src || !repo) return
  if (!capabilities.value.canWrite) {
    refuseWrite()
    return
  }
  try {
    const guide = await buildAgentGuide({
      repoName: repo.name,
      config: config.value,
      issues: issues.value,
      epics: epics.value,
      sprints: sprints.value,
    })
    await src.write(AGENT_GUIDE_PATH, guide)
    noteSelfWrite(AGENT_GUIDE_PATH)
    notify(`Wrote ${AGENT_GUIDE_PATH}`, 'ok')
    await rescan()
  } catch (error) {
    notify(describeError(error), 'error')
  }
}

/**
 * Write the agent skill into the repository, so a checkout can use it without
 * running the CLI first. The target mirrors the default of
 * `scrumit skill install`: `.skills/scrumit-sprint/`.
 */
export async function writeAgentSkill(targetDir = '.skills'): Promise<void> {
  const src = source
  const repo = activeRepo.value
  if (!src || !repo) return
  if (!capabilities.value.canWrite) {
    refuseWrite()
    return
  }
  const base = targetDir.replace(/\/+$/, '')
  if (base === '') {
    notify('Choose a folder for the skill.', 'error')
    return
  }
  try {
    const files = await loadSprintSkillFiles()
    for (const file of files) {
      const path = `${base}/${SPRINT_SKILL_FOLDER}/${file.path}`
      await src.write(path, file.text)
      noteSelfWrite(path)
    }
    notify(`Wrote ${files.length} files to ${base}/${SPRINT_SKILL_FOLDER}`, 'ok')
  } catch (error) {
    notify(describeError(error), 'error')
  }
}

/** Write a starter `.scrumit/config.yaml` into a repo that has none. */
export async function initialiseRepo(): Promise<void> {
  const src = source
  if (!src) return
  if (!capabilities.value.canWrite) {
    refuseWrite()
    return
  }
  try {
    await src.write(CONFIG_PATH, serializeConfig({ ...defaultConfig(), project: activeRepo.value?.name ?? '' }))
    noteSelfWrite(CONFIG_PATH)
    notify('Wrote .scrumit/config.yaml', 'ok')
    await rescan()
  } catch (error) {
    notify(describeError(error), 'error')
  }
}


/* -------------------------------------------------------------------------- */
/* Issue actions                                                              */
/* -------------------------------------------------------------------------- */

function nextOrder(status: Status, excludeId?: string): number {
  const column = issues.value
    .filter((i) => i.status === status && i.id !== excludeId)
    .sort(compareOrder)
  const last = column[column.length - 1]
  return last ? last.order + 10 : 10
}

/** The message to show when a move would break a hard column limit. */
function columnHardLimit(status: Status, excludeId?: string): string | null {
  const column = config.value.columns.find((item) => item.id === status)
  if (!column || column.wip === null) return null
  const count = issues.value.filter(
    (issue) => issue.status === status && issue.id !== excludeId,
  ).length
  if (count < column.wip) return null
  return `${column.name} is at its hard WIP limit (${column.wip}). Move or finish something first.`
}

/** The message to show when a move would break a hard sprint WIP limit. */
function sprintHardLimit(
  sprintId: string | null,
  nextStatus: Status,
  current?: Issue,
): string | null {
  if (!sprintId) return null
  const sprint = sprints.value.find((item) => item.id === sprintId)
  if (!sprint || sprint.wipHard == null) return null
  if (!countsAsSprintWip(nextStatus, config.value)) return null
  const alreadyCounted =
    current !== undefined &&
    current.sprint === sprintId &&
    countsAsSprintWip(current.status, config.value)
  if (alreadyCounted) return null
  const count = issues.value.filter(
    (issue) =>
      issue.sprint === sprintId &&
      issue.id !== current?.id &&
      countsAsSprintWip(issue.status, config.value),
  ).length
  if (count < sprint.wipHard) return null
  return `${sprint.name} is at its hard WIP limit (${sprint.wipHard}). Finish or move work out first.`
}

function denyWip(message: string | null): boolean {
  if (message === null) return false
  notify(message, 'error')
  return true
}

export interface NewIssueInput {
  title: string
  status: Status
  type?: Issue['type']
  epic?: string | null
  sprint?: string | null
  points?: number | null
  assignee?: string | null
  priority?: Issue['priority']
  labels?: string[]
  body?: string
}

export async function createIssue(input: NewIssueInput): Promise<Issue | null> {
  const src = source
  if (!src) return null
  if (!capabilities.value.canWrite) {
    refuseWrite()
    return null
  }
  if (
    denyWip(columnHardLimit(input.status)) ||
    denyWip(sprintHardLimit(input.sprint ?? null, input.status))
  ) {
    return null
  }
  const id = newIssueId(
    issues.value.map((i) => i.id),
    config.value.project,
  )
  const draft: Issue = {
    id,
    title: input.title,
    status: input.status,
    type: input.type ?? 'story',
    epic: input.epic ?? null,
    sprint: input.sprint ?? null,
    points: input.points ?? null,
    assignee: input.assignee ?? null,
    priority: input.priority ?? null,
    labels: input.labels ?? [],
    blockedBy: [],
    links: [],
    order: nextOrder(input.status),
    created: todayISO(),
    updated: todayISO(),
    body: input.body ?? '\n',
    path: null,
    extra: {},
  }
  draft.path = issuePath(draft, config.value.dirs)
  try {
    await src.write(draft.path, serializeIssue(draft))
    noteSelfWrite(draft.path)
    issues.value = [...issues.value, draft]
    selectedId.value = draft.id
    notify(`Created ${draft.id}`, 'ok')
    return draft
  } catch (error) {
    notify(describeError(error), 'error')
    return null
  }
}

export function patchIssue(id: string, patch: Partial<Issue>, immediate = false): void {
  if (!capabilities.value.canWrite) {
    refuseWrite()
    return
  }
  const existing = issues.value.find((i) => i.id === id)
  if (!existing) return
  const next: Issue = { ...existing, ...patch, updated: todayISO() }
  if (patch.status !== undefined && patch.status !== existing.status) {
    if (denyWip(columnHardLimit(patch.status, id))) return
    if (denyWip(sprintHardLimit(next.sprint, next.status, existing))) return
  } else if (patch.sprint !== undefined && patch.sprint !== existing.sprint) {
    if (denyWip(sprintHardLimit(next.sprint, next.status, existing))) return
  }
  issues.value = issues.value.map((i) => (i.id === id ? next : i))
  queueDraft(id)
  queueIssueWrite(id, immediate ? 0 : 900)
}

export async function deleteIssue(id: string): Promise<void> {
  if (!capabilities.value.canWrite) {
    refuseWrite()
    return
  }
  const issue = issues.value.find((i) => i.id === id)
  if (!issue) return
  if (issue.path && source) {
    try {
      await source.remove(issue.path)
      noteSelfWrite(issue.path)
    } catch (error) {
      notify(describeError(error), 'error')
      return
    }
  }
  issues.value = issues.value.filter((i) => i.id !== id)
  if (selectedId.value === id) selectedId.value = null
  await clearDraft(activeRepo.value?.id ?? '', id)
  notify(`Deleted ${id}`, 'info')
}

/**
 * Drop an issue into a column at a position. Uses midpoint ordering so a drag
 * normally rewrites exactly one file; only when the gap closes do we renumber
 * the column.
 */
export async function moveIssue(id: string, toStatus: Status, toIndex: number): Promise<void> {
  if (!capabilities.value.canWrite) {
    refuseWrite()
    return
  }
  const moving = issues.value.find((i) => i.id === id)
  if (!moving) return

  if (moving.status !== toStatus) {
    if (denyWip(columnHardLimit(toStatus, id))) return
    if (denyWip(sprintHardLimit(moving.sprint, toStatus, moving))) return
  }

  const target = issues.value
    .filter((i) => i.status === toStatus && i.id !== id)
    .sort(compareOrder)
  const index = Math.min(Math.max(toIndex, 0), target.length)

  const before = target[index - 1]?.order
  const after = target[index]?.order
  const orders = new Map<string, number>()

  if (before === undefined && after === undefined) {
    orders.set(id, 10)
  } else if (before === undefined) {
    orders.set(id, after! - 10)
  } else if (after === undefined) {
    orders.set(id, before + 10)
  } else if (after - before > 1.5) {
    orders.set(id, Math.round(((before + after) / 2) * 100) / 100)
  } else {
    const ordered = [...target.slice(0, index), moving, ...target.slice(index)]
    for (let position = 0; position < ordered.length; position++) {
      const issue = ordered[position]
      const next = (position + 1) * 10
      if (issue.order !== next) orders.set(issue.id, next)
    }
    if (!orders.has(id)) orders.set(id, (index + 1) * 10)
  }

  const touched: string[] = []
  issues.value = issues.value.map((issue) => {
    const order = orders.get(issue.id)
    const isMoving = issue.id === id
    if (order === undefined && !isMoving) return issue
    touched.push(issue.id)
    return {
      ...issue,
      status: isMoving ? toStatus : issue.status,
      order: order ?? issue.order,
      updated: isMoving ? todayISO() : issue.updated,
    }
  })

  await Promise.all(touched.map((issueId) => persistIssue(issueId)))
}

/* -------------------------------------------------------------------------- */
/* Config actions                                                             */
/* -------------------------------------------------------------------------- */

export function patchConfig(patch: Partial<BoardConfig>): void {
  if (!capabilities.value.canWrite) {
    refuseWrite()
    return
  }
  config.value = { ...config.value, ...patch }
  void persistConfig()
}

export function patchColumn(id: Status, patch: Partial<BoardColumnSpec>): void {
  if (!capabilities.value.canWrite) {
    refuseWrite()
    return
  }
  config.value = {
    ...config.value,
    columns: config.value.columns.map((column) =>
      column.id === id ? { ...column, ...patch } : column,
    ),
  }
  void persistConfig()
}

export function moveColumn(id: Status, direction: -1 | 1): void {
  if (!capabilities.value.canWrite) {
    refuseWrite()
    return
  }
  const columns = config.value.columns.slice()
  const index = columns.findIndex((column) => column.id === id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= columns.length) return
  const [moved] = columns.splice(index, 1)
  columns.splice(target, 0, moved)
  config.value = { ...config.value, columns }
  void persistConfig()
}

export async function persistConfig(): Promise<void> {
  const src = source
  if (!src) return
  if (!capabilities.value.canWrite) return
  markSaving(1)
  try {
    await src.write(CONFIG_PATH, serializeConfig(config.value))
    noteSelfWrite(CONFIG_PATH)
  } catch (error) {
    notify(`Could not write config.yaml: ${describeError(error)}`, 'error')
  } finally {
    markSaving(-1)
  }
}

/* -------------------------------------------------------------------------- */
/* Epic and sprint actions                                                    */
/* -------------------------------------------------------------------------- */

export async function createEpic(title: string): Promise<Epic | null> {
  const src = source
  if (!src) return null
  if (!capabilities.value.canWrite) {
    refuseWrite()
    return null
  }
  const epic: Epic = {
    id: newEpicId(epics.value.map((e) => e.id)),
    title,
    state: 'planned',
    owner: null,
    target: null,
    color: (epics.value.length % 8) + 1,
    description: '',
    path: null,
    extra: {},
  }
  epic.path = epicPath(epic, config.value.dirs)
  try {
    await src.write(epic.path, serializeEpic(epic))
    noteSelfWrite(epic.path)
    epics.value = [...epics.value, epic]
    notify(`Created ${epic.id}`, 'ok')
    return epic
  } catch (error) {
    notify(describeError(error), 'error')
    return null
  }
}

export function patchEpic(id: string, patch: Partial<Epic>): void {
  if (!capabilities.value.canWrite) {
    refuseWrite()
    return
  }
  const existing = epics.value.find((e) => e.id === id)
  if (!existing) return
  const next = { ...existing, ...patch }
  epics.value = epics.value.map((e) => (e.id === id ? next : e))
  void persistEpic(next)
}

export async function persistEpic(epic: Epic): Promise<void> {
  const src = source
  if (!src) return
  if (!capabilities.value.canWrite) return
  const path = epicPath(epic, config.value.dirs)
  markSaving(1)
  try {
    await src.write(path, serializeEpic(epic))
    noteSelfWrite(path, epic.path)
    if (epic.path && epic.path !== path) {
      try {
        await src.remove(epic.path)
      } catch {
        /* already gone */
      }
    }
    if (epic.path !== path) {
      epics.value = epics.value.map((e) => (e.id === epic.id ? { ...e, path } : e))
    }
  } catch (error) {
    notify(`Could not save ${epic.id}: ${describeError(error)}`, 'error')
  } finally {
    markSaving(-1)
  }
}

export function patchSprint(id: string, patch: Partial<Sprint>): void {
  if (!capabilities.value.canWrite) {
    refuseWrite()
    return
  }
  const existing = sprints.value.find((s) => s.id === id)
  if (!existing) return
  const next = { ...existing, ...patch }
  sprints.value = sprints.value.map((s) => (s.id === id ? next : s))
  void persistSprint(next)
}

export async function persistSprint(sprint: Sprint): Promise<void> {
  const src = source
  if (!src) return
  if (!capabilities.value.canWrite) return
  const path = sprintPath(sprint, config.value.dirs)
  markSaving(1)
  try {
    await src.write(path, serializeSprint(sprint))
    noteSelfWrite(path)
    if (sprint.path !== path) {
      sprints.value = sprints.value.map((s) => (s.id === sprint.id ? { ...s, path } : s))
    }
  } catch (error) {
    notify(`Could not save ${sprint.id}: ${describeError(error)}`, 'error')
  } finally {
    markSaving(-1)
  }
}

export async function createSprint(): Promise<Sprint | null> {
  const src = source
  if (!src) return null
  if (!capabilities.value.canWrite) {
    refuseWrite()
    return null
  }
  const year = new Date().getFullYear()
  let n = 1
  while (sprints.value.some((s) => s.id === `${year}-S${String(n).padStart(2, '0')}`)) n++
  const id = `${year}-S${String(n).padStart(2, '0')}`
  const start = todayISO()
  const end = new Date(Date.parse(`${start}T00:00:00Z`) + config.value.sprintLengthDays * 86_400_000)
    .toISOString()
    .slice(0, 10)
  const sprint: Sprint = {
    id,
    name: `Sprint ${n}`,
    goal: '',
    start,
    end,
    capacity: null,
    wipSoft: null,
    wipHard: null,
    state: 'planned',
    notes: '',
    path: null,
    extra: {},
  }
  sprint.path = sprintPath(sprint, config.value.dirs)
  try {
    await src.write(sprint.path, serializeSprint(sprint))
    noteSelfWrite(sprint.path)
    sprints.value = [...sprints.value, sprint]
    notify(`Created ${sprint.name}`, 'ok')
    return sprint
  } catch (error) {
    notify(describeError(error), 'error')
    return null
  }
}

export async function assignToSprint(issueIds: string[], sprintId: string | null): Promise<void> {
  if (!capabilities.value.canWrite) {
    refuseWrite()
    return
  }
  const sprint = sprintId ? sprints.value.find((item) => item.id === sprintId) : null
  if (sprint && sprint.wipHard != null) {
    const moving = new Set(issueIds)
    const already = issues.value.filter(
      (issue) =>
        issue.sprint === sprintId &&
        !moving.has(issue.id) &&
        countsAsSprintWip(issue.status, config.value),
    ).length
    const incoming = issueIds.filter((id) => {
      const issue = issues.value.find((item) => item.id === id)
      if (!issue || !countsAsSprintWip(issue.status, config.value)) return false
      return !(issue.sprint === sprintId)
    }).length
    if (already + incoming > sprint.wipHard) {
      notify(
        `${sprint.name} is at its hard WIP limit (${sprint.wipHard}). Finish or move work out first.`,
        'error',
      )
      return
    }
  }
  for (const id of issueIds) patchIssue(id, { sprint: sprintId }, true)
  await Promise.all(issueIds.map((id) => persistIssue(id)))
  notify(
    sprintId === null
      ? `Moved ${issueIds.length} to the backlog`
      : `Scheduled ${issueIds.length} into ${sprintId}`,
    'ok',
  )
}

export async function setStatuses(
  ids: string[],
  status: Status,
): Promise<void> {
  if (!capabilities.value.canWrite) {
    refuseWrite()
    return
  }
  const column = config.value.columns.find((item) => item.id === status)
  if (column && column.wip !== null) {
    const selected = new Set(ids)
    const already = issues.value.filter(
      (issue) => issue.status === status && !selected.has(issue.id),
    ).length
    if (already + ids.length > column.wip) {
      notify(
        `${column.name} is at its hard WIP limit (${column.wip}). Move or finish something first.`,
        'error',
      )
      return
    }
  }
  for (const id of ids) patchIssue(id, { status, order: nextOrder(status, id) }, true)
  await Promise.all(ids.map((id) => persistIssue(id)))
}

/* -------------------------------------------------------------------------- */
/* Git                                                                        */
/* -------------------------------------------------------------------------- */

export async function loadGit(): Promise<void> {
  const src = source
  gitError.value = null
  if (!src?.gitStatus) {
    gitStatus.value = null
    gitLogEntries.value = []
    gitDiff.value = null
    return
  }
  gitBusy.value = true
  try {
    const [status, log] = await Promise.all([
      src.gitStatus(),
      src.gitLog ? src.gitLog(5) : Promise.resolve([]),
    ])
    gitStatus.value = status
    gitLogEntries.value = log
    if (gitDiff.value && !status.changes.some((change) => change.path === gitDiff.value?.path)) {
      gitDiff.value = null
    }
  } catch (error) {
    gitError.value = describeError(error)
  } finally {
    gitBusy.value = false
  }
}

export async function loadGitDiff(path: string): Promise<void> {
  const src = source
  if (!src?.gitDiff) return
  gitBusy.value = true
  try {
    gitDiff.value = await src.gitDiff(path)
  } catch (error) {
    gitError.value = describeError(error)
  } finally {
    gitBusy.value = false
  }
}

/** Commit exactly the paths the user selected — never the whole tree. */
export async function commitPaths(message: string, paths: string[]): Promise<boolean> {
  const src = source
  if (!src?.gitCommit) {
    notify('Committing is available when the repository is opened through `scrumit serve`.', 'error')
    return false
  }
  if (!capabilities.value.canWrite) {
    refuseWrite()
    return false
  }
  if (message.trim() === '' || paths.length === 0) return false
  gitBusy.value = true
  gitError.value = null
  try {
    const result = await src.gitCommit(message.trim(), paths)
    notify(`Committed ${result.short}.`, 'ok')
    await loadGit()
    return true
  } catch (error) {
    const text = describeError(error)
    gitError.value = text
    notify(`Could not commit: ${text}`, 'error')
    return false
  } finally {
    gitBusy.value = false
  }
}

/* -------------------------------------------------------------------------- */
/* Preferences                                                                */
/* -------------------------------------------------------------------------- */

const THEMES = [
  'scrumit-light',
  'scrumit-dark',
  'catppuccin-latte',
  'catppuccin-frappe',
  'catppuccin-macchiato',
  'catppuccin-mocha',
  'kanagawa-lotus',
  'kanagawa-wave',
  'kanagawa-dragon',
  'gruvbox-light',
  'gruvbox-dark',
  'gruvbox-material',
  'everforest-light',
  'everforest-dark',
  'nord',
  'tokyo-night',
  'rose-pine',
  'rose-pine-moon',
  'rose-pine-dawn',
  'solarized-light',
  'solarized-dark',
  'one-light',
  'one-dark',
]

export const themeList = THEMES

export function applyTheme(name: string): void {
  theme.value = name
  document.documentElement.dataset.theme = name
}

export async function setTheme(name: string): Promise<void> {
  applyTheme(name)
  await setPref('theme', name)
}

export async function toggleCompact(): Promise<void> {
  compact.value = !compact.value
  await setPref('compact', compact.value)
}

export async function patchLayout(patch: Partial<BoardLayout>): Promise<void> {
  layout.value = { ...layout.value, ...patch }
  await setPref('layout', layout.value)
}

/** Set the board view to a sprint and keep the scope visible in the filter bar. */
export function applyLocation(): void {
  const params = new URLSearchParams(window.location.search)
  const sprint = params.get('sprint')
  if (sprint !== null) {
    setFilter({ sprint: sprint === 'backlog' || sprint === 'none' ? '' : sprint })
  }
  const raw = decodeURIComponent(window.location.hash.replace(/^#/, ''))
  if (raw === '' || raw.startsWith('token=') || raw.startsWith('sprint=')) return
  if (issueById.value.has(raw)) select(raw)
}

export function clearDeepLink(): void {
  if (window.location.hash === '') return
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${window.location.search}`,
  )
}

export async function bootstrap(): Promise<void> {
  const [savedTheme, savedCompact, savedLayout, savedView, lastRepoId, repoList] = await Promise.all([
    getPref<string>('theme', ''),
    getPref<boolean>('compact', false),
    getPref<BoardLayout>('layout', layout.value),
    getPref<View>('view', 'board'),
    getPref<string | null>('activeRepoId', null),
    listRepos(),
  ])

  applyTheme(
    savedTheme === ''
      ? window.matchMedia?.('(prefers-color-scheme: dark)').matches
        ? 'scrumit-dark'
        : 'scrumit-light'
      : savedTheme,
  )
  compact.value = savedCompact
  if (savedLayout && typeof savedLayout === 'object') {
    layout.value = { ...layout.value, ...savedLayout }
  }
  view.value = savedView
  repos.value = repoList

  const requestedRepo = new URLSearchParams(window.location.search).get('repo')
  const repoId = requestedRepo ?? lastRepoId
  if (repoId === null) return
  const record = repoList.find((r) => r.id === repoId)
  if (!record) return

  // Auto-open only when it needs no prompt. A silent permission prompt is not
  // a user gesture, and a repo that opens read-only without explanation is
  // worse than one that asks.
  if (record.kind === 'demo') {
    await openRepo(record)
    return
  }
  if (record.kind === 'http') {
    const token = record.serverUrl
      ? localStorage.getItem(serverTokenKey(record.serverUrl))
      : null
    if (record.serverUrl && token) {
      await openRepo(record)
      return
    }
  }
  if (!record.handle) {
    // A remembered repo whose handle the browser would not clone. Show the
    // cached board and say so rather than silently dropping the last session.
    const cached = await readSnapshot(record.id)
    if (cached) {
      handleLost.value = true
      permission.value = 'denied'
      sourceCapabilities.value = {
        canWrite: false,
        canWatch: false,
        access: record.kind === 'http' ? 'http' : 'handle',
        git: record.kind === 'http' ? 'full' : 'branch',
      }
      activeRepo.value = { ...record, handlePersisted: false }
      applySnapshot(cached)
      validation.value = []
      loadState.value = 'ready'
    }
    return
  }
  const fsa = new FsaSource(record.handle, record.path || record.name)
  const state = await fsa.permission()
  if (state === 'granted') await openRepo(record)
  else {
    handleLost.value = false
    permission.value = state
    sourceCapabilities.value = fsa.capabilities
    activeRepo.value = record
    const cached = await readSnapshot(record.id)
    if (cached) {
      applySnapshot(cached)
      validation.value = []
      loadState.value = 'ready'
    }
  }
}

export async function setView(next: View): Promise<void> {
  view.value = next
  await setPref('view', next)
}

export async function wipeLocalData(): Promise<void> {
  await db.delete()
  location.reload()
}
