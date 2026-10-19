/**
 * The skill is documentation an agent will follow literally. Like llms.txt, it
 * is tested against the enums and the CLI rather than trusted.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SKILL = join(ROOT, 'skills/scrumit-sprint')
const CLI = join(ROOT, 'cli/scrumit.mjs')

function read(path) {
  return readFileSync(join(SKILL, path), 'utf8')
}

test('the skill names every fixed status and type', () => {
  const text = read('SKILL.md')
  for (const status of ['backlog', 'todo', 'doing', 'review', 'done']) {
    assert.match(text, new RegExp(`\`${status}\``), `SKILL.md is missing \`${status}\``)
  }
  for (const type of ['story', 'bug', 'chore', 'spike']) {
    assert.match(text, new RegExp(`\`${type}\``), `SKILL.md is missing \`${type}\``)
  }
})

test('the skill never invents a blocked status', () => {
  const text = read('SKILL.md')
  assert.match(text, /blocked_by/)
  assert.doesNotMatch(text, /^status:\s*blocked\s*$/m)
  assert.doesNotMatch(text, /`blocked`\s+status/i)
})

test('the skill references the CLI contract and the supporting files', () => {
  const text = read('SKILL.md')
  for (const command of ['scrumit board', 'scrumit claim', 'scrumit finish', 'scrumit block', 'scrumit release']) {
    assert.ok(text.includes(command), `SKILL.md is missing ${command}`)
  }
  assert.match(text, /Scrumit-Task:/)
  for (const path of [
    'references/format.md',
    'references/git-protocol.md',
    'references/orchestration.md',
    'references/cli.md',
    'templates/issue.md',
    'templates/epic.md',
    'templates/sprint.md',
  ]) {
    assert.ok(existsSync(join(SKILL, path)), `missing skill file ${path}`)
  }
})

test('the CLI help exposes every lifecycle command', () => {
  const result = spawnSync(process.execPath, [CLI, 'help'], { encoding: 'utf8' })
  assert.equal(result.status, 0)
  for (const command of ['board', 'validate', 'claim', 'finish', 'block', 'release', 'new', 'init', 'serve', 'skill install']) {
    assert.ok(result.stdout.includes(command), `help is missing ${command}`)
  }
})

test('the repository config makes .skills discoverable', () => {
  const config = readFileSync(join(ROOT, '.opencode/opencode.jsonc'), 'utf8')
  assert.match(config, /"skills"\s*:\s*\[\s*"\.skills"\s*\]/)
})
