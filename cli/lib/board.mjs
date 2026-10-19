import {
  STATUSES,
  ISSUE_TYPES,
  EPIC_STATES,
  SPRINT_STATES,
  issuePath,
  sprintPath,
  readLock,
  lockIsStale,
} from './repo.mjs'

function add(list, severity, code, path, message) {
  list.push({ severity, code, path, message })
}

export function validateState(state) {
  const issues = state.issues ?? []
  const epics = state.epics ?? []
  const sprints = state.sprints ?? []
  const config = state.config
  const dirs = config.dirs
  const findings = []

  if (config.version !== 1) {
    add(
      findings,
      'warning',
      'config-version',
      '.scrumit/config.yaml',
      `config version ${config.version} is newer than this CLI understands (1)`,
    )
  }

  const issueIds = new Map()
  for (const issue of issues) {
    if (issueIds.has(issue.id)) {
      add(
        findings,
        'error',
        'duplicate-id',
        issue.path,
        `duplicate issue id ${issue.id}; also at ${issueIds.get(issue.id)}`,
      )
    } else {
      issueIds.set(issue.id, issue.path)
    }
    if (!issue.updated) {
      add(findings, 'warning', 'missing-updated', issue.path, 'front-matter has no updated date')
    }
    if (issue.created && issue.updated && issue.updated < issue.created) {
      add(findings, 'warning', 'updated-before-created', issue.path, 'updated is before created')
    }
    if (issue.data?.status != null && !STATUSES.includes(issue.data.status)) {
      add(
        findings,
        'error',
        'bad-status',
        issue.path,
        `status ${JSON.stringify(issue.data.status)} is not one of ${STATUSES.join(', ')}`,
      )
    }
    if (issue.data?.type != null && !ISSUE_TYPES.includes(issue.data.type)) {
      add(
        findings,
        'error',
        'bad-type',
        issue.path,
        `type ${JSON.stringify(issue.data.type)} is not one of ${ISSUE_TYPES.join(', ')}`,
      )
    }
    const expected = issuePath(issue, dirs)
    if (issue.path !== expected) {
      add(findings, 'warning', 'path-mismatch', issue.path, `expected ${expected}`)
    }
    if (issue.blockedBy.includes(issue.id)) {
      add(findings, 'error', 'self-block', issue.path, `${issue.id} is blocked by itself`)
    }
  }

  const epicIds = new Map()
  for (const epic of epics) {
    if (epicIds.has(epic.id)) {
      add(
        findings,
        'error',
        'duplicate-id',
        epic.path,
        `duplicate epic id ${epic.id}; also at ${epicIds.get(epic.id)}`,
      )
    } else {
      epicIds.set(epic.id, epic.path)
    }
    if (epic.data?.state != null && !EPIC_STATES.includes(epic.data.state)) {
      add(
        findings,
        'error',
        'bad-epic-state',
        epic.path,
        `state ${JSON.stringify(epic.data.state)} is not one of ${EPIC_STATES.join(', ')}`,
      )
    }
  }

  const sprintIds = new Map()
  for (const sprint of sprints) {
    if (sprint.path === null) continue
    if (sprintIds.has(sprint.id)) {
      add(
        findings,
        'error',
        'duplicate-id',
        sprint.path,
        `duplicate sprint id ${sprint.id}; also at ${sprintIds.get(sprint.id)}`,
      )
    } else {
      sprintIds.set(sprint.id, sprint.path)
    }
    if (sprint.data?.state != null && !SPRINT_STATES.includes(sprint.data.state)) {
      add(
        findings,
        'error',
        'bad-sprint-state',
        sprint.path,
        `state ${JSON.stringify(sprint.data.state)} is not one of ${SPRINT_STATES.join(', ')}`,
      )
    }
    const expected = sprintPath(sprint, dirs)
    if (sprint.path !== expected) {
      add(findings, 'warning', 'path-mismatch', sprint.path, `expected ${expected}`)
    }
  }

  for (const issue of issues) {
    if (issue.epic && !epicIds.has(issue.epic)) {
      add(findings, 'error', 'dangling-epic', issue.path, `epic ${issue.epic} does not exist`)
    }
    if (issue.sprint && !sprints.some((sprint) => sprint.id === issue.sprint)) {
      add(findings, 'warning', 'dangling-sprint', issue.path, `sprint ${issue.sprint} has no sprint.md`)
    }
    for (const blocker of issue.blockedBy) {
      if (!issueIds.has(blocker)) {
        add(findings, 'error', 'dangling-blocker', issue.path, `blocked_by ${blocker} does not exist`)
      }
    }
  }

  // Cycles in blocked_by are reported once, at the lowest id in the cycle.
  const byId = new Map(issues.map((issue) => [issue.id, issue]))
  const visiting = new Set()
  const visited = new Set()
  const stack = []
  const reported = new Set()

  function visit(id) {
    if (visited.has(id)) return
    if (visiting.has(id)) {
      const at = stack.indexOf(id)
      const cycle = at >= 0 ? stack.slice(at) : [id]
      const key = [...cycle].sort().join('>')
      if (!reported.has(key)) {
        reported.add(key)
        add(
          findings,
          'error',
          'blocked-cycle',
          byId.get(id)?.path ?? null,
          `blocked_by cycle: ${[...cycle, cycle[0]].join(' → ')}`,
        )
      }
      return
    }
    const issue = byId.get(id)
    if (!issue) return
    visiting.add(id)
    stack.push(id)
    for (const blocker of issue.blockedBy) visit(blocker)
    stack.pop()
    visiting.delete(id)
    visited.add(id)
  }

  for (const issue of issues) visit(issue.id)

  for (const skipped of state.skipped ?? []) {
    add(findings, 'warning', 'skipped', skipped.path, skipped.reason)
  }

  return findings
}

export function activeSprint(state, requested = null) {
  if (requested) {
    const sprint = state.sprints.find((item) => item.id === requested)
    return { sprint: sprint ?? null, warning: sprint ? null : `sprint ${requested} not found` }
  }
  const active = state.sprints.filter((sprint) => sprint.state === 'active' && sprint.path !== null)
  if (active.length === 1) return { sprint: active[0], warning: null }
  if (active.length > 1) {
    return {
      sprint: active[0],
      warning: `multiple active sprints (${active.map((sprint) => sprint.id).join(', ')}); using ${active[0].id}`,
      active: active.map((sprint) => sprint.id),
    }
  }
  return { sprint: null, warning: null }
}

function blockersOf(issue, state) {
  const byId = new Map(state.issues.map((item) => [item.id, item]))
  return issue.blockedBy.map((id) => ({
    id,
    status: byId.get(id)?.status ?? 'missing',
    done: byId.get(id)?.status === 'done',
  }))
}

export function boardState(state, options = {}) {
  const findings = validateState(state)
  const { sprint, warning, active } = activeSprint(state, options.sprint ?? null)
  const selected = options.all
    ? state.issues
    : sprint
      ? state.issues.filter((issue) => issue.sprint === sprint.id)
      : state.issues.filter((issue) => issue.status !== 'done')

  const tasks = selected.map((issue) => {
    const blockers = blockersOf(issue, state)
    const blocked = blockers.some((blocker) => !blocker.done)
    const lock = readLock(state.root, issue.id)
    const claimed = Boolean(lock && !lock.unreadable && !lockIsStale(lock))
    const assignedToHuman = Boolean(issue.assignee && !issue.assignee.startsWith('agent-'))
    const ready =
      (issue.status === 'backlog' || issue.status === 'todo') &&
      !blocked &&
      !claimed &&
      !assignedToHuman
    return {
      id: issue.id,
      title: issue.title,
      status: issue.status,
      type: issue.type,
      epic: issue.epic,
      sprint: issue.sprint,
      points: issue.points,
      assignee: issue.assignee,
      priority: issue.priority,
      order: issue.order,
      path: issue.path,
      labels: issue.labels,
      blockedBy: issue.blockedBy,
      blockers,
      blocked,
      claimed,
      claimedBy: claimed ? lock.agent ?? lock.pid : null,
      claimedAt: claimed ? lock.at ?? null : null,
      assignedToHuman,
      ready,
    }
  })

  return {
    repo: state.root,
    project: state.config.project,
    sprint: sprint
      ? {
          id: sprint.id,
          name: sprint.name,
          state: sprint.state,
          goal: sprint.goal,
          start: sprint.start,
          end: sprint.end,
          capacity: sprint.capacity,
        }
      : null,
    activeSprints: active ?? (sprint ? [sprint.id] : []),
    warning,
    tasks,
    ready: tasks.filter((task) => task.ready),
    inProgress: tasks.filter((task) => task.status === 'doing'),
    review: tasks.filter((task) => task.status === 'review'),
    blocked: tasks.filter((task) => task.blocked),
    done: tasks.filter((task) => task.status === 'done'),
    validation: findings,
  }
}

function points(list) {
  return list.reduce((sum, task) => sum + (task.points ?? 0), 0)
}

function line(task, suffix = '') {
  const bits = [task.id.padEnd(9), task.status.padEnd(8)]
  if (task.points !== null) bits.push(`${task.points} pts`)
  if (task.type) bits.push(task.type)
  if (task.epic) bits.push(task.epic)
  if (task.assignee) bits.push(task.assignee)
  if (suffix) bits.push(suffix)
  return `  ${bits.join('  ')}  ${task.title}`
}

export function formatBoard(board) {
  const out = []
  const title = board.project || 'scrumit'
  out.push(`${title}${board.sprint ? ` · ${board.sprint.id} ${board.sprint.name}` : ''}`)
  if (board.sprint?.goal) out.push(`Goal: ${board.sprint.goal}`)
  if (board.sprint?.start && board.sprint?.end) {
    out.push(`${board.sprint.start} → ${board.sprint.end}${board.sprint.capacity ? ` · capacity ${board.sprint.capacity} pts` : ''}`)
  }
  out.push(
    `${board.tasks.length} task${board.tasks.length === 1 ? '' : 's'} · ${points(board.tasks)} pts · ${board.ready.length} ready`,
  )
  if (board.warning) out.push(`! ${board.warning}`)

  out.push('', `READY (${board.ready.length})`)
  if (board.ready.length === 0) out.push('  nothing ready')
  for (const task of board.ready) out.push(line(task))

  out.push('', `IN PROGRESS (${board.inProgress.length})`)
  if (board.inProgress.length === 0) out.push('  nothing in progress')
  for (const task of board.inProgress) {
    out.push(line(task, task.claimedBy ? `claimed by ${task.claimedBy}` : 'no claim lock'))
  }

  out.push('', `BLOCKED (${board.blocked.length})`)
  if (board.blocked.length === 0) out.push('  nothing blocked')
  for (const task of board.blocked) {
    const why = task.blockers
      .filter((blocker) => !blocker.done)
      .map((blocker) => `${blocker.id} (${blocker.status})`)
      .join(', ')
    out.push(line(task, `blocked by ${why}`))
  }

  out.push('', `REVIEW (${board.review.length})`)
  if (board.review.length === 0) out.push('  nothing waiting for review')
  for (const task of board.review) out.push(line(task))

  if (board.validation.length > 0) {
    out.push('', `VALIDATION (${board.validation.length})`)
    for (const finding of board.validation.slice(0, 20)) {
      out.push(`  ${finding.severity.padEnd(8)} ${finding.code.padEnd(18)} ${finding.path ?? ''}`)
      out.push(`           ${finding.message}`)
    }
    if (board.validation.length > 20) out.push(`  … ${board.validation.length - 20} more`)
  }

  return `${out.join('\n')}\n`
}
