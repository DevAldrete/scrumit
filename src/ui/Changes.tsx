import { useEffect, useMemo, useState } from 'preact/hooks'
import type { GitChange } from '../lib/git.ts'
import {
  capabilities,
  commitPaths,
  gitBusy,
  gitDiff,
  gitError,
  gitLogEntries,
  gitStatus,
  loadGit,
  loadGitDiff,
} from '../lib/store.ts'
import { Btn, Chip } from './primitives.tsx'
import { IconBranch, IconCheck, IconRefresh } from './icons.tsx'

export function Changes() {
  const status = gitStatus.value
  const diff = gitDiff.value
  const canCommit = capabilities.value.git === 'full' && !gitBusy.value
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')

  useEffect(() => {
    void loadGit()
  }, [])

  useEffect(() => {
    if (!status) return
    setSelected((current) => {
      const live = new Set(status.changes.map((change) => change.path))
      const next = new Set([...current].filter((path) => live.has(path)))
      return next.size === current.size ? current : next
    })
  }, [status])

  const groups = useMemo(() => {
    const map = new Map<string, GitChange[]>()
    for (const change of status?.changes ?? []) {
      const slash = change.path.lastIndexOf('/')
      const dir = slash < 0 ? '(repository root)' : change.path.slice(0, slash)
      const bucket = map.get(dir)
      if (bucket) bucket.push(change)
      else map.set(dir, [change])
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [status])

  function toggle(path: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function toggleAll() {
    if (!status) return
    setSelected((current) =>
      current.size === status.changes.length
        ? new Set()
        : new Set(status.changes.map((change) => change.path)),
    )
  }

  async function submit() {
    const ok = await commitPaths(message, [...selected])
    if (ok) {
      setSelected(new Set())
      setMessage('')
    }
  }

  if (capabilities.value.git !== 'full') {
    return (
      <div class="scroll-y h-full">
        <div class="mx-auto max-w-[680px] px-4 py-8">
          <h2 class="text-[16px] text-ink" style={{ fontFamily: 'var(--f-display)' }}>
            Git needs the local sidecar
          </h2>
          <p class="prose-body mt-2">
            The browser can read the branch name, but status, diffs and commits need a
            real checkout on disk. Run{' '}
            <code>npx scrumit serve --repo .</code> in this repository and connect to
            it from the welcome screen.
          </p>
          <p class="mt-3 text-[11.5px] text-ink-4">
            Merge, rebase and push stay in your terminal. This view never stages
            everything implicitly: a commit contains exactly the paths you tick.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div class="flex h-full min-h-0 flex-col">
      <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-1.5">
        <span class="flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-2">
          <IconBranch size={13} />
          <span class="truncate">{status?.branch ?? 'unknown branch'}</span>
        </span>
        {status?.upstream ? (
          <Chip title={`Tracking ${status.upstream}`}>
            {status.ahead > 0 ? `↑${status.ahead}` : ''}
            {status.ahead > 0 && status.behind > 0 ? ' ' : ''}
            {status.behind > 0 ? `↓${status.behind}` : ''}
            {status.ahead === 0 && status.behind === 0 ? 'up to date' : ''}
          </Chip>
        ) : null}
        {status ? (
          <span class="num text-[11px] text-ink-4">
            {status.changes.length === 0
              ? 'working tree clean'
              : `${status.changes.length} change${status.changes.length === 1 ? '' : 's'}`}
          </span>
        ) : null}
        <Btn
          class="ml-auto shrink-0"
          onClick={() => void loadGit()}
          disabled={gitBusy.value}
        >
          <IconRefresh size={13} />
          Refresh
        </Btn>
      </div>

      {gitError.value ? (
        <div class="shrink-0 border-b border-line bg-warn-soft px-3 py-1.5 text-[11.5px] text-ink-2">
          {gitError.value}
        </div>
      ) : null}

      <div class="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(300px,36%)_minmax(0,1fr)]">
        <div class="flex min-h-0 flex-col border-r border-line">
          <div class="scroll-y min-h-0 flex-1">
            {!status || status.changes.length === 0 ? (
              <div class="px-3 py-6">
                <p class="text-[12.5px] text-ink-2">Nothing to commit.</p>
                <p class="mt-1 text-[11.5px] leading-snug text-ink-4">
                  Edits made here, by an agent, or in a terminal will appear after a
                  refresh.
                </p>
              </div>
            ) : (
              groups.map(([dir, changes]) => (
                <section key={dir}>
                  <header class="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-panel-2 px-2.5 py-1">
                    <span class="num min-w-0 flex-1 truncate text-[10.5px] text-ink-3" title={dir}>
                      {dir}
                    </span>
                    <span class="num text-[10px] text-ink-4">{changes.length}</span>
                  </header>
                  <ul>
                    {changes.map((change) => (
                      <li key={change.path} class="border-b border-line last:border-b-0">
                        <div
                          class={`flex items-center gap-2 px-2.5 py-1.5 ${
                            diff?.path === change.path ? 'bg-accent-soft' : 'hover:bg-panel-2'
                          }`}
                        >
                          <input
                            type="checkbox"
                            class="shrink-0 accent-[var(--accent)]"
                            checked={selected.has(change.path)}
                            onChange={() => toggle(change.path)}
                            aria-label={`Select ${change.path}`}
                          />
                          <button
                            type="button"
                            class="flex min-w-0 flex-1 items-center gap-2 text-left"
                            onClick={() => void loadGitDiff(change.path)}
                          >
                            <span
                              class="num w-[34px] shrink-0 text-[10px]"
                              style={{
                                color: change.untracked
                                  ? 'var(--ink-4)'
                                  : change.staged && change.unstaged
                                    ? 'var(--warn)'
                                    : 'var(--accent)',
                              }}
                              title={`${change.label}${change.staged ? ' · staged' : ''}${
                                change.unstaged ? ' · unstaged' : ''
                              }`}
                            >
                              {change.label.slice(0, 3)}
                            </span>
                            <span class="min-w-0 flex-1 truncate text-[12px] text-ink">
                              {change.path}
                            </span>
                            {change.origPath ? (
                              <span class="max-w-[36%] shrink-0 truncate text-[10.5px] text-ink-4">
                                from {change.origPath}
                              </span>
                            ) : null}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>

          <div class="shrink-0 border-t border-line bg-panel-2 p-2">
            <div class="mb-1 flex items-center gap-2">
              <button
                type="button"
                class="text-[11px] text-ink-3 hover:text-ink disabled:opacity-40"
                onClick={toggleAll}
                disabled={!status || status.changes.length === 0}
              >
                {status && selected.size === status.changes.length ? 'Clear all' : 'Select all'}
              </button>
              <span class="num ml-auto text-[10.5px] text-ink-4">
                {selected.size} of {status?.changes.length ?? 0} selected
              </span>
            </div>
            <textarea
              class="field min-h-[58px] text-[12px]"
              rows={2}
              placeholder="Commit message — only the paths you selected are included"
              value={message}
              onInput={(event) => setMessage(event.currentTarget.value)}
            />
            <Btn
              variant="primary"
              class="mt-1.5 w-full justify-center"
              disabled={!canCommit || message.trim() === '' || selected.size === 0}
              onClick={() => void submit()}
            >
              <IconCheck size={13} />
              {gitBusy.value ? 'Committing…' : `Commit ${selected.size || ''}`.trim()}
            </Btn>
          </div>
        </div>

        <div class="flex min-h-0 min-w-0 flex-col">
          <div class="min-h-0 flex-1 overflow-auto bg-panel-2 p-2">
            {diff ? (
              <pre class="min-h-full whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
                {diff.diff.split('\n').map((line, index) => (
                  <span
                    key={index}
                    class="block"
                    style={{
                      color: line.startsWith('+')
                        ? 'var(--ok)'
                        : line.startsWith('-')
                          ? 'var(--signal)'
                          : line.startsWith('@@')
                            ? 'var(--accent)'
                            : 'var(--ink-3)',
                    }}
                  >
                    {line === '' ? ' ' : line}
                  </span>
                ))}
              </pre>
            ) : (
              <div class="grid h-full place-items-center px-4 text-center">
                <p class="max-w-[42ch] text-[12px] leading-relaxed text-ink-4">
                  Choose a changed file to see its unified diff. Nothing is staged until
                  you tick it and press Commit.
                </p>
              </div>
            )}
          </div>

          <div class="shrink-0 border-t border-line bg-panel">
            <p class="label px-2.5 pt-1.5">Recent commits</p>
            <ul class="max-h-[132px] overflow-y-auto">
              {gitLogEntries.value.length === 0 ? (
                <li class="px-2.5 py-2 text-[11.5px] text-ink-4">No commits yet.</li>
              ) : (
                gitLogEntries.value.map((commit) => (
                  <li
                    key={commit.sha}
                    class="flex items-center gap-2 border-b border-line px-2.5 py-1.5 last:border-b-0"
                  >
                    <span class="num shrink-0 text-[10.5px] text-accent">{commit.short}</span>
                    <span class="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">
                      {commit.subject}
                    </span>
                    <span class="shrink-0 text-[10.5px] text-ink-4">{commit.author}</span>
                    <span class="num shrink-0 text-[10.5px] text-ink-4">{commit.date}</span>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
