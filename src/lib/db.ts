import Dexie, { type Table } from 'dexie'
import type { RepoMeta, RepoSnapshot } from './model.ts'

export interface RepoRecord extends RepoMeta {
  /**
   * A FileSystemDirectoryHandle survives structured cloning, so the repo can be
   * reopened on a cold start without asking the user to find the folder again.
   * Permission still has to be re-granted by a user gesture — the handle is a
   * pointer, not an authorisation.
   */
  handle?: FileSystemDirectoryHandle
  /**
   * False when the browser exposes a handle but refuses to structured-clone it
   * into IndexedDB. The repo still opens for the session and the cached board
   * survives a reload; the folder simply has to be reopened next time.
   */
  handlePersisted?: boolean
  /** The sidecar origin, for the `http` tier. The token lives in localStorage. */
  serverUrl?: string
}

export interface PrefsRecord {
  key: string
  value: unknown
}

export interface SnapshotRecord {
  repoId: string
  snapshot: RepoSnapshot
}

export interface DraftRecord {
  id: string
  repoId: string
  issueId: string
  at: number
  title: string
  body: string
  /** JSON-encoded partial issue fields. */
  fields: string
}

class ScrumitDatabase extends Dexie {
  repos!: Table<RepoRecord, string>
  prefs!: Table<PrefsRecord, string>
  snapshots!: Table<SnapshotRecord, string>
  drafts!: Table<DraftRecord, string>

  constructor() {
    super('scrumit')
    this.version(1).stores({
      repos: 'id, lastOpenedAt, name',
      prefs: 'key',
      snapshots: 'repoId',
      drafts: 'id, repoId, issueId',
    })
  }
}

export const db = new ScrumitDatabase()

export async function getPref<T>(key: string, fallback: T): Promise<T> {
  const row = await db.prefs.get(key)
  return row === undefined ? fallback : (row.value as T)
}

export async function setPref(key: string, value: unknown): Promise<void> {
  await db.prefs.put({ key, value })
}

export async function listRepos(): Promise<RepoRecord[]> {
  const repos = await db.repos.toArray()
  return repos.sort((a, b) => {
    if (a.lastOpenedAt !== b.lastOpenedAt) return b.lastOpenedAt - a.lastOpenedAt
    return a.name.localeCompare(b.name)
  })
}

export function isDataCloneError(error: unknown): boolean {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'DataCloneError'
  }
  return (
    error instanceof Error &&
    (error.name === 'DataCloneError' || /could not be cloned|not cloneable/i.test(error.message))
  )
}

export type RepoPut = (record: RepoRecord) => Promise<unknown>

/**
 * Store the registry record, degrading gracefully when the handle cannot be
 * cloned.
 *
 * Safari can expose a `FileSystemDirectoryHandle` from a drop without allowing
 * it to be structured-cloned. A repo that throws on add is worse than one that
 * cannot be remembered, so the handle is dropped on `DataCloneError` and the
 * record is flagged instead. The session keeps the live handle in memory.
 */
export async function persistRepo(record: RepoRecord, put: RepoPut): Promise<RepoRecord> {
  try {
    await put(record)
    return record.handle ? { ...record, handlePersisted: true } : record
  } catch (error) {
    if (!isDataCloneError(error) || !record.handle) throw error
    const fallback: RepoRecord = { ...record, handlePersisted: false }
    delete fallback.handle
    await put(fallback)
    return fallback
  }
}

export async function putRepo(record: RepoRecord): Promise<RepoRecord> {
  return persistRepo(record, (next) => db.repos.put(next))
}

export async function removeRepo(id: string): Promise<void> {
  await db.transaction('rw', db.repos, db.snapshots, db.drafts, async () => {
    await db.repos.delete(id)
    await db.snapshots.delete(id)
    await db.drafts.where('repoId').equals(id).delete()
  })
}

export async function readSnapshot(repoId: string): Promise<RepoSnapshot | null> {
  const row = await db.snapshots.get(repoId)
  return row?.snapshot ?? null
}

export async function writeSnapshot(snapshot: RepoSnapshot): Promise<void> {
  await db.snapshots.put({ repoId: snapshot.repoId, snapshot })
}

export function draftId(repoId: string, issueId: string): string {
  return `${repoId}::${issueId}`
}

export async function saveDraft(record: Omit<DraftRecord, 'id'>): Promise<void> {
  await db.drafts.put({ ...record, id: draftId(record.repoId, record.issueId) })
}

export async function clearDraft(repoId: string, issueId: string): Promise<void> {
  await db.drafts.delete(draftId(repoId, issueId))
}

export async function listDrafts(repoId: string): Promise<DraftRecord[]> {
  return db.drafts.where('repoId').equals(repoId).toArray()
}

export async function estimateUsage(): Promise<{ bytes: number; repos: number }> {
  let bytes = 0
  if (navigator.storage?.estimate) {
    const est = await navigator.storage.estimate()
    bytes = est.usage ?? 0
  }
  return { bytes, repos: await db.repos.count() }
}
