import type { Issue, RepoSnapshot } from './model.ts'

export interface IssueMove {
  issue: Issue
  fromStatus: string
  toStatus: string
  fromSprint: string | null
  toSprint: string | null
}

export interface SnapshotDiff {
  added: Issue[]
  removed: Issue[]
  moved: IssueMove[]
  updated: Issue[]
  configChanged: boolean
  epicsAdded: number
  epicsChanged: number
  epicsRemoved: number
  sprintsAdded: number
  sprintsChanged: number
  /** Distinct artefacts that changed. Zero means the board is unchanged. */
  total: number
  /** One line for a toast. Empty when nothing changed. */
  summary: string
  /** Up to four lines naming what happened, most interesting first. */
  details: string[]
}

const EMPTY: SnapshotDiff = {
  added: [],
  removed: [],
  moved: [],
  updated: [],
  configChanged: false,
  epicsAdded: 0,
  epicsChanged: 0,
  epicsRemoved: 0,
  sprintsAdded: 0,
  sprintsChanged: 0,
  total: 0,
  summary: '',
  details: [],
}

function list(value: readonly string[]): string {
  return value.join('\u0000')
}

/**
 * Compare two issues by everything that is a statement about the work.
 *
 * `path` is deliberately excluded: a file that moved without changing says
 * nothing new about the issue, and reporting it would turn a tidy-up into noise.
 */
function sameIssue(a: Issue, b: Issue): boolean {
  return (
    a.title === b.title &&
    a.status === b.status &&
    a.type === b.type &&
    a.epic === b.epic &&
    a.sprint === b.sprint &&
    a.points === b.points &&
    a.assignee === b.assignee &&
    a.priority === b.priority &&
    a.order === b.order &&
    a.created === b.created &&
    a.updated === b.updated &&
    a.body === b.body &&
    list(a.labels) === list(b.labels) &&
    list(a.blockedBy) === list(b.blockedBy) &&
    list(a.links) === list(b.links) &&
    JSON.stringify(a.extra) === JSON.stringify(b.extra)
  )
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/**
 * Describe what changed between two scans of the same repository.
 *
 * This exists for the moment work arrives from somewhere other than the app — an
 * agent editing files, a `git checkout`, a colleague pushing. "12 files changed"
 * is not useful; "ACME-140 doing → done" is, and it takes about the same amount
 * of code.
 */
export function diffSnapshots(
  before: RepoSnapshot | null,
  after: RepoSnapshot,
): SnapshotDiff {
  if (!before) return EMPTY

  const diff: SnapshotDiff = {
    ...EMPTY,
    added: [],
    removed: [],
    moved: [],
    updated: [],
  }

  const columnName = (status: string): string =>
    after.config.columns.find((column) => column.id === status)?.name ?? status

  const previous = new Map(before.issues.map((issue) => [issue.id, issue]))
  const current = new Map(after.issues.map((issue) => [issue.id, issue]))

  for (const [id, issue] of current) {
    const old = previous.get(id)
    if (!old) {
      diff.added.push(issue)
      continue
    }
    if (old.status !== issue.status || old.sprint !== issue.sprint) {
      diff.moved.push({
        issue,
        fromStatus: old.status,
        toStatus: issue.status,
        fromSprint: old.sprint,
        toSprint: issue.sprint,
      })
      continue
    }
    if (!sameIssue(old, issue)) diff.updated.push(issue)
  }

  for (const [id, issue] of previous) {
    if (!current.has(id)) diff.removed.push(issue)
  }

  diff.configChanged = JSON.stringify(before.config) !== JSON.stringify(after.config)

  const beforeEpics = new Map(before.epics.map((epic) => [epic.id, epic]))
  const afterEpics = new Map(after.epics.map((epic) => [epic.id, epic]))
  for (const [id, epic] of afterEpics) {
    const old = beforeEpics.get(id)
    if (!old) diff.epicsAdded++
    else if (JSON.stringify(old) !== JSON.stringify(epic)) diff.epicsChanged++
  }
  for (const id of beforeEpics.keys()) if (!afterEpics.has(id)) diff.epicsRemoved++

  const beforeSprints = new Map(before.sprints.map((sprint) => [sprint.id, sprint]))
  const afterSprints = new Map(after.sprints.map((sprint) => [sprint.id, sprint]))
  for (const [id, sprint] of afterSprints) {
    const old = beforeSprints.get(id)
    if (!old) diff.sprintsAdded++
    else if (JSON.stringify(old) !== JSON.stringify(sprint)) diff.sprintsChanged++
  }

  diff.total =
    diff.added.length +
    diff.removed.length +
    diff.moved.length +
    diff.updated.length +
    diff.epicsAdded +
    diff.epicsChanged +
    diff.epicsRemoved +
    diff.sprintsAdded +
    diff.sprintsChanged +
    (diff.configChanged ? 1 : 0)

  if (diff.total === 0) return diff

  const parts: string[] = []
  if (diff.moved.length) parts.push(plural(diff.moved.length, 'card') + ' moved')
  if (diff.added.length) parts.push(`${diff.added.length} added`)
  if (diff.removed.length) parts.push(`${diff.removed.length} removed`)
  if (diff.updated.length) parts.push(`${diff.updated.length} edited`)
  if (diff.configChanged) parts.push('config.yaml changed')
  if (diff.epicsAdded + diff.epicsChanged + diff.epicsRemoved > 0) {
    parts.push('epics changed')
  }
  if (diff.sprintsAdded + diff.sprintsChanged > 0) parts.push('sprints changed')

  diff.summary = `From disk: ${parts.join(', ')}`

  const details: string[] = []
  const push = (line: string) => {
    if (details.length < 4) details.push(line)
  }

  for (const move of diff.moved) {
    if (move.fromStatus !== move.toStatus && move.fromSprint !== move.toSprint) {
      push(
        `${move.issue.id} ${columnName(move.fromStatus)} → ${columnName(move.toStatus)}, ${
          move.toSprint ?? 'backlog'
        }`,
      )
    } else if (move.fromStatus !== move.toStatus) {
      push(`${move.issue.id} ${columnName(move.fromStatus)} → ${columnName(move.toStatus)}`)
    } else if (move.toSprint === null) {
      push(`${move.issue.id} returned to the backlog`)
    } else {
      push(`${move.issue.id} scheduled into ${move.toSprint}`)
    }
  }
  for (const issue of diff.added) {
    push(
      `${issue.id} ${issue.sprint ? `added to ${issue.sprint}` : 'added to the backlog'}`,
    )
  }
  for (const issue of diff.removed) push(`${issue.id} is no longer in the repository`)
  for (const issue of diff.updated) push(`${issue.id} edited`)
  if (diff.configChanged) push('config.yaml changed')

  const extra = diff.total - details.length
  if (extra > 0) details.push(`and ${extra} more`)

  diff.details = details
  return diff
}

export interface ChangeLogEntry {
  id: string
  at: number
  summary: string
  details: string[]
  total: number
}

/**
 * Keep the newest 50 external changes. The toast is an event; this is the
 * stream an agent produces while it works, and a stream needs a place to live.
 */
export function appendChangeLog(
  log: readonly ChangeLogEntry[],
  diff: SnapshotDiff,
  at = Date.now(),
  limit = 50,
): ChangeLogEntry[] {
  if (diff.total === 0) return log as ChangeLogEntry[]
  const entry: ChangeLogEntry = {
    id: `${at}-${Math.random().toString(36).slice(2, 8)}`,
    at,
    summary: diff.summary,
    details: diff.details,
    total: diff.total,
  }
  return [entry, ...log].slice(0, limit)
}
