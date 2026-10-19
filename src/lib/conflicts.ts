import type { Issue } from './model.ts'

export interface ConflictInfo {
  issueId: string
  path: string
  /** The text the user has in memory. */
  mine: string
  /** The text on disk at the moment the conflict was detected, or null if deleted. */
  theirs: string | null
  /** The fresh ETag that a Keep mine write must use. */
  etag: string | null
  at: number
}

/**
 * A background rescan must not replace a card the user is still resolving.
 * Keep the local version for conflicted ids, and keep it even if the disk copy
 * disappeared entirely.
 */
export function overlayConflicts(
  snapshot: Issue[],
  local: Issue[],
  conflictedIds: Iterable<string>,
): Issue[] {
  const wanted = new Set(conflictedIds)
  if (wanted.size === 0) return snapshot
  const localById = new Map(local.map((issue) => [issue.id, issue]))
  const seen = new Set<string>()
  const out = snapshot.map((issue) => {
    if (!wanted.has(issue.id)) return issue
    seen.add(issue.id)
    return localById.get(issue.id) ?? issue
  })
  for (const id of wanted) {
    if (seen.has(id)) continue
    const issue = localById.get(id)
    if (issue) out.push(issue)
  }
  return out
}
