import type { BoardConfig, Epic, Issue, Sprint, Status } from './model.ts'
import { addDays, daysBetween, isoToDate, sumPoints, todayISO } from './format.ts'

export interface ColumnStat {
  id: Status
  name: string
  wip: number | null
  terminal: boolean
  hidden: boolean
  issues: Issue[]
  count: number
  points: number
  over: boolean
}

/** Group issues into the configured columns, applying the manual order. */
export function boardColumns(issues: Issue[], config: BoardConfig): ColumnStat[] {
  const byStatus = new Map<Status, Issue[]>()
  for (const issue of issues) {
    const bucket = byStatus.get(issue.status)
    if (bucket) bucket.push(issue)
    else byStatus.set(issue.status, [issue])
  }

  return config.columns.map((column) => {
    const columnIssues = (byStatus.get(column.id) ?? []).slice().sort(compareOrder)
    const points = sumPoints(columnIssues)
    return {
      id: column.id,
      name: column.name,
      wip: column.wip,
      terminal: column.terminal,
      hidden: column.hidden,
      issues: columnIssues,
      count: columnIssues.length,
      points,
      over: column.wip !== null && columnIssues.length > column.wip,
    }
  })
}

export function compareOrder(a: Issue, b: Issue): number {
  if (a.order !== b.order) return a.order - b.order
  return a.id.localeCompare(b.id)
}

export function issuesOfSprint(issues: Issue[], sprintId: string): Issue[] {
  return issues.filter((issue) => issue.sprint === sprintId).sort(compareOrder)
}

export function backlogIssues(issues: Issue[]): Issue[] {
  return issues.filter((issue) => issue.sprint === null).sort(compareOrder)
}

/** The sprint currently running, else the newest one that has not closed. */
export function currentSprint(sprints: Sprint[]): Sprint | null {
  const active = sprints.filter((s) => s.state === 'active').sort(byIdDesc)
  if (active.length > 0) return active[0]
  const open = sprints.filter((s) => s.state !== 'closed').sort(byIdDesc)
  return open[0] ?? sprints[0] ?? null
}

function byIdDesc(a: { id: string }, b: { id: string }): number {
  return b.id.localeCompare(a.id)
}

export interface SprintProgress {
  committed: number
  done: number
  remaining: number
  capacity: number | null
  daysTotal: number | null
  daysLeft: number | null
  /** 0..1 of the calendar consumed, or null when dates are missing. */
  elapsed: number | null
  doneRatio: number
  scopeAdded: number
  total: number
}

export function sprintProgress(sprint: Sprint, issues: Issue[]): SprintProgress {
  const scoped = issuesOfSprint(issues, sprint.id)
  const committed = sumPoints(scoped)
  const done = sumPoints(scoped.filter((i) => i.status === 'done'))
  const total = scoped.length
  const daysTotal = daysBetween(sprint.start, sprint.end)
  const today = todayISO()
  const elapsedDays = daysBetween(sprint.start, today)
  const daysLeft = daysBetween(today, sprint.end)
  const elapsed =
    daysTotal && daysTotal > 0 && elapsedDays !== null
      ? Math.min(Math.max(elapsedDays / daysTotal, 0), 1)
      : null

  // Scope added after the sprint started: unpointed items are excluded rather
  // than guessed at, so the number stays honest.
  const started = sprint.start
  const scopeAdded = started
    ? sumPoints(scoped.filter((i) => i.created !== null && i.created > started))
    : 0

  return {
    committed,
    done,
    remaining: Math.max(committed - done, 0),
    capacity: sprint.capacity,
    daysTotal,
    daysLeft,
    elapsed,
    doneRatio: committed > 0 ? done / committed : 0,
    scopeAdded,
    total,
  }
}

export interface BurnPoint {
  day: string
  remaining: number
  ideal: number
}

/**
 * Burndown derived from `created` and `updated` rather than from stored
 * history: an issue counts as burned on the day it was last touched. Honest
 * about its own precision — the editor overwrites `updated` on any edit — so
 * the metrics view labels this as an approximation.
 */
export function burndown(sprint: Sprint, issues: Issue[]): BurnPoint[] {
  const scoped = issuesOfSprint(issues, sprint.id)
  const total = sumPoints(scoped)
  if (!sprint.start || !sprint.end) return []

  const points: BurnPoint[] = []
  const days = daysBetween(sprint.start, sprint.end) ?? 0
  for (let offset = 0; offset <= days; offset++) {
    const day = addDays(sprint.start, offset)
    const burned = scoped
      .filter((i) => i.status === 'done' && i.updated !== null && i.updated <= day)
      .reduce((sum, i) => sum + (i.points ?? 0), 0)
    const ideal = days > 0 ? total * (1 - offset / days) : 0
    points.push({ day, remaining: Math.max(total - burned, 0), ideal: Math.round(ideal * 10) / 10 })
  }
  return points
}

export interface VelocityBucket {
  id: string
  label: string
  points: number
  count: number
  state: Sprint['state']
  meetsCapacity: boolean | null
}

export function velocity(sprints: Sprint[], issues: Issue[], limit = 6): VelocityBucket[] {
  return sprints
    .filter((sprint) => issues.some((i) => i.sprint === sprint.id))
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(-limit)
    .map((sprint) => {
      const scoped = issuesOfSprint(issues, sprint.id)
      const done = scoped.filter((i) => i.status === 'done')
      const points = sumPoints(done)
      return {
        id: sprint.id,
        label: sprint.name.replace(/^Sprint\s+/i, 'S'),
        points,
        count: done.length,
        state: sprint.state,
        meetsCapacity: sprint.capacity === null ? null : points >= sprint.capacity,
      }
    })
}

/**
 * Mean points finished per *closed* sprint. The running sprint is excluded:
 * counting a sprint on its second day as a zero would drag the average down and
 * managers read velocity as a planning input.
 */
export function velocityMean(buckets: VelocityBucket[]): number | null {
  const closed = buckets.filter((bucket) => bucket.state === 'closed')
  if (closed.length === 0) return null
  const total = closed.reduce((sum, bucket) => sum + bucket.points, 0)
  return Math.round((total / closed.length) * 10) / 10
}

export interface Hygiene {
  blocked: Issue[]
  unassigned: Issue[]
  unpointed: Issue[]
  withoutCriteria: Issue[]
  stale: Issue[]
}

const CRITERIA = /^\s*[-*]\s+\[[ xX]\]/m

/** The checks a scrum master actually runs before a standup. */
export function hygiene(issues: Issue[], config: BoardConfig, staleDays = 7): Hygiene {
  const open = issues.filter((i) => i.status !== 'done')
  const openIds = new Set(open.map((i) => i.id))
  const today = todayISO()

  const boardStatuses = new Set(
    config.columns.filter((c) => !c.terminal).map((c) => c.id),
  )

  return {
    blocked: open.filter((i) => i.blockedBy.some((dep) => openIds.has(dep))),
    unassigned: open.filter((i) => i.assignee === null && i.status !== 'backlog'),
    unpointed: open.filter((i) => i.points === null && i.status !== 'backlog'),
    withoutCriteria: open.filter(
      (i) => !CRITERIA.test(i.body) && (i.status === 'todo' || i.status === 'doing'),
    ),
    stale: open.filter((i) => {
      if (!boardStatuses.has(i.status) || i.status === 'todo') return false
      const age = daysBetween(i.updated, today)
      return age !== null && age >= staleDays
    }),
  }
}

export interface EpicProgress {
  epic: Epic
  total: number
  done: number
  points: number
  pointsDone: number
  ratio: number
  open: Issue[]
}

export function epicProgress(epics: Epic[], issues: Issue[]): EpicProgress[] {
  return epics.map((epic) => {
    const scoped = issues.filter((i) => i.epic === epic.id)
    const done = scoped.filter((i) => i.status === 'done')
    const points = sumPoints(scoped)
    const pointsDone = sumPoints(done)
    return {
      epic,
      total: scoped.length,
      done: done.length,
      points,
      pointsDone,
      ratio: points > 0 ? pointsDone / points : 0,
      open: scoped.filter((i) => i.status !== 'done').sort(compareOrder),
    }
  })
}

export interface FlowStats {
  /** Mean days from creation to completion across done issues. */
  leadTime: number | null
  medianLeadTime: number | null
  /** Mean age of work still open. */
  openAge: number | null
  doneCount: number
  throughputPerSprint: number | null
}

export function flow(issues: Issue[], sprints: Sprint[]): FlowStats {
  const today = todayISO()
  const doneDurations: number[] = []
  for (const issue of issues) {
    if (issue.status !== 'done') continue
    const span = daysBetween(issue.created, issue.updated)
    if (span !== null && span >= 0) doneDurations.push(span)
  }

  const openAges: number[] = []
  for (const issue of issues) {
    if (issue.status === 'done') continue
    const age = daysBetween(issue.created, today)
    if (age !== null) openAges.push(age)
  }

  const closedSprints = sprints.filter((s) => s.state === 'closed').length
  const mean = (values: number[]): number | null =>
    values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length

  const sorted = [...doneDurations].sort((a, b) => a - b)
  const median =
    sorted.length === 0
      ? null
      : sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2

  return {
    leadTime: mean(doneDurations),
    medianLeadTime: median,
    openAge: mean(openAges),
    doneCount: doneDurations.length,
    throughputPerSprint:
      closedSprints > 0 ? doneDurations.length / closedSprints : null,
  }
}

/** Sprint ids sorted newest first, for pickers. */
export function sprintIds(sprints: Sprint[]): string[] {
  return sprints.map((s) => s.id).sort((a, b) => b.localeCompare(a))
}

export function sprintWindowLabel(sprint: Sprint): string {
  if (!sprint.start || !sprint.end) return 'No dates set'
  const start = isoToDate(sprint.start)
  const end = isoToDate(sprint.end)
  if (!start || !end) return 'No dates set'
  const formatter = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `${formatter.format(start)} – ${formatter.format(end)}`
}
