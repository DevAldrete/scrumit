import { useEffect } from 'preact/hooks'
import {
  activeRepo,
  addLocalRepo,
  bootstrap,
  capabilities,
  externalUpdates,
  fileCount,
  flush,
  handleLost,
  initialiseRepo,
  issues,
  loadState,
  openHandleAsRepo,
  openRepo,
  paletteOpen,
  permission,
  reconnect,
  refreshOnReturn,
  repos,
  select,
  selectedId,
  toast,
  view,
  watching,
} from './lib/store.ts'
import { db, type RepoRecord } from './lib/db.ts'
import type { RepoSource } from './lib/source.ts'
import { Backlog } from './ui/Backlog.tsx'
import { Board } from './ui/Board.tsx'
import { CommandPalette } from './ui/CommandPalette.tsx'
import { Epics } from './ui/Epics.tsx'
import { IssuePanel } from './ui/IssuePanel.tsx'
import { Metrics } from './ui/Metrics.tsx'
import { Settings } from './ui/Settings.tsx'
import { Sprints } from './ui/Sprints.tsx'
import { Rail, ViewHeader } from './ui/ViewHeader.tsx'
import { TopBar } from './ui/TopBar.tsx'
import { Btn } from './ui/primitives.tsx'
import { IconRefresh, IconWarn, IconX } from './ui/icons.tsx'
import { Welcome } from './ui/Welcome.tsx'

/**
 * A tiny read-only repository used by the smoke suite to prove that a source
 * with `canWrite: false` refuses every mutation. It is inside the DEV guard and
 * is dropped from production bundles.
 */
function makeReadOnlyFixture(): { source: RepoSource; writeAttempts: () => number } {
  const files = new Map<string, string>([
    ['.scrumit/config.yaml', 'version: 1\nproject: Read-only fixture\n'],
    [
      'sprints/2026-S01/sprint.md',
      '---\nid: 2026-S01\nname: Sprint 1\nstate: active\n---\n\nFixture sprint.\n',
    ],
    [
      'sprints/2026-S01/READONLY-1.md',
      '---\nid: READONLY-1\ntitle: Only the file can change\nstatus: todo\ntype: story\nsprint: 2026-S01\norder: 10\ncreated: 2026-10-19\nupdated: 2026-10-19\n---\n\n## Context\n\nThis fixture refuses every write.\n',
    ],
  ])
  let attempts = 0
  const refuse = async (): Promise<never> => {
    attempts += 1
    throw new Error('read-only fixture refuses writes')
  }
  return {
    source: {
      kind: 'fsa',
      label: 'read-only fixture',
      capabilities: { canWrite: false, canWatch: false, access: 'handle', git: 'none' },
      list: async () => [...files.keys()],
      read: async (path) => {
        const text = files.get(path)
        if (text === undefined) throw new Error(`Not found: ${path}`)
        return text
      },
      write: refuse,
      remove: refuse,
      exists: async (path) => files.has(path),
      permission: async () => 'denied',
      request: async () => 'denied',
    },
    writeAttempts: () => attempts,
  }
}

export function App() {
  useEffect(() => {
    if (import.meta.env.DEV) {
      // Test seam so an automated browser can exercise the File System Access
      // path, which cannot be driven through the native directory picker.
      let fixture = makeReadOnlyFixture()
      ;(window as unknown as Record<string, unknown>).__scrumit = {
        openHandleAsRepo,
        // Simulate a browser that cannot clone a FileSystemDirectoryHandle:
        // the record stays, the handle does not.
        dropHandles: async () => {
          await db.repos.toCollection().modify((record) => {
            delete record.handle
          })
        },
        openReadOnlyFake: async () => {
          fixture = makeReadOnlyFixture()
          const record: RepoRecord = {
            id: 'fixture-readonly',
            name: 'Read-only fixture',
            path: 'fixture://read-only',
            kind: 'fsa',
            color: 1,
            createdAt: Date.now(),
            lastOpenedAt: Date.now(),
          }
          await openRepo(record, { source: fixture.source, transient: true })
        },
        stats: () => ({
          externalUpdates: externalUpdates.value,
          watching: watching.value,
          writeAttempts: fixture.writeAttempts(),
        }),
      }
    }
  }, [])

  useEffect(() => {
    void bootstrap()
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        paletteOpen.value = !paletteOpen.value
        return
      }
      if (event.key === 'Escape' && selectedId.value !== null) {
        select(null)
      }
    }

    function onPaletteRequest() {
      paletteOpen.value = true
    }

    function onOpenRepo(event: Event) {
      const id = (event as CustomEvent<string>).detail
      const repo = repos.value.find((item) => item.id === id)
      if (repo) void openRepo(repo, { gesture: true })
    }

    let hiddenAt = 0
    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        void flush()
        return
      }
      // Browsers without FileSystemObserver get a look when the tab returns.
      void refreshOnReturn(Date.now() - hiddenAt)
    }

    function onPageHide() {
      void flush()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scrumit:palette', onPaletteRequest)
    window.addEventListener('scrumit:open-repo', onOpenRepo)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scrumit:palette', onPaletteRequest)
      window.removeEventListener('scrumit:open-repo', onOpenRepo)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [])

  if (loadState.value === 'error' && activeRepo.value === null) {
    return (
      <div class="flex h-full items-center justify-center p-6">
        <div class="panel max-w-[520px] p-4">
          <h1 class="flex items-center gap-2 text-[13px] text-signal">
            <IconWarn size={14} />
            scrumit could not open the repository
          </h1>
          <p class="prose-body mt-2">
            The folder may have been moved, renamed or deleted since you last
            opened it. Nothing in your repository was changed.
          </p>
          <div class="mt-3 flex gap-2">
            <Btn variant="primary" onClick={() => void reconnect()}>
              <IconRefresh size={13} />
              Try again
            </Btn>
            <Btn
              onClick={() => {
                loadState.value = 'welcome'
                activeRepo.value = null
              }}
            >
              Choose another repository
            </Btn>
          </div>
        </div>
      </div>
    )
  }

  if (loadState.value === 'welcome' || activeRepo.value === null) {
    return <Welcome />
  }

  return (
    <div class="flex h-full flex-col">
      <TopBar />
      {!capabilities.value.canWrite ? (
        <div class="flex shrink-0 items-center gap-2 border-b border-line bg-warn-soft px-3 py-1.5">
          <IconWarn size={13} />
          <span class="text-[11.5px] text-ink-2">
            {handleLost.value
              ? 'Read-only — scrumit is showing the last saved view. This browser cannot remember the folder handle, so open the folder again to write.'
              : permission.value !== 'granted' && capabilities.value.access === 'handle'
                ? 'scrumit is showing the last saved index. It cannot write to this folder until you grant access in this browser session.'
                : 'Read-only — this browser can open the folder but not write to it. Run `npx scrumit serve` for full access.'}
          </span>
          {handleLost.value || (permission.value !== 'granted' && capabilities.value.access === 'handle') ? (
            <Btn
              class="ml-auto shrink-0"
              onClick={() => void (handleLost.value ? addLocalRepo() : reconnect())}
            >
              {handleLost.value ? 'Open the folder again' : 'Grant access'}
            </Btn>
          ) : null}
        </div>
      ) : null}

      <div class="flex min-h-0 flex-1">
        <Rail />
        <main class="flex min-w-0 flex-1 flex-col">
          <ViewHeader />

          {loadState.value === 'loading' && issues.value.length === 0 ? (
            <div class="flex flex-1 items-center justify-center">
              <p class="text-[12px] text-ink-4">Reading the repository…</p>
            </div>
          ) : (
            <div class="min-h-0 flex-1">
              <Content />
            </div>
          )}

          {issues.value.length === 0 && loadState.value === 'ready' && view.value !== 'settings' ? (
            <div class="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-panel-2 px-3 py-2">
              <IconWarn size={13} />
              <span class="text-[11.5px] text-ink-3">
                scrumit read {fileCount.value} files and found no issues. An issue is
                any markdown file with an <code>id</code> in its front-matter.
              </span>
              <Btn class="ml-auto" onClick={() => void initialiseRepo()}>
                Write a starter config.yaml
              </Btn>
            </div>
          ) : null}
        </main>

        <IssuePanel />
      </div>

      <CommandPalette />
      <Toast />
    </div>
  )
}

function Content() {
  switch (view.value) {
    case 'backlog':
      return <Backlog />
    case 'sprints':
      return <Sprints />
    case 'epics':
      return <Epics />
    case 'metrics':
      return <Metrics />
    case 'settings':
      return <Settings />
    case 'board':
    default:
      return <Board />
  }
}

function Toast() {
  const current = toast.value
  if (!current) return null
  return (
    <div class="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
      <div
        class="pop pointer-events-auto flex max-w-[70ch] cursor-pointer items-start gap-2 px-3 py-2"
        role="status"
        aria-live="polite"
        title="Dismiss"
        onClick={() => {
          toast.value = null
        }}
      >
        {current.kind === 'error' ? (
          <span class="mt-[3px] shrink-0 text-signal">
            <IconWarn size={13} />
          </span>
        ) : null}
        <span class="min-w-0">
          <span class="block text-[12.5px] text-ink-2">{current.message}</span>
          {current.details && current.details.length > 0 ? (
            <span class="mt-0.5 block text-[11.5px] leading-relaxed text-ink-4">
              {current.details.map((line) => (
                <span key={line} class="block truncate">
                  {line}
                </span>
              ))}
            </span>
          ) : null}
        </span>
        <span class="ml-1 shrink-0 text-ink-4">
          <IconX size={12} />
        </span>
      </div>
    </div>
  )
}
