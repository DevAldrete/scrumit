import type { Capabilities } from './model.ts'
import {
  IGNORED_DIRS,
  describeError,
  isIgnoredPath,
  type PermissionState,
  type RepoSource,
  type StopWatching,
  type WatchEvent,
} from './source.ts'

interface DirEntries {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>
}

interface PermissionHandle extends FileSystemHandle {
  queryPermission?(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission?(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
}

/* ---------------------------------------------------- FileSystemObserver shim */

/**
 * `FileSystemObserver` is not in TypeScript's DOM library yet, and it is still
 * experimental in the browser, so the shape scrumit relies on is declared here
 * and feature-detected at the point of use.
 */
interface FileSystemChangeRecord {
  type: 'appeared' | 'disappeared' | 'modified' | 'moved' | 'unknown' | 'errored'
  relativePathComponents?: readonly string[]
  changedHandle?: FileSystemHandle
}

interface FileSystemObserver {
  observe(handle: FileSystemHandle, options?: { recursive?: boolean }): Promise<void>
  unobserve(handle: FileSystemHandle): Promise<void>
  disconnect(): void
}

type FileSystemObserverConstructor = new (
  callback: (records: FileSystemChangeRecord[]) => void,
) => FileSystemObserver

export function observerSupported(): boolean {
  return typeof (globalThis as { FileSystemObserver?: unknown }).FileSystemObserver === 'function'
}

/** How long to wait for a burst of writes to settle before reporting it. */
const SETTLE_MS = 180

interface PickerWindow {
  showDirectoryPicker?(options?: {
    id?: string
    mode?: 'read' | 'readwrite'
  }): Promise<FileSystemDirectoryHandle>
}

/** File System Access is Chromium-only; the demo repo covers everyone else. */
export function fsaSupported(): boolean {
  const w = window as unknown as PickerWindow
  return typeof w.showDirectoryPicker === 'function'
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  const w = window as unknown as PickerWindow
  if (!w.showDirectoryPicker) return null
  try {
    return await w.showDirectoryPicker({ id: 'scrumit-repo', mode: 'readwrite' })
  } catch {
    // The picker throws on cancel. Cancelling is not an error.
    return null
  }
}

/** Guard against pointing scrumit at a monorepo and walking 400k files. */
const MAX_FILES = 25_000

export class FsaSource implements RepoSource {
  readonly kind = 'fsa'
  readonly label: string
  readonly capabilities: Capabilities
  #root: FileSystemDirectoryHandle

  constructor(root: FileSystemDirectoryHandle, label: string) {
    this.#root = root
    this.label = label
    this.capabilities = {
      canWrite: true,
      canWatch: observerSupported(),
      access: 'handle',
      git: 'branch',
    }
  }

  get root(): FileSystemDirectoryHandle {
    return this.#root
  }

  async list(): Promise<string[]> {
    const out: string[] = []
    await this.walk(this.#root, '', out)
    return out
  }

  private async walk(
    dir: FileSystemDirectoryHandle,
    prefix: string,
    out: string[],
  ): Promise<void> {
    if (out.length >= MAX_FILES) return
    const children = (dir as unknown as DirEntries).entries()
    for await (const [name, handle] of children) {
      if (IGNORED_DIRS.has(name)) continue
      if (out.length >= MAX_FILES) return
      const path = prefix === '' ? name : `${prefix}/${name}`
      if (handle.kind === 'directory') {
        await this.walk(handle as FileSystemDirectoryHandle, path, out)
      } else {
        out.push(path)
      }
    }
  }

  private async resolve(
    path: string,
    createDirs: boolean,
  ): Promise<{ parent: FileSystemDirectoryHandle; name: string }> {
    const segments = path.split('/').filter(Boolean)
    const name = segments.pop()
    if (!name) throw new Error(`Not a file path: ${path}`)
    let dir = this.#root
    for (const segment of segments) {
      dir = await dir.getDirectoryHandle(segment, { create: createDirs })
    }
    return { parent: dir, name }
  }

  async read(path: string): Promise<string> {
    const { parent, name } = await this.resolve(path, false)
    const file = await parent.getFileHandle(name)
    return (await file.getFile()).text()
  }

  async write(path: string, text: string): Promise<void> {
    const { parent, name } = await this.resolve(path, true)
    const file = await parent.getFileHandle(name, { create: true })
    const writable = await file.createWritable()
    try {
      await writable.write(text)
    } finally {
      await writable.close()
    }
  }

  async remove(path: string): Promise<void> {
    const { parent, name } = await this.resolve(path, false)
    await parent.removeEntry(name)
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.read(path)
      return true
    } catch {
      return false
    }
  }

  async permission(): Promise<PermissionState> {
    const handle = this.#root as PermissionHandle
    if (typeof handle.queryPermission !== 'function') return 'granted'
    try {
      const state = await handle.queryPermission({ mode: 'readwrite' })
      return (state ?? 'prompt') as PermissionState
    } catch (error) {
      throw new Error(describeError(error))
    }
  }

  async request(): Promise<PermissionState> {
    const handle = this.#root as PermissionHandle
    if (typeof handle.requestPermission !== 'function') return 'granted'
    try {
      const state = await handle.requestPermission({ mode: 'readwrite' })
      return (state ?? 'prompt') as PermissionState
    } catch {
      // requestPermission throws if called without a user gesture.
      return 'prompt'
    }
  }

  /**
   * Watch the whole repository and report changes made outside scrumit.
   *
   * Observing from the root rather than from each artefact directory is
   * deliberate: an issue anywhere in the tree is a card, so a narrower watch
   * would miss files a human or an agent put in an unexpected place. The cost is
   * that git's own churn arrives too, which is filtered out below — cheaply, on
   * the first path component, because a checkout can touch thousands of files
   * under `.git/`.
   */
  async watch(onChange: (event: WatchEvent) => void): Promise<StopWatching> {
    const Ctor = (globalThis as { FileSystemObserver?: FileSystemObserverConstructor })
      .FileSystemObserver
    if (typeof Ctor !== 'function') {
      throw new Error(
        'This browser cannot watch the filesystem. Changes made outside scrumit need a manual rescan.',
      )
    }

    let paths = new Set<string>()
    let gitHead = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    const settle = () => {
      timer = null
      if (stopped) return
      const batch = [...paths]
      const branch = gitHead
      paths = new Set()
      gitHead = false
      if (batch.length > 0 || branch) onChange({ paths: batch, gitHead: branch })
    }

    const observer = new Ctor((records) => {
      if (stopped) return
      for (const record of records) {
        const components = record.relativePathComponents
        if (!components || components.length === 0) continue
        if (components[0] === '.git') {
          // A branch switch changes the board and the chip; a commit changes
          // neither, but either way it is worth re-reading one small file.
          if (components.length === 2 && components[1] === 'HEAD') gitHead = true
          continue
        }
        const path = components.join('/')
        if (isIgnoredPath(path)) continue
        paths.add(path)
      }
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(settle, SETTLE_MS)
    })

    try {
      await observer.observe(this.#root, { recursive: true })
    } catch (error) {
      observer.disconnect()
      throw new Error(describeError(error))
    }

    return () => {
      stopped = true
      if (timer !== null) clearTimeout(timer)
      observer.disconnect()
    }
  }
}
