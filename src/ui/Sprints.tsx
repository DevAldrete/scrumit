import { useState } from 'preact/hooks'
import { plural, sumPoints, todayISO } from '../lib/format.ts'
import {
  burndown,
  compareOrder,
  currentSprint,
  issuesOfSprint,
  sprintProgress,
  sprintWindowLabel,
} from '../lib/metrics.ts'
import type { Issue, Sprint, Status } from '../lib/model.ts'
import {
  assignToSprint,
  createSprint,
  issues,
  patchSprint,
  setStatuses,
  sprints,
  toggleSelected,
} from '../lib/store.ts'
import { BurnLine } from './charts.tsx'
import { Avatar, Btn, Chip, Modal, Progress, StatusDot } from './primitives.tsx'
import { ICON_FOR_TYPE, IconCheck, IconPlus } from './icons.tsx'

export function Sprints() {
  const ordered = sprints.value.slice().sort((a, b) => b.id.localeCompare(a.id))
  const active = currentSprint(sprints.value)

  return (
    <div class="scroll-y h-full">
      <div class="mx-auto flex max-w-[880px] flex-col gap-4 px-4 py-4">
        <div class="flex items-center gap-2">
          <p class="text-[11.5px] text-ink-4">
            Each sprint is a folder with a <code>sprint.md</code> holding its goal,
            dates and notes.
          </p>
          <Btn class="ml-auto shrink-0" onClick={() => void createSprint()}>
            <IconPlus size={13} />
            New sprint
          </Btn>
        </div>

        {ordered.length === 0 ? (
          <p class="panel px-3 py-4 text-[12px] text-ink-3">
            No sprints yet. Create one, then drag work into it from the backlog.
          </p>
        ) : (
          ordered.map((sprint) => (
            <SprintBlock key={sprint.id} sprint={sprint} isCurrent={active?.id === sprint.id} />
          ))
        )}
      </div>
    </div>
  )
}

function SprintBlock({ sprint, isCurrent }: { sprint: Sprint; isCurrent: boolean }) {
  const [closing, setClosing] = useState(false)
  const scoped = issuesOfSprint(issues.value, sprint.id)
  const progress = sprintProgress(sprint, issues.value)
  const finished = scoped.filter((issue) => issue.status === 'done')
  const unfinished = scoped.filter((issue) => issue.status !== 'done')
  const burn = sprint.state === 'active' ? burndown(sprint, issues.value) : []

  return (
    <section class="panel">
      <header class="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <h2
          class="text-[16px] leading-none text-ink"
          style={{
            fontFamily: 'var(--f-display)',
            fontWeight: 500,
            letterSpacing: '-0.02em',
          }}
        >
          {sprint.name}
        </h2>
        <Chip
          tint={
            sprint.state === 'active'
              ? 'doing'
              : sprint.state === 'closed'
                ? 'done'
                : undefined
          }
        >
          <StatusDot status={sprint.state === 'active' ? 'doing' : sprint.state === 'closed' ? 'done' : 'backlog'} />
          {sprint.state}
        </Chip>
        <span class="num text-[11.5px] text-ink-4">{sprintWindowLabel(sprint)}</span>

        <span class="ml-auto flex shrink-0 items-center gap-1.5">
          {sprint.state !== 'active' ? (
            <Btn
              onClick={() =>
                patchSprint(sprint.id, {
                  state: 'active',
                  start: sprint.start ?? todayISO(),
                })
              }
              title={
                sprint.state === 'closed'
                  ? 'Reopen this sprint'
                  : 'Mark this sprint as the running one'
              }
            >
              {sprint.state === 'closed' ? 'Reopen' : 'Start'}
            </Btn>
          ) : null}
          {sprint.state !== 'closed' ? (
            <Btn onClick={() => setClosing(true)}>
              <IconCheck size={13} />
              Close
            </Btn>
          ) : null}
        </span>
      </header>

      <div class="grid gap-4 px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_236px]">
        <div class="flex min-w-0 flex-col gap-2.5">
          <label class="flex flex-col gap-1">
            <span class="label">Sprint goal</span>
            <input
              class="field !border-transparent !bg-transparent text-[13.5px] hover:!border-line-2 focus:!bg-panel-2"
              value={sprint.goal}
              placeholder="One sentence a stakeholder would understand"
              onInput={(event) => patchSprint(sprint.id, { goal: event.currentTarget.value })}
            />
          </label>

          <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span class="num text-[11.5px] text-ink-3">
              {progress.done}/{progress.committed} pts delivered
            </span>
            <span class="num text-[11.5px] text-ink-4">
              {plural(finished.length, 'issue')} done · {plural(unfinished.length, 'issue')} open
            </span>
            {sprint.capacity !== null ? (
              <span class="num text-[11.5px] text-ink-4">capacity {sprint.capacity} pts</span>
            ) : null}
            {progress.scopeAdded > 0 ? (
              <span class="num text-[11.5px] text-warn">
                +{progress.scopeAdded} pts added after the start
              </span>
            ) : null}
          </div>

          <Progress
            value={progress.doneRatio}
            tone={sprint.state === 'closed' ? 'ok' : 'accent'}
            height={4}
            marker={
              sprint.capacity && progress.committed > 0
                ? sprint.capacity / progress.committed
                : null
            }
          />

          <ScopeList sprintId={sprint.id} issues={scoped} />
        </div>

        <div class="flex flex-col gap-2">
          {isCurrent && burn.length > 0 ? (
            <div>
              <p class="label mb-1">Burndown</p>
              <BurnLine points={burn} capacity={sprint.capacity} height={108} />
              <p class="mt-1 text-[10.5px] leading-snug text-ink-4">
                Derived from each issue's last-modified date, so it is a close
                approximation rather than a stored history.
              </p>
            </div>
          ) : null}

          <label class="flex flex-col gap-1">
            <span class="label">Capacity</span>
            <input
              class="field"
              type="number"
              min="0"
              step="1"
              value={sprint.capacity ?? ''}
              placeholder="points"
              onChange={(event) =>
                patchSprint(sprint.id, {
                  capacity:
                    event.currentTarget.value === '' ? null : Number(event.currentTarget.value),
                })
              }
            />
          </label>

          <div class="grid grid-cols-2 gap-2">
            <label class="flex flex-col gap-1">
              <span class="label">Starts</span>
              <input
                class="field"
                type="date"
                value={sprint.start ?? ''}
                onChange={(event) =>
                  patchSprint(sprint.id, { start: event.currentTarget.value || null })
                }
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="label">Ends</span>
              <input
                class="field"
                type="date"
                value={sprint.end ?? ''}
                onChange={(event) =>
                  patchSprint(sprint.id, { end: event.currentTarget.value || null })
                }
              />
            </label>
          </div>
        </div>
      </div>

      {sprint.notes.trim() !== '' ? (
        <details class="border-t border-line px-3 py-2">
          <summary class="cursor-pointer text-[11.5px] text-ink-3 hover:text-ink">
            Retro and working agreements
          </summary>
          <pre class="prose-body mt-2 whitespace-pre-wrap">{sprint.notes}</pre>
        </details>
      ) : null}

      {closing ? (
        <CloseSprintModal
          sprint={sprint}
          unfinished={unfinished}
          onClose={() => setClosing(false)}
        />
      ) : null}
    </section>
  )
}

function ScopeList({ sprintId, issues: scoped }: { sprintId: string; issues: Issue[] }) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? scoped : scoped.slice(0, 6)

  if (scoped.length === 0) {
    return (
      <p class="inset px-2.5 py-3 text-[11.5px] text-ink-4">
        Nothing scheduled. Drag issues in from the backlog, or set their sprint in
        the issue panel.
      </p>
    )
  }

  return (
    <div class="inset">
      <ul>
        {shown
          .slice()
          .sort(compareOrder)
          .map((issue) => {
            const TypeIcon = ICON_FOR_TYPE[issue.type]
            return (
              <li key={issue.id} class="border-b border-line last:border-b-0">
                <button
                  type="button"
                  class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-panel-3"
                  onClick={() => toggleSelected(issue.id)}
                >
                  <span class="shrink-0" style={{ color: `var(--st-${issue.status})` }}>
                    <TypeIcon size={12} />
                  </span>
                  <span class="num w-[68px] shrink-0 text-[11px] text-ink-3">{issue.id}</span>
                  <span class="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                    {issue.title}
                  </span>
                  <span class="num shrink-0 text-[11px] text-ink-4">
                    {issue.points ?? '–'}
                  </span>
                  <Avatar handle={issue.assignee} size={16} />
                </button>
              </li>
            )
          })}
      </ul>
      {scoped.length > 6 ? (
        <button
          type="button"
          class="w-full border-t border-line px-2.5 py-1.5 text-left text-[11.5px] text-ink-3 hover:bg-panel-3 hover:text-ink"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Show fewer' : `Show all ${scoped.length}`}
        </button>
      ) : null}
      <div class="border-t border-line px-2.5 py-1.5">
        <span class="num text-[11px] text-ink-4">{sumPoints(scoped)} pts in scope</span>
        <span class="num ml-3 text-[11px] text-ink-4">{sprintId}</span>
      </div>
    </div>
  )
}

function CloseSprintModal({
  sprint,
  unfinished,
  onClose,
}: {
  sprint: Sprint
  unfinished: Issue[]
  onClose: () => void
}) {
  const [carry, setCarry] = useState(true)
  const openPoints = sumPoints(unfinished)

  return (
    <Modal
      title={`Close ${sprint.name}`}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn
            variant="primary"
            onClick={() => {
              onClose()
              patchSprint(sprint.id, { state: 'closed' })
              if (carry && unfinished.length > 0) {
                void assignToSprint(
                  unfinished.map((issue) => issue.id),
                  null,
                )
              } else if (unfinished.length > 0) {
                void setStatuses(
                  unfinished.map((issue) => issue.id),
                  'backlog' as Status,
                )
              }
            }}
          >
            Close the sprint
          </Btn>
        </>
      }
    >
      <div class="flex flex-col gap-3">
        <p class="text-[12.5px] text-ink-2">
          {unfinished.length === 0
            ? 'Everything in scope is done. Clean close.'
            : `${plural(unfinished.length, 'issue')} worth ${openPoints} points are still open.`}
        </p>
        {unfinished.length > 0 ? (
          <>
            <ul class="inset max-h-[180px] overflow-y-auto">
              {unfinished.map((issue) => (
                <li
                  key={issue.id}
                  class="flex items-center gap-2 border-b border-line px-2.5 py-1.5 last:border-b-0"
                >
                  <span class="num shrink-0 text-[11px] text-ink-3">{issue.id}</span>
                  <span class="min-w-0 flex-1 truncate text-[12px] text-ink-2">
                    {issue.title}
                  </span>
                  <span class="num shrink-0 text-[11px] text-ink-4">{issue.points ?? '–'}</span>
                </li>
              ))}
            </ul>
            <label class="flex items-start gap-2 text-[12.5px] text-ink-2">
              <input
                type="checkbox"
                class="mt-0.5 accent-[var(--accent)]"
                checked={carry}
                onChange={(event) => setCarry(event.currentTarget.checked)}
              />
              <span>
                Return them to the backlog, unscheduled.
                <span class="block text-[11.5px] text-ink-4">
                  Leave this off to keep them in the closed sprint as a record of
                  what was not finished.
                </span>
              </span>
            </label>
          </>
        ) : null}
        <p class="text-[11.5px] text-ink-4">
          Closing writes <code>state: closed</code> to{' '}
          <code>{sprint.path ?? sprint.id}</code>. Undo with git.
        </p>
      </div>
    </Modal>
  )
}
