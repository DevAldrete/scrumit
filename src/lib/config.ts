import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import {
  EPIC_STATES,
  ISSUE_TYPES,
  STATUSES,
  STATUS_LABEL,
  type BoardColumnSpec,
  type BoardConfig,
  type Priority,
} from './model.ts'

export function defaultConfig(): BoardConfig {
  return {
    version: 1,
    project: '',
    columns: [
      { id: 'backlog', name: STATUS_LABEL.backlog, wip: null, terminal: false, hidden: false },
      { id: 'todo', name: STATUS_LABEL.todo, wip: null, terminal: false, hidden: false },
      { id: 'doing', name: STATUS_LABEL.doing, wip: 3, terminal: false, hidden: false },
      { id: 'review', name: STATUS_LABEL.review, wip: 4, terminal: false, hidden: false },
      { id: 'done', name: STATUS_LABEL.done, wip: null, terminal: true, hidden: false },
    ],
    dirs: { backlog: 'backlog', sprints: 'sprints', epics: 'epics', archive: 'done' },
    sprintLengthDays: 14,
    ceremony: 'Planning Monday, review and retro every second Friday',
    vocabulary: { points: true, assignees: true, priorities: true },
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * Parse `.scrumit/config.yaml` over the defaults.
 *
 * Missing keys are defaults; unknown keys are ignored (the file may be shared
 * with other tooling). Columns may be renamed, reordered, capped and hidden,
 * but their ids stay fixed to the five statuses: status is load-bearing in
 * every path and query, and a fixed set is what keeps the files portable
 * between teams.
 */
export function parseConfig(text: string): BoardConfig {
  const base = defaultConfig()
  let raw: Record<string, unknown>
  try {
    raw = asRecord(parseYaml(text))
  } catch {
    return base
  }

  const dirs = asRecord(raw.dirs)
  const vocab = asRecord(raw.vocabulary)
  const sprinting = asRecord(raw.sprints)
  const backlog = asRecord(raw.backlog)
  const epics = asRecord(raw.epics)
  const archive = asRecord(raw.archive)

  const columns: BoardColumnSpec[] = []
  const declared = Array.isArray(raw.columns) ? raw.columns : []
  const seen = new Set<string>()

  for (const entry of declared) {
    const col = asRecord(entry)
    const id = asString(col.id, '')
    if (!STATUSES.includes(id as (typeof STATUSES)[number])) continue
    if (seen.has(id)) continue
    seen.add(id)
    const fallback = base.columns.find((c) => c.id === id)!
    columns.push({
      id: id as BoardColumnSpec['id'],
      name: asString(col.name, fallback.name),
      wip: asNumber(col.wip),
      terminal: asBool(col.terminal, fallback.terminal),
      hidden: asBool(col.hidden, false),
    })
  }
  // Any status the config forgot keeps its default column.
  for (const fallback of base.columns) {
    if (!seen.has(fallback.id)) columns.push({ ...fallback })
  }

  return {
    version: asNumber(raw.version) ?? base.version,
    project: asString(raw.project, base.project),
    columns,
    dirs: {
      backlog: asString(backlog.dir ?? dirs.backlog, base.dirs.backlog),
      sprints: asString(sprinting.dir ?? dirs.sprints, base.dirs.sprints),
      epics: asString(epics.dir ?? dirs.epics, base.dirs.epics),
      archive: asString(archive.dir ?? dirs.archive, base.dirs.archive),
    },
    sprintLengthDays: asNumber(sprinting.length_days) ?? base.sprintLengthDays,
    ceremony: asString(raw.ceremony, base.ceremony),
    vocabulary: {
      points: asBool(vocab.points, true),
      assignees: asBool(vocab.assignees, true),
      priorities: asBool(vocab.priorities, true),
    },
  }
}

export function serializeConfig(config: BoardConfig): string {
  const doc = {
    version: config.version,
    project: config.project,
    columns: config.columns.map((c) => ({
      id: c.id,
      name: c.name,
      wip: c.wip,
      ...(c.terminal ? { terminal: true } : {}),
      ...(c.hidden ? { hidden: true } : {}),
    })),
    backlog: { dir: config.dirs.backlog },
    sprints: { dir: config.dirs.sprints, length_days: config.sprintLengthDays },
    epics: { dir: config.dirs.epics },
    archive: { dir: config.dirs.archive },
    ceremony: config.ceremony,
    vocabulary: config.vocabulary,
  }
  return stringifyYaml(doc, { lineWidth: 0 })
}

export function isStatus(value: string): value is BoardColumnSpec['id'] {
  return STATUSES.includes(value as BoardColumnSpec['id'])
}

export function isType(value: string): value is (typeof ISSUE_TYPES)[number] {
  return ISSUE_TYPES.includes(value as (typeof ISSUE_TYPES)[number])
}

export function isEpicState(value: string): value is (typeof EPIC_STATES)[number] {
  return EPIC_STATES.includes(value as (typeof EPIC_STATES)[number])
}

export function isPriority(value: number): value is Priority {
  return value === 0 || value === 1 || value === 2 || value === 3
}
