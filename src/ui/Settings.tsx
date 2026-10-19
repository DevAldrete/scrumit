import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { AGENT_GUIDE_PATH, AGENT_POINTER } from '../lib/agentGuide.ts'
import { estimateUsage } from '../lib/db.ts'
import { bytes, personName, relativeTime } from '../lib/format.ts'
import { STATUS_LABEL, type Status } from '../lib/model.ts'
import {
  activeRepo,
  capabilities,
  compact,
  config,
  drafts,
  fileCount,
  forgetRepo,
  gitBranch,
  initialiseRepo,
  moveColumn,
  notify,
  patchColumn,
  patchConfig,
  permission,
  reconnect,
  rescan,
  resetDemo,
  scannedAt,
  setTheme,
  theme,
  themeList,
  toggleCompact,
  watchNotice,
  watching,
  wipeLocalData,
  writeAgentGuide,
  writeAgentSkill,
} from '../lib/store.ts'
import { Btn, Chip, Kbd, tintStyle } from './primitives.tsx'
import { IconCheck, IconRefresh, IconTerminal, IconTrash } from './icons.tsx'

export function Settings() {
  const repo = activeRepo.value
  const isDemo = repo?.kind === 'demo'
  const [stored, setStored] = useState(0)

  useEffect(() => {
    void estimateUsage().then((usage) => setStored(usage.bytes))
  }, [drafts.value.length, scannedAt.value])

  return (
    <div class="scroll-y h-full">
      <div class="mx-auto flex max-w-[900px] flex-col gap-5 px-4 py-4">
        <Section title="Appearance" hint="themes are token sets, not stylesheets">
          <div class="grid grid-cols-[repeat(auto-fill,minmax(136px,1fr))] gap-2">
            {themeList.map((name) => (
              <button
                key={name}
                type="button"
                class={`panel overflow-hidden p-0 text-left ${
                  theme.value === name ? 'ring-2 ring-accent' : ''
                }`}
                onClick={() => void setTheme(name)}
              >
                <span
                  data-theme={name}
                  class="block p-2"
                  style={{ background: 'var(--paper)' }}
                >
                  <span class="flex items-center gap-1.5">
                    <span
                      class="h-2 w-2 rounded-full"
                      style={{ background: 'var(--accent)' }}
                    />
                    <span class="truncate text-[10.5px]" style={{ color: 'var(--ink)' }}>
                      {personName(name)}
                    </span>
                  </span>
                  <span class="mt-1.5 flex gap-1">
                    {[0, 1, 2].map((index) => (
                      <span
                        key={index}
                        class="h-5 flex-1 rounded-sm"
                        style={{
                          background: 'var(--panel)',
                          border: '1px solid var(--line)',
                          borderTopColor: `var(--e${index + 1})`,
                          borderTopWidth: '2px',
                        }}
                      />
                    ))}
                  </span>
                  <span class="mt-1.5 flex gap-0.5">
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((hue) => (
                      <span
                        key={hue}
                        class="h-[7px] flex-1 rounded-full"
                        style={{ background: `var(--e${hue})` }}
                      />
                    ))}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <label class="mt-3 flex items-center gap-2 text-[12.5px] text-ink-2">
            <input
              type="checkbox"
              class="accent-[var(--accent)]"
              checked={compact.value}
              onChange={() => void toggleCompact()}
            />
            Compact board columns
            <span class="text-[11px] text-ink-4">
              Narrower columns, same information.
            </span>
          </label>
        </Section>

        <Section title="Repository">
          {repo ? (
            <div class="inset flex flex-col gap-2 p-2.5">
              <div class="flex flex-wrap items-center gap-2">
                <span class="swatch h-2.5 w-2.5" style={tintStyle(repo.color)} />
                <span class="text-[13px] text-ink">{repo.name}</span>
                <Chip>{repo.kind === 'demo' ? 'demo repository' : 'local folder'}</Chip>
                {gitBranch.value ? <Chip>branch {gitBranch.value}</Chip> : null}
              </div>
              <dl class="grid grid-cols-2 gap-x-6 gap-y-1 text-[11.5px] sm:grid-cols-4">
                <Meta label="path" value={repo.path} />
                <Meta label="files seen" value={String(fileCount.value)} />
                <Meta label="read" value={relativeTime(scannedAt.value)} />
                <Meta
                  label="access"
                  value={permission.value === 'granted' ? 'read and write' : permission.value}
                />
              </dl>

              <p class="text-[11px] leading-snug text-ink-4">
                {watching.value ? (
                  <>
                    <span class="mr-1 inline-block h-[6px] w-[6px] rounded-full align-middle" style={{ background: 'var(--ok)' }} />
                    Watching this folder. Edits made outside scrumit — an agent
                    rewriting files, or a <code>git checkout</code> — rebuild the board
                    on their own.
                  </>
                ) : (
                  <>
                    <span class="mr-1 inline-block h-[6px] w-[6px] rounded-full align-middle" style={{ background: 'var(--ink-4)' }} />
                    {watchNotice.value ?? 'Not watching this folder.'} Changes made
                    outside scrumit need <strong>Rescan</strong> in the top bar.
                  </>
                )}
              </p>
              <div class="flex flex-wrap gap-1.5">
                <Btn onClick={() => void rescan()}>
                  <IconRefresh size={13} />
                  Rescan
                </Btn>
                {permission.value !== 'granted' ? (
                  <Btn variant="primary" onClick={() => void reconnect()}>
                    Grant folder access
                  </Btn>
                ) : null}
                {isDemo ? (
                  <Btn onClick={() => void resetDemo()}>Reset the demo data</Btn>
                ) : (
                  <Btn
                    disabled={!capabilities.value.canWrite}
                    onClick={() => void initialiseRepo()}
                  >
                    Write a starter config.yaml
                  </Btn>
                )}
                <Btn
                  variant="danger"
                  onClick={() => {
                    if (repo.id) void forgetRepo(repo.id)
                  }}
                >
                  <IconTrash size={13} />
                  Forget this repository
                </Btn>
              </div>
              {!isDemo ? (
                <p class="text-[11px] leading-snug text-ink-4">
                  Forgetting removes the folder handle and the cached index. Your
                  files are untouched.
                </p>
              ) : null}
            </div>
          ) : (
            <p class="text-[11.5px] text-ink-4">No repository is open.</p>
          )}
        </Section>

        <Section title="Board" hint="written to .scrumit/config.yaml">
          <fieldset
            disabled={!capabilities.value.canWrite}
            class="m-0 min-w-0 border-0 p-0"
          >
          <div class="flex flex-col gap-3">
            <div class="grid gap-2 sm:grid-cols-3">
              <label class="flex flex-col gap-1">
                <span class="label">Project name</span>
                <input
                  class="field"
                  value={config.value.project}
                  placeholder="Acme Payments Platform"
                  onInput={(event) => patchConfig({ project: event.currentTarget.value })}
                />
              </label>
              <label class="flex flex-col gap-1">
                <span class="label">Sprint length (days)</span>
                <input
                  class="field"
                  type="number"
                  min="1"
                  value={config.value.sprintLengthDays}
                  onChange={(event) =>
                    patchConfig({ sprintLengthDays: Number(event.currentTarget.value) || 14 })
                  }
                />
              </label>
              <label class="flex flex-col gap-1">
                <span class="label">Ceremony rhythm</span>
                <input
                  class="field"
                  value={config.value.ceremony}
                  onInput={(event) => patchConfig({ ceremony: event.currentTarget.value })}
                />
              </label>
            </div>

            <div>
              <p class="label mb-1">Columns</p>
              <ul class="inset">
                {config.value.columns.map((column, index) => (
                  <li
                    key={column.id}
                    class="flex items-center gap-2 border-b border-line px-2.5 py-1.5 last:border-b-0"
                  >
                    <span
                      class="swatch h-2.5 w-2.5"
                      style={{ '--tint': `var(--st-${column.id})` } as never}
                    />
                    <span class="num w-[68px] shrink-0 text-[11px] text-ink-4">
                      {column.id}
                    </span>
                    <input
                      class="field flex-1"
                      value={column.name}
                      onInput={(event) =>
                        patchColumn(column.id as Status, { name: event.currentTarget.value })
                      }
                    />
                    <label class="flex shrink-0 items-center gap-1 text-[11px] text-ink-4">
                      WIP
                      <input
                        class="field w-[58px]"
                        type="number"
                        min="1"
                        placeholder="none"
                        value={column.wip ?? ''}
                        onChange={(event) =>
                          patchColumn(column.id as Status, {
                            wip:
                              event.currentTarget.value === ''
                                ? null
                                : Number(event.currentTarget.value),
                          })
                        }
                      />
                    </label>
                    <label class="flex shrink-0 items-center gap-1 text-[11px] text-ink-4">
                      <input
                        type="checkbox"
                        class="accent-[var(--accent)]"
                        checked={column.hidden}
                        onChange={(event) =>
                          patchColumn(column.id as Status, {
                            hidden: event.currentTarget.checked,
                          })
                        }
                      />
                      hide
                    </label>
                    <div class="flex shrink-0 flex-col">
                      <button
                        type="button"
                        class="px-1 text-[9px] leading-none text-ink-4 hover:text-ink disabled:opacity-30"
                        disabled={index === 0}
                        aria-label="Move left"
                        onClick={() => moveColumn(column.id as Status, -1)}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        class="px-1 text-[9px] leading-none text-ink-4 hover:text-ink disabled:opacity-30"
                        disabled={index === config.value.columns.length - 1}
                        aria-label="Move right"
                        onClick={() => moveColumn(column.id as Status, 1)}
                      >
                        ▼
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <p class="mt-1.5 text-[11px] leading-snug text-ink-4">
                Column ids stay fixed to {Object.values(STATUS_LABEL).join(', ')} because
                status decides which folder a file lives in. Names, order, limits and
                visibility are yours.
              </p>
            </div>

            <div class="grid gap-2 sm:grid-cols-3">
              {(
                [
                  ['backlog', 'backlog'],
                  ['sprints', 'sprints'],
                  ['epics', 'epics'],
                  ['archive', 'archive'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} class="flex flex-col gap-1">
                  <span class="label">{label} folder</span>
                  <input
                    class="field"
                    value={config.value.dirs[key]}
                    onChange={(event) =>
                      patchConfig({
                        dirs: { ...config.value.dirs, [key]: event.currentTarget.value },
                      })
                    }
                  />
                </label>
              ))}
            </div>

            <div class="flex flex-wrap gap-3">
              {(
                [
                  ['points', 'Estimates'],
                  ['assignees', 'Assignees'],
                  ['priorities', 'Priorities'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} class="flex items-center gap-1.5 text-[12px] text-ink-2">
                  <input
                    type="checkbox"
                    class="accent-[var(--accent)]"
                    checked={config.value.vocabulary[key]}
                    onChange={(event) =>
                      patchConfig({
                        vocabulary: {
                          ...config.value.vocabulary,
                          [key]: event.currentTarget.checked,
                        },
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>

            <p class="text-[11px] leading-snug text-ink-4">
              Point estimates are treated as points rather than hours on purpose:
              the app never converts them, so an estimate means whatever your team
              agreed it means.
            </p>
          </div>
          </fieldset>
        </Section>

        <AgentSection />

        <Section title="On this device" hint="what scrumit keeps in IndexedDB">
          <dl class="grid grid-cols-2 gap-x-6 gap-y-1 text-[11.5px] sm:grid-cols-4">
            <Meta label="drafts" value={String(drafts.value.length)} />
            <Meta label="theme" value={personName(theme.value)} />
            <Meta label="density" value={compact.value ? 'compact' : 'comfortable'} />
            <Meta label="stored" value={bytes(stored)} />
          </dl>
          <p class="mt-2 max-w-[68ch] text-[11.5px] leading-snug text-ink-4">
            scrumit stores folder handles, your interface preferences and a cached
            index of the last scan. It never copies your issues. Unsaved editor
            drafts are kept here for {drafts.value.length > 0 ? 'the issues listed below' : 'safety'}.
          </p>
          {drafts.value.length > 0 ? (
            <ul class="inset mt-2">
              {drafts.value.map((draft) => (
                <li
                  key={draft.id}
                  class="flex items-center gap-2 border-b border-line px-2.5 py-1.5 last:border-b-0"
                >
                  <span class="num shrink-0 text-[11px] text-ink-3">{draft.issueId}</span>
                  <span class="min-w-0 flex-1 truncate text-[12px] text-ink-2">
                    {draft.title}
                  </span>
                  <span class="num shrink-0 text-[11px] text-ink-4">
                    {relativeTime(draft.at)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <div class="mt-2 flex gap-1.5">
            <Btn
              variant="danger"
              onClick={() => {
                if (
                  window.confirm(
                    'Delete every folder handle, preference and cached index scrumit holds for this browser? Your repository files are not touched.',
                  )
                ) {
                  void wipeLocalData()
                }
              }}
            >
              <IconTrash size={13} />
              Clear local data
            </Btn>
          </div>
        </Section>

        <Section title="Keys">
          <ul class="grid gap-1.5 sm:grid-cols-2">
            <Shortcut keys={['⌘', 'K']} action="Find an issue or a view" />
            <Shortcut keys={['Esc']} action="Close the panel, menu or dialog" />
            <Shortcut keys={['Enter']} action="Add a card from a column composer" />
            <Shortcut keys={['Shift', 'Enter']} action="New line in a composer" />
            <Shortcut keys={['Enter']} action="Add a label or a blocker token" />
            <Shortcut keys={['⌫']} action="Remove the last token in an empty field" />
          </ul>
        </Section>
      </div>
    </div>
  )
}

function AgentSection() {
  const [copied, setCopied] = useState(false)
  const [skillDir, setSkillDir] = useState('.skills')

  async function copyPointer() {
    try {
      await navigator.clipboard.writeText(AGENT_POINTER)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      notify('The clipboard is not available here — select the text and copy it manually.', 'error')
    }
  }

  return (
    <Section title="AI agents" hint="let an agent work the board by editing files">
      <div class="flex flex-col gap-2.5">
        <p class="prose-body">
          Every card is a file, so an agent that can read and write markdown can run
          this board without the app at all. The hard part is knowing <em>this</em>{' '}
          repository: which folders are configured, which ids are taken, what the next
          issue number is. scrumit will write that down.
        </p>

        <div class="flex flex-wrap items-center gap-2">
          <Btn
            variant="primary"
            disabled={!capabilities.value.canWrite}
            onClick={() => void writeAgentGuide()}
          >
            <IconTerminal size={13} />
            Write {AGENT_GUIDE_PATH}
          </Btn>
          <span class="text-[11px] text-ink-4">
            Regenerate it after the board changes shape.
          </span>
        </div>

        <div>
          <p class="text-[11.5px] leading-snug text-ink-3">
            Then point your agent at it. Most agents look for <code>AGENTS.md</code> at the
            repository root, and that file usually belongs to somebody else — so append
            this rather than replacing it:
          </p>
          <pre class="inset mt-1.5 overflow-x-auto p-2 text-[11px] leading-relaxed text-ink-2">
            {AGENT_POINTER}
          </pre>
          <Btn class="mt-1.5" onClick={() => void copyPointer()}>
            {copied ? (
              <>
                <IconCheck size={13} />
                Copied
              </>
            ) : (
              'Copy the pointer'
            )}
          </Btn>
        </div>

        <div class="border-t border-line pt-2.5">
          <p class="text-[11.5px] leading-snug text-ink-3">
            The <code>scrumit-sprint</code> skill teaches an agent how to claim a task,
            commit it, and keep the board's status honest. Write it into this repository
            so the skill travels with the code.
          </p>
          <div class="mt-1.5 flex flex-wrap items-end gap-2">
            <label class="flex min-w-[180px] flex-1 flex-col gap-1">
              <span class="label">skill folder</span>
              <input
                class="field"
                value={skillDir}
                onInput={(event) => setSkillDir(event.currentTarget.value)}
                placeholder=".skills"
              />
            </label>
            <Btn
              variant="primary"
              disabled={!capabilities.value.canWrite}
              onClick={() => void writeAgentSkill(skillDir)}
            >
              <IconTerminal size={13} />
              Write the sprint skill
            </Btn>
          </div>
          <p class="mt-1 text-[11px] leading-snug text-ink-4">
            OpenCode discovers <code>.skills</code> when{' '}
            <code>opencode.jsonc</code> lists it. The CLI writes the same files with{' '}
            <code>scrumit skill install</code>; use <code>--dir .opencode/skills</code>{' '}
            for the automatic location.
          </p>
        </div>

        <p class="text-[11px] leading-snug text-ink-4">
          {watching.value
            ? 'scrumit is watching this folder, so an agent editing files shows up on the board within about a second. The write path is one way, though'
            : 'Without filesystem watching, press Rescan in the top bar after an agent edits files. Either way, the write path is one way'}
          : a write from the app puts a card back at the path its own fields imply, so
          a misplaced file is tidied rather than reported as wrong. Worth knowing before
          you trust one.
        </p>
      </div>
    </Section>
  )
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: ComponentChildren
}) {  return (
    <section class="border-t border-line pt-2.5">
      <header class="mb-2.5 flex items-baseline gap-2">
        <h2 class="text-[12.5px] font-medium text-ink">{title}</h2>
        {hint ? <span class="truncate text-[11px] text-ink-4">{hint}</span> : null}
      </header>
      {children}
    </section>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div class="min-w-0">
      <dt class="text-[10.5px] text-ink-4">{label}</dt>
      <dd class="truncate text-[12px] text-ink-2" title={value}>
        {value}
      </dd>
    </div>
  )
}

function Shortcut({ keys, action }: { keys: string[]; action: string }) {
  return (
    <li class="flex items-center gap-2">
      <span class="flex shrink-0 gap-0.5">
        {keys.map((key) => (
          <Kbd key={key}>{key}</Kbd>
        ))}
      </span>
      <span class="text-[12px] text-ink-3">{action}</span>
    </li>
  )
}
