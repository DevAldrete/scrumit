/**
 * Runtime smoke test. Loads the app in a real Chrome, walks the views, and
 * fails loudly on any console error or page exception.
 *
 *   node tools/smoke.mjs [baseUrl]
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'

const BASE = process.argv[2] ?? 'http://localhost:5178'
const SHOTS = join(process.cwd(), 'tools', 'shots')

/**
 * Find a Chromium. The File System Access API needs a real Chrome, and CI
 * images usually already have one cached by Playwright, so look there first.
 */
function findChrome() {
  const candidates = [process.env.SCRUMIT_CHROME]

  for (const cache of [
    join(homedir(), 'Library/Caches/ms-playwright'),
    join(homedir(), '.cache/ms-playwright'),
  ]) {
    if (!existsSync(cache)) continue
    for (const entry of readdirSync(cache)) {
      if (!entry.startsWith('chromium-')) continue
      candidates.push(
        join(cache, entry, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
        join(cache, entry, 'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
        join(cache, entry, 'chrome-linux/chrome'),
      )
    }
  }

  candidates.push(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  )
  return candidates.filter(Boolean).find((path) => existsSync(path))
}

const CHROME = findChrome()
if (!CHROME) {
  console.error(
    'No Chromium found. Set SCRUMIT_CHROME=/path/to/chrome, or install one with:\n  npx playwright install chromium',
  )
  process.exit(2)
}

mkdirSync(SHOTS, { recursive: true })

const problems = []

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell',
  args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none'],
})

const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })

page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console.error: ${message.text()}`)
  if (message.type() === 'warning' && /React|Preact|Unknown|Invalid/.test(message.text())) {
    problems.push(`console.warn: ${message.text()}`)
  }
})
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
page.on('requestfailed', (request) => {
  problems.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`)
})

const shot = async (name) => {
  await page.screenshot({ path: join(SHOTS, `${name}.png`) })
  console.log(`  shot  ${name}`)
}

const step = async (label, fn) => {
  process.stdout.write(`- ${label}\n`)
  await fn()
}

/** Wait for a string that appears in the rendered body, then settle. */
async function waitForText(text, timeout = 8000) {
  await page.waitForFunction(
    (needle) => document.body.innerText.includes(needle),
    { timeout },
    text,
  )
}

async function clickByText(selector, text) {
  const handle = await page.evaluateHandle(
    (sel, needle) => {
      const wanted = needle.toLowerCase()
      const nodes = [...document.querySelectorAll(sel)]
      const match = (node) =>
        (node.textContent ?? '').toLowerCase().includes(wanted) ||
        (node.getAttribute('aria-label') ?? '').toLowerCase().includes(wanted) ||
        (node.getAttribute('title') ?? '').toLowerCase().includes(wanted)
      // Prefer the deepest match so a label inside a row does not select the row.
      const hits = nodes.filter(match)
      return hits.length > 0 ? hits[hits.length - 1] : null
    },
    selector,
    text,
  )
  const element = handle.asElement()
  if (!element) throw new Error(`No ${selector} containing "${text}"`)
  await element.click()
  return element
}

/** The shell only exists once a repo has loaded and the scan has finished. */
async function waitForShell(timeout = 20_000) {
  await page.waitForSelector('nav[aria-label="Views"]', { timeout })
  await waitForText('Add to', timeout)
}

try {
  await step('load the welcome screen', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle0' })
    await waitForText('scrumit')
    await waitForText('Open a repository folder')
    await waitForText('Open a folder read-only')
    await waitForText('Drop a folder here')
    await shot('01-welcome')
  })

  await step('open the demo repo', async () => {
    await clickByText('button', 'Explore the demo repo')
    await waitForShell()
    await new Promise((resolve) => setTimeout(resolve, 600))
    const branch = await page.evaluate(() => document.querySelector('header').innerText)
    if (!branch.includes('main')) problems.push(`branch chip missing from the header: ${branch}`)
    await shot('02-board')
  })

  await step('drag ACME-140 from To do into Doing', async () => {
    const geometry = await page.evaluate(() => {
      const rect = (el) => {
        const r = el.getBoundingClientRect()
        return { x: r.x, y: r.y, w: r.width, h: r.height }
      }
      const card = [...document.querySelectorAll('.card')].find(
        (c) => c.dataset.issue === 'ACME-140',
      )
      return {
        card: rect(card),
        doing: rect(document.querySelector('[data-status="doing"]')),
      }
    })

    await page.mouse.move(geometry.card.x + geometry.card.w / 2, geometry.card.y + 14)
    await page.mouse.down()
    await page.mouse.move(
      geometry.doing.x + geometry.doing.w / 2,
      geometry.doing.y + 60,
      { steps: 18 },
    )
    await page.mouse.move(
      geometry.doing.x + geometry.doing.w / 2,
      geometry.doing.y + 62,
      { steps: 3 },
    )
    await page.mouse.up()
    await new Promise((resolve) => setTimeout(resolve, 900))

    const state = await page.evaluate(() => ({
      todo: document.querySelector('[data-status="todo"]').querySelectorAll('.card').length,
      doing: document.querySelector('[data-status="doing"]').querySelectorAll('.card').length,
      moved: !!document.querySelector(
        '[data-status="doing"] [data-issue="ACME-140"]',
      ),
    }))
    if (!state.moved) problems.push(`drag did not move the card: ${JSON.stringify(state)}`)
    await shot('16-after-drag')
  })

  await step('reload and confirm the drag was written to the repo', async () => {
    await page.reload({ waitUntil: 'networkidle0' })
    await waitForShell()
    const still = await page.evaluate(
      () => !!document.querySelector('[data-status="doing"] [data-issue="ACME-140"]'),
    )
    if (!still) problems.push('the move did not survive a reload')
  })

  await step('open an issue panel', async () => {
    await clickByText('.card', 'ACME-140')
    await waitForText('Assignee')
    await shot('03-issue-panel')
  })

  await step('preview the markdown body', async () => {
    await clickByText('button', 'preview')
    await new Promise((resolve) => setTimeout(resolve, 300))
    await shot('04-markdown-preview')
  })

  await step('close the panel', async () => {
    await page.keyboard.press('Escape')
    await new Promise((resolve) => setTimeout(resolve, 200))
  })

  for (const [view, expect, name] of [
    ['Backlog', 'ACME-118', '05-backlog'],
    ['Sprints', 'Sprint 20', '06-sprints'],
    ['Epics', 'EPIC-01', '07-epics'],
    ['Flow', 'Velocity', '08-flow'],
    ['Settings', 'Appearance', '09-settings'],
  ]) {
    await step(`view: ${view}`, async () => {
      await clickByText('nav[aria-label="Views"] button', view)
      await waitForText(expect, 10_000)
      await shot(name)
    })
  }

  await step('write the agent guide into the repository', async () => {
    await clickByText('button', 'Write .scrumit/AGENTS.md')
    await waitForText('Wrote .scrumit/AGENTS.md', 10_000)
    // The demo repository mirrors its files into Dexie, so the real artefact can
    // be read back and inspected.
    await new Promise((resolve) => setTimeout(resolve, 600))
    const guide = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open('scrumit')
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const get = request.result
              .transaction('prefs', 'readonly')
              .objectStore('prefs')
              .get('demo.files')
            get.onerror = () => reject(get.error)
            get.onsuccess = () => resolve(get.result?.value?.['.scrumit/AGENTS.md'] ?? null)
          }
        }),
    )

    if (typeof guide !== 'string') {
      problems.push('the agent guide was not written to the repository')
    } else {
      if (!guide.includes('next free id')) problems.push('the guide has no live-context section')
      if (!guide.includes('ACME-149')) {
        problems.push('the guide does not state the next free id (expected ACME-149)')
      }
      if (!guide.includes('## 1. Invariants')) problems.push('the guide does not inline the spec')
      console.log(`  guide  ${guide.length} bytes, ${guide.split('\n').length} lines`)
      writeFileSync(join(SHOTS, 'AGENTS.md'), guide)
    }
    await shot('17-agent-guide')
  })

  await step('back to the board', async () => {
    await clickByText('nav[aria-label="Views"] button', 'Board')
    await waitForShell()
    await shot('12-board')
  })

  await step('switch theme to catppuccin-mocha', async () => {
    await clickByText('header button[title="Change theme"]', 'Change theme')
    await new Promise((resolve) => setTimeout(resolve, 150))
    await clickByText('.pop button', 'Catppuccin Mocha')
    await new Promise((resolve) => setTimeout(resolve, 400))
    const theme = await page.evaluate(() => document.documentElement.dataset.theme)
    if (theme !== 'catppuccin-mocha') problems.push(`theme did not apply: ${theme}`)
    await shot('10-catppuccin-mocha')
  })

  await step('switch theme to kanagawa-wave', async () => {
    await clickByText('header button[title="Change theme"]', 'Change theme')
    await new Promise((resolve) => setTimeout(resolve, 150))
    await clickByText('.pop button', 'Kanagawa Wave')
    await new Promise((resolve) => setTimeout(resolve, 400))
    await shot('11-kanagawa-wave')
  })

  await step('command palette', async () => {
    await page.keyboard.down('Meta')
    await page.keyboard.press('k')
    await page.keyboard.up('Meta')
    await new Promise((resolve) => setTimeout(resolve, 300))
    await page.keyboard.type('webhook')
    await new Promise((resolve) => setTimeout(resolve, 300))
    await shot('13-palette')
    await page.keyboard.press('Escape')
  })

  await step('theme back to scrumit-dark', async () => {
    await clickByText('header button[title="Change theme"]', 'Change theme')
    await new Promise((resolve) => setTimeout(resolve, 150))
    await clickByText('.pop button', 'Scrumit Dark')
    await new Promise((resolve) => setTimeout(resolve, 400))
    await shot('14-scrumit-dark')
  })

  await step('reload and confirm the repo reopens with no prompt', async () => {
    await page.reload({ waitUntil: 'networkidle0' })
    await waitForShell()
    const theme = await page.evaluate(() => document.documentElement.dataset.theme)
    if (theme !== 'scrumit-dark') problems.push(`theme not persisted: ${theme}`)
    await shot('15-after-reload')
  })

  /* ------------------------------------------------------------------------
   * Filesystem watching, against real files.
   *
   * A native directory picker cannot be driven by an automated browser, so the
   * fixture is built over the Origin Private File System and handed to the app
   * through the dev-only seam. It is still a real FileSystemDirectoryHandle, so
   * the whole File System Access path — scan, write, and observe — runs for
   * real. Writes afterwards come from `page.evaluate`, i.e. from outside the
   * app, which is exactly the situation the watcher exists for.
   * ---------------------------------------------------------------------- */

  const writeFixture = async (path, text) =>
    page.evaluate(
      async (targetPath, contents) => {
        const root = await navigator.storage.getDirectory()
        const repo = await root.getDirectoryHandle('agent-repo', { create: true })
        const parts = targetPath.split('/')
        const name = parts.pop()
        let parent = repo
        for (const part of parts) {
          parent = await parent.getDirectoryHandle(part, { create: true })
        }
        const file = await parent.getFileHandle(name, { create: true })
        const stream = await file.createWritable()
        await stream.write(contents)
        await stream.close()
      },
      path,
      text,
    )

  await step('open a repository backed by real files', async () => {
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory()
      const repo = await root.getDirectoryHandle('agent-repo', { create: true })
      const write = async (path, text) => {
        const parts = path.split('/')
        const name = parts.pop()
        let parent = repo
        for (const part of parts) parent = await parent.getDirectoryHandle(part, { create: true })
        const file = await parent.getFileHandle(name, { create: true })
        const stream = await file.createWritable()
        await stream.write(text)
        await stream.close()
      }

      await write('.scrumit/config.yaml', 'version: 1\nproject: Agent Repo\n')
      await write('.git/HEAD', 'ref: refs/heads/agent-branch\n')
      await write(
        'backlog/AGENT-1.md',
        [
          '---',
          'id: AGENT-1',
          'title: First card',
          'status: backlog',
          'type: story',
          'points: 2',
          'created: 2026-10-01',
          'updated: 2026-10-01',
          'order: 10',
          '---',
          '',
          '## Context',
          '',
          'The only card in this repository.',
          '',
        ].join('\n'),
      )

      await window.__scrumit.openHandleAsRepo(repo, 'agent-repo')
    })

    await waitForShell()
    await waitForText('AGENT-1', 12_000)

    const stats = await page.evaluate(() => window.__scrumit.stats())
    if (!stats.watching) {
      problems.push('the filesystem observer did not start for a real directory')
    }
    const header = await page.evaluate(() => document.querySelector('header').innerText)
    if (!header.includes('agent-branch')) {
      problems.push(`branch not read from the fixture: ${header}`)
    }
    await shot('18-watched-repo')
  })

  await step('notice files written outside the app', async () => {
    const before = await page.evaluate(() => window.__scrumit.stats().externalUpdates)

    await writeFixture(
      'backlog/AGENT-2.md',
      [
        '---',
        'id: AGENT-2',
        'title: Written by an agent',
        'status: todo',
        'type: story',
        'points: 3',
        'created: 2026-10-16',
        'updated: 2026-10-16',
        'order: 20',
        '---',
        '',
        '## Context',
        '',
        'Nobody clicked anything to make this card.',
        '',
      ].join('\n'),
    )
    await writeFixture(
      'backlog/AGENT-1.md',
      [
        '---',
        'id: AGENT-1',
        'title: First card',
        'status: doing',
        'type: story',
        'points: 2',
        'created: 2026-10-01',
        'updated: 2026-10-16',
        'order: 10',
        '---',
        '',
        '## Context',
        '',
        'The only card in this repository.',
        '',
      ].join('\n'),
    )

    await waitForText('Written by an agent', 12_000)
    await waitForText('From disk:', 12_000)

    const text = await page.evaluate(() => document.body.innerText)
    if (!text.includes('1 added')) problems.push('the diff did not report the new card')
    if (!text.includes('1 card moved')) problems.push('the diff did not report the move')
    if (!text.includes('AGENT-1 Backlog → Doing')) {
      problems.push('the diff did not name the move in the configured columns')
    }

    const after = await page.evaluate(() => window.__scrumit.stats().externalUpdates)
    if (after <= before) problems.push(`no refresh was recorded (${before} → ${after})`)

    const moved = await page.evaluate(
      () => !!document.querySelector('[data-status="doing"] [data-issue="AGENT-1"]'),
    )
    if (!moved) problems.push('AGENT-1 did not appear in Doing after the external edit')

    await shot('19-external-change')
  })

  await step('ignore changes scrumit made itself', async () => {
    const before = await page.evaluate(() => window.__scrumit.stats().externalUpdates)

    await clickByText('button', 'Add to backlog')
    // Wait for the composer to actually be in the DOM, then focus it directly
    // rather than trusting whatever the click left focused.
    await page.waitForSelector('textarea[placeholder="What needs doing?"]', { timeout: 5000 })
    await page.click('textarea[placeholder="What needs doing?"]')
    await page.keyboard.type('A card added in the app')
    await page.keyboard.press('Enter')
    await waitForText('A card added in the app', 8000)

    // Give the observer more than its settle window plus the store's debounce.
    await new Promise((resolve) => setTimeout(resolve, 2000))

    const after = await page.evaluate(() => window.__scrumit.stats().externalUpdates)
    if (after !== before) {
      problems.push(`scrumit refreshed in response to its own write (${before} → ${after})`)
    }

    const names = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory()
      const repo = await root.getDirectoryHandle('agent-repo')
      const backlog = await repo.getDirectoryHandle('backlog')
      const out = []
      for await (const [name] of backlog.entries()) out.push(name)
      return out.sort()
    })
    if (!names.includes('AGENT-3.md')) {
      problems.push(`the new card was not written to the repository: ${names.join(', ')}`)
    }
    console.log(`  files  ${names.join(', ')}`)
    await shot('20-self-write')
  })

  /* ------------------------------------------------------------------------
   * A browser that exposes a handle but refuses to clone it into IndexedDB
   * must still open the repository from its cached snapshot and say so.
   * ---------------------------------------------------------------------- */

  await step('open the cached board when the handle is gone', async () => {
    await page.evaluate(() => window.__scrumit.dropHandles())
    await page.reload({ waitUntil: 'networkidle0' })
    await waitForText('Open the folder again', 12_000)
    const text = await page.evaluate(() => document.body.innerText)
    if (!text.includes('AGENT-1')) {
      problems.push('the cached board did not render after the handle was dropped')
    }
    await shot('21-handle-lost')
  })

  /* ------------------------------------------------------------------------
   * A source whose capabilities say `canWrite: false` must refuse every
   * mutation before it touches the board, with one explanation.
   * ---------------------------------------------------------------------- */

  await step('make read-only legible and inert', async () => {
    await page.evaluate(() => window.__scrumit.openReadOnlyFake())
    await page.waitForSelector('nav[aria-label="Views"]', { timeout: 12_000 })
    await waitForText('READONLY-1', 12_000)

    const chrome = await page.evaluate(() => ({
      composers: [...document.querySelectorAll('button')].filter((button) =>
        /Add to/i.test(button.textContent ?? ''),
      ).length,
      grips: document.querySelectorAll('[data-grip]').length,
      banner: document.body.innerText.includes('Read-only'),
    }))
    if (chrome.composers > 0) {
      problems.push(`read-only board still offers ${chrome.composers} composer(s)`)
    }
    if (!chrome.banner) problems.push('the read-only banner is missing')

    const before = await page.evaluate(() => window.__scrumit.stats().writeAttempts)

    // Sortable must be disabled, not merely hidden: a drag changes nothing.
    const geometry = await page.evaluate(() => {
      const rect = (element) => {
        const r = element.getBoundingClientRect()
        return { x: r.x, y: r.y, w: r.width, h: r.height }
      }
      return {
        card: rect(document.querySelector('[data-status="todo"] .card')),
        doing: rect(document.querySelector('[data-status="doing"]')),
      }
    })
    await page.mouse.move(geometry.card.x + geometry.card.w / 2, geometry.card.y + 14)
    await page.mouse.down()
    await page.mouse.move(
      geometry.doing.x + geometry.doing.w / 2,
      geometry.doing.y + 60,
      { steps: 15 },
    )
    await page.mouse.up()
    await new Promise((resolve) => setTimeout(resolve, 500))
    const moved = await page.evaluate(
      () => !!document.querySelector('[data-status="doing"] [data-issue="READONLY-1"]'),
    )
    if (moved) problems.push('a read-only board moved a card on drag')

    // The panel is readable but not editable, and Delete is gone.
    await clickByText('.card', 'READONLY-1')
    await waitForText('Assignee', 8000)
    const panel = await page.evaluate(() => {
      const title = document.querySelector('textarea[aria-label="Title"]')
      return {
        titleLocked: title?.readOnly === true || title?.disabled === true,
        deletes: document.querySelectorAll('button[title="Delete this issue"]').length,
      }
    })
    if (!panel.titleLocked) problems.push('the read-only panel title is editable')
    if (panel.deletes > 0) problems.push('the read-only panel still offers Delete')
    await page.keyboard.press('Escape')
    await new Promise((resolve) => setTimeout(resolve, 200))

    const after = await page.evaluate(() => window.__scrumit.stats().writeAttempts)
    if (after !== before) {
      problems.push(`a read-only source was written ${after - before} time(s)`)
    }
    await shot('22-read-only')
  })

  await step('show and resolve a conflict honestly', async () => {
    await clickByText('.card', 'READONLY-1')
    await waitForText('Assignee', 8000)
    await page.evaluate(() => window.__scrumit.simulateConflict())
    await waitForText('This file changed on disk', 8000)
    const compare = await page.evaluate(() =>
      document.body.innerText.includes('Compare versions'),
    )
    if (!compare) problems.push('the conflict comparison is missing')

    await clickByText('button', 'Take theirs')
    await new Promise((resolve) => setTimeout(resolve, 700))
    const gone = await page.evaluate(
      () => !document.body.innerText.includes('This file changed on disk'),
    )
    if (!gone) problems.push('the conflict bar did not clear after Take theirs')
    await shot('23-conflict')
  })
} catch (error) {
  problems.push(`fatal: ${error.message}`)
} finally {
  await browser.close()
}

if (problems.length > 0) {
  console.log(`\n${problems.length} problem(s):`)
  for (const problem of problems) console.log(`  ! ${problem}`)
  process.exitCode = 1
} else {
  console.log('\nNo console errors, exceptions or failed requests.')
}
