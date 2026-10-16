import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { humanDate } from '../lib/format.ts'
import { checklistStats } from '../lib/md.ts'
import { renderMarkdown } from '../lib/render.ts'
import { ISSUE_TYPES, type IssueType, type Priority, type Status } from '../lib/model.ts'
import { enterPanel } from '../lib/motion.ts'
import {
  allLabels,
  assignees,
  config,
  deleteIssue,
  epicById,
  epics,
  issueIds,
  patchIssue,
  saving,
  select,
  selectedIssue,
  sprints,
} from '../lib/store.ts'
import { AutoTextarea, Btn, Chip, Modal, Pts, Swatch } from './primitives.tsx'
import { ICON_FOR_TYPE, IconTrash, IconX } from './icons.tsx'

export function IssuePanel() {
  const issue = selectedIssue.value
  const panel = useRef<HTMLElement>(null)
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const [confirming, setConfirming] = useState(false)

  const issueId = issue?.id ?? null
  const body = issue?.body ?? ''
  const [preview, setPreview] = useState('')

  useEffect(() => {
    if (issueId && panel.current) enterPanel(panel.current)
  }, [issueId])

  useEffect(() => {
    setTab('write')
    setConfirming(false)
  }, [issueId])

  useEffect(() => {
    if (tab !== 'preview') return
    let current = true
    void renderMarkdown(body).then((html) => {
      if (current) setPreview(html)
    })
    return () => {
      current = false
    }
  }, [tab, body])

  if (!issue) return null

  const epic = issue.epic ? epicById.value.get(issue.epic) : null
  const criteria = checklistStats(issue.body)
  const TypeIcon = ICON_FOR_TYPE[issue.type]

  return (
    <aside
      ref={panel}
      class="flex h-full w-[368px] max-w-[46vw] shrink-0 flex-col border-l border-line bg-panel"
      aria-label={`${issue.id} details`}
    >
      <header class="flex shrink-0 items-center gap-1.5 border-b border-line px-2.5 py-1.5">
        <TypeIcon size={13} />
        <span class="num text-[12px] text-ink-2">{issue.id}</span>
        {epic ? (
          <span class="flex items-center gap-1" title={epic.title}>
            <Swatch hue={epic.color} />
            <span class="num text-[11px] text-ink-4">{epic.id}</span>
          </span>
        ) : null}
        <span class="ml-auto text-[10.5px] text-ink-4">
          {saving.value ? 'writing…' : 'on disk'}
        </span>
        <Btn variant="ghost" icon onClick={() => select(null)} aria-label="Close panel">
          <IconX size={14} />
        </Btn>
      </header>

      <div class="scroll-y flex min-h-0 flex-1 flex-col gap-3 px-2.5 py-2.5">
        <AutoTextarea
          class="field !bg-transparent !border-transparent hover:!border-line-2 focus:!bg-panel-2 text-[15px] leading-snug"
          value={issue.title}
          rows={2}
          aria-label="Title"
          onInput={(value) => patchIssue(issue.id, { title: value })}
        />

        <div class="grid grid-cols-2 gap-x-2 gap-y-2.5">
          <Field label="Status">
            <select
              class="field"
              value={issue.status}
              onChange={(event) =>
                patchIssue(issue.id, { status: event.currentTarget.value as Status }, true)
              }
            >
              {config.value.columns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Type">
            <select
              class="field"
              value={issue.type}
              onChange={(event) =>
                patchIssue(issue.id, { type: event.currentTarget.value as IssueType })
              }
            >
              {ISSUE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Sprint">
            <select
              class="field"
              value={issue.sprint ?? ''}
              onChange={(event) =>
                patchIssue(
                  issue.id,
                  { sprint: event.currentTarget.value === '' ? null : event.currentTarget.value },
                  true,
                )
              }
            >
              <option value="">Backlog</option>
              {sprints.value.map((sprint) => (
                <option key={sprint.id} value={sprint.id}>
                  {sprint.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Epic">
            <select
              class="field"
              value={issue.epic ?? ''}
              onChange={(event) =>
                patchIssue(issue.id, {
                  epic: event.currentTarget.value === '' ? null : event.currentTarget.value,
                })
              }
            >
              <option value="">None</option>
              {epics.value.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Estimate">
            <div class="flex items-center gap-1.5">
              <input
                class="field"
                type="number"
                min="0"
                step="1"
                value={issue.points ?? ''}
                placeholder="—"
                onChange={(event) =>
                  patchIssue(issue.id, {
                    points:
                      event.currentTarget.value === ''
                        ? null
                        : Number(event.currentTarget.value),
                  })
                }
              />
              <Pts value={issue.points} />
            </div>
          </Field>

          <Field label="Priority">
            <select
              class="field"
              value={issue.priority === null ? '' : String(issue.priority)}
              onChange={(event) =>
                patchIssue(issue.id, {
                  priority:
                    event.currentTarget.value === ''
                      ? null
                      : (Number(event.currentTarget.value) as Priority),
                })
              }
            >
              <option value="">None</option>
              <option value="0">P0 — drop everything</option>
              <option value="1">P1 — this sprint</option>
              <option value="2">P2 — next sprint</option>
              <option value="3">P3 — someday</option>
            </select>
          </Field>
        </div>

        <Field label="Assignee">
          <input
            class="field"
            list="scrumit-assignees"
            value={issue.assignee ?? ''}
            placeholder="unassigned"
            onChange={(event) =>
              patchIssue(issue.id, { assignee: event.currentTarget.value || null })
            }
          />
          <datalist id="scrumit-assignees">
            {assignees.value.map((person) => (
              <option key={person} value={person} />
            ))}
          </datalist>
        </Field>

        <TokenEditor
          label="Labels"
          values={issue.labels}
          placeholder="add a label"
          suggestions={allLabels.value}
          onChange={(labels) => patchIssue(issue.id, { labels })}
        />

        <TokenEditor
          label="Blocked by"
          values={issue.blockedBy}
          placeholder="issue id"
          suggestions={issueIds.value.filter((id) => id !== issue.id)}
          onChange={(blockedBy) => patchIssue(issue.id, { blockedBy })}
        />

        <TokenEditor
          label="Links"
          values={issue.links}
          placeholder="https://…"
          onChange={(links) => patchIssue(issue.id, { links })}
          asLink
        />

        <section class="flex min-h-[220px] flex-1 flex-col">
          <div class="flex items-center gap-1 pb-1.5">
            <span class="label mr-1">Description</span>
            <div class="ml-auto flex items-center gap-0.5 rounded-sm border border-line p-0.5">
              {(['write', 'preview'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  class={`rounded-sm px-2 py-[3px] text-[11px] capitalize ${
                    tab === mode ? 'bg-panel-3 text-ink' : 'text-ink-3 hover:text-ink'
                  }`}
                  onClick={() => setTab(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
            {criteria.total > 0 ? (
              <span class="num text-[11px] text-ink-4">
                {criteria.done}/{criteria.total}
              </span>
            ) : null}
          </div>

          {tab === 'write' ? (
            <textarea
              class="field min-h-[220px] flex-1 font-mono text-[12.5px] leading-relaxed"
              value={issue.body}
              placeholder="## Context&#10;&#10;## Acceptance criteria&#10;&#10;- [ ] …"
              onInput={(event) => patchIssue(issue.id, { body: event.currentTarget.value })}
            />
          ) : (
            <div
              class="prose-body inset min-h-[220px] flex-1 overflow-y-auto p-2.5"
              // Sanitised in renderMarkdown before it reaches the DOM.
              dangerouslySetInnerHTML={{ __html: preview }}
            />
          )}
        </section>
      </div>

      <footer class="flex shrink-0 items-center gap-2 border-t border-line px-2.5 py-1.5">
        <span class="min-w-0 flex-1 truncate text-[10.5px] text-ink-4" title={issue.path ?? ''}>
          {issue.path ?? 'not yet written'}
        </span>
        <span class="num shrink-0 text-[10.5px] text-ink-4">
          {humanDate(issue.created)}
        </span>
        <Btn
          variant="ghost"
          icon
          title="Delete this issue"
          onClick={() => setConfirming(true)}
        >
          <IconTrash size={13} />
        </Btn>
      </footer>

      {confirming ? (
        <Modal
          title={`Delete ${issue.id}?`}
          width={400}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Btn onClick={() => setConfirming(false)}>Keep it</Btn>
              <Btn
                variant="danger"
                onClick={() => {
                  setConfirming(false)
                  void deleteIssue(issue.id)
                }}
              >
                <IconTrash size={13} />
                Delete the file
              </Btn>
            </>
          }
        >
          <p class="text-[12.5px] text-ink-2">
            This removes <code class="text-ink">{issue.path ?? issue.id}</code> from the
            repository. If the file is tracked by git, <code class="text-ink">git restore</code>{' '}
            brings it back.
          </p>
        </Modal>
      ) : null}
    </aside>
  )
}

function Field({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <label class="flex min-w-0 flex-col gap-1">
      <span class="label">{label}</span>
      {children}
    </label>
  )
}

function TokenEditor({
  label,
  values,
  placeholder,
  suggestions,
  onChange,
  asLink = false,
}: {
  label: string
  values: string[]
  placeholder: string
  suggestions?: string[]
  onChange: (next: string[]) => void
  asLink?: boolean
}) {
  const [entry, setEntry] = useState('')

  function commit(raw: string) {
    const value = raw.trim().replace(/,$/, '')
    if (value === '' || values.includes(value)) {
      setEntry('')
      return
    }
    onChange([...values, value])
    setEntry('')
  }

  return (
    <div class="flex flex-col gap-1">
      <span class="label">{label}</span>
      <div class="flex flex-wrap items-center gap-1">
        {values.map((value) => (
          <Chip key={value}>
            {asLink ? (
              <a
                href={value}
                target="_blank"
                rel="noreferrer noopener"
                class="hover:underline"
              >
                {value.replace(/^https?:\/\//, '').slice(0, 34)}
              </a>
            ) : (
              value
            )}
            <button
              type="button"
              class="text-ink-4 hover:text-signal"
              aria-label={`Remove ${value}`}
              onClick={() => onChange(values.filter((item) => item !== value))}
            >
              <IconX size={10} />
            </button>
          </Chip>
        ))}
        <input
          class="inset min-w-[110px] flex-1 px-1.5 py-[3px] text-[12px] outline-none placeholder:text-ink-4 focus:border-accent"
          list={suggestions ? `scrumit-${label}` : undefined}
          value={entry}
          placeholder={placeholder}
          onInput={(event) => setEntry(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault()
              commit(event.currentTarget.value)
            }
            if (event.key === 'Backspace' && entry === '' && values.length > 0) {
              onChange(values.slice(0, -1))
            }
          }}
          onBlur={(event) => commit(event.currentTarget.value)}
        />
        {suggestions ? (
          <datalist id={`scrumit-${label}`}>
            {suggestions
              .filter((item) => !values.includes(item))
              .map((item) => (
                <option key={item} value={item} />
              ))}
          </datalist>
        ) : null}
      </div>
    </div>
  )
}

