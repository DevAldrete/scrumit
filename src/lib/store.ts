import { computed, signal } from '@preact/signals'
import { AGENT_GUIDE_PATH, buildAgentGuide } from './agentGuide.ts'
import { diffSnapshots, type SnapshotDiff } from './changes.ts'
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
import { loadSprintSkillFiles, SPRINT_SKILL_FOLDER } from './skill.ts'
import { personHue, todayISO } from './format.ts'
import type {
  BoardColumnSpec,
  BoardConfig,
  Epic,
  Issue,
  RepoSnapshot,
  Sprint,
  Status,
} from './model.ts'
import { boardColumns, compareOrder } from './metrics.ts'
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

export type View = 'board' | 'backlog' | 'sprints' | 'epics' | 'metrics' | 'settings'
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
export const repos = signal<RepoRecord[]>([])
export const activeRepo = signal<RepoRecord | null>(null)
export const permission = signal<PermissionState>('granted')
/**
 * True when the registry remembers a repo but not its directory handle, so the
 * cached board is showing and the folder must be reopened to write.
 */
export const handleLost = signal(false)
export const loadState = signal<LoadState>('welcome')
export const busy = signal(false)
export const saving = signal(false)
export const errorMessage = signal<string | null>(null)
export const skippedFiles = signal<{ path: string; reason: string }[]>([])
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
      const haystack = `${issue.id} ${issue.title} ${issue.labels.join(' ')}`.toLowerCase()
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
let externalTimer: ReturnType<typeof setTimeout> | null = null
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
  const { snapshot, skipped } = await scanRepo(src, repo.id)
  applySnapshot(snapshot)
  skippedFiles.value = skipped
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
    if (diff && diff.total > 0) notify(diff.summary, 'ok', diff.details)
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
    notify(`Could not save ${issue.id}: ${describeError(error)}`, 'error')
  } finally {
    markSaving(-1)
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
  await Promise.all([...ids].map((id) => persistIssue(id)))
}

/* -------------------------------------------------------------------------- */
/* Loading                                                                    */
/* -------------------------------------------------------------------------- */

function applySnapshot(snapshot: RepoSnapshot): void {
  config.value = snapshot.config
  issues.value = snapshot.issues
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
}

export async function openRepo(record: RepoRecord, options: OpenOptions = {}): Promise<void> {
  loadState.value = 'loading'
  errorMessage.value = null
  try {
    let next: RepoSource
    if (record.kind === 'demo') {
      next = await DemoSource.load()
      permission.value = 'granted'
    } else {
      if (!record.handle) {
        // The registry knows the repo but not its handle. Show the cached board
        // read-only, or send the user back to pick the folder again.
        stopWatching()
        source = null
        const cached = await readSnapshot(record.id)
        if (cached) {
          handleLost.value = true
          permission.value = 'denied'
          activeRepo.value = { ...record, handlePersisted: false }
          applySnapshot(cached)
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
        loadState.value = 'ready'
        return
      }
      next = fsa
    }

    source = next
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
    const { snapshot, skipped } = await scanRepo(src, repo.id)
    applySnapshot(snapshot)
    skippedFiles.value = skipped
    await writeSnapshot(snapshot)
    loadState.value = 'ready'
  } catch (error) {
    const cached = await readSnapshot(repo.id)
    if (cached) {
      applySnapshot(cached)
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
  await DemoSource.reset()
  await rescan()
  notify('Demo repo restored to its original state.', 'ok')
}

export async function closeRepo(): Promise<void> {
  await flush()
  stopWatching()
  source = null
  handleLost.value = false
  activeRepo.value = null
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
  if (permission.value !== 'granted') {
    notify('scrumit cannot write to this folder until you grant access.', 'error')
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
  const existing = issues.value.find((i) => i.id === id)
  if (!existing) return
  const next: Issue = { ...existing, ...patch, updated: todayISO() }
  issues.value = issues.value.map((i) => (i.id === id ? next : i))
  queueDraft(id)
  queueIssueWrite(id, immediate ? 0 : 900)
}

export async function deleteIssue(id: string): Promise<void> {
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
  const moving = issues.value.find((i) => i.id === id)
  if (!moving) return

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
  config.value = { ...config.value, ...patch }
  void persistConfig()
}

export function patchColumn(id: Status, patch: Partial<BoardColumnSpec>): void {
  config.value = {
    ...config.value,
    columns: config.value.columns.map((column) =>
      column.id === id ? { ...column, ...patch } : column,
    ),
  }
  void persistConfig()
}

export function moveColumn(id: Status, direction: -1 | 1): void {
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
  const existing = epics.value.find((e) => e.id === id)
  if (!existing) return
  const next = { ...existing, ...patch }
  epics.value = epics.value.map((e) => (e.id === id ? next : e))
  void persistEpic(next)
}

export async function persistEpic(epic: Epic): Promise<void> {
  const src = source
  if (!src) return
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
  const existing = sprints.value.find((s) => s.id === id)
  if (!existing) return
  const next = { ...existing, ...patch }
  sprints.value = sprints.value.map((s) => (s.id === id ? next : s))
  void persistSprint(next)
}

export async function persistSprint(sprint: Sprint): Promise<void> {
  const src = source
  if (!src) return
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
  for (const id of ids) patchIssue(id, { status, order: nextOrder(status, id) }, true)
  await Promise.all(ids.map((id) => persistIssue(id)))
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

export async function bootstrap(): Promise<void> {
  const [savedTheme, savedCompact, savedView, lastRepoId, repoList] = await Promise.all([
    getPref<string>('theme', ''),
    getPref<boolean>('compact', false),
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
  view.value = savedView
  repos.value = repoList

  if (lastRepoId === null) return
  const record = repoList.find((r) => r.id === lastRepoId)
  if (!record) return

  // Auto-open only when it needs no prompt. A silent permission prompt is not
  // a user gesture, and a repo that opens read-only without explanation is
  // worse than one that asks.
  if (record.kind === 'demo') {
    await openRepo(record)
    return
  }
  if (!record.handle) {
    // A remembered repo whose handle the browser would not clone. Show the
    // cached board and say so rather than silently dropping the last session.
    const cached = await readSnapshot(record.id)
    if (cached) {
      handleLost.value = true
      permission.value = 'denied'
      activeRepo.value = { ...record, handlePersisted: false }
      applySnapshot(cached)
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
    activeRepo.value = record
    const cached = await readSnapshot(record.id)
    if (cached) {
      applySnapshot(cached)
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
