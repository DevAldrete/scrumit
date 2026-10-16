import Sortable from 'sortablejs'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { daysBetween, todayISO } from '../lib/format.ts'
import { compareOrder } from '../lib/metrics.ts'
import type { Issue, Status } from '../lib/model.ts'
import {
  assignToSprint,
  epicById,
  moveIssue,
  setStatuses,
  sprints,
  toggleSelected,
  visibleIssues,
} from '../lib/store.ts'
import { Avatar, Btn, Chip, Menu, MenuItem, Pts, Swatch, statusStyle } from './primitives.tsx'
import { ICON_FOR_TYPE, IconBlocked, IconGrip, IconX } from './icons.tsx'

export function Backlog() {
  const container = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const rows = visibleIssues.value
    .filter((issue) => issue.sprint === null)
    .sort(compareOrder)

  useLayoutEffect(() => {
    const element = container.current
    if (!element) return
    let origin: { parent: HTMLElement; next: Element | null } | null = null

    const sortable = Sortable.create(element, {
      animation: 140,
      easing: 'cubic-bezier(0.22, 0.8, 0.24, 1)',
      handle: '[data-grip]',
      draggable: '[data-issue]',
      ghostClass: 'sortable-ghost',
      fallbackClass: 'sortable-fallback',
      forceFallback: true,
      fallbackOnBody: true,
      fallbackTolerance: 4,
      onStart: (event) => {
        const item = event.item as HTMLElement
        origin = { parent: event.from as HTMLElement, next: item.nextElementSibling }
      },
      onEnd: (event) => {
        const item = event.item as HTMLElement
        const id = item.dataset.issue
        const index = event.newIndex ?? 0
        if (origin) {
          if (origin.next && origin.next.parentNode === origin.parent) {
            origin.parent.insertBefore(item, origin.next)
          } else {
            origin.parent.appendChild(item)
          }
          origin = null
        }
        if (id) void moveIssue(id, 'backlog' as Status, index)
      },
    })
    return () => sortable.destroy()
  }, [])

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const ids = [...selected]

  return (
    <div class="relative flex h-full flex-col">
      <div class="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
        <span class="num text-[11px] text-ink-4">
          {rows.length} issue{rows.length === 1 ? '' : 's'}
        </span>
        <span class="text-ink-4">·</span>
        <span class="num text-[11px] text-ink-4">
          {rows.reduce((sum, i) => sum + (i.points ?? 0), 0)} pts
        </span>
        <span class="ml-auto text-[11px] text-ink-4">
          Drag by the grip to set the order the board will show.
        </span>
      </div>

      <div ref={container} class="scroll-y min-h-0 flex-1">
        {rows.length === 0 ? (
          <p class="px-3 py-6 text-[12px] text-ink-4">
            Nothing in the backlog. Add work from a board column, then clear its
            sprint to return it here.
          </p>
        ) : (
          rows.map((issue) => (
            <Row
              key={issue.id}
              issue={issue}
              selected={selected.has(issue.id)}
              onToggle={() => toggle(issue.id)}
            />
          ))
        )}
      </div>

      {ids.length > 0 ? (
        <BulkBar ids={ids} onClear={() => setSelected(new Set())} />
      ) : null}
    </div>
  )
}

function Row({
  issue,
  selected,
  onToggle,
}: {
  issue: Issue
  selected: boolean
  onToggle: () => void
}) {
  const epic = issue.epic ? epicById.value.get(issue.epic) : null
  const age = daysBetween(issue.updated, todayISO())
  const TypeIcon = ICON_FOR_TYPE[issue.type]

  return (
    <div
      class={`group flex items-center gap-2 border-b border-line px-3 py-1.5 hover:bg-panel-2 ${
        selected ? 'bg-accent-soft' : ''
      }`}
      data-issue={issue.id}
    >
      <input
        type="checkbox"
        class="shrink-0 accent-[var(--accent)]"
        checked={selected}
        onChange={onToggle}
        aria-label={`Select ${issue.id}`}
      />
      <span
        class="shrink-0 cursor-grab text-ink-4 opacity-0 group-hover:opacity-100"
        data-grip
        title="Reorder"
      >
        <IconGrip size={13} />
      </span>

      <span class="num w-[72px] shrink-0 text-[11px] text-ink-3">{issue.id}</span>

      {epic ? (
        <span class="shrink-0" title={epic.title}>
          <Swatch hue={epic.color} />
        </span>
      ) : (
        <span class="w-[7px] shrink-0" />
      )}

      <span class="shrink-0 text-ink-4">
        <TypeIcon size={12} />
      </span>

      <button
        type="button"
        class="min-w-0 flex-1 truncate text-left text-[13px] text-ink hover:text-accent"
        onClick={() => toggleSelected(issue.id)}
      >
        {issue.title}
      </button>

      <span class="hidden shrink-0 items-center gap-1 lg:flex">
        {issue.labels.slice(0, 3).map((label) => (
          <Chip key={label}>{label}</Chip>
        ))}
      </span>

      {issue.blockedBy.length > 0 ? (
        <span class="shrink-0 text-signal" title={`Blocked by ${issue.blockedBy.join(', ')}`}>
          <IconBlocked size={12} />
        </span>
      ) : null}

      <Pts value={issue.points} class="shrink-0" />
      <Avatar handle={issue.assignee} />
      <span class="num w-[30px] shrink-0 text-right text-[11px] text-ink-4">
        {age ?? '–'}d
      </span>
    </div>
  )
}

function BulkBar({ ids, onClear }: { ids: string[]; onClear: () => void }) {
  return (
    <div class="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
      <div class="pop pointer-events-auto flex items-center gap-2 px-2 py-1.5">
        <span class="num px-1 text-[11px] text-ink-3">{ids.length} selected</span>
        <span class="h-4 w-px bg-line" />

        <Menu
          label="Schedule"
          class="w-[118px]"
          align="right"
        >
          {(close) => (
            <>
              {sprints.value
                .slice()
                .sort((a, b) => b.id.localeCompare(a.id))
                .map((sprint) => (
                  <MenuItem
                    key={sprint.id}
                    onClick={() => {
                      close()
                      void assignToSprint(ids, sprint.id)
                      onClear()
                    }}
                    hint={sprint.state}
                  >
                    {sprint.name}
                  </MenuItem>
                ))}
              <div class="my-1 h-px bg-line" />
              <MenuItem
                onClick={() => {
                  close()
                  void assignToSprint(ids, null)
                  onClear()
                }}
              >
                Leave in the backlog
              </MenuItem>
            </>
          )}
        </Menu>

        <StatusMenu ids={ids} onClear={onClear} />

        <Btn variant="ghost" icon onClick={onClear} title="Clear selection">
          <IconX size={13} />
        </Btn>
      </div>
    </div>
  )
}

function StatusMenu({ ids, onClear }: { ids: string[]; onClear: () => void }) {
  return (
    <Menu label="Status" class="w-[104px]" align="right">
      {(close) => (
        <>
          {(['todo', 'doing', 'review', 'done'] as Status[]).map((status) => (
            <button
              key={status}
              type="button"
              class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] text-ink-2 hover:bg-panel-2 hover:text-ink"
              onClick={() => {
                close()
                void setStatuses(ids, status)
                onClear()
              }}
            >
              <span class="swatch" style={statusStyle(status)} />
              {status}
            </button>
          ))}
        </>
      )}
    </Menu>
  )
}
