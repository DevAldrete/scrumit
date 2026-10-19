import type { Capabilities } from './model.ts'
import { isIgnoredPath, type PermissionState, type RepoSource } from './source.ts'

export interface ReadOnlyEntry {
  /** Path relative to the folder the user opened. */
  path: string
  file: File
}

/**
 * A repository opened from a folder input or a drop in a browser without the
 * File System Access API.
 *
 * Reads are real; writes are impossible and say so. The app's capability banner
 * and write guard make the restriction visible rather than pretending the board
 * is editable.
 */
export class ReadOnlySource implements RepoSource {
  readonly kind = 'readonly'
  readonly label: string
  readonly capabilities: Capabilities
  #files: Map<string, File>

  constructor(entries: readonly ReadOnlyEntry[], label: string) {
    this.label = label
    this.#files = new Map()
    for (const entry of entries) {
      const path = entry.path.replace(/^\/+/, '')
      if (path !== '' && !this.#files.has(path)) this.#files.set(path, entry.file)
    }
    this.capabilities = {
      canWrite: false,
      canWatch: false,
      access: 'none',
      git: this.#files.has('.git/HEAD') ? 'branch' : 'none',
    }
  }

  static fromFiles(files: readonly File[], label?: string): ReadOnlySource {
    return new ReadOnlySource(entriesFromFiles(files), label ?? labelFor(files))
  }

  async list(): Promise<string[]> {
    return [...this.#files.keys()]
      .filter((path) => path === '.git/HEAD' || !isIgnoredPath(path))
      .sort()
  }

  async read(path: string): Promise<string> {
    const file = this.#files.get(path)
    if (!file) throw new Error(`Not found in the opened folder: ${path}`)
    return file.text()
  }

  async write(): Promise<void> {
    throw new Error(
      'This folder was opened read-only. Use a writable folder in Chromium, or run `npx scrumit serve` for a writable local server.',
    )
  }

  async remove(): Promise<void> {
    throw new Error(
      'This folder was opened read-only. Nothing was deleted.',
    )
  }

  async exists(path: string): Promise<boolean> {
    return this.#files.has(path)
  }

  async permission(): Promise<PermissionState> {
    return 'unsupported'
  }

  async request(): Promise<PermissionState> {
    return 'denied'
  }

  // No watch: a FileList is a snapshot. The store's focus-refresh fallback is
  // the most this tier can honestly promise.
}

/** Normalise a folder input's FileList, stripping the selected root folder. */
export function entriesFromFiles(files: readonly File[]): ReadOnlyEntry[] {
  const raw = files.map((file) => ({
    path: (file.webkitRelativePath || file.name).replace(/^\/+/, ''),
    file,
  }))
  const root = raw.find((entry) => entry.path.includes('/'))?.path.split('/')[0] ?? ''
  return raw.map((entry) => ({
    path:
      root !== '' && entry.path.startsWith(`${root}/`)
        ? entry.path.slice(root.length + 1)
        : entry.path,
    file: entry.file,
  }))
}

function labelFor(files: readonly File[]): string {
  const first = files.find((file) => file.webkitRelativePath.includes('/'))
  return first?.webkitRelativePath.split('/')[0] || 'Read-only folder'
}
