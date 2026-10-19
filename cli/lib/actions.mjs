import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  STATUSES,
  ISSUE_TYPES,
  EPIC_STATES,
  SPRINT_STATES,
  acquireLock,
  commitPaths,
  currentBranch,
  epicPath,
  git,
  isClean,
  isGitRepo,
  isMerged,
  issuePath,
  nextEpicId,
  nextIssueId,
  nextOrder,
  nextSprintId,
  readLock,
  releaseLock,
  repoState,
  serializeConfig,
  slug,
  sprintPath,
  todayISO,
  worktreeFor,
} from './repo.mjs'
import {
  appendBodySection,
  parseFrontmatter,
  serializeFrontmatter,
  setKeys,
} from './frontmatter.mjs'

export class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
  }
}

function requireGit(root) {
  if (!isGitRepo(root)) {
    throw new CliError('This directory is not a git repository. Run `git init` first.')
  }
}

function requireClean(root) {
  requireGit(root)
  if (!isClean(root)) {
    const status = git(root, ['status', '--short'])
    throw new CliError(
      `Working tree is not clean. Commit or stash these changes first:\n${status}`,
    )
  }
}

function issueById(state, id) {
  const issue = state.issues.find((item) => item.id === id)
  if (!issue) throw new CliError(`Task ${id} not found under ${state.config.dirs.sprints}/ or ${state.config.dirs.backlog}/`)
  return issue
}

function epicById(state, id) {
  const epic = state.epics.find((item) => item.id === id)
  if (!epic) throw new CliError(`Epic ${id} not found`)
  return epic
}

function sprintById(state, id) {
  const sprint = state.sprints.find((item) => item.id === id)
  if (!sprint || !sprint.path) throw new CliError(`Sprint ${id} not found`)
  return sprint
}

function blockers(root, issue) {
  const state = repoState(root)
  const byId = new Map(state.issues.map((item) => [item.id, item]))
  return issue.blockedBy.map((id) => ({
    id,
    status: byId.get(id)?.status ?? 'missing',
  }))
}

function describeBlockers(list) {
  return list
    .filter((blocker) => blocker.status !== 'done')
    .map((blocker) => `${blocker.id} (${blocker.status})`)
    .join(', ')
}

function agentName(options, fallback = null) {
  const raw = options.agent || process.env.SCRUMIT_AGENT || fallback || ''
  if (!raw) return `agent-${(process.env.USER || 'unknown').toLowerCase()}`
  return raw.startsWith('agent-') ? raw : `agent-${slug(raw, 32)}`
}

function commitMessage(type, id, summary, trailers = {}) {
  const lines = [`${type}(${id}): ${summary}`, '', `Scrumit-Task: ${id}`]
  for (const [key, value] of Object.entries(trailers)) {
    if (value !== null && value !== undefined && value !== '') lines.push(`Scrumit-${key}: ${value}`)
  }
  return lines.join('\n')
}

function writeText(path, text) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

function readText(path) {
  return readFileSync(path, 'utf8')
}

function ensureBody(text) {
  return text.startsWith('\n') ? text : `\n${text}`
}

function template(name) {
  try {
    return readFileSync(new URL(`../../skills/scrumit-sprint/templates/${name}`, import.meta.url), 'utf8')
  } catch {
    return ''
  }
}

function moveArtifact(root, oldPath, newPath) {
  if (oldPath === newPath) return
  const oldAbs = join(root, oldPath)
  if (!existsSync(oldAbs)) return
  const newAbs = join(root, newPath)
  mkdirSync(dirname(newAbs), { recursive: true })
  let tracked = false
  try {
    git(root, ['ls-files', '--error-unmatch', '--', oldPath])
    tracked = true
  } catch {
    tracked = false
  }
  if (tracked) git(root, ['mv', '--', oldPath, newPath])
  else renameSync(oldAbs, newAbs)
}

function updateIssueFile(root, issue, patch) {
  const oldPath = issue.path
  const next = { ...issue, ...patch }
  const newPath = issuePath(next, repoState(root).config.dirs)
  const oldText = readText(join(root, oldPath))
  const newText = setKeys(oldText, patch)
  moveArtifact(root, oldPath, newPath)
  writeText(join(root, newPath), newText)
  return { oldPath, newPath, text: newText }
}

function worktreePath(root, id) {
  return resolve(dirname(root), `${basename(root)}-worktrees`, id)
}

function claimLockInfo(root, id, agent, options) {
  return {
    repo: root,
    id,
    agent,
    branch: options.branch ?? null,
    worktree: options.worktree ?? null,
    base: currentBranch(root),
  }
}

export function claimTask(root, id, options = {}) {
  requireClean(root)
  let state = repoState(root)
  const issue = issueById(state, id)

  if (issue.sprint) {
    const sprint = state.sprints.find((item) => item.id === issue.sprint)
    if (!sprint || !sprint.path) {
      throw new CliError(
        `Sprint ${issue.sprint} has no sprint.md. Create it before claiming work in it.`,
      )
    }
    if (sprint.state !== 'active') {
      throw new CliError(
        `Sprint ${issue.sprint} is ${sprint.state}. Activate it before claiming work in it.`,
      )
    }
  }

  if (!options.force && issue.status !== 'backlog' && issue.status !== 'todo') {
    throw new CliError(
      `${id} is ${issue.status}; only backlog or todo tasks can be claimed. Use --force to take over a stale claim.`,
    )
  }
  if (issue.assignee && !issue.assignee.startsWith('agent-') && !options.force) {
    throw new CliError(`${id} is assigned to ${issue.assignee}. Use --force if you are taking it over.`)
  }

  const blocked = blockers(root, issue)
  const open = describeBlockers(blocked)
  if (open) throw new CliError(`${id} is blocked by ${open}. Do not claim blocked work.`)

  const agent = agentName(options, issue.assignee)
  const lock = acquireLock(root, id, claimLockInfo(root, id, agent, options), {
    force: options.force,
  })
  if (lock.conflict) {
    const holder = lock.existing?.agent ?? lock.existing?.pid ?? 'another process'
    throw new CliError(
      `${id} is already claimed by ${holder}. Leave it alone, or release the stale claim with --force.`,
    )
  }

  try {
    const sprint =
      options.sprint === undefined ? issue.sprint : options.sprint === 'none' ? null : options.sprint
    if (sprint) sprintById(state, sprint)

    const patch = {
      status: 'doing',
      assignee: agent,
      updated: todayISO(),
      order: nextOrder(state.issues, 'doing', issue.id),
    }
    if (options.sprint !== undefined) patch.sprint = sprint

    const moved = updateIssueFile(root, issue, patch)
    const branch =
      options.branch ??
      (options.worktree ? `task/${id}-${slug(issue.title)}` : null)
    const message = commitMessage('chore', id, 'claim task', {
      Sprint: sprint,
      Agent: agent,
      Branch: branch,
    })
    const sha = commitPaths(root, [moved.oldPath, moved.newPath], message)

    let worktree = null
    if (options.worktree) {
      worktree = resolve(options.worktree)
      if (existsSync(worktree)) {
        throw new CliError(`Worktree path already exists: ${worktree}`)
      }
      mkdirSync(dirname(worktree), { recursive: true })
      git(root, ['worktree', 'add', '-b', branch, worktree])
    }

    const finalLock = {
      ...claimLockInfo(root, id, agent, { ...options, branch, worktree }),
      at: new Date().toISOString(),
      pid: process.pid,
      claimCommit: sha,
    }
    writeFileSync(lock.path, JSON.stringify(finalLock, null, 2))

    return { id, agent, branch, worktree, commit: sha, path: moved.newPath, sprint }
  } catch (error) {
    releaseLock(root, id)
    throw error
  }
}

export function finishTask(root, id, options = {}) {
  requireClean(root)
  const state = repoState(root)
  const issue = issueById(state, id)
  const to = options.to ?? 'review'
  if (to !== 'review' && to !== 'done') {
    throw new CliError('--to must be review or done')
  }
  if (issue.status === 'done') {
    return { id, status: 'done', alreadyDone: true, path: issue.path, commit: null }
  }
  if (issue.status !== 'doing' && issue.status !== 'review' && !options.force) {
    throw new CliError(`${id} is ${issue.status}; only doing or review tasks can be finished.`)
  }

  const lock = readLock(root, id)
  if (lock?.agent && options.agent && lock.agent !== options.agent && !options.force) {
    throw new CliError(`${id} is claimed by ${lock.agent}. Use --force as the orchestrator.`)
  }

  const branch = options.branch ?? lock?.branch ?? null
  if (to === 'done' && branch && !options.force) {
    const merged = isMerged(root, branch)
    if (merged === false) {
      throw new CliError(
        `Branch ${branch} is not merged into ${currentBranch(root)}. Merge it first, or finish --to review.`,
      )
    }
  }

  const patch = {
    status: to,
    updated: todayISO(),
    order: nextOrder(state.issues, to, issue.id),
  }

  let text = setKeys(readText(join(root, issue.path)), patch)
  if (to === 'done') {
    const commits = git(root, ['log', '--format=%h', '--grep', `Scrumit-Task: ${id}`]).split('\n').filter(Boolean)
    const lines = []
    if (branch) lines.push(`- Branch: \`${branch}\``)
    if (commits.length > 0) lines.push(`- Commits: ${commits.map((sha) => `\`${sha}\``).join(', ')}`)
    if (options.summary) lines.push(`- Summary: ${options.summary}`)
    if (options.checks) lines.push(`- Checks: ${options.checks}`)
    if (lines.length > 0) text = appendBodySection(text, 'Delivery', lines)
  }

  const next = { ...issue, ...patch }
  const newPath = issuePath(next, state.config.dirs)
  moveArtifact(root, issue.path, newPath)
  writeText(join(root, newPath), text)

  const message = commitMessage('chore', id, to === 'done' ? 'complete task' : 'ready for review', {
    Sprint: issue.sprint,
    Agent: options.agent ?? lock?.agent ?? null,
    Branch: branch,
    Summary: options.summary ?? null,
  })
  const sha = commitPaths(root, [issue.path, newPath], message)

  if (to === 'done' && lock?.worktree && existsSync(lock.worktree)) {
    try {
      if (isClean(lock.worktree)) git(root, ['worktree', 'remove', lock.worktree])
    } catch {
      // A worktree that cannot be removed is left in place and reported.
    }
  }
  if (to === 'done') releaseLock(root, id)

  return {
    id,
    status: to,
    commit: sha,
    path: newPath,
    branch,
    worktree: lock?.worktree ?? null,
  }
}

export function blockTask(root, id, options = {}) {
  requireClean(root)
  const state = repoState(root)
  const issue = issueById(state, id)
  const by = (options.by ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (by.length === 0) throw new CliError('block requires --by <issue-id>[,<issue-id>]')
  if (issue.status === 'done') throw new CliError(`${id} is already done`)

  const byId = new Map(state.issues.map((item) => [item.id, item]))
  const unknown = by.filter((blocker) => !byId.has(blocker))
  if (unknown.length > 0) {
    throw new CliError(
      `blocked_by references unknown issues: ${unknown.join(', ')}. Create them first or fix the id.`,
    )
  }
  const alreadyDone = by.filter((blocker) => byId.get(blocker).status === 'done')
  if (alreadyDone.length > 0) {
    throw new CliError(
      `${alreadyDone.join(', ')} ${alreadyDone.length === 1 ? 'is' : 'are'} already done; that is not a blocker.`,
    )
  }

  const blockedBy = [...new Set([...issue.blockedBy, ...by])]
  const patch = {
    status: 'todo',
    assignee: null,
    updated: todayISO(),
    blocked_by: blockedBy,
    order: nextOrder(state.issues, 'todo', issue.id),
  }

  let text = setKeys(readText(join(root, issue.path)), patch)
  const reason = options.reason ?? 'waiting on a dependency'
  text = appendBodySection(text, 'Blocked', [
    `- ${todayISO()} — blocked by ${by.join(', ')}: ${reason}`,
  ])

  const next = { ...issue, ...patch, assignee: null, blockedBy }
  const newPath = issuePath(next, state.config.dirs)
  moveArtifact(root, issue.path, newPath)
  writeText(join(root, newPath), text)

  const message = commitMessage('chore', id, `blocked by ${by.join(', ')}`, {
    Sprint: issue.sprint,
    Agent: options.agent ?? null,
    Reason: reason,
  })
  const sha = commitPaths(root, [issue.path, newPath], message)
  releaseLock(root, id)
  return { id, status: 'todo', blockedBy, commit: sha, path: newPath }
}

export function releaseTask(root, id, options = {}) {
  requireClean(root)
  const state = repoState(root)
  const issue = issueById(state, id)
  if (issue.status === 'done') throw new CliError(`${id} is already done`)

  const patch = {
    status: 'todo',
    assignee: null,
    updated: todayISO(),
    order: nextOrder(state.issues, 'todo', issue.id),
  }
  const text = setKeys(readText(join(root, issue.path)), patch)
  const newPath = issuePath({ ...issue, ...patch, assignee: null }, state.config.dirs)
  moveArtifact(root, issue.path, newPath)
  writeText(join(root, newPath), text)

  const message = commitMessage('chore', id, 'release task', {
    Sprint: issue.sprint,
    Agent: options.agent ?? null,
  })
  const sha = commitPaths(root, [issue.path, newPath], message)
  releaseLock(root, id)
  return { id, status: 'todo', commit: sha, path: newPath }
}

export function createIssue(root, options = {}) {
  requireClean(root)
  const state = repoState(root)
  const title = String(options.title ?? '').trim()
  if (!title) throw new CliError('new issue requires --title')

  const status = options.status ?? 'backlog'
  if (!STATUSES.includes(status)) throw new CliError(`status must be one of ${STATUSES.join(', ')}`)
  const type = options.type ?? 'story'
  if (!ISSUE_TYPES.includes(type)) throw new CliError(`type must be one of ${ISSUE_TYPES.join(', ')}`)

  const sprint = options.sprint ? String(options.sprint) : null
  if (sprint) sprintById(state, sprint)
  const epic = options.epic ? String(options.epic) : null
  if (epic) epicById(state, epic)

  const blockedBy = (options.blockedBy ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const known = new Set(state.issues.map((item) => item.id))
  for (const blocker of blockedBy) {
    if (!known.has(blocker)) throw new CliError(`blocked_by ${blocker} does not exist`)
  }

  const labels = (options.labels ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  const id = nextIssueId(state.issues, state.config.project)
  const body = ensureBody(
    options.body ??
      (options.bodyFile ? readText(resolve(options.bodyFile)) : template('issue.md') || '\n'),
  )
  const issue = {
    id,
    title,
    status,
    type,
    epic,
    sprint,
    points: options.points === undefined ? null : Number(options.points),
    assignee: options.assignee ?? null,
    priority: options.priority === undefined ? null : Number(options.priority),
    labels,
    blockedBy,
    links: [],
    order: nextOrder(state.issues, status),
    created: todayISO(),
    updated: todayISO(),
    body,
    path: null,
  }
  issue.path = issuePath(issue, state.config.dirs)

  const data = {
    id: issue.id,
    title: issue.title,
    status: issue.status,
    type: issue.type,
    epic: issue.epic ?? undefined,
    sprint: issue.sprint ?? undefined,
    points: issue.points ?? undefined,
    assignee: issue.assignee ?? undefined,
    priority: issue.priority ?? undefined,
    labels: issue.labels.length ? issue.labels : undefined,
    blocked_by: issue.blockedBy.length ? issue.blockedBy : undefined,
    order: issue.order,
    created: issue.created,
    updated: issue.updated,
  }
  const text = `${serializeFrontmatter(data)}${body}`
  writeText(join(root, issue.path), text)
  const message = commitMessage('chore', id, 'create issue', {
    Sprint: issue.sprint,
    Epic: issue.epic,
  })
  const sha = commitPaths(root, [issue.path], message)
  return { ...issue, commit: sha }
}

export function createEpic(root, options = {}) {
  requireClean(root)
  const state = repoState(root)
  const title = String(options.title ?? '').trim()
  if (!title) throw new CliError('new epic requires --title')
  const stateValue = options.state ?? 'planned'
  if (!EPIC_STATES.includes(stateValue)) {
    throw new CliError(`epic state must be one of ${EPIC_STATES.join(', ')}`)
  }
  const used = new Set(state.epics.map((epic) => epic.color))
  let color = options.color === undefined ? 1 : Number(options.color)
  if (options.color === undefined) {
    while (used.has(color) && color <= 8) color++
    if (color > 8) color = 1
  }

  const epic = {
    id: nextEpicId(state.epics),
    title,
    state: stateValue,
    owner: options.owner ?? null,
    target: options.target ?? null,
    color,
    path: null,
  }
  epic.path = epicPath(epic, state.config.dirs)
  const body = ensureBody(
    options.body ?? (options.bodyFile ? readText(resolve(options.bodyFile)) : template('epic.md') || '\n'),
  )
  const data = {
    id: epic.id,
    title: epic.title,
    state: epic.state,
    color: epic.color,
    owner: epic.owner ?? undefined,
    target: epic.target ?? undefined,
  }
  writeText(join(root, epic.path), `${serializeFrontmatter(data)}${body}`)
  const sha = commitPaths(root, [epic.path], commitMessage('chore', epic.id, 'create epic'))
  return { ...epic, body, commit: sha }
}

export function createSprint(root, options = {}) {
  requireClean(root)
  const state = repoState(root)
  const id = options.id ? String(options.id) : nextSprintId(state.sprints)
  const existing = state.sprints.find((sprint) => sprint.id === id && sprint.path)
  if (existing) throw new CliError(`Sprint ${id} already exists`)

  const start = options.start ?? todayISO()
  const length = options.lengthDays === undefined ? state.config.sprintLengthDays : Number(options.lengthDays)
  const end =
    options.end ??
    new Date(Date.parse(`${start}T00:00:00Z`) + length * 86_400_000).toISOString().slice(0, 10)
  const stateValue = options.state ?? 'planned'
  if (!SPRINT_STATES.includes(stateValue)) {
    throw new CliError(`sprint state must be one of ${SPRINT_STATES.join(', ')}`)
  }

  const sprint = {
    id,
    name: options.name ?? `Sprint ${id.split('-S')[1] ?? id}`,
    goal: options.goal ?? '',
    start,
    end,
    capacity: options.capacity === undefined ? null : Number(options.capacity),
    state: stateValue,
    path: null,
  }
  sprint.path = sprintPath(sprint, state.config.dirs)
  const body = ensureBody(
    options.body ?? (options.bodyFile ? readText(resolve(options.bodyFile)) : template('sprint.md') || '\n'),
  )
  const data = {
    id: sprint.id,
    name: sprint.name,
    state: sprint.state,
    goal: sprint.goal || undefined,
    start: sprint.start,
    end: sprint.end,
    capacity: sprint.capacity ?? undefined,
  }
  writeText(join(root, sprint.path), `${serializeFrontmatter(data)}${body}`)
  const sha = commitPaths(root, [sprint.path], commitMessage('chore', sprint.id, 'create sprint'))
  return { ...sprint, body, commit: sha }
}

export function initBoard(root, options = {}) {
  requireGit(root)
  const path = join(root, '.scrumit', 'config.yaml')
  if (existsSync(path) && !options.force) {
    throw new CliError('.scrumit/config.yaml already exists. Use --force to overwrite it.')
  }
  const project = options.project ?? (basename(root) || 'scrumit')
  const config = repoState(root).config
  config.project = project
  writeText(path, serializeConfig(config))
  const sha = commitPaths(root, ['.scrumit/config.yaml'], 'chore(scrumit): initialise board')
  return { path: '.scrumit/config.yaml', project, commit: sha }
}
