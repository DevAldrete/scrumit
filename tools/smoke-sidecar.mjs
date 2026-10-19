/**
 * Cross-browser sidecar smoke.
 *
 *   npm run build
 *   node tools/smoke-sidecar.mjs --matrix
 *
 * The sidecar tier runs in Chromium, Firefox, and WebKit against a real temp
 * repository: connect with the printed token, change a card through the UI,
 * confirm the file on disk, watch an external write appear, then stop the server
 * and confirm the failure is legible. The read-only tier runs the Vite dev app in
 * WebKit and drives the read-only fixture through the dev seam.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, firefox, webkit } from 'playwright'
import { createServer as createViteServer } from 'vite'

import { startServer } from '../server/index.mjs'

const ARGS = process.argv.slice(2)
const MATRIX = ARGS.includes('--matrix')
const TIER = option('--tier')
const BROWSERS = MATRIX ? ['chromium', 'firefox', 'webkit'] : [option('--browser') ?? 'chromium']
const ROOT = process.cwd()
const DIST = join(ROOT, 'dist')
const SHOTS = join(ROOT, 'tools', 'shots')
const LAUNCHERS = { chromium, firefox, webkit }
const problems = []

function option(name) {
  const index = ARGS.indexOf(name)
  return index >= 0 ? ARGS[index + 1] : null
}

function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'scrumit-matrix-'))
  mkdirSync(join(repo, '.scrumit'), { recursive: true })
  mkdirSync(join(repo, 'backlog'), { recursive: true })
  mkdirSync(join(repo, 'sprints/2026-S01'), { recursive: true })
  writeFileSync(join(repo, '.scrumit/config.yaml'), 'version: 1\nproject: Matrix\n')
  writeFileSync(
    join(repo, 'sprints/2026-S01/sprint.md'),
    '---\nid: 2026-S01\nname: Sprint 1\nstate: active\ngoal: Prove the matrix\n---\n',
  )
  writeFileSync(
    join(repo, 'sprints/2026-S01/MATRIX-1.md'),
    '---\nid: MATRIX-1\ntitle: Matrix card\nstatus: todo\ntype: story\nsprint: 2026-S01\norder: 10\ncreated: 2026-10-19\nupdated: 2026-10-19\n---\n\n## Context\n\nA card the smoke can edit.\n',
  )
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' })
  git('init', '-q', '-b', 'matrix')
  git('config', 'user.name', 'Matrix Agent')
  git('config', 'user.email', 'matrix@example.com')
  git('add', '.')
  git('commit', '-q', '-m', 'matrix fixture')
  return repo
}

async function waitForText(page, text, timeout = 10_000) {
  // Playwright's signature is (pageFunction, arg, options), unlike Puppeteer's.
  await page.waitForFunction(
    (needle) => document.body.innerText.includes(needle),
    text,
    { timeout },
  )
}

async function runSidecar(name) {
  const launcher = LAUNCHERS[name]
  if (!launcher) throw new Error(`Unknown browser: ${name}`)
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error('dist/index.html is missing. Run `npm run build` first.')
  }

  const repo = makeRepo()
  const info = await startServer({
    repo,
    port: 0,
    token: 'matrix-token',
    quiet: true,
    dist: DIST,
  })
  const browser = await launcher.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  let ignoreErrors = false

  page.on('console', (message) => {
    if (!ignoreErrors && message.type() === 'error') {
      problems.push(`${name} console.error: ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => {
    if (!ignoreErrors) problems.push(`${name} pageerror: ${error.message}`)
  })
  page.on('requestfailed', (request) => {
    if (!ignoreErrors) {
      problems.push(`${name} requestfailed: ${request.url()} ${request.failure()?.errorText}`)
    }
  })

  try {
    console.log(`- ${name}: connect to the sidecar`)
    await page.goto(`${info.url}/#token=${info.token}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('nav[aria-label="Views"]', { timeout: 15_000 })
    await waitForText(page, 'MATRIX-1', 15_000)

    console.log(`- ${name}: edit a card and confirm the file`)
    await page.locator('.card').filter({ hasText: 'MATRIX-1' }).first().click()
    await waitForText(page, 'Assignee')
    await page.locator('aside select').first().selectOption('doing')
    await new Promise((resolve) => setTimeout(resolve, 1400))
    const onDisk = readFileSync(join(repo, 'sprints/2026-S01/MATRIX-1.md'), 'utf8')
    if (!/^status: doing$/m.test(onDisk)) {
      problems.push(`${name}: the UI change did not reach the file`)
    }
    await page.screenshot({ path: join(SHOTS, `matrix-${name}.png`) })

    console.log(`- ${name}: follow an external write`)
    writeFileSync(
      join(repo, 'backlog/MATRIX-2.md'),
      '---\nid: MATRIX-2\ntitle: External from the matrix\nstatus: backlog\ntype: story\norder: 10\n---\n',
    )
    await waitForText(page, 'External from the matrix', 10_000)

    console.log(`- ${name}: open the git changes view`)
    await page.locator('nav[aria-label="Views"] button[aria-label="Changes"]').click()
    await waitForText(page, 'MATRIX-2.md', 10_000)
    await page.locator('button').filter({ hasText: 'MATRIX-2.md' }).first().click()
    await waitForText(page, 'External from the matrix', 10_000)
    await page.screenshot({ path: join(SHOTS, `changes-${name}.png`) })

    console.log(`- ${name}: stop the server and make the failure legible`)
    ignoreErrors = true
    await info.stop()
    await waitForText(page, 'not responding', 10_000)
  } catch (error) {
    problems.push(`${name}: ${error.message}`)
  } finally {
    await browser.close().catch(() => {})
    await info.stop().catch(() => {})
  }
}

async function runReadonly(name) {
  const launcher = LAUNCHERS[name]
  if (!launcher) throw new Error(`Unknown browser: ${name}`)
  const vite = await createViteServer({
    root: ROOT,
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  })
  await vite.listen()
  const address = vite.httpServer?.address()
  const url = `http://127.0.0.1:${address.port}/`
  const browser = await launcher.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`${name} console.error: ${message.text()}`)
  })
  page.on('pageerror', (error) => problems.push(`${name} pageerror: ${error.message}`))

  try {
    console.log(`- ${name}: open the read-only fixture`)
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await waitForText(page, 'Open a folder read-only', 15_000)
    console.log(`  ${name}: welcome loaded`)
    await page.evaluate(() => window.__scrumit.openReadOnlyFake())
    console.log(`  ${name}: fixture requested`)
    await page.waitForSelector('nav[aria-label="Views"]', { timeout: 15_000 })
    console.log(`  ${name}: shell visible`)
    await waitForText(page, 'READONLY-1', 15_000)
    console.log(`  ${name}: card visible`)

    const state = await page.evaluate(() => ({
      banner: document.body.innerText.includes('Read-only'),
      composers: [...document.querySelectorAll('button')].filter((button) =>
        /Add to/i.test(button.textContent ?? ''),
      ).length,
    }))
    if (!state.banner) problems.push(`${name}: read-only banner is missing`)
    if (state.composers > 0) problems.push(`${name}: read-only board offers a composer`)

    await page.locator('.card').filter({ hasText: 'READONLY-1' }).first().click()
    console.log(`  ${name}: card clicked`)
    await waitForText(page, 'Assignee')
    console.log(`  ${name}: panel visible`)
    const panel = await page.evaluate(() => {
      const title = document.querySelector('textarea[aria-label="Title"]')
      return {
        locked: title?.readOnly === true || title?.disabled === true,
        deletes: document.querySelectorAll('button[title="Delete this issue"]').length,
      }
    })
    if (!panel.locked) problems.push(`${name}: read-only title is editable`)
    if (panel.deletes > 0) problems.push(`${name}: read-only Delete is present`)
    await page.screenshot({ path: join(SHOTS, `matrix-${name}-readonly.png`) })
  } catch (error) {
    problems.push(`${name}: ${error.message}`)
  } finally {
    await browser.close().catch(() => {})
    await vite.close()
  }
}

mkdirSync(SHOTS, { recursive: true })

const modes = MATRIX
  ? BROWSERS.map((name) => ['sidecar', name]).concat([['readonly', 'webkit']])
  : BROWSERS.map((name) => [TIER ?? 'sidecar', name])

for (const [tier, name] of modes) {
  if (tier === 'sidecar') await runSidecar(name)
  else if (tier === 'readonly') await runReadonly(name)
  else problems.push(`unknown tier: ${tier}`)
}

if (problems.length > 0) {
  console.log(`\n${problems.length} problem(s):`)
  for (const problem of problems) console.log(`  ! ${problem}`)
  process.exitCode = 1
} else {
  console.log('\nMatrix clean.')
}
