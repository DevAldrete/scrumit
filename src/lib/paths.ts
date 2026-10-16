import type { BoardConfig, Issue } from './model.ts'

export function slug(text: string, max = 48): string {
  const s = text
    .normalize('NFKD')
    // Drop combining marks so "Ünïcodé" folds to "unicode" rather than
    // collapsing into separators. Letters outside Latin-1 are kept as-is.
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '')
  return s || 'untitled'
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

export function basename(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? path : path.slice(i + 1)
}

export function joinPath(...parts: string[]): string {
  return parts
    .filter((p) => p !== '')
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+|\/+$/g, '')))
    .join('/')
}

/**
 * Where an issue belongs, derived from its own fields.
 *
 *   done + sprint   → done/<sprint>/ID.md
 *   donet           → done/ID.md
 *   sprinted        → sprints/<sprint>/ID.md
 *   otherwise       → backlog/ID.md
 *
 * Moving a file is therefore idempotent, and a hand-moved file converges with
 * a hand-edited `status`.
 */
export function issuePath(
  issue: Pick<Issue, 'id' | 'status' | 'sprint'>,
  dirs: BoardConfig['dirs'],
): string {
  if (issue.status === 'done') {
    return issue.sprint
      ? joinPath(dirs.archive, issue.sprint, `${issue.id}.md`)
      : joinPath(dirs.archive, `${issue.id}.md`)
  }
  if (issue.sprint) return joinPath(dirs.sprints, issue.sprint, `${issue.id}.md`)
  return joinPath(dirs.backlog, `${issue.id}.md`)
}

/** On create we humanise the filename; on rename we leave it alone. */
export function epicPath(
  epic: { id: string; title: string; path: string | null },
  dirs: BoardConfig['dirs'],
): string {
  if (epic.path) return epic.path
  return joinPath(dirs.epics, `${epic.id}-${slug(epic.title)}.md`)
}

export function sprintPath(
  sprint: { id: string },
  dirs: BoardConfig['dirs'],
): string {
  return joinPath(dirs.sprints, sprint.id, 'sprint.md')
}

