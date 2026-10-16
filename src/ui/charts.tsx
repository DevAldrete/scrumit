import { dayMonth, todayISO } from '../lib/format.ts'
import type { BurnPoint, VelocityBucket } from '../lib/metrics.ts'
import type { ColumnStat } from '../lib/metrics.ts'

/**
 * Charts are drawn from the data scrumit actually has. Where a metric would
 * need history the repo does not keep, it is labelled as a derivation instead
 * of being dressed up as measurement.
 */
export function BurnLine({
  points,
  height = 132,
  capacity,
}: {
  points: BurnPoint[]
  height?: number
  capacity?: number | null
}) {
  if (points.length < 2) {
    return (
      <p class="px-0.5 py-6 text-[11.5px] text-ink-4">
        Set a start and end date on this sprint to plot a burndown.
      </p>
    )
  }

  const peak = Math.max(...points.map((p) => Math.max(p.remaining, p.ideal)), capacity ?? 0, 1)
  // Round the axis up so the labels read as round numbers and the peak line is
  // not drawn hard against the top edge.
  const step = peak <= 10 ? 1 : peak <= 50 ? 5 : peak <= 100 ? 10 : peak <= 250 ? 25 : 50
  const max = Math.ceil(peak / step) * step

  const today = todayISO()
  const total = points.length - 1
  const x = (index: number) => (index / total) * 100
  const y = (value: number) => 100 - (value / max) * 100
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.round(max * fraction))

  const actual = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(p.remaining).toFixed(2)}`)
    .join(' ')
  const ideal = `M 0 ${y(points[0].ideal).toFixed(2)} L 100 ${y(
    points[points.length - 1].ideal,
  ).toFixed(2)}`

  const todayIndex = points.findIndex((p) => p.day === today)

  return (
    <div class="flex gap-1.5">
      <div
        class="flex shrink-0 flex-col justify-between text-right text-[9.5px] text-ink-4"
        style={{ height: `${height}px` }}
        aria-hidden="true"
      >
        {ticks
          .slice()
          .reverse()
          .map((tick) => (
            <span key={tick} class="num leading-none">
              {tick}
            </span>
          ))}
      </div>

      <div class="min-w-0 flex-1">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          class="w-full"
          style={{ height: `${height}px` }}
          role="img"
          aria-label={`Remaining points against the ideal burndown, out of ${max}`}
        >
          {ticks.map((tick) => (
            <line
              key={tick}
              x1="0"
              x2="100"
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--line)"
              stroke-width="1"
              vector-effect="non-scaling-stroke"
            />
          ))}
          {capacity ? (
            <line
              x1="0"
              x2="100"
              y1={y(capacity)}
              y2={y(capacity)}
              stroke="var(--line-2)"
              stroke-width="1"
              stroke-dasharray="1 3"
              vector-effect="non-scaling-stroke"
            />
          ) : null}
          <path
            d={ideal}
            fill="none"
            stroke="var(--ink-4)"
            stroke-width="1"
            stroke-dasharray="3 3"
            vector-effect="non-scaling-stroke"
          />
          <path
            d={actual}
            fill="none"
            stroke="var(--accent)"
            stroke-width="2"
            stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
          />
          {todayIndex >= 0 ? (
            <line
              x1={x(todayIndex)}
              x2={x(todayIndex)}
              y1="0"
              y2="100"
              stroke="var(--warn)"
              stroke-width="1"
              vector-effect="non-scaling-stroke"
            />
          ) : null}
        </svg>

        <div class="mt-1 flex items-center justify-between text-[10px] text-ink-4">
          <span>{dayMonth(points[0].day)}</span>
          <span class="flex items-center gap-2.5">
            <span class="flex items-center gap-1">
              <span class="h-[2px] w-3 bg-accent" />
              remaining
            </span>
            <span class="flex items-center gap-1">
              <span class="h-[2px] w-3 border-t border-dashed border-ink-4" />
              ideal
            </span>
            {todayIndex >= 0 ? (
              <span class="flex items-center gap-1">
                <span class="h-2.5 w-[1px] bg-warn" />
                today
              </span>
            ) : null}
          </span>
          <span>{dayMonth(points[points.length - 1].day)}</span>
        </div>
      </div>
    </div>
  )
}

export function VelocityBars({
  buckets,
  height = 104,
}: {
  buckets: VelocityBucket[]
  height?: number
}) {
  if (buckets.length === 0) {
    return (
      <p class="py-6 text-[11.5px] text-ink-4">
        No closed sprints yet. Velocity appears after your first one.
      </p>
    )
  }

  const max = Math.max(...buckets.map((bucket) => bucket.points), 1)

  return (
    <div class="flex items-end gap-3" style={{ height: `${height}px` }}>
      {buckets.map((bucket) => {
        const ratio = bucket.points / max
        return (
          <div key={bucket.id} class="flex h-full min-w-0 flex-1 flex-col justify-end gap-1">
            <span class="num text-center text-[11px] text-ink-3">{bucket.points}</span>
            <div
              class="mx-auto w-full max-w-[46px] rounded-t-sm"
              style={{
                height: `${Math.max(ratio * (height - 40), 2)}px`,
                background:
                  bucket.state === 'active'
                    ? 'repeating-linear-gradient(135deg, var(--accent) 0 4px, transparent 4px 8px)'
                    : 'var(--accent)',
                opacity: bucket.state === 'active' ? 0.75 : 1,
              }}
              title={`${bucket.points} points from ${bucket.count} issues${
                bucket.state === 'active' ? ' — still running' : ''
              }`}
            />
            <span class="num truncate text-center text-[10px] text-ink-4">{bucket.label}</span>
          </div>
        )
      })}
    </div>
  )
}

export function FlowBand({ columns }: { columns: ColumnStat[] }) {
  const total = columns.reduce((sum, column) => sum + column.count, 0)
  if (total === 0) {
    return <span class="block h-2 w-full rounded-full bg-panel-3" />
  }
  return (
    <div>
      <span class="flex h-2 w-full overflow-hidden rounded-full">
        {columns
          .filter((column) => column.count > 0)
          .map((column) => (
            <span
              key={column.id}
              style={{
                width: `${(column.count / total) * 100}%`,
                background: `var(--st-${column.id})`,
              }}
              title={`${column.name}: ${column.count}`}
            />
          ))}
      </span>
      <ul class="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {columns.map((column) => (
          <li key={column.id} class="flex items-center gap-1.5 text-[11px] text-ink-3">
            <span
              class="h-[7px] w-[7px] rounded-full"
              style={{ background: `var(--st-${column.id})` }}
            />
            {column.name}
            <span class="num text-ink-4">{column.count}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
