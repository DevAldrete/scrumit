/**
 * The small, honest slice of git scrumit shows: working-tree status, a unified
 * diff per file, the last few commits, and a commit of explicitly chosen paths.
 * Merge, rebase, push and branch creation stay in the terminal.
 */

export interface GitChange {
  path: string
  /** Present for a rename or copy. */
  origPath?: string
  /** Index (staged) status code, e.g. `M`. */
  index: string
  /** Working-tree status code, e.g. `M` or `?`. */
  worktree: string
  label: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
}

export interface GitStatus {
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  changes: GitChange[]
  clean: boolean
}

export interface GitDiff {
  path: string
  diff: string
}

export interface GitCommit {
  sha: string
  short: string
  author: string
  date: string
  subject: string
}

export interface GitCommitResult {
  ok: true
  sha: string
  short: string
  paths: string[]
}

/** Methods a source may expose when it can talk to a real git checkout. */
export interface GitOperations {
  gitStatus(): Promise<GitStatus>
  gitDiff(path: string): Promise<GitDiff>
  gitLog(limit?: number): Promise<GitCommit[]>
  gitCommit(message: string, paths: string[]): Promise<GitCommitResult>
}
