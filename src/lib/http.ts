import type { Capabilities } from './model.ts'
import type { GitCommit, GitCommitResult, GitDiff, GitStatus } from './git.ts'
import type {
  PermissionState,
  RepoSource,
  StopWatching,
  WatchEvent,
  WriteOptions,
} from './source.ts'

/** A write was refused because the file changed on disk since it was read. */
export class ConflictError extends Error {
  readonly path: string
  readonly current: string | null
  readonly etag: string | null

  constructor(path: string, current: string | null, etag: string | null) {
    super(`${path} changed on disk`)
    this.name = 'ConflictError'
    this.path = path
    this.current = current
    this.etag = etag
  }
}

/** The local sidecar stopped answering. Writes must not pretend to succeed. */
export class ServerUnavailableError extends Error {
  constructor(message = 'The local server is not responding.') {
    super(message)
    this.name = 'ServerUnavailableError'
  }
}

type Connection = (up: boolean, message?: string) => void

interface FileEntry {
  path: string
  etag: string | null
}

export class HttpSource implements RepoSource {
  readonly kind = 'http'
  readonly label: string
  readonly capabilities: Capabilities
  #base: string
  #token: string
  #etags = new Map<string, string>()
  #onConnection: Connection | null = null

  constructor(
    baseUrl: string,
    token: string,
    options: { onConnection?: Connection } = {},
  ) {
    this.#base = baseUrl.replace(/\/+$/, '')
    this.#token = token
    this.label = this.#base
    this.#onConnection = options.onConnection ?? null
    this.capabilities = {
      canWrite: true,
      canWatch: true,
      access: 'http',
      git: 'full',
    }
  }

  setConnectionListener(listener: Connection | null): void {
    this.#onConnection = listener
  }

  applyCapabilities(capabilities: Partial<Capabilities>): void {
    Object.assign(this.capabilities, capabilities)
  }

  async health(): Promise<{
    ok: boolean
    version: string
    repo: string
    capabilities: Capabilities
  }> {
    const response = await this.#request('/api/health', {}, 4000)
    if (!response.ok) await this.#fail(response)
    return response.json()
  }

  async gitStatus(): Promise<GitStatus> {
    const response = await this.#request('/api/git/status')
    if (!response.ok) await this.#fail(response)
    return response.json()
  }

  async gitDiff(path: string): Promise<GitDiff> {
    const response = await this.#request(`/api/git/diff?${query({ path })}`)
    if (!response.ok) await this.#fail(response)
    return response.json()
  }

  async gitLog(limit = 5): Promise<GitCommit[]> {
    const response = await this.#request(`/api/git/log?${query({ limit: String(limit) })}`)
    if (!response.ok) await this.#fail(response)
    const payload = (await response.json()) as { commits: GitCommit[] }
    return payload.commits
  }

  async gitCommit(message: string, paths: string[]): Promise<GitCommitResult> {
    const response = await this.#request('/api/git/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, paths }),
    })
    if (!response.ok) await this.#fail(response)
    return response.json()
  }

  async list(): Promise<string[]> {
    const response = await this.#request('/api/files')
    if (!response.ok) await this.#fail(response)
    const payload = (await response.json()) as { files: FileEntry[] }
    this.#etags = new Map(
      payload.files
        .filter((file) => typeof file.etag === 'string')
        .map((file) => [file.path, file.etag as string]),
    )
    return payload.files.map((file) => file.path)
  }

  async read(path: string): Promise<string> {
    const response = await this.#request(`/api/file?${query({ path })}`)
    if (!response.ok) await this.#fail(response)
    const etag = response.headers.get('etag')
    if (etag) this.#etags.set(path, etag)
    return response.text()
  }

  async write(path: string, text: string, options: WriteOptions = {}): Promise<void> {
    const base = options.base !== undefined ? options.base : this.#etags.get(path) ?? null
    const params: Record<string, string> = { path }
    if (base) params.base = base
    const response = await this.#request(`/api/file?${query(params)}`, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: text,
    })
    if (response.status === 409) {
      const payload = await response.json().catch(() => ({}))
      throw new ConflictError(path, payload.current ?? null, payload.etag ?? null)
    }
    if (!response.ok) await this.#fail(response)
    const payload = await response.json().catch(() => ({}))
    if (typeof payload.etag === 'string') this.#etags.set(path, payload.etag)
    else this.#etags.delete(path)
  }

  async remove(path: string, options: WriteOptions = {}): Promise<void> {
    const base = options.base !== undefined ? options.base : this.#etags.get(path) ?? null
    const params: Record<string, string> = { path }
    if (base) params.base = base
    const response = await this.#request(`/api/file?${query(params)}`, { method: 'DELETE' })
    if (response.status === 409) {
      const payload = await response.json().catch(() => ({}))
      throw new ConflictError(path, payload.current ?? null, payload.etag ?? null)
    }
    if (!response.ok) await this.#fail(response)
    this.#etags.delete(path)
  }

  async exists(path: string): Promise<boolean> {
    const response = await this.#request(`/api/file?${query({ path })}`)
    if (response.status === 404) return false
    if (!response.ok) await this.#fail(response)
    return true
  }

  async permission(): Promise<PermissionState> {
    return 'granted'
  }

  async request(): Promise<PermissionState> {
    return 'granted'
  }

  async watch(onChange: (event: WatchEvent) => void): Promise<StopWatching> {
    let stopped = false
    let current: AbortController | null = null
    let retry = 250
    let paths = new Set<string>()
    let gitHead = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const flush = () => {
      timer = null
      if (stopped) return
      const batch = [...paths]
      const branch = gitHead
      paths = new Set()
      gitHead = false
      if (batch.length > 0 || branch) onChange({ paths: batch, gitHead: branch })
    }

    const schedule = () => {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(flush, 180)
    }

    const connect = async (): Promise<void> => {
      if (stopped) return
      current = new AbortController()
      try {
        const response = await fetch(`${this.#base}/api/events`, {
          headers: { authorization: `Bearer ${this.#token}` },
          signal: current.signal,
        })
        if (!response.ok || !response.body) {
          throw new Error(`The local server refused the event stream (${response.status}).`)
        }
        retry = 250
        this.#onConnection?.(true)
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (!stopped) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
          let index = buffer.indexOf('\n\n')
          while (index >= 0) {
            const chunk = buffer.slice(0, index)
            buffer = buffer.slice(index + 2)
            const data = chunk
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trim())
              .join('\n')
            if (data !== '') {
              try {
                const event = JSON.parse(data) as { type?: string; path?: string }
                if (event.type === 'change' && typeof event.path === 'string') {
                  paths.add(event.path)
                  schedule()
                } else if (event.type === 'git-head') {
                  gitHead = true
                  schedule()
                }
              } catch {
                // A malformed event is not worth dropping the stream over.
              }
            }
            index = buffer.indexOf('\n\n')
          }
        }
        // A clean end of stream still means the server went away.
        if (!stopped) {
          this.#onConnection?.(false, 'The local server is not responding.')
        }
      } catch (error) {
        if (!stopped) {
          const text = error instanceof Error ? error.message : String(error)
          this.#onConnection?.(
            false,
            /fetch|network|terminated|aborted/i.test(text)
              ? 'The local server is not responding.'
              : text,
          )
        }
      }
      if (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, retry))
        retry = Math.min(retry * 2, 5000)
        void connect()
      }
    }

    void connect()

    return () => {
      stopped = true
      if (timer !== null) clearTimeout(timer)
      current?.abort()
    }
  }

  async #request(
    path: string,
    init: RequestInit = {},
    timeoutMs = 8000,
  ): Promise<Response> {
    const controller = new AbortController()
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null
    try {
      return await fetch(`${this.#base}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.#token}`,
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ServerUnavailableError('The local server did not respond in time.')
      }
      throw new ServerUnavailableError()
    } finally {
      if (timer !== null) clearTimeout(timer)
    }
  }

  async #fail(response: Response): Promise<never> {
    if (response.status === 401) {
      throw new Error('The local server rejected the token. Check the token printed by `scrumit serve`.')
    }
    const text = await response.text().catch(() => '')
    throw new Error(
      `The local server returned ${response.status}${text === '' ? '' : `: ${text.slice(0, 200)}`}`,
    )
  }
}

function query(values: Record<string, string>): string {
  return new URLSearchParams(values).toString()
}
