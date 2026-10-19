#!/usr/bin/env node
/**
 * scrumit — the sprint board CLI.
 *
 * The CLI is intentionally separate from the browser app: it reads and writes
 * the same markdown artefacts, needs no runtime dependencies, and can be used
 * in a repository where scrumit is not installed as an app.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import {
  boardState,
  formatBoard,
  validateState,
} from './lib/board.mjs'
import {
  CliError,
  blockTask,
  claimTask,
  createEpic,
  createIssue,
  createSprint,
  finishTask,
  initBoard,
  releaseTask,
} from './lib/actions.mjs'
import { findRepoRoot, repoState } from './lib/repo.mjs'
import { installSkill, printSkill, skillSourceDir } from './lib/skill.mjs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const OPTIONS = {
  repo: { type: 'string' },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
  version: { type: 'boolean', short: 'v', default: false },
  port: { type: 'string' },
  token: { type: 'string' },
  dist: { type: 'string' },
  quiet: { type: 'boolean', default: false },
  agent: { type: 'string' },
  force: { type: 'boolean', default: false },
  sprint: { type: 'string' },
  all: { type: 'boolean', default: false },
  ready: { type: 'boolean', default: false },
  strict: { type: 'boolean', default: false },
  branch: { type: 'string' },
  worktree: { type: 'string' },
  to: { type: 'string' },
  summary: { type: 'string' },
  checks: { type: 'string' },
  by: { type: 'string' },
  reason: { type: 'string' },
  title: { type: 'string' },
  status: { type: 'string' },
  type: { type: 'string' },
  epic: { type: 'string' },
  points: { type: 'string' },
  assignee: { type: 'string' },
  priority: { type: 'string' },
  labels: { type: 'string' },
  'blocked-by': { type: 'string' },
  body: { type: 'string' },
  'body-file': { type: 'string' },
  state: { type: 'string' },
  color: { type: 'string' },
  owner: { type: 'string' },
  target: { type: 'string' },
  id: { type: 'string' },
  name: { type: 'string' },
  goal: { type: 'string' },
  start: { type: 'string' },
  end: { type: 'string' },
  capacity: { type: 'string' },
  'length-days': { type: 'string' },
  dir: { type: 'string' },
  project: { type: 'string' },
}

const HELP = `scrumit — sprint board CLI

Usage:
  scrumit <command> [options]

Board:
  scrumit board [--sprint <id>] [--all] [--ready] [--json]
  scrumit validate [--strict] [--json]

Task lifecycle:
  scrumit claim <id> --agent <name> [--sprint <id>] [--branch <name>] [--worktree <path>] [--force]
  scrumit finish <id> [--to review|done] [--summary <text>] [--checks <text>] [--force]
  scrumit block <id> --by <id>[,<id>] [--reason <text>]
  scrumit release <id>

Create artefacts:
  scrumit new issue --title <title> [--status <status>] [--type <type>]
                    [--epic <id>] [--sprint <id>] [--points <n>] [--assignee <name>]
                    [--priority <0-3>] [--labels <a,b>] [--blocked-by <id,id>]
                    [--body <text> | --body-file <path>]
  scrumit new epic --title <title> [--state planned|active|done] [--color 1-8]
                   [--owner <name>] [--target <date>] [--body <text>]
  scrumit new sprint [--id <YYYY-SNN>] [--name <name>] [--goal <text>]
                     [--start <YYYY-MM-DD>] [--end <YYYY-MM-DD>] [--capacity <n>]
                     [--length-days <n>] [--state planned|active|closed]

Skill:
  scrumit skill install [--dir .skills] [--force] [--json]
  scrumit skill print
  scrumit skill path

Sidecar:
  scrumit serve [--repo <path>] [--port 5180] [--token <token>] [--dist <path>] [--quiet]

Repository:
  scrumit init [--project <name>] [--force]

Global options:
  --repo <path>   Run against a repository other than the current directory.
  --json          Machine-readable output. Errors are JSON too.
  --agent <name>  Agent handle for claims and commits (env: SCRUMIT_AGENT).
  --force         Override a stale claim, assignment, or existing skill/config.
  -h, --help      Show this help.
  -v, --version   Print the version.

Environment:
  SCRUMIT_AGENT       Default agent handle.
  SCRUMIT_LOCK_DIR    Directory for claim locks (default: OS temp).
  SCRUMIT_LOCK_TTL_MS Claim staleness window (default: 2 hours).

Exit codes:
  0 success, including "nothing is ready"
  1 a command failed (blocked task, dirty tree, missing artefact)
  2 invalid usage

The artefacts are the source of truth. The CLI never invents a status, never
rewrites the markdown body for a status change, and commits only the files a
command owns.`

function print(value) {
  process.stdout.write(value.endsWith('\n') ? value : `${value}\n`)
}

function json(value) {
  print(JSON.stringify(value, null, 2))
}

function formatValidation(findings) {
  if (findings.length === 0) return 'No validation problems.\n'
  const lines = [`${findings.length} validation problem${findings.length === 1 ? '' : 's'}:`]
  for (const finding of findings) {
    lines.push(
      `  ${finding.severity.padEnd(8)} ${finding.code.padEnd(18)} ${finding.path ?? ''}`,
    )
    lines.push(`           ${finding.message}`)
  }
  return `${lines.join('\n')}\n`
}

function usageError(message) {
  throw new CliError(`${message}\n\nRun \`scrumit help\` for usage.`, 2)
}

async function main() {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: OPTIONS,
    allowPositionals: true,
    strict: true,
  })
  const values = parsed.values
  const positionals = parsed.positionals

  if (values.version) {
    print(pkg.version)
    return
  }
  if (values.help || positionals.length === 0) {
    print(HELP)
    return
  }

  const root = resolve(values.repo ?? findRepoRoot(process.cwd()))
  const command = positionals[0]
  const subcommand = positionals[1]

  if (command === 'help') {
    print(HELP)
    return
  }

  if (command === 'board') {
    const state = repoState(root)
    const board = boardState(state, { sprint: values.sprint, all: values.all })
    if (values.ready) {
      print(board.ready.map((task) => task.id).join('\n'))
      return
    }
    if (values.json) json(board)
    else print(formatBoard(board))
    return
  }

  if (command === 'validate') {
    const state = repoState(root)
    const findings = validateState(state)
    if (values.json) {
      json({ ok: findings.every((finding) => finding.severity !== 'error'), findings })
    } else {
      print(formatValidation(findings))
    }
    const bad = findings.some(
      (finding) => finding.severity === 'error' || (values.strict && finding.severity === 'warning'),
    )
    if (bad) process.exitCode = 1
    return
  }

  if (command === 'claim') {
    const id = positionals[1]
    if (!id) usageError('claim requires a task id')
    const result = claimTask(root, id, {
      agent: values.agent,
      sprint: values.sprint,
      branch: values.branch,
      worktree: values.worktree,
      force: values.force,
    })
    if (values.json) json({ ok: true, ...result })
    else {
      print(`Claimed ${result.id} for ${result.agent}.`)
      if (result.branch) print(`  branch   ${result.branch}`)
      if (result.worktree) print(`  worktree ${result.worktree}`)
      print(`  commit   ${result.commit}`)
    }
    return
  }

  if (command === 'finish') {
    const id = positionals[1]
    if (!id) usageError('finish requires a task id')
    const result = finishTask(root, id, {
      to: values.to,
      summary: values.summary,
      checks: values.checks,
      agent: values.agent,
      force: values.force,
    })
    if (values.json) json({ ok: true, ...result })
    else print(`${result.id} is now ${result.status}${result.commit ? ` (${result.commit})` : ''}.`)
    return
  }

  if (command === 'block') {
    const id = positionals[1]
    if (!id) usageError('block requires a task id')
    const result = blockTask(root, id, {
      by: values.by,
      reason: values.reason,
      agent: values.agent,
    })
    if (values.json) json({ ok: true, ...result })
    else print(`${result.id} is blocked by ${result.blockedBy.join(', ')} (${result.commit}).`)
    return
  }

  if (command === 'release') {
    const id = positionals[1]
    if (!id) usageError('release requires a task id')
    const result = releaseTask(root, id, { agent: values.agent })
    if (values.json) json({ ok: true, ...result })
    else print(`${result.id} released (${result.commit}).`)
    return
  }

  if (command === 'new') {
    if (subcommand === 'issue') {
      const result = createIssue(root, {
        title: values.title,
        status: values.status,
        type: values.type,
        epic: values.epic,
        sprint: values.sprint,
        points: values.points,
        assignee: values.assignee,
        priority: values.priority,
        labels: values.labels,
        blockedBy: values['blocked-by'],
        body: values.body,
        bodyFile: values['body-file'],
      })
      if (values.json) json({ ok: true, ...result })
      else print(`Created ${result.id} at ${result.path} (${result.commit}).`)
      return
    }
    if (subcommand === 'epic') {
      const result = createEpic(root, {
        title: values.title,
        state: values.state,
        color: values.color,
        owner: values.owner,
        target: values.target,
        body: values.body,
        bodyFile: values['body-file'],
      })
      if (values.json) json({ ok: true, ...result })
      else print(`Created ${result.id} at ${result.path} (${result.commit}).`)
      return
    }
    if (subcommand === 'sprint') {
      const result = createSprint(root, {
        id: values.id,
        name: values.name,
        goal: values.goal,
        start: values.start,
        end: values.end,
        capacity: values.capacity,
        lengthDays: values['length-days'],
        state: values.state,
        body: values.body,
        bodyFile: values['body-file'],
      })
      if (values.json) json({ ok: true, ...result })
      else print(`Created ${result.id} at ${result.path} (${result.commit}).`)
      return
    }
    usageError('new requires a subcommand: issue, epic, or sprint')
  }

  if (command === 'serve') {
    const { startServer } = await import('../server/index.mjs')
    const info = await startServer({
      repo: root,
      port: values.port === undefined ? undefined : Number(values.port),
      token: values.token,
      dist: values.dist,
      quiet: values.quiet,
    })
    if (values.json) {
      json({ ok: true, url: info.url, repo: info.repo, token: info.token, port: info.port })
    } else if (!values.quiet) {
      print(`scrumit  ${info.url}`)
      print(`  repo   ${info.repo}`)
      print(`  token  ${info.token}`)
      print('')
      print('Set the same token in scrumit, or open the built app served by this process.')
    }
    const close = async () => {
      await info.stop()
      process.exit(0)
    }
    process.on('SIGINT', () => void close())
    process.on('SIGTERM', () => void close())
    return
  }

  if (command === 'init') {
    const result = initBoard(root, { project: values.project, force: values.force })
    if (values.json) json({ ok: true, ...result })
    else print(`Initialised ${result.path} for ${result.project} (${result.commit}).`)
    return
  }

  if (command === 'skill') {
    if (subcommand === 'path') {
      print(skillSourceDir())
      return
    }
    if (subcommand === 'print') {
      print(printSkill())
      return
    }
    if (subcommand === 'install') {
      const result = installSkill(root, { dir: values.dir, force: values.force })
      if (values.json) json({ ok: true, ...result })
      else {
        print(`Installed ${result.relativeTarget}.`)
        if (result.written.length > 0) {
          print(`  wrote   ${result.written.length} file${result.written.length === 1 ? '' : 's'}`)
        }
        if (result.skipped.length > 0) {
          print(`  skipped ${result.skipped.length} existing file${result.skipped.length === 1 ? '' : 's'} (--force to overwrite)`)
        }
      }
      return
    }
    usageError('skill requires a subcommand: install, print, or path')
  }

  usageError(`Unknown command: ${command}`)
}

try {
  await main()
} catch (error) {
  const asJson = process.argv.includes('--json')
  const message = error instanceof Error ? error.message : String(error)
  const code = error instanceof CliError ? error.exitCode : 1
  if (asJson) json({ ok: false, error: message, exitCode: code })
  else process.stderr.write(`scrumit: ${message}\n`)
  process.exitCode = code
}
