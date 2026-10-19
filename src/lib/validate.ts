import { splitFrontmatter, str } from './frontmatter.ts'
import { EPIC_STATES, ISSUE_TYPES, STATUSES } from './model.ts'
import type { BoardConfig, Epic, Issue, Sprint } from './model.ts'
import { issuePath, sprintPath } from './paths.ts'

export interface ValidationIssue {
  path: string
  severity: 'error' | 'warning'
  code: string
  message: string
}

export interface ValidationInput {
  config: BoardConfig
  issues: Issue[]
  epics: Epic[]
  sprints: Sprint[]
  /** Raw file text, keyed by repo-relative path, for enum checks. */
  texts: Map<string, string>
  skipped: { path: string; reason: string }[]
}

function finding(
  out: ValidationIssue[],
  severity: ValidationIssue['severity'],
  code: string,
  path: string,
  message: string,
): void {
  out.push({ path, severity, code, message })
}

function duplicates<T extends { id: string; path: string | null }>(
  out: ValidationIssue[],
  kind: string,
  items: T[],
): void {
  const seen = new Map<string, string>()
  for (const item of items) {
    if (!item.path) continue
    const first = seen.get(item.id)
    if (first) {
      finding(out, 'error', 'duplicate-id', item.path, `duplicate ${kind} id ${item.id}; also at ${first}`)
    } else {
      seen.set(item.id, item.path)
    }
  }
}

function enumFinding(
  out: ValidationIssue[],
  path: string,
  text: string,
  key: string,
  allowed: readonly string[],
  code: string,
): void {
  const { data } = splitFrontmatter(text)
  const value = str(data[key])
  if (value !== null && !allowed.includes(value)) {
    finding(
      out,
      'error',
      code,
      path,
      `${key} ${JSON.stringify(value)} is not one of ${allowed.join(', ')}`,
    )
  }
}

/**
 * Everything an agent-written repository can get wrong without failing to
 * parse. Pure over a scan, so the Flow view and a test see exactly the same
 * answer.
 */
export function validateScan(input: ValidationInput): ValidationIssue[] {
  const { config, issues, epics, sprints, texts } = input
  const out: ValidationIssue[] = []

  if (config.version !== 1) {
    finding(
      out,
      'warning',
      'config-version',
      '.scrumit/config.yaml',
      `config version ${config.version} is newer than this build understands (1)`,
    )
  }

  duplicates(out, 'issue', issues)
  duplicates(out, 'epic', epics)
  duplicates(out, 'sprint', sprints)

  const issueIds = new Map(issues.map((issue) => [issue.id, issue]))
  const epicIds = new Set(epics.map((epic) => epic.id))
  const sprintIds = new Set(sprints.map((sprint) => sprint.id))

  for (const issue of issues) {
    if (!issue.updated) {
      finding(out, 'warning', 'missing-updated', issue.path ?? issue.id, 'front-matter has no updated date')
    }
    if (issue.created && issue.updated && issue.updated < issue.created) {
      finding(
        out,
        'warning',
        'updated-before-created',
        issue.path ?? issue.id,
        `updated (${issue.updated}) is before created (${issue.created})`,
      )
    }
    if (issue.epic && !epicIds.has(issue.epic)) {
      finding(out, 'error', 'dangling-epic', issue.path ?? issue.id, `epic ${issue.epic} does not exist`)
    }
    if (issue.sprint && !sprintIds.has(issue.sprint)) {
      finding(
        out,
        'warning',
        'dangling-sprint',
        issue.path ?? issue.id,
        `sprint ${issue.sprint} has no sprint.md`,
      )
    }
    for (const blocker of issue.blockedBy) {
      if (!issueIds.has(blocker)) {
        finding(
          out,
          'error',
          'dangling-blocker',
          issue.path ?? issue.id,
          `blocked_by ${blocker} does not exist`,
        )
      }
      if (blocker === issue.id) {
        finding(out, 'error', 'self-block', issue.path ?? issue.id, `${issue.id} is blocked by itself`)
      }
    }
    if (issue.path) {
      const expected = issuePath(issue, config.dirs)
      if (expected !== issue.path) {
        finding(out, 'warning', 'path-mismatch', issue.path, `expected ${expected}`)
      }
    }
  }

  // blocked_by cycles, reported once per cycle at the lowest id encountered.
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []
  const reported = new Set<string>()
  function visit(id: string): void {
    if (visited.has(id)) return
    if (visiting.has(id)) {
      const at = stack.indexOf(id)
      const cycle = at >= 0 ? stack.slice(at) : [id]
      const key = [...cycle].sort().join('>')
      if (!reported.has(key)) {
        reported.add(key)
        finding(
          out,
          'error',
          'blocked-cycle',
          issueIds.get(id)?.path ?? id,
          `blocked_by cycle: ${[...cycle, cycle[0]].join(' → ')}`,
        )
      }
      return
    }
    const issue = issueIds.get(id)
    if (!issue) return
    visiting.add(id)
    stack.push(id)
    for (const blocker of issue.blockedBy) visit(blocker)
    stack.pop()
    visiting.delete(id)
    visited.add(id)
  }
  for (const issue of issues) visit(issue.id)

  for (const epic of epics) {
    if (epic.path) enumFinding(out, epic.path, texts.get(epic.path) ?? '', 'state', EPIC_STATES, 'bad-epic-state')
  }
  for (const sprint of sprints) {
    if (!sprint.path) continue
    enumFinding(
      out,
      sprint.path,
      texts.get(sprint.path) ?? '',
      'state',
      ['planned', 'active', 'closed'],
      'bad-sprint-state',
    )
    const expected = sprintPath(sprint, config.dirs)
    if (expected !== sprint.path) {
      finding(out, 'warning', 'path-mismatch', sprint.path, `expected ${expected}`)
    }
  }
  for (const issue of issues) {
    if (!issue.path) continue
    const text = texts.get(issue.path)
    if (text === undefined) continue
    enumFinding(out, issue.path, text, 'status', STATUSES, 'bad-status')
    enumFinding(out, issue.path, text, 'type', ISSUE_TYPES, 'bad-type')
  }

  for (const skipped of input.skipped) {
    finding(out, 'warning', 'unreadable', skipped.path, skipped.reason)
  }

  return out
}
