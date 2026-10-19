/**
 * Domain types. These mirror the on-disk format exactly; nothing here is
 * invented for the UI's convenience.
 */

export const STATUSES = ['backlog', 'todo', 'doing', 'review', 'done'] as const
export type Status = (typeof STATUSES)[number]

export const ISSUE_TYPES = ['story', 'bug', 'chore', 'spike'] as const
export type IssueType = (typeof ISSUE_TYPES)[number]

export const EPIC_STATES = ['planned', 'active', 'done'] as const
export type EpicState = (typeof EPIC_STATES)[number]

export type Priority = 0 | 1 | 2 | 3

export interface Issue {
  id: string
  title: string
  status: Status
  type: IssueType
  epic: string | null
  sprint: string | null
  points: number | null
  assignee: string | null
  priority: Priority | null
  labels: string[]
  blockedBy: string[]
  links: string[]
  order: number
  created: string | null
  updated: string | null
  body: string
  /** Repo-relative path, or null when the issue exists only in memory. */
  path: string | null
  /** Front-matter keys scrumit does not own, carried through writes verbatim. */
  extra: Record<string, unknown>
}

export interface Epic {
  id: string
  title: string
  state: EpicState
  owner: string | null
  target: string | null
  /** 1..8, indexes the theme's hue ramp so an epic keeps its colour family. */
  color: number
  description: string
  path: string | null
  extra: Record<string, unknown>
}

export interface Sprint {
  id: string
  name: string
  goal: string
  start: string | null
  end: string | null
  capacity: number | null
  /**
   * Sprint-wide WIP limits. The soft limit is advisory; the hard limit refuses
   * a move that would exceed it. `null` means uncapped.
   */
  wipSoft: number | null
  wipHard: number | null
  state: 'planned' | 'active' | 'closed'
  notes: string
  path: string | null
  extra: Record<string, unknown>
}

export interface Column extends BoardColumnSpec {
  /** Facts the board needs, resolved from the issues on hand. */
  count: number
  points: number
  /** The soft (flexible) limit was crossed. */
  overSoft: boolean
  /** The hard limit was crossed. */
  overWip: boolean
}

export interface BoardColumnSpec {
  id: Status
  name: string
  /**
   * Soft, flexible work-in-progress limit. Crossing it warns and never refuses
   * a move.
   */
  softWip: number | null
  /** Hard work-in-progress ceiling, or null for uncapped. */
  wip: number | null
  /** Terminal columns are excluded from cycle-time and flow maths. */
  terminal: boolean
  hidden: boolean
}

export interface BoardConfig {
  version: number
  project: string
  columns: BoardColumnSpec[]
  dirs: {
    backlog: string
    sprints: string
    epics: string
    archive: string
  }
  sprintLengthDays: number
  /** Ceremony rhythm, printed on the metrics view. */
  ceremony: string
  vocabulary: {
    points: boolean
    assignees: boolean
    priorities: boolean
  }
}

/** Per-device board geometry. Kept in Dexie, never in the repository. */
export interface BoardLayout {
  /** Width of one board column, in pixels. */
  columnWidth: number
  /** Gap between cards, in pixels. */
  cardGap: number
  /** Draw the vertical rule between columns. */
  separators: boolean
  /** Draw a border around every card. */
  cardBorders: boolean
  /** Draw a faint background grid behind the board. */
  grid: boolean
}

export interface RepoMeta {
  id: string
  name: string
  /** Display path. Demo repos report `demo://`. */
  path: string
  kind: 'fsa' | 'demo' | 'readonly' | 'http'
  color: number
  createdAt: number
  lastOpenedAt: number
}

export interface RawFile {
  path: string
  text: string
}

/**
 * What a repository source can do, independent of which tier it came from.
 *
 * `canWrite` is intrinsic to the source: a read-only folder and a demo repo both
 * say yes or no here. The store combines it with the browser permission state,
 * so a writable handle the user has not re-granted is still read-only in
 * practice.
 */
export interface Capabilities {
  canWrite: boolean
  canWatch: boolean
  /** How the folder was obtained. */
  access: 'handle' | 'http' | 'none'
  git: 'branch' | 'full' | 'none'
}

export interface RepoSnapshot {
  repoId: string
  scannedAt: number
  config: BoardConfig
  issues: Issue[]
  epics: Epic[]
  sprints: Sprint[]
  /** Files under the repo root that look like markdown, for the file tree. */
  fileCount: number
  /** Set when the directory could not be rescanned and this came from cache. */
  stale: boolean
  /** Branch name read from `.git/HEAD`, when there is one. Null for demo repos. */
  gitBranch: string | null
  /** Sprint ids that issues reference but which have no sprint.md yet. */
  orphanSprints: string[]
}

export const STATUS_LABEL: Record<Status, string> = {
  backlog: 'Backlog',
  todo: 'To do',
  doing: 'Doing',
  review: 'Review',
  done: 'Done',
}
