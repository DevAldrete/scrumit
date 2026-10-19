import type { ComponentChildren } from 'preact'
import { relativeTime } from '../lib/format.ts'
import {
  boardColumns,
  burndown,
  currentSprint,
  flow,
  hygiene,
  sprintProgress,
  velocity,
  velocityMean,
  backlogIssues,
} from '../lib/metrics.ts'
import type { Issue } from '../lib/model.ts'
import {
  config,
  issues,
  scannedAt,
  skippedFiles,
  sprints,
  toggleSelected,
  validation,
} from '../lib/store.ts'
import { BurnLine, FlowBand, VelocityBars } from './charts.tsx'
import { Avatar, Progress } from './primitives.tsx'
import { ICON_FOR_TYPE } from './icons.tsx'

export function Metrics() {
  const sprint = currentSprint(sprints.value)
  const progress = sprint ? sprintProgress(sprint, issues.value) : null
  const columns = boardColumns(issues.value, config.value)
  const buckets = velocity(sprints.value, issues.value)
  const meanVelocity = velocityMean(buckets)
  const stats = flow(issues.value, sprints.value)
  const checks = hygiene(issues.value, config.value)

  const openIssues = issues.value.filter((issue) => issue.status !== 'done')

  return (
    <div class="scroll-y h-full">
      <div class="mx-auto flex max-w-[1100px] flex-col gap-5 px-4 py-4">
        <p class="text-[11.5px] text-ink-4">
          Everything here is read from the repository files. Where a number would
          need history the repo does not keep, it is named as a derivation rather
          than presented as a measurement.
        </p>

        <Section
          title="Sprint pulse"
          hint={sprint ? `${sprint.name} · ${sprint.goal || 'no goal set'}` : undefined}
        >
          {sprint && progress ? (
            <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_300px]">
              <div class="flex flex-col gap-3">
                <div class="grid grid-cols-3 gap-4">
                  <Figure
                    value={`${progress.done}/${progress.committed}`}
                    label="points delivered"
                  />
                  <Figure
                    value={
                      progress.daysLeft === null
                        ? '—'
                        : progress.daysLeft >= 0
                          ? String(progress.daysLeft)
                          : 'overdue'
                    }
                    label="days left"
                  />
                  <Figure
                    value={
                      progress.capacity === null
                        ? '—'
                        : `${Math.round((progress.committed / progress.capacity) * 100)}%`
                    }
                    label="of capacity committed"
                  />
                </div>
                <Progress
                  value={progress.doneRatio}
                  tone={progress.scopeAdded > 0 ? 'warn' : 'accent'}
                  height={5}
                  marker={
                    progress.capacity && progress.committed > 0
                      ? progress.capacity / progress.committed
                      : null
                  }
                />
                <p class="text-[11.5px] text-ink-4">
                  {progress.scopeAdded > 0
                    ? `${progress.scopeAdded} points were added after the sprint started.`
                    : 'No scope has been added since the sprint started.'}
                </p>
              </div>
              <div>
                <p class="label mb-1">Burndown</p>
                <BurnLine
                  points={sprint ? burndown(sprint, issues.value) : []}
                  capacity={sprint.capacity}
                  height={120}
                />
              </div>
            </div>
          ) : (
            <p class="text-[11.5px] text-ink-4">
              No sprint is running. Start one from the Sprints view to see the pulse.
            </p>
          )}
        </Section>

        <div class="grid gap-5 md:grid-cols-2">
          <Section title="Velocity" hint="points finished per sprint">
            <VelocityBars buckets={buckets} />
            <dl class="mt-3 grid grid-cols-3 gap-3">
              <Figure
                value={meanVelocity === null ? '—' : String(meanVelocity)}
                label="mean per closed sprint"
              />
              <Figure value={String(backlogIssues(issues.value).length)} label="in the backlog" />
              <Figure value={String(openIssues.length)} label="open overall" />
            </dl>
          </Section>

          <Section title="Flow" hint="where the work is right now">
            <FlowBand columns={columns} />
            <dl class="mt-3 grid grid-cols-3 gap-3">
              <Figure
                value={stats.medianLeadTime === null ? '—' : `${stats.medianLeadTime}d`}
                label="median lead time"
              />
              <Figure
                value={stats.openAge === null ? '—' : `${stats.openAge.toFixed(1)}d`}
                label="mean age of open work"
              />
              <Figure
                value={
                  stats.throughputPerSprint === null
                    ? '—'
                    : stats.throughputPerSprint.toFixed(1)
                }
                label="issues per closed sprint"
              />
            </dl>
            <p class="mt-2 text-[10.5px] leading-snug text-ink-4">
              Lead time is measured from <code>created</code> to the last
              modification date on finished issues.
            </p>
          </Section>
        </div>

        <Section
          title="Before the standup"
          hint="the checks a scrum master actually runs"
        >
          <div class="grid gap-x-8 gap-y-3 md:grid-cols-2">
            <CheckList
              title="Blocked"
              issues={checks.blocked}
              empty="Nothing is blocked by open work."
              tone="signal"
            />
            <CheckList
              title="Unassigned but scheduled"
              issues={checks.unassigned}
              empty="Every scheduled issue has an owner."
            />
            <CheckList
              title="Scheduled without an estimate"
              issues={checks.unpointed}
              empty="Everything scheduled is estimated."
            />
            <CheckList
              title="No acceptance criteria"
              issues={checks.withoutCriteria}
              empty="Every started issue states what done means."
            />
            <CheckList
              title="Not touched in a week"
              issues={checks.stale}
              empty="Nothing has gone quiet."
            />
          </div>
        </Section>

        <Section
          title="What the flow is missing"
          hint={`read ${relativeTime(scannedAt.value)}`}
        >
          {skippedFiles.value.length === 0 ? (
            <p class="text-[11.5px] text-ink-4">
              Every markdown file with an <code>id</code> in front-matter was read
              successfully.
            </p>
          ) : (
            <ul class="inset">
              {skippedFiles.value.map((file) => (
                <li
                  key={file.path}
                  class="flex items-center gap-2 border-b border-line px-2.5 py-1.5 last:border-b-0"
                >
                  <span class="num min-w-0 flex-1 truncate text-[11.5px] text-ink-2">
                    {file.path}
                  </span>
                  <span class="shrink-0 text-[11px] text-signal">{file.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Artefact validation"
          hint="what an agent-written repository gets wrong"
        >
          {validation.value.length === 0 ? (
            <p class="text-[11.5px] text-ink-4">
              No duplicate ids, dangling references, unknown enums, or path drift.
            </p>
          ) : (
            <ul class="inset">
              {validation.value.map((finding, index) => (
                <li
                  key={`${finding.path}-${finding.code}-${index}`}
                  class="border-b border-line px-2.5 py-1.5 last:border-b-0"
                >
                  <div class="flex items-center gap-2">
                    <span
                      class="num shrink-0 text-[10.5px] uppercase"
                      style={{
                        color:
                          finding.severity === 'error' ? 'var(--signal)' : 'var(--ink-4)',
                      }}
                    >
                      {finding.severity}
                    </span>
                    <span class="num min-w-0 flex-1 truncate text-[11.5px] text-ink-2">
                      {finding.path}
                    </span>
                    <span class="shrink-0 text-[10.5px] text-ink-4">{finding.code}</span>
                  </div>
                  <p class="mt-0.5 text-[11px] leading-snug text-ink-3">{finding.message}</p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
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
}) {
  return (
    <section class="border-t border-line pt-2.5">
      <header class="mb-2.5 flex items-baseline gap-2">
        <h2 class="text-[12.5px] font-medium text-ink">{title}</h2>
        {hint ? <span class="truncate text-[11px] text-ink-4">{hint}</span> : null}
      </header>
      {children}
    </section>
  )
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dt class="text-[10.5px] text-ink-4">{label}</dt>
      <dd class="num mt-0.5 text-[19px] leading-none text-ink">{value}</dd>
    </div>
  )
}

function CheckList({
  title,
  issues: list,
  empty,
  tone,
}: {
  title: string
  issues: Issue[]
  empty: string
  tone?: 'signal'
}) {
  return (
    <div>
      <div class="mb-1 flex items-baseline gap-2">
        <h3 class="text-[11.5px] text-ink-2">{title}</h3>
        <span
          class="num text-[11px]"
          style={{ color: list.length === 0 ? 'var(--ink-4)' : undefined }}
        >
          {list.length}
        </span>
      </div>
      {list.length === 0 ? (
        <p class="text-[11px] text-ink-4">{empty}</p>
      ) : (
        <ul class="flex flex-col">
          {list.slice(0, 5).map((issue) => {
            const TypeIcon = ICON_FOR_TYPE[issue.type]
            return (
              <li key={issue.id}>
                <button
                  type="button"
                  class="flex w-full items-center gap-2 rounded-sm px-1 py-1 text-left hover:bg-panel-2"
                  onClick={() => toggleSelected(issue.id)}
                >
                  <span style={{ color: `var(--st-${issue.status})` }}>
                    <TypeIcon size={11} />
                  </span>
                  <span class="num shrink-0 text-[10.5px] text-ink-4">{issue.id}</span>
                  <span
                    class="min-w-0 flex-1 truncate text-[12px]"
                    style={{ color: tone === 'signal' ? 'var(--signal)' : 'var(--ink-2)' }}
                  >
                    {issue.title}
                  </span>
                  <Avatar handle={issue.assignee} size={15} />
                </button>
              </li>
            )
          })}
          {list.length > 5 ? (
            <li class="num px-1 py-0.5 text-[10.5px] text-ink-4">
              and {list.length - 5} more
            </li>
          ) : null}
        </ul>
      )}
    </div>
  )
}
