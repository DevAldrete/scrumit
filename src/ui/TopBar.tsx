import { useEffect, useState } from 'preact/hooks'
import { relativeTime } from '../lib/format.ts'
import {
  activeRepo,
  addLocalRepo,
  closeRepo,
  compact,
  clearExternalLog,
  externalLog,
  forgetRepo,
  gitBranch,
  lastExternalAt,
  openDemo,
  permission,
  reconnect,
  refreshRepos,
  repos,
  rescan,
  resetDemo,
  saving,
  setTheme,
  theme,
  themeList,
  toggleCompact,
  watching,
} from '../lib/store.ts'
import { personName } from '../lib/format.ts'
import { Btn, Menu, MenuItem, Swatch, tintStyle } from './primitives.tsx'
import {
  IconBranch,
  IconFolder,
  IconPalette,
  IconRefresh,
  IconSearch,
  IconTrash,
} from './icons.tsx'

export function TopBar() {
  const repo = activeRepo.value

  return (
    <header class="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-panel px-2.5">
      <button
        type="button"
        class="shrink-0 rounded-sm px-1 text-[15px] leading-none text-ink"
        style={{
          fontFamily: 'var(--f-display)',
          fontWeight: 500,
          letterSpacing: '-0.03em',
          fontVariationSettings: "'SOFT' 24, 'WONK' 1, 'opsz' 40",
        }}
        title="Back to your repositories"
        onClick={() => void closeRepo()}
      >
        scrumit
      </button>

      <span class="h-4 w-px shrink-0 bg-line" />

      <RepoSwitcher />

      {gitBranch.value ? (
        <span class="hidden shrink-0 items-center gap-1 text-[11px] text-ink-4 sm:flex">
          <IconBranch size={12} />
          {gitBranch.value}
        </span>
      ) : null}

      <LiveIndicator />

      {repo && permission.value !== 'granted' ? (
        <Btn onClick={() => void reconnect()} class="shrink-0">
          Grant access
        </Btn>
      ) : null}

      <span class="ml-auto" />

      {saving.value ? (
        <span class="hidden shrink-0 text-[11px] text-ink-4 md:inline">writing…</span>
      ) : null}

      <button
        type="button"
        class="hidden h-7 shrink-0 items-center gap-2 rounded-sm border border-line-2 px-2 text-[11.5px] text-ink-4 hover:border-ink-4 hover:text-ink-2 md:flex"
        onClick={() => {
          window.dispatchEvent(new CustomEvent('scrumit:palette'))
        }}
      >
        <IconSearch size={12} />
        Find anything
        <span class="num text-[10px] text-ink-4">⌘K</span>
      </button>

      <Btn
        variant="ghost"
        icon
        title="Rescan the repository"
        onClick={() => void rescan()}
      >
        <IconRefresh size={14} />
      </Btn>

      <ThemeMenu />
    </header>
  )
}

/**
 * A quiet statement that scrumit is listening. It is not decoration: without it
 * there is no way to tell a board that is up to date from one that is simply
 * stale, and the difference matters the moment an agent starts editing files.
 */
function LiveIndicator() {
  const at = lastExternalAt.value
  const log = externalLog.value
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    if (at === null) return
    setFlash(true)
    const timer = setTimeout(() => setFlash(false), 3000)
    return () => clearTimeout(timer)
  }, [at])

  if (!watching.value) return null

  return (
    <Menu
      align="left"
      class="w-[64px] shrink-0"
      menuClass="w-[340px] max-w-[calc(100vw-24px)]"
      title="Recent changes made outside scrumit"
      label={
        <span
          class="flex min-w-0 items-center gap-1.5 text-[11px]"
          style={{ color: flash ? 'var(--accent)' : 'var(--ink-4)' }}
        >
          <span
            class="h-[6px] w-[6px] shrink-0 rounded-full"
            style={{ background: flash ? 'var(--accent)' : 'var(--ok)' }}
          />
          {flash ? 'synced' : 'live'}
        </span>
      }
    >
      {(close) => (
        <div class="flex min-w-0 flex-col">
          <div class="flex items-center gap-2 px-2 py-1">
            <span class="label">Changes from disk</span>
            <span class="num ml-auto text-[10px] text-ink-4">{log.length}/50</span>
            {log.length > 0 ? (
              <button
                type="button"
                class="text-[10.5px] text-ink-4 hover:text-ink"
                onClick={() => {
                  clearExternalLog()
                  close()
                }}
              >
                Clear
              </button>
            ) : null}
          </div>
          {log.length === 0 ? (
            <p class="px-2 py-2 text-[11.5px] leading-snug text-ink-4">
              Nothing has arrived from outside the app yet. Edits by an agent, a
              terminal or a <code>git checkout</code> will appear here.
            </p>
          ) : (
            <ul class="max-h-[320px] overflow-y-auto">
              {log.map((entry) => (
                <li key={entry.id} class="border-t border-line px-2 py-1.5">
                  <div class="flex items-baseline gap-2">
                    <span class="min-w-0 flex-1 text-[11.5px] text-ink-2">
                      {entry.summary}
                    </span>
                    <span class="num shrink-0 text-[10px] text-ink-4">
                      {relativeTime(entry.at)}
                    </span>
                  </div>
                  {entry.details.length > 0 ? (
                    <ul class="mt-0.5">
                      {entry.details.map((line) => (
                        <li key={line} class="truncate text-[10.5px] text-ink-4" title={line}>
                          {line}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Menu>
  )
}

function RepoSwitcher() {
  const repo = activeRepo.value

  return (
    <Menu
      class="max-w-[280px] shrink-0"
      align="left"
      title={repo ? `${repo.name} — switch repository` : 'Choose a repository'}
      label={
        repo ? (
          <span class="flex min-w-0 items-center gap-1.5">
            <span class="swatch" style={tintStyle(repo.color)} />
            <span class="truncate text-[12.5px] text-ink">{repo.name}</span>
            {repo.kind === 'demo' ? (
              <span class="num shrink-0 text-[10px] text-ink-4">demo</span>
            ) : null}
          </span>
        ) : (
          <span class="flex items-center gap-1.5 text-ink-3">
            <IconFolder size={13} />
            No repository
          </span>
        )
      }
    >
      {(close) => (
        <>
          {repos.value.length > 1 ? (
            <>
              <p class="label px-2 py-1">Switch to</p>
              {repos.value
                .filter((item) => item.id !== activeRepo.value?.id)
                .map((item) => (
                  <MenuItem
                    key={item.id}
                    hint={relativeTime(item.lastOpenedAt)}
                    onClick={() => {
                      close()
                      window.dispatchEvent(
                        new CustomEvent('scrumit:open-repo', { detail: item.id }),
                      )
                    }}
                  >
                    <span class="flex items-center gap-1.5">
                      <Swatch hue={item.color} />
                      <span class="truncate">{item.name}</span>
                    </span>
                  </MenuItem>
                ))}
              <div class="my-1 h-px bg-line" />
            </>
          ) : null}

          <MenuItem
            onClick={() => {
              close()
              void addLocalRepo()
            }}
          >
            Open a repository folder…
          </MenuItem>
          <MenuItem
            onClick={() => {
              close()
              void openDemo()
            }}
          >
            Explore the demo repo
          </MenuItem>

          {activeRepo.value?.kind === 'demo' ? (
            <MenuItem
              onClick={() => {
                close()
                void resetDemo()
              }}
            >
              Reset the demo data
            </MenuItem>
          ) : null}

          {repos.value.length > 1 ? (
            <MenuItem
              onClick={() => {
                close()
                void refreshRepos()
              }}
            >
              Refresh the list
            </MenuItem>
          ) : null}

          {activeRepo.value && activeRepo.value.kind !== 'demo' ? (
            <>
              <div class="my-1 h-px bg-line" />
              <MenuItem
                onClick={() => {
                  const id = activeRepo.value?.id
                  close()
                  if (id) void forgetRepo(id)
                }}
              >
                <span class="flex items-center gap-1.5 text-signal">
                  <IconTrash size={12} />
                  Forget this repository
                </span>
              </MenuItem>
            </>
          ) : null}
        </>
      )}
    </Menu>
  )
}

function ThemeMenu() {
  const current = theme.value
  return (
    <Menu
      align="right"
      class="w-[124px] shrink-0"
      title="Change theme"
      label={
        <span class="flex items-center gap-1.5">
          <IconPalette size={13} />
          <span class="hidden truncate text-[11.5px] text-ink-3 lg:inline">
            {personName(current)}
          </span>
        </span>
      }
    >
      {(close) => (
        <>
          {themeList.map((name) => (
            <button
              key={name}
              type="button"
              class={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] ${
                current === name ? 'bg-accent-soft text-ink' : 'text-ink-2 hover:bg-panel-2 hover:text-ink'
              }`}
              onClick={() => {
                close()
                void setTheme(name)
              }}
            >
              <ThemeSwatch name={name} />
              <span class="truncate">{personName(name)}</span>
              {current === name ? <span class="ml-auto text-[10px] text-accent">●</span> : null}
            </button>
          ))}
          <div class="my-1 h-px bg-line" />
          <MenuItem
            onClick={() => {
              close()
              void toggleCompact()
            }}
            selected={compact.value}
          >
            Compact rows
          </MenuItem>
          <MenuItem
            onClick={() => {
              close()
              void rescan()
            }}
          >
            Rescan repository
          </MenuItem>
        </>
      )}
    </Menu>
  )
}

/** Four bars sampled from the theme's own tokens, so the menu previews it. */
function ThemeSwatch({ name }: { name: string }) {
  return (
    <span
      class="flex shrink-0 items-center gap-0.5"
      data-theme={name}
      aria-hidden="true"
    >
      {(['--p-blue', '--p-green', '--p-orange', '--p-red'] as const).map((token) => (
        <span
          key={token}
          class="h-3 w-[3px] rounded-full"
          style={{ background: `var(${token})` }}
        />
      ))}
    </span>
  )
}
