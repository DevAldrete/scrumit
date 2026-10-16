import Sortable from 'sortablejs'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { enterStagger, settle, sweep } from '../lib/motion.ts'
import type { ColumnStat } from '../lib/metrics.ts'
import type { Status } from '../lib/model.ts'
import { board, beginInteraction, compact, createIssue, endInteraction, moveIssue } from '../lib/store.ts'
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

  return (
    <div ref={container} class="scroll-x flex h-full">
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

  useEffect(() => {
    if (flashNonce > 0 && sweepLine.current) sweep(sweepLine.current)
  }, [flashNonce])

  useLayoutEffect(() => {
    const element = body.current
    if (!element) return

    let origin: { parent: HTMLElement; next: Element | null } | null = null

    const sortable = Sortable.create(element, {
      group: 'board',
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
  }, [column.id])

  const width = compact.value ? 234 : 268

  return (
    <section
      class="flex h-full shrink-0 flex-col border-r border-line"
      style={{ width: `${width}px` }}
      data-column={column.id}
    >
      <header class="relative shrink-0 px-2.5 pt-2 pb-1.5">
        <div class="flex items-baseline gap-1.5">
          <h3 class="text-[12px] font-medium text-ink-2">{column.name}</h3>
          <span class="num text-[11px] text-ink-4">{column.count}</span>
          {column.wip !== null ? (
            <span
              class="num text-[11px]"
              style={{ color: column.over ? 'var(--signal)' : 'var(--ink-4)' }}
              title={`Work-in-progress limit: ${column.wip}`}
            >
              /{column.wip}
            </span>
          ) : null}
          <span class="num ml-auto text-[11px] text-ink-4">{column.points} pts</span>
        </div>
        {column.wip !== null ? (
          <div class="mt-1.5">
            <Progress
              value={column.count / column.wip}
              tone={column.over ? 'signal' : 'accent'}
              height={2}
            />
          </div>
        ) : null}
        {column.over ? (
          <p class="mt-1 text-[10.5px] text-signal">
            Over the limit by {column.count - (column.wip ?? 0)} — finish something first.
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
