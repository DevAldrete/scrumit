import { useState } from 'preact/hooks'
import { humanDate, plural, sumPoints } from '../lib/format.ts'
import { epicProgress, type EpicProgress } from '../lib/metrics.ts'
import { EPIC_STATES, type EpicState } from '../lib/model.ts'
import { createEpic, epics, issues, patchEpic, toggleSelected } from '../lib/store.ts'
import { AutoTextarea, Avatar, Btn, Chip, Progress, Swatch, tintStyle } from './primitives.tsx'
import { ICON_FOR_TYPE, IconPlus, IconTarget } from './icons.tsx'

export function Epics() {
  const progress = epicProgress(epics.value, issues.value)

  return (
    <div class="scroll-y h-full">
      <div class="mx-auto flex max-w-[1080px] flex-col gap-3 px-4 py-4">
        <div class="flex items-center gap-2">
          <p class="text-[11.5px] text-ink-4">
            Epics group issues that share a goal. Their colour comes from the
            active theme, so an epic keeps its hue family when you switch themes.
          </p>
          <Btn class="ml-auto shrink-0" onClick={() => void createEpic('New epic')}>
            <IconPlus size={13} />
            New epic
          </Btn>
        </div>

        {progress.length === 0 ? (
          <p class="panel px-3 py-4 text-[12px] text-ink-3">
            No epics yet. Create one, then set it on any issue.
          </p>
        ) : (
          <div class="grid gap-3 lg:grid-cols-2">
            {progress.map((row) => (
              <EpicCard key={row.epic.id} progress={row} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function EpicCard({ progress }: { progress: EpicProgress }) {
  const { epic, open } = progress
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? open : open.slice(0, 4)

  return (
    <section class="panel flex flex-col">
      <header
        class="flex items-start gap-2 border-b border-line px-3 py-2"
        style={{ borderTop: `2px solid var(--e${epic.color})` }}
      >
        <span class="mt-0.5">
          <Swatch hue={epic.color} />
        </span>
        <div class="min-w-0 flex-1">
          <input
            class="field !border-transparent !bg-transparent !px-0 text-[14px] leading-snug hover:!border-transparent focus:!bg-transparent"
            style={{ fontFamily: 'var(--f-display)', fontWeight: 500, letterSpacing: '-0.01em' }}
            value={epic.title}
            onInput={(event) => patchEpic(epic.id, { title: event.currentTarget.value })}
          />
          <span class="num text-[11px] text-ink-4">{epic.id}</span>
        </div>

        <select
          class="field w-[92px] shrink-0"
          value={epic.state}
          onChange={(event) =>
            patchEpic(epic.id, { state: event.currentTarget.value as EpicState })
          }
        >
          {EPIC_STATES.map((state) => (
            <option key={state} value={state}>
              {state}
            </option>
          ))}
        </select>
      </header>

      <div class="flex flex-col gap-2.5 px-3 py-2.5">
        <div>
          <div class="mb-1 flex items-baseline gap-2">
            <span class="num text-[11.5px] text-ink-3">
              {progress.pointsDone}/{progress.points} pts
            </span>
            <span class="num text-[11.5px] text-ink-4">
              {progress.done}/{progress.total} {progress.total === 1 ? 'issue' : 'issues'}
            </span>
            <span class="num ml-auto text-[11.5px] text-ink-4">
              {Math.round(progress.ratio * 100)}%
            </span>
          </div>
          <Progress
            value={progress.ratio}
            tone={epic.state === 'done' ? 'ok' : epic.state === 'planned' ? 'warn' : 'accent'}
          />
        </div>

        <AutoTextarea
          class="field min-h-[54px] text-[12.5px]"
          placeholder="What does done look like for this epic?"
          value={epic.description}
          onInput={(value) => patchEpic(epic.id, { description: value })}
        />

        <div class="grid grid-cols-3 gap-2">
          <label class="flex flex-col gap-1">
            <span class="label">Owner</span>
            <input
              class="field"
              value={epic.owner ?? ''}
              placeholder="unowned"
              onInput={(event) =>
                patchEpic(epic.id, { owner: event.currentTarget.value || null })
              }
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="label">Target</span>
            <input
              class="field"
              type="date"
              value={epic.target ?? ''}
              onChange={(event) =>
                patchEpic(epic.id, { target: event.currentTarget.value || null })
              }
            />
          </label>
          <div class="flex flex-col gap-1">
            <span class="label">Hue</span>
            <div class="flex h-[26px] items-center gap-1">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((hue) => (
                <button
                  key={hue}
                  type="button"
                  class={`h-4 w-4 rounded-sm ${
                    epic.color === hue ? 'ring-2 ring-offset-1 ring-ink-4' : 'opacity-80 hover:opacity-100'
                  }`}
                  style={{
                    ...tintStyle(hue),
                    background: 'var(--tint)',
                    // The offset ring needs to sit on the panel, not the card.
                    '--tw-ring-offset-color': 'var(--panel)',
                  } as never}
                  title={`Hue ${hue}`}
                  aria-label={`Use hue ${hue}`}
                  onClick={() => patchEpic(epic.id, { color: hue })}
                />
              ))}
            </div>
          </div>
        </div>

        {epic.target ? (
          <p class="num text-[11px] text-ink-4">
            <IconTarget size={11} /> target {humanDate(epic.target)}
          </p>
        ) : null}

        {open.length > 0 ? (
          <div class="inset">
            <ul>
              {shown.map((issue) => {
                const TypeIcon = ICON_FOR_TYPE[issue.type]
                return (
                  <li key={issue.id} class="border-b border-line last:border-b-0">
                    <button
                      type="button"
                      class="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-panel-3"
                      onClick={() => toggleSelected(issue.id)}
                    >
                      <span style={{ color: `var(--st-${issue.status})` }}>
                        <TypeIcon size={12} />
                      </span>
                      <span class="num w-[68px] shrink-0 text-[11px] text-ink-3">
                        {issue.id}
                      </span>
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
            {open.length > 4 ? (
              <button
                type="button"
                class="w-full border-t border-line px-2 py-1.5 text-left text-[11.5px] text-ink-3 hover:bg-panel-3 hover:text-ink"
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? 'Show fewer' : `Show all ${open.length} open`}
              </button>
            ) : null}
          </div>
        ) : (
          <p class="inset px-2 py-2 text-[11.5px] text-ink-4">
            {progress.total === 0
              ? 'Nothing assigned to this epic yet.'
              : `All ${plural(progress.total, 'issue')} closed.`}
          </p>
        )}
      </div>

      {progress.total > 0 ? (
        <footer class="flex items-center gap-2 border-t border-line px-3 py-1.5">
          <Chip>{sumPoints(open)} pts still open</Chip>
          {epic.owner ? <Avatar handle={epic.owner} size={16} /> : null}
        </footer>
      ) : null}
    </section>
  )
}
