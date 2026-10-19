/**
 * Measure what each browser actually exposes before trusting a support table.
 *
 *   node tools/probe-support.mjs [--json]
 *
 * Uses the Playwright browsers installed with `npx playwright install
 * chromium firefox webkit`. A browser that is not installed is reported as
 * unavailable rather than treated as "no support".
 */
import { createServer } from 'node:http'
import { chromium, firefox, webkit } from 'playwright'

const AS_JSON = process.argv.includes('--json')

const PROBE = async () => {
  const result = {
    showDirectoryPicker: typeof window.showDirectoryPicker === 'function',
    FileSystemObserver: typeof window.FileSystemObserver === 'function',
    opfs: typeof navigator.storage?.getDirectory === 'function',
    getAsFileSystemHandle:
      typeof DataTransferItem !== 'undefined' &&
      typeof DataTransferItem.prototype.getAsFileSystemHandle === 'function',
    colorMix:
      typeof CSS !== 'undefined' && CSS.supports('color', 'color-mix(in oklab, red, blue)'),
    handleCloneable: null,
    handleCloneError: null,
  }

  if (result.opfs) {
    try {
      const root = await navigator.storage.getDirectory()
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('scrumit-probe', 1)
        request.onupgradeneeded = () => request.result.createObjectStore('handles')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const database = request.result
          const tx = database.transaction('handles', 'readwrite')
          tx.objectStore('handles').put(root, 'root')
          tx.oncomplete = () => {
            database.close()
            indexedDB.deleteDatabase('scrumit-probe')
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      })
      result.handleCloneable = true
    } catch (error) {
      result.handleCloneable = false
      result.handleCloneError = error?.name ?? String(error)
    }
  }

  return result
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>scrumit probe</title><body></body>`

function serve() {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(PAGE)
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({ server, url: `http://127.0.0.1:${address.port}/` })
    })
  })
}

function mark(value) {
  if (value === true) return 'yes'
  if (value === false) return 'no'
  if (value === null) return '—'
  return String(value)
}

async function probe(name, launcher, url) {
  let browser = null
  try {
    browser = await launcher.launch({ headless: true })
    const page = await browser.newPage()
    await page.goto(url, { waitUntil: 'load' })
    const result = await page.evaluate(PROBE)
    return { name, ok: true, ...result }
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error)
    const notInstalled = /Executable doesn't exist|browserType\.launch/i.test(message)
    return {
      name,
      ok: false,
      unavailable: true,
      error: notInstalled
        ? 'not installed — run `npx playwright install chromium firefox webkit`'
        : message,
    }
  } finally {
    await browser?.close().catch(() => {})
  }
}

const { server, url } = await serve()
let results
try {
  results = []
  for (const [name, launcher] of [
    ['chromium', chromium],
    ['firefox', firefox],
    ['webkit', webkit],
  ]) {
    results.push(await probe(name, launcher, url))
  }
} finally {
  server.close()
}

if (AS_JSON) {
  console.log(JSON.stringify(results, null, 2))
} else {
  const columns = [
    'browser',
    'showDirectoryPicker',
    'FileSystemObserver',
    'OPFS',
    'getAsFileSystemHandle',
    'color-mix',
    'handle cloneable',
  ]
  const rows = results.map((result) =>
    result.ok
      ? [
          result.name,
          mark(result.showDirectoryPicker),
          mark(result.FileSystemObserver),
          mark(result.opfs),
          mark(result.getAsFileSystemHandle),
          mark(result.colorMix),
          mark(result.handleCloneable),
        ]
      : [result.name, result.error, '', '', '', '', ''],
  )
  const widths = columns.map((column, index) =>
    Math.max(column.length, ...rows.map((row) => (row[index] ?? '').length)),
  )
  const line = (row) =>
    row.map((cell, index) => String(cell ?? '').padEnd(widths[index])).join('  ')
  console.log(line(columns))
  console.log(line(widths.map((width) => '-'.repeat(width))))
  for (const row of rows) console.log(line(row))
}

const unavailable = results.filter((result) => result.unavailable)
if (unavailable.length === results.length) process.exitCode = 1
