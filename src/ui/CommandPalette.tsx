import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { plainExcerpt } from '../lib/md.ts'
import type { View } from '../lib/store.ts'
import {
  activeRepo,
  addLocalRepo,
  capabilities,
  epics,
  initialiseRepo,
  issues,
  openDemo,
  paletteOpen,
  repos,
  rescan,
  select,
  setView,
  sprints,
  themeList,
  setTheme,
  view,
  writeAgentGuide,
} from '../lib/store.ts'
import { Swatch } from './primitives.tsx'
import { IconLayers, IconRefresh, IconTarget } from './icons.tsx'

interface Entry {
  id: string
  kind: 'issue' | 'view' | 'command' | 'repo' | 'sprint' | 'epic'
  label: string
  detail?: string
  hue?: number
  run: () => void
}

const VIEWS: { id: View; label: string }[] = [
  { id: 'board', label: 'Go to the board' },
  { id: 'backlog', label: 'Go to the backlog' },
  { id: 'sprints', label: 'Go to sprints' },
  { id: 'epics', label: 'Go to epics' },
  { id: 'metrics', label: 'Go to flow and metrics' },
  { id: 'settings', label: 'Go to settings' },
]

export function CommandPalette() {
  const open = paletteOpen.value
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
      queueMicrotask(() => input.current?.focus())
    }
  }, [open])

  const entries = useMemo(() => {
    if (!open) return []
    const needle = query.trim().toLowerCase()
    const list: Entry[] = []

    for (const issue of issues.value) {
      const haystack = `${issue.id} ${issue.title} ${issue.labels.join(' ')}`.toLowerCase()
      if (needle !== '' && !haystack.includes(needle)) continue
      list.push({
        id: `issue:${issue.id}`,
        kind: 'issue',
        label: issue.title,
        detail: issue.id,
        run: () => {
          select(issue.id)
        },
      })
      if (list.length > 40) break
    }

    for (const entry of VIEWS) {
      if (needle !== '' && !entry.label.toLowerCase().includes(needle)) continue
      list.push({
        id: `view:${entry.id}`,
        kind: 'view',
        label: entry.label,
        detail: entry.id === view.value ? 'current' : undefined,
        run: () => {
          void setView(entry.id)
        },
      })
    }

    for (const epic of epics.value) {
      const haystack = `${epic.id} ${epic.title}`.toLowerCase()
      if (needle === '' || !haystack.includes(needle)) continue
      list.push({
        id: `epic:${epic.id}`,
        kind: 'epic',
        label: epic.title,
        detail: epic.id,
        hue: epic.color,
        run: () => {
          void setView('epics')
        },
      })
    }

    for (const sprint of sprints.value) {
      const haystack = `${sprint.id} ${sprint.name}`.toLowerCase()
      if (needle === '' || !haystack.includes(needle)) continue
      list.push({
        id: `sprint:${sprint.id}`,
        kind: 'sprint',
        label: sprint.name,
        detail: sprint.state,
        run: () => {
          void setView('sprints')
        },
      })
    }

    const commands: {
      label: string
      detail?: string
      mutating?: boolean
      run: () => void
    }[] = [
      {
        label: 'Open a repository folder…',
        run: () => {
          void addLocalRepo()
        },
      },
      {
        label: 'Explore the demo repo',
        run: () => {
          void openDemo()
        },
      },
      {
        label: 'Rescan the repository',
        run: () => {
          void rescan()
        },
      },
      {
        label: 'Write .scrumit/AGENTS.md',
        detail: 'write',
        mutating: true,
        run: () => {
          void writeAgentGuide()
        },
      },
      {
        label: 'Initialise .scrumit/config.yaml',
        detail: 'write',
        mutating: true,
        run: () => {
          void initialiseRepo()
        },
      },
      ...repos.value
        .filter((repo) => repo.id !== activeRepo.value?.id)
        .map((repo) => ({
          label: `Switch to ${repo.name}`,
          detail: repo.kind,
          run: () => {
            window.dispatchEvent(new CustomEvent('scrumit:open-repo', { detail: repo.id }))
          },
        })),
      ...themeList.map((name) => ({
        label: `Use the ${name.replace(/-/g, ' ')} theme`,
        detail: 'theme',
        run: () => {
          void setTheme(name)
        },
      })),
    ]

    for (const command of commands) {
      if (needle !== '' && !command.label.toLowerCase().includes(needle)) continue
      if (command.mutating && !capabilities.value.canWrite) continue
      list.push({
        id: `command:${command.label}`,
        kind: 'command',
        label: command.label,
        detail: command.detail,
        run: command.run,
      })
    }

    return list.slice(0, 60)
  }, [
    open,
    query,
    issues.value,
    epics.value,
    sprints.value,
    repos.value,
    view.value,
    capabilities.value.canWrite,
  ])

  useEffect(() => {
    setCursor((current) => Math.min(current, Math.max(entries.length - 1, 0)))
  }, [entries.length])

  if (!open) return null

  function close() {
    paletteOpen.value = false
  }

  return (
    <div class="fixed inset-0 z-50 flex justify-center bg-[rgb(0_0_0/0.45)] pt-[10vh]">
      <div class="absolute inset-0" role="presentation" onClick={close} />
      <div
        class="pop relative z-10 flex max-h-[62vh] w-[min(620px,calc(100vw-32px))] flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Find anything"
      >
        <input
          ref={input}
          class="shrink-0 border-b border-line bg-transparent px-3 py-2.5 text-[14px] text-ink outline-none placeholder:text-ink-4"
          placeholder="Find an issue, a view, a sprint, or run a command"
          value={query}
          onInput={(event) => {
            setQuery(event.currentTarget.value)
            setCursor(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setCursor((current) => Math.min(current + 1, entries.length - 1))
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setCursor((current) => Math.max(current - 1, 0))
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              const entry = entries[cursor]
              if (!entry) return
              close()
              entry.run()
            }
            if (event.key === 'Escape') close()
          }}
        />

        <ul class="min-h-0 flex-1 overflow-y-auto p-1">
          {entries.length === 0 ? (
            <li class="px-2.5 py-6 text-center text-[12px] text-ink-4">
              Nothing matches “{query}”. Markdown files without an <code>id</code> in
              front-matter are not indexed.
            </li>
          ) : (
            entries.map((entry, index) => (
              <li key={entry.id}>
                <button
                  type="button"
                  class={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left ${
                    index === cursor ? 'bg-accent-soft text-ink' : 'text-ink-2 hover:bg-panel-2'
                  }`}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => {
                    close()
                    entry.run()
                  }}
                >
                  <span class="shrink-0 text-ink-4">
                    {entry.kind === 'epic' ? (
                      <Swatch hue={entry.hue ?? 1} />
                    ) : entry.kind === 'sprint' ? (
                      <IconTarget size={12} />
                    ) : entry.kind === 'view' ? (
                      <IconLayers size={12} />
                    ) : entry.kind === 'command' ? (
                      <IconRefresh size={12} />
                    ) : null}
                  </span>

                  {entry.kind === 'issue' ? (
                    <>
                      <span class="num shrink-0 text-[10.5px] text-ink-3">{entry.detail}</span>                      <span class="min-w-0 flex-1 truncate text-[13px] text-ink">
                        {entry.label}
                      </span>
                      <span class="hidden min-w-0 max-w-[40%] shrink-0 truncate text-[11px] text-ink-4 sm:block">
                        {plainExcerpt(
                          issues.value.find((i) => i.id === entry.detail)?.body ?? '',
                          60,
                        )}
                      </span>
                    </>
                  ) : (
                    <>
                      <span class="min-w-0 flex-1 truncate text-[13px]">{entry.label}</span>
                      {entry.detail && entry.kind !== 'epic' && entry.kind !== 'sprint' ? (
                        <span class="shrink-0 text-[11px] text-ink-4">{entry.detail}</span>
                      ) : null}
                    </>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>

        <footer class="flex shrink-0 items-center gap-3 border-t border-line bg-panel-2 px-3 py-1.5 text-[10.5px] text-ink-4">
          <span>↑ ↓ to move</span>
          <span>Enter to open</span>
          <span>Esc to dismiss</span>
          {activeRepo.value ? (
            <span class="ml-auto truncate">{activeRepo.value.name}</span>
          ) : null}
        </footer>
      </div>
    </div>
  )
}
