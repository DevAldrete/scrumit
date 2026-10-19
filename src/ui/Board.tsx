import Sortable from 'sortablejs'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { enterStagger, settle, sweep } from '../lib/motion.ts'
import type { ColumnStat } from '../lib/metrics.ts'
import type { Status } from '../lib/model.ts'
import {
  board,
  beginInteraction,
  capabilities,
  compact,
  createIssue,
  endInteraction,
  layout,
  moveIssue,
} from '../lib/store.ts'
import { IconPlus } from './icons.tsx'
import { IssueCard } from './IssueCard.tsx'
import { Btn, Progress } from './primitives.tsx'

let hasEntered = false

export function Board() {
  const columns = board.value.filter((column) => !column.hidden)
  const container = useRef<HTMLDivElement>(null)
  const [flash, setFlash] = useState<{ status: Status; nonce: number } | null>(null)

  // The staggered entrance is the one unprovoked movement in the app, so it
  // plays when the board first appears and never again.
  useLayoutEffect(() => {
    if (container.current && !hasEntered) {
      hasEntered = true
      enterStagger([...container.current.children])
    }
  }, [])

  const geometry = layout.value

  return (
    <div
      ref={container}
      class={`scroll-x flex h-full ${geometry.grid ? 'board-grid' : ''}`}
      data-separators={geometry.separators ? 'true' : 'false'}
      data-card-borders={geometry.cardBorders ? 'true' : 'false'}
      style={{
        '--card-gap': `${geometry.cardGap}px`,
      } as never}
    >
      {columns.map((column) => (
        <Column
          key={column.id}
          column={column}
          flashNonce={flash && flash.status === column.id ? flash.nonce : 0}
          onLanded={(status) =>
            setFlash((current) => ({ status, nonce: (current?.nonce ?? 0) + 1 }))
          }
        />
      ))}
    </div>
  )
}

function Column({
  column,
  flashNonce,
  onLanded,
}: {
  column: ColumnStat
  flashNonce: number
  onLanded: (status: Status) => void
}) {
  const body = useRef<HTMLDivElement>(null)
  const sweepLine = useRef<HTMLDivElement>(null)
  const [composing, setComposing] = useState(false)
  const canWrite = capabilities.value.canWrite

  useEffect(() => {
    if (flashNonce > 0 && sweepLine.current) sweep(sweepLine.current)
  }, [flashNonce])

  useLayoutEffect(() => {
    const element = body.current
    if (!element) return

    let origin: { parent: HTMLElement; next: Element | null } | null = null

    const sortable = Sortable.create(element, {
      group: 'board',
      disabled: !canWrite,
      animation: 140,
      easing: 'cubic-bezier(0.22, 0.8, 0.24, 1)',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      fallbackClass: 'sortable-fallback',
      draggable: '[data-issue]',
      dataIdAttr: 'data-issue',
      swapThreshold: 0.66,
      // The fallback drag is used on purpose: it behaves the same on touch as
      // on a mouse, and it lets the card being carried be styled. The tolerance
      // keeps a plain click from being swallowed as a drag.
      forceFallback: true,
      fallbackOnBody: true,
      fallbackTolerance: 4,
      onStart: (event) => {
        const item = event.item as HTMLElement
        origin = { parent: event.from as HTMLElement, next: item.nextElementSibling }
        beginInteraction()
      },
      onEnd: (event) => {
        endInteraction()
        const item = event.item as HTMLElement
        const id = item.dataset.issue
        const target = (event.to as HTMLElement).dataset.status as Status | undefined
        const index = event.newIndex ?? 0

        // Hand the DOM back to Preact exactly as it was, then let the state
        // change drive the re-render. Sorting the DOM ourselves would put the
        // DOM and the virtual tree out of step.
        if (origin) {
          if (origin.next && origin.next.parentNode === origin.parent) {
            origin.parent.insertBefore(item, origin.next)
          } else {
            origin.parent.appendChild(item)
          }
          origin = null
        }

        if (!id || !target) return
        onLanded(target)
        const writing = moveIssue(id, target, index)
        requestAnimationFrame(() => {
          const landed = document.querySelector(
            `[data-status="${target}"] [data-issue="${CSS.escape(id)}"]`,
          )
          if (landed) settle(landed)
        })
        void writing
      },
    })

    return () => {
      endInteraction()
      sortable.destroy()
    }
  }, [column.id, canWrite])

  const configuredWidth = layout.value.columnWidth
  const width = compact.value ? Math.min(configuredWidth, 234) : configuredWidth

  return (
    <section
      class="board-column flex h-full shrink-0 flex-col border-r border-line"
      style={{ width: `${width}px` }}
      data-column={column.id}
    >
      <header class="relative shrink-0 px-2.5 pt-2 pb-1.5">
        <div class="flex min-w-0 items-baseline gap-1.5">
          <h3 class="min-w-0 truncate text-[12px] font-medium text-ink-2" title={column.name}>
            {column.name}
          </h3>
          <span class="num shrink-0 text-[11px] text-ink-4">{column.count}</span>
          {column.wip !== null || column.softWip !== null ? (
            <span
              class="num flex shrink-0 items-center gap-1 text-[11px]"
              style={{
                color: column.overWip
                  ? 'var(--signal)'
                  : column.overSoft
                    ? 'var(--warn)'
                    : 'var(--ink-4)',
              }}
              title={[
                column.softWip !== null ? `soft limit ${column.softWip}` : null,
                column.wip !== null ? `hard limit ${column.wip}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            >
              {column.wip !== null ? `/${column.wip}` : null}
              {column.softWip !== null ? (
                <span class="text-[9px]">soft {column.softWip}</span>
              ) : null}
            </span>
          ) : null}
          <span class="num ml-auto shrink-0 text-[11px] text-ink-4">{column.points} pts</span>
        </div>
        {column.wip !== null ? (
          <div class="mt-1.5">
            <Progress
              value={column.count / column.wip}
              tone={column.overWip ? 'signal' : column.overSoft ? 'warn' : 'accent'}
              softMarker={
                column.softWip !== null && column.wip !== null
                  ? column.softWip / column.wip
                  : null
              }
              height={2}
            />
          </div>
        ) : null}
        {column.overWip ? (
          <p class="mt-1 text-[10.5px] text-signal">
            Over the hard limit by {column.count - (column.wip ?? 0)} — finish something first.
          </p>
        ) : column.overSoft ? (
          <p class="mt-1 text-[10.5px] text-warn">
            Past the flexible limit of {column.softWip}. Slow down before this becomes a blocker.
          </p>
        ) : null}
        <div
          ref={sweepLine}
          class="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] origin-left opacity-0"
          style={{ background: 'var(--accent)' }}
        />
      </header>

      <div
        ref={body}
        class="col-body scroll-y min-h-0 flex-1"
        data-status={column.id}
      >
        {column.issues.map((issue) => (
          <IssueCard key={issue.id} issue={issue} />
        ))}
      </div>

      {canWrite ? (
        <div class="shrink-0 px-2 pb-2">
          {composing ? (
            <Composer status={column.id} onClose={() => setComposing(false)} />
          ) : (
            <button
              type="button"
              class="btn btn-ghost w-full justify-start text-ink-3"
              onClick={() => setComposing(true)}
            >
              <IconPlus size={13} />
              Add to {column.name.toLowerCase()}
            </button>
          )}
        </div>
      ) : null}
    </section>
  )
}

function Composer({ status, onClose }: { status: Status; onClose: () => void }) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)

  // `autofocus` on a freshly inserted element is unreliable, so focus it here.
  useEffect(() => {
    input.current?.focus()
  }, [])

  async function submit() {
    const title = value.trim()
    if (title === '') {
      onClose()
      return
    }
    setSaving(true)
    await createIssue({ title, status })
    setValue('')
    setSaving(false)
    input.current?.focus()
  }

  return (
    <div class="inset p-1.5">
      <textarea
        ref={input}
        class="field"
        rows={2}
        placeholder="What needs doing?"
        value={value}
        onInput={(event) => setValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void submit()
          }
          if (event.key === 'Escape') onClose()
        }}
      />
      <div class="mt-1 flex items-center gap-1">
        <Btn variant="primary" onClick={() => void submit()} disabled={saving}>
          Add
        </Btn>
        <Btn variant="ghost" onClick={onClose}>
          Done
        </Btn>
        <span class="ml-auto text-[10px] text-ink-4">Enter adds, Shift+Enter breaks</span>
      </div>
    </div>
  )
}
