import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  createToken,
  HttpError,
  repoRoot,
  tokenMatches,
} from './security.mjs'
import {
  listFiles,
  readTextFile,
  removeTextFile,
  watchRepo,
  writeTextFile,
} from './fs-api.mjs'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const VERSION = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version
const MAX_BODY = 2 * 1024 * 1024

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

function sendJson(res, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...extraHeaders,
  })
  res.end(body)
}

function sendText(res, status, text, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    ...extraHeaders,
  })
  res.end(text)
}

async function readBody(req) {
  const declared = Number(req.headers['content-length'] ?? 0)
  if (declared > MAX_BODY) throw new HttpError(413, 'body is too large')
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BODY) throw new HttpError(413, 'body is too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function serveStatic(req, res, dist) {
  if (!existsSync(dist)) {
    sendText(
      res,
      503,
      'scrumit is not built yet. Run `npm run build` in the scrumit checkout, or use `npm run dev` with the sidecar running separately.\n',
    )
    return
  }

  let pathname
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname)
  } catch {
    sendText(res, 400, 'bad path')
    return
  }
  if (pathname.includes('\0')) {
    sendText(res, 400, 'bad path')
    return
  }

  const relative = normalize(pathname).replace(/^([/\\])+/, '')
  let target = join(dist, relative)
  if (target !== dist && !target.startsWith(`${dist}${sep}`)) {
    sendText(res, 403, 'forbidden')
    return
  }
  if (existsSync(target) && statSync(target).isDirectory()) target = join(target, 'index.html')
  if (!existsSync(target)) {
    // SPA fallback for a route without an extension.
    if (extname(pathname) === '') target = join(dist, 'index.html')
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    sendText(res, 404, 'not found')
    return
  }

  const type = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream'
  const body = readFileSync(target)
  const immutable = target.includes(`${sep}assets${sep}`)
  res.writeHead(200, {
    'content-type': type,
    'content-length': body.length,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  res.end(body)
}

function apiRoute(req, res, context) {
  const { root, token, dist } = context
  const url = new URL(req.url, 'http://127.0.0.1')
  const method = req.method ?? 'GET'

  if (url.pathname === '/api/health' && method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      version: VERSION,
      repo: root,
      capabilities: {
        canWrite: true,
        canWatch: true,
        access: 'http',
        git: existsSync(join(root, '.git')) ? 'full' : 'none',
      },
    })
    return
  }

  if (url.pathname === '/api/files' && method === 'GET') {
    sendJson(res, 200, { files: listFiles(root) })
    return
  }

  if (url.pathname === '/api/file' && method === 'GET') {
    const path = url.searchParams.get('path') ?? ''
    const file = readTextFile(root, path)
    res.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'content-length': Buffer.byteLength(file.text),
      etag: file.etag,
      'cache-control': 'no-store',
    })
    res.end(file.text)
    return
  }

  if (url.pathname === '/api/file' && method === 'PUT') {
    void (async () => {
      try {
        const path = url.searchParams.get('path') ?? ''
        const base = url.searchParams.get('base')
        const text = await readBody(req)
        const written = writeTextFile(root, path, text, base)
        sendJson(res, 200, { ok: true, ...written })
      } catch (error) {
        fail(res, error)
      }
    })()
    return
  }

  if (url.pathname === '/api/file' && method === 'DELETE') {
    const path = url.searchParams.get('path') ?? ''
    const base = url.searchParams.get('base')
    removeTextFile(root, path, base)
    res.writeHead(204, { 'cache-control': 'no-store' })
    res.end()
    return
  }

  if (url.pathname === '/api/events' && method === 'GET') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    res.write('retry: 1000\n\n')
    const client = { res, heartbeat: setInterval(() => res.write(': ping\n\n'), 20_000) }
    context.clients.add(client)
    req.on('close', () => {
      clearInterval(client.heartbeat)
      context.clients.delete(client)
    })
    return
  }

  if (url.pathname === '/api/') {
    sendJson(res, 200, {
      ok: true,
      version: VERSION,
      endpoints: ['health', 'files', 'file', 'events'],
    })
    return
  }

  // A request for a non-API asset that reached this branch is a static file.
  if (!url.pathname.startsWith('/api/')) {
    serveStatic(req, res, dist)
    return
  }

  sendJson(res, 404, { error: 'not found' })
}

function fail(res, error) {
  if (error instanceof HttpError) {
    sendJson(res, error.status, { error: error.message, ...error.extra })
    return
  }
  sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
}

function broadcast(context, event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`
  for (const client of context.clients) {
    try {
      client.res.write(payload)
    } catch {
      clearInterval(client.heartbeat)
      context.clients.delete(client)
    }
  }
}

/**
 * Start the local sidecar.
 *
 * One process, one origin: it serves the built SPA and the API from the same
 * `127.0.0.1` listener, so no CORS is involved and the token never travels
 * cross-origin. In development, Vite proxies `/api` here.
 */
export async function startServer(options = {}) {
  const repo = resolve(options.repo ?? process.cwd())
  if (!existsSync(repo) || !statSync(repo).isDirectory()) {
    throw new Error(`Not a directory: ${repo}`)
  }
  const root = repoRoot(repo)
  const token = options.token || createToken()
  const dist = resolve(options.dist ?? join(PACKAGE_ROOT, 'dist'))
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 5180
  const clients = new Set()
  const context = { root, token, dist, clients }

  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname.startsWith('/api/')) {
        if (!tokenMatches(req.headers.authorization, token)) {
          sendJson(res, 401, { error: 'missing or invalid token' })
          return
        }
        apiRoute(req, res, context)
        return
      }
      serveStatic(req, res, dist)
    } catch (error) {
      fail(res, error)
    }
  })

  let stopWatch = () => {}
  try {
    stopWatch = watchRepo(root, ({ paths, gitHead }) => {
      for (const path of paths) broadcast(context, { type: 'change', path })
      if (gitHead) broadcast(context, { type: 'git-head' })
    })
  } catch {
    // Watching is a capability, not a requirement. The health response still
    // advertises the tier; the client can fall back to a refresh.
  }

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(port, host, resolveListen)
  })
  const address = server.address()
  const actualPort = typeof address === 'object' && address ? address.port : port
  const url = `http://${host}:${actualPort}`

  return {
    server,
    repo: root,
    token,
    port: actualPort,
    url,
    dist,
    stop: async () => {
      stopWatch()
      for (const client of clients) {
        clearInterval(client.heartbeat)
        try {
          client.res.end()
        } catch {
          // Already closed.
        }
      }
      clients.clear()
      await new Promise((resolveClose) => server.close(resolveClose))
    },
  }
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--repo') out.repo = argv[++i]
    else if (arg === '--port') out.port = Number(argv[++i])
    else if (arg === '--token') out.token = argv[++i]
    else if (arg === '--dist') out.dist = argv[++i]
    else if (arg === '--quiet') out.quiet = true
  }
  return out
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const info = await startServer(options)
  if (!options.quiet) {
    console.log(`scrumit  ${info.url}`)
    console.log(`  repo   ${info.repo}`)
    console.log(`  token  ${info.token}`)
    console.log('')
    console.log('Set the same token in scrumit, or open the served URL from this process.')
  }
  const close = async () => {
    await info.stop()
    process.exit(0)
  }
  process.on('SIGINT', () => void close())
  process.on('SIGTERM', () => void close())
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main()
}
