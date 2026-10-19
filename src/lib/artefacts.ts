import {
  joinFrontmatter,
  num,
  splitFrontmatter,
  str,
  strList,
} from './frontmatter.ts'
import { isEpicState, isPriority, isStatus, isType } from './config.ts'
import type { BoardConfig, Epic, Issue, Sprint } from './model.ts'
import { basename, dirname } from './paths.ts'

const ISSUE_KEYS = new Set([
  'id',
  'title',
  'status',
  'type',
  'epic',
  'sprint',
  'points',
  'assignee',
  'priority',
  'labels',
  'blocked_by',
  'links',
  'order',
  'created',
  'updated',
])

/** Stable hue for an epic that has not been given one. */
export function hueForId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 8
  return h + 1
}

function titleFromBody(body: string, fallback: string): string {
  const match = /^#{1,3}[ \t]+(.+)$/m.exec(body)
  return match ? match[1].trim() : fallback
}

export function parseIssue(path: string, text: string): Issue | null {
  const { data, body } = splitFrontmatter(text)
  const id = str(data.id)
  if (!id) return null

  const rawStatus = str(data.status) ?? 'backlog'
  const rawType = str(data.type) ?? 'story'
  const priorityValue = num(data.priority)

  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (!ISSUE_KEYS.has(key)) extra[key] = value
  }

  return {
    id,
    title: str(data.title) ?? titleFromBody(body, id),
    status: isStatus(rawStatus) ? rawStatus : 'backlog',
    type: isType(rawType) ? rawType : 'story',
    epic: str(data.epic),
    sprint: str(data.sprint),
    points: num(data.points),
    assignee: str(data.assignee),
    priority: priorityValue !== null && isPriority(priorityValue) ? priorityValue : null,
    labels: strList(data.labels),
    blockedBy: strList(data.blocked_by ?? data.blockedBy),
    links: strList(data.links),
    order: num(data.order) ?? 0,
    created: str(data.created),
    updated: str(data.updated),
    body,
    path,
    extra,
  }
}

/**
 * Serialise an issue. Optional fields are omitted rather than written as null,
 * so a card created in the UI produces a file a human would have written.
 */
export function serializeIssue(issue: Issue): string {
  const fm: Record<string, unknown> = {
    id: issue.id,
    title: issue.title,
    status: issue.status,
    type: issue.type,
  }
  if (issue.epic) fm.epic = issue.epic
  if (issue.sprint) fm.sprint = issue.sprint
  if (issue.points !== null) fm.points = issue.points
  if (issue.assignee) fm.assignee = issue.assignee
  if (issue.priority !== null) fm.priority = issue.priority
  if (issue.labels.length) fm.labels = issue.labels
  if (issue.blockedBy.length) fm.blocked_by = issue.blockedBy
  if (issue.links.length) fm.links = issue.links
  fm.order = issue.order
  if (issue.created) fm.created = issue.created
  if (issue.updated) fm.updated = issue.updated

  for (const [key, value] of Object.entries(issue.extra)) {
    if (!(key in fm)) fm[key] = value
  }

  return joinFrontmatter(fm, issue.body)
}

export function parseEpic(path: string, text: string): Epic | null {
  const { data, body } = splitFrontmatter(text)
  const id = str(data.id)
  if (!id) return null
  const rawState = str(data.state) ?? 'planned'
  const color = num(data.color)

  const known = new Set(['id', 'title', 'state', 'owner', 'target', 'color'])
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (!known.has(key)) extra[key] = value
  }

  return {
    id,
    title: str(data.title) ?? titleFromBody(body, id),
    state: isEpicState(rawState) ? rawState : 'planned',
    owner: str(data.owner),
    target: str(data.target),
    color: color !== null && color >= 1 && color <= 8 ? Math.round(color) : hueForId(id),
    description: body.trim(),
    path,
    extra,
  }
}

export function serializeEpic(epic: Epic): string {
  const fm: Record<string, unknown> = {
    id: epic.id,
    title: epic.title,
    state: epic.state,
    color: epic.color,
  }
  if (epic.owner) fm.owner = epic.owner
  if (epic.target) fm.target = epic.target
  for (const [key, value] of Object.entries(epic.extra)) {
    if (!(key in fm)) fm[key] = value
  }
  return joinFrontmatter(fm, epic.description ? `\n${epic.description}\n` : '')
}

export function parseSprint(path: string, text: string): Sprint | null {
  const { data, body } = splitFrontmatter(text)
  const id = str(data.id) ?? basename(dirname(path))
  if (!id) return null
  const rawState = str(data.state) ?? 'planned'

  const known = new Set([
    'id',
    'name',
    'state',
    'goal',
    'start',
    'end',
    'capacity',
    'wip_soft',
    'wip_hard',
    'length_days',
  ])
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (!known.has(key)) extra[key] = value
  }

  return {
    id,
    name: str(data.name) ?? id,
    goal: str(data.goal) ?? '',
    start: str(data.start),
    end: str(data.end),
    capacity: num(data.capacity),
    wipSoft: num(data.wip_soft ?? data.wipSoft),
    wipHard: num(data.wip_hard ?? data.wipHard),
    state:
      rawState === 'active' || rawState === 'closed' || rawState === 'planned'
        ? rawState
        : 'planned',
    notes: body.trim(),
    path,
    extra,
  }
}

export function serializeSprint(sprint: Sprint): string {
  const fm: Record<string, unknown> = {
    id: sprint.id,
    name: sprint.name,
    state: sprint.state,
  }
  if (sprint.goal) fm.goal = sprint.goal
  if (sprint.start) fm.start = sprint.start
  if (sprint.end) fm.end = sprint.end
  if (sprint.capacity !== null) fm.capacity = sprint.capacity
  if (sprint.wipSoft != null) fm.wip_soft = sprint.wipSoft
  if (sprint.wipHard != null) fm.wip_hard = sprint.wipHard
  for (const [key, value] of Object.entries(sprint.extra)) {
    if (!(key in fm)) fm[key] = value
  }
  return joinFrontmatter(fm, sprint.notes ? `\n${sprint.notes}\n` : '')
}

export type ArtefactKind = 'issue' | 'epic' | 'sprint' | 'other'

/** Decide what a markdown file is, from where it lives and what it declares. */
export function classify(path: string, cfg: BoardConfig): ArtefactKind {
  if (path.startsWith(cfg.dirs.epics + '/')) return 'epic'
  if (
    path.startsWith(cfg.dirs.sprints + '/') &&
    basename(path) === 'sprint.md'
  )
    return 'sprint'
  return 'other'
}

export function isMarkdown(path: string): boolean {
  return path.toLowerCase().endsWith('.md')
}

/**
 * The id prefix new issues should use.
 *
 * Existing ids win over the project name. A repository already numbering
 * `ACME-1..ACME-40` must not sprout an `ACMEPA-41` next to them just because the
 * project is called "Acme Payments Platform" — mixed prefixes in one repo are
 * exactly the mess an id scheme exists to prevent.
 */
export function issuePrefix(ids: Iterable<string>, project: string): string {
  const counts = new Map<string, number>()
  for (const id of ids) {
    const match = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/.exec(id)
    if (!match) continue
    const prefix = match[1].toUpperCase()
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1)
  }

  let best: string | null = null
  for (const [prefix, count] of counts) {
    if (best === null || count > counts.get(best)!) best = prefix
  }
  if (best !== null) return best

  const word = project.trim().split(/\s+/)[0] ?? ''
  return word.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase() || 'SCRUM'
}

export function newIssueId(existing: Iterable<string>, project: string): string {
  const ids = [...existing]
  const prefix = issuePrefix(ids, project)
  const pattern = new RegExp(`^${prefix}-(\\d+)$`, 'i')

  let max = 0
  for (const id of ids) {
    const match = pattern.exec(id)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `${prefix}-${max + 1}`
}

export function newEpicId(existing: Iterable<string>): string {
  let max = 0
  for (const id of existing) {
    const match = /(\d+)/.exec(id)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `EPIC-${String(max + 1).padStart(2, '0')}`
}
