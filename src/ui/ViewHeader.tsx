import type { JSX } from 'preact'
import { dayMonth, plural, relativeTime } from '../lib/format.ts'
import { currentSprint, sprintProgress, sprintWip } from '../lib/metrics.ts'
import type { View } from '../lib/store.ts'
import {
  activeRepo,
  allLabels,
  assignees,
  blockedIds,
  clearFilters,
  config,
  epicById,
  epics,
  fileCount,
  filterCount,
  filters,
  issues,
  scannedAt,
  setFilter,
  setView,
  sprints,
  view,
  visibleIssues,
} from '../lib/store.ts'
import { Btn, Menu, MenuItem, Swatch, tintStyle } from './primitives.tsx'
import {
  IconBoard,
  IconBranch,
  IconLayers,
  IconList,
  IconPulse,
  IconSliders,
  IconTarget,
  IconX,
} from './icons.tsx'

const NAV: { id: View; label: string; Icon: (p: { size?: number }) => JSX.Element }[] = [
  { id: 'board', label: 'Board', Icon: IconBoard },
  { id: 'backlog', label: 'Backlog', Icon: IconList },
  { id: 'sprints', label: 'Sprints', Icon: IconTarget },
  { id: 'epics', label: 'Epics', Icon: IconLayers },
  { id: 'metrics', label: 'Flow', Icon: IconPulse },
  { id: 'changes', label: 'Changes', Icon: IconBranch },
  { id: 'settings', label: 'Settings', Icon: IconSliders },
]

export function Rail() {
  const current = view.value
  const backlogCount = visibleIssues.value.filter((issue) => issue.sprint === null).length

  return (
    <nav
      class="flex w-11 shrink-0 flex-col items-center gap-0.5 border-r border-line bg-panel py-2"
      aria-label="Views"
    >
      {NAV.map(({ id, label, Icon }) => {
        const active = current === id
        return (
          <button
            key={id}
            type="button"
            title={label}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            class={`relative flex h-9 w-9 items-center justify-center rounded-sm ${
              active ? 'bg-panel-3 text-ink' : 'text-ink-3 hover:bg-panel-2 hover:text-ink'
            }`}
            onClick={() => void setView(id)}
          >
            {active ? (
              <span class="absolute top-1.5 -left-2 bottom-1.5 w-[2px] rounded-full bg-accent" />
            ) : null}
            <Icon size={16} />
            {id === 'backlog' && backlogCount > 0 ? (
              <span class="num absolute -right-0.5 -bottom-0.5 rounded-full bg-panel-3 px-1 text-[9px] text-ink-3">
                {backlogCount}
              </span>
            ) : null}
          </button>
        )
      })}
    </nav>
  )
}

const TITLES: Record<View, string> = {
  board: 'Board',
  backlog: 'Backlog',
  sprints: 'Sprints',
  epics: 'Epics',
  metrics: 'Flow',
  changes: 'Changes',
  settings: 'Settings',
}

export function ViewHeader() {
  const current = view.value
  const repo = activeRepo.value
  const sprint = currentSprint(sprints.value)
  const progress = sprint ? sprintProgress(sprint, issues.value) : null
  const wip = sprint ? sprintWip(sprint, issues.value, config.value) : null
  const backlog = visibleIssues.value.filter((issue) => issue.sprint === null)

  return (
    <div class="flex shrink-0 flex-col border-b border-line bg-panel">
      <div class="flex h-9 items-center gap-2 overflow-hidden px-3">
        <h1 class="shrink-0 text-[12.5px] font-medium text-ink">{TITLES[current]}</h1>
        <span class="h-3.5 w-px shrink-0 bg-line" />

        {current === 'board' && sprint && progress ? (
          <>
            <span class="shrink-0 text-[11.5px] text-ink-3">{sprint.name}</span>
            <span class="num shrink-0 text-[11.5px] text-ink-4">
              {progress.done}/{progress.committed} pts
            </span>
            {progress.daysLeft !== null && progress.daysLeft >= 0 ? (
              <span class="num shrink-0 text-[11.5px] text-ink-4">
                {plural(progress.daysLeft, 'day')} left
              </span>
            ) : null}
            {wip ? (
              <span
                class="num shrink-0 text-[11.5px]"
                style={{
                  color: wip.over
                    ? 'var(--signal)'
                    : wip.overSoft
                      ? 'var(--warn)'
                      : 'var(--ink-4)',
                }}
                title={[
                  `WIP counts ${wip.count} in-flight task${wip.count === 1 ? '' : 's'}`,
                  wip.soft !== null ? `flexible limit ${wip.soft}` : null,
                  wip.hard !== null ? `hard limit ${wip.hard}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              >
                WIP {wip.count}
                {wip.hard !== null ? `/${wip.hard}` : ''}
                {wip.over ? ' — over' : wip.overSoft ? ' — soft' : ''}
              </span>
            ) : null}
            {progress.scopeAdded > 0 ? (
              <span class="num shrink-0 text-[11.5px] text-warn">
                +{progress.scopeAdded} added mid-sprint
              </span>
            ) : null}
          </>
        ) : null}

        {current === 'board' && !sprint ? (
          <span class="truncate text-[11.5px] text-ink-4">
            No sprint yet — work stays in the backlog until you plan one.
          </span>
        ) : null}

        {current === 'backlog' ? (
          <>
            <span class="num shrink-0 text-[11.5px] text-ink-4">
              {plural(backlog.length, 'issue')}
            </span>
            <span class="num shrink-0 text-[11.5px] text-ink-4">
              {backlog.reduce((sum, issue) => sum + (issue.points ?? 0), 0)} pts
            </span>
          </>
        ) : null}

        {current === 'epics' ? (
          <span class="num shrink-0 text-[11.5px] text-ink-4">
            {plural(epics.value.length, 'epic')}
          </span>
        ) : null}

        {current === 'sprints' ? (
          <span class="num shrink-0 text-[11.5px] text-ink-4">
            {plural(sprints.value.length, 'sprint')}
          </span>
        ) : null}

        {current === 'metrics' ? (
          <span class="num truncate text-[11.5px] text-ink-4">
            {plural(fileCount.value, 'file')} · read {relativeTime(scannedAt.value)}
          </span>
        ) : null}

        {current === 'settings' && repo ? (
          <span class="truncate text-[11.5px] text-ink-4">{repo.path}</span>
        ) : null}

        <span class="ml-auto flex shrink-0 items-center gap-2">
          {blockedIds.value.size > 0 ? (
            <span class="num text-[11px] text-signal">
              {blockedIds.value.size} blocked
            </span>
          ) : null}
          {config.value.project ? (
            <span class="hidden max-w-[220px] truncate text-[11px] text-ink-4 lg:inline">
              {config.value.project}
            </span>
          ) : null}
          <span class="swatch" style={tintStyle(repo?.color ?? 1)} aria-hidden="true" />
        </span>
      </div>

      {current === 'board' || current === 'backlog' ? <FilterBar /> : null}
    </div>
  )
}

function FilterBar() {
  const f = filters.value
  const sprint = f.sprint ? sprints.value.find((item) => item.id === f.sprint) : null
  const epic = f.epic ? epicById.value.get(f.epic) : null
  const activeSprint = currentSprint(sprints.value)

  return (
    <div class="flex flex-wrap items-center gap-1.5 border-t border-line px-3 py-1.5">
      <div class="flex min-w-0 items-center gap-0.5 rounded-sm border border-line p-0.5">
        <span class="label shrink-0 px-1.5">Sprint</span>
        <button
          type="button"
          class={`rounded-sm px-1.5 py-0.5 text-[11px] ${
            f.sprint === null
              ? 'bg-panel-3 text-ink'
              : 'text-ink-3 hover:bg-panel-2 hover:text-ink'
          }`}
          onClick={() => setFilter({ sprint: null })}
          title="Show every sprint and the backlog"
        >
          All
        </button>
        <button
          type="button"
          disabled={!activeSprint}
          class={`rounded-sm px-1.5 py-0.5 text-[11px] disabled:opacity-40 ${
            activeSprint && f.sprint === activeSprint.id
              ? 'bg-panel-3 text-ink'
              : 'text-ink-3 hover:bg-panel-2 hover:text-ink'
          }`}
          onClick={() => {
            if (activeSprint) setFilter({ sprint: activeSprint.id })
          }}
          title={activeSprint ? `Show ${activeSprint.name}` : 'No sprint is active'}
        >
          Active
        </button>
        <button
          type="button"
          class={`rounded-sm px-1.5 py-0.5 text-[11px] ${
            f.sprint === ''
              ? 'bg-panel-3 text-ink'
              : 'text-ink-3 hover:bg-panel-2 hover:text-ink'
          }`}
          onClick={() => setFilter({ sprint: '' })}
          title="Show only unscheduled work"
        >
          Backlog
        </button>
      </div>

      <input
        class="field h-7 w-[188px] min-w-[132px] py-0"
        placeholder="Filter issues…"
        title="Filter by id, title, label or body"
        value={f.text}
        onInput={(event) => setFilter({ text: event.currentTarget.value })}
      />

      <Menu class="w-[132px]" label={f.assignee ?? 'Anyone'} title="Filter by assignee">
        {(close) => (
          <>
            <MenuItem
              selected={f.assignee === null}
              onClick={() => {
                close()
                setFilter({ assignee: null })
              }}
            >
              Anyone
            </MenuItem>
            {assignees.value.map((person) => (
              <MenuItem
                key={person}
                selected={f.assignee === person}
                onClick={() => {
                  close()
                  setFilter({ assignee: person })
                }}
              >
                {person}
              </MenuItem>
            ))}
          </>
        )}
      </Menu>

      <Menu
        class="w-[138px]"
        label={
          epic ? (
            <span class="flex min-w-0 items-center gap-1.5">
              <Swatch hue={epic.color} />
              <span class="truncate">{epic.id}</span>
            </span>
          ) : (
            'Any epic'
          )
        }
        title="Filter by epic"
      >
        {(close) => (
          <>
            <MenuItem
              selected={f.epic === null}
              onClick={() => {
                close()
                setFilter({ epic: null })
              }}
            >
              Any epic
            </MenuItem>
            {epics.value.map((item) => (
              <MenuItem
                key={item.id}
                selected={f.epic === item.id}
                onClick={() => {
                  close()
                  setFilter({ epic: item.id })
                }}
              >
                <span class="flex items-center gap-1.5">
                  <Swatch hue={item.color} />
                  <span class="truncate">{item.title}</span>
                </span>
              </MenuItem>
            ))}
          </>
        )}
      </Menu>

      <Menu class="w-[126px]" label={f.label ?? 'Any label'} title="Filter by label">
        {(close) => (
          <>
            <MenuItem
              selected={f.label === null}
              onClick={() => {
                close()
                setFilter({ label: null })
              }}
            >
              Any label
            </MenuItem>
            {allLabels.value.map((label) => (
              <MenuItem
                key={label}
                selected={f.label === label}
                onClick={() => {
                  close()
                  setFilter({ label })
                }}
              >
                {label}
              </MenuItem>
            ))}
          </>
        )}
      </Menu>

      <Menu class="w-[128px]" label={sprint ? sprint.name : 'Any sprint'} title="Filter by sprint">
        {(close) => (
          <>
            <MenuItem
              selected={f.sprint === null}
              onClick={() => {
                close()
                setFilter({ sprint: null })
              }}
            >
              Any sprint
            </MenuItem>
            <MenuItem
              selected={f.sprint === ''}
              onClick={() => {
                close()
                setFilter({ sprint: '' })
              }}
            >
              Not scheduled
            </MenuItem>
            {sprints.value.map((item) => (
              <MenuItem
                key={item.id}
                selected={f.sprint === item.id}
                hint={item.end ? dayMonth(item.end) : item.state}
                onClick={() => {
                  close()
                  setFilter({ sprint: item.id })
                }}
              >
                {item.name}
              </MenuItem>
            ))}
          </>
        )}
      </Menu>

      {filterCount.value > 0 ? (
        <Btn variant="ghost" onClick={clearFilters}>
          <IconX size={12} />
          Clear {filterCount.value}
        </Btn>
      ) : null}

      <span class="num ml-auto shrink-0 text-[11px] text-ink-4">
        {visibleIssues.value.length} of {issues.value.length}
      </span>
    </div>
  )
}
