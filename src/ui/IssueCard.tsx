import { daysBetween, todayISO } from '../lib/format.ts'
import { checklistStats } from '../lib/md.ts'
import type { Issue } from '../lib/model.ts'
import { blockedIds, epicById, selectedId, toggleSelected } from '../lib/store.ts'
import { Avatar, Chip, Pts } from './primitives.tsx'
import { ICON_FOR_TYPE, IconBlocked, IconGrip } from './icons.tsx'

const TYPE_HUE = { story: 0, bug: 7, chore: 0, spike: 4 } as const

export function IssueCard({ issue, dragging = false }: { issue: Issue; dragging?: boolean }) {
  const epic = issue.epic ? epicById.value.get(issue.epic) : null
  const blocked = blockedIds.value.has(issue.id)
  const age = daysBetween(issue.updated, todayISO())
  const criteria = checklistStats(issue.body)
  const selected = selectedId.value === issue.id
  const TypeIcon = ICON_FOR_TYPE[issue.type]

  const style = epic
    ? ({ borderTopColor: `var(--e${epic.color})`, borderTopWidth: '2px' } as never)
    : undefined

  return (
    <article
      class="card no-drag-text"
      data-issue={issue.id}
      data-selected={selected ? 'true' : 'false'}
      style={style}
      tabIndex={0}
      role="button"
      aria-label={`${issue.id} ${issue.title}`}
      onClick={(event) => {
        event.stopPropagation()
        toggleSelected(issue.id)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          toggleSelected(issue.id)
        }
      }}
    >
      <div class="flex items-center gap-1.5">
        <span class="num text-[11px] text-ink-3">{issue.id}</span>
        {issue.priority !== null ? (
          <span
            class="num text-[10px] font-medium"
            style={{
              color: issue.priority <= 1 ? 'var(--signal)' : 'var(--ink-4)',
            }}
            title={`Priority ${issue.priority}`}
          >
            P{issue.priority}
          </span>
        ) : null}
        <span class="ml-auto flex items-center gap-1">
          <Pts value={issue.points} />
          <span class="card-grip cursor-grab text-ink-4" title="Drag to move">
            <IconGrip size={13} />
          </span>
        </span>
      </div>

      <p class="mt-1 line-clamp-3 text-[13px] leading-[1.4] text-ink">{issue.title}</p>

      {issue.type !== 'story' || issue.labels.length > 0 || blocked ? (
        <div class="mt-1.5 flex flex-wrap items-center gap-1">
          {issue.type !== 'story' ? (
            <Chip tint={TYPE_HUE[issue.type] || undefined} class="capitalize">
              <TypeIcon size={10} />
              {issue.type}
            </Chip>
          ) : null}
          {issue.labels.slice(0, 2).map((label) => (
            <Chip key={label}>{label}</Chip>
          ))}
          {issue.labels.length > 2 ? (
            <span class="num text-[10px] text-ink-4">+{issue.labels.length - 2}</span>
          ) : null}
          {blocked ? (
            <Chip class="chip-tint" tint={7} title={`Blocked by ${issue.blockedBy.join(', ')}`}>
              <IconBlocked size={10} />
              blocked
            </Chip>
          ) : null}
        </div>
      ) : null}

      <div class="mt-1.5 flex items-center gap-2">
        {issue.assignee ? (
          <Avatar handle={issue.assignee} />
        ) : (
          <span class="text-[10px] text-ink-4">unassigned</span>
        )}
        {age !== null ? (
          <span class="num text-[10px] text-ink-4" title={`Last change ${issue.updated}`}>
            {age}d
          </span>
        ) : null}
        {criteria.total > 0 ? (
          <span
            class="num ml-auto text-[10px]"
            style={{
              color:
                criteria.done === criteria.total ? 'var(--ok)' : 'var(--ink-4)',
            }}
            title="Acceptance criteria"
          >
            {criteria.done}/{criteria.total}
          </span>
        ) : null}
      </div>

      {dragging ? null : null}
    </article>
  )
}
