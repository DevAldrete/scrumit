import { useState } from 'preact/hooks'
import { relativeTime } from '../lib/format.ts'
import { fsaSupported } from '../lib/fsa.ts'
import {
  addLocalRepo,
  forgetRepo,
  openDemo,
  openRepo,
  repos,
} from '../lib/store.ts'
import type { RepoRecord } from '../lib/db.ts'
import { Btn, Chip, tintStyle } from './primitives.tsx'
import { IconBranch, IconFolder, IconTrash } from './icons.tsx'

const SPECIMEN = `id: ACME-140
title: Retry webhook delivery with backoff
status: doing
type: story
epic: EPIC-01
sprint: 2026-S20
points: 3
assignee: tobias-rehn
labels: [reliability]

## Acceptance criteria

- [ ] Retry at 1s, 8s, 60s, then dead-letter
- [ ] Duplicate deliveries below 0.01%`

export function Welcome() {
  return (
    <div class="scroll-y h-full">
      <div class="grid min-h-full place-items-center px-6 py-10">
        <div class="flex w-full max-w-[1060px] flex-col gap-12 lg:flex-row lg:items-center lg:gap-16">
          <div class="min-w-0 flex-1">
            <h1
              class="text-[46px] leading-[0.95] text-ink"
              style={{
                fontFamily: 'var(--f-display)',
                fontWeight: 500,
                letterSpacing: '-0.035em',
                fontVariationSettings: "'SOFT' 24, 'WONK' 1, 'opsz' 96",
              }}
            >
              scrumit
            </h1>

            <hr class="hairline mt-6 mb-6" />

            <p class="prose-body">
              A console for sprints, boards and epics that live in your repository as
              markdown. Every card is a file with a YAML header. Drag it and one file
              moves; edit it and one diff appears. Nothing is locked in scrumit, so
              nothing is lost if you stop using it.
            </p>

            <div class="mt-7 flex flex-wrap gap-2">
              <Btn variant="primary" onClick={() => void addLocalRepo()}>
                <IconFolder size={14} />
                Open a repository folder
              </Btn>
              <Btn onClick={() => void openDemo()}>Explore the demo repo</Btn>
            </div>

            <p class="mt-3 max-w-[52ch] text-[11.5px] leading-relaxed text-ink-4">
              {fsaSupported()
                ? 'Your files stay on disk. scrumit reads and writes them directly and keeps only folder handles and a cached index in your browser.'
                : 'This browser cannot open local folders — folder access needs Chrome, Edge or another Chromium browser. The demo repo works everywhere.'}
            </p>

            {repos.value.length > 0 ? <RecentRepos /> : null}
          </div>

          <Specimen />
        </div>
      </div>
    </div>
  )
}

function RecentRepos() {
  const [pending, setPending] = useState<string | null>(null)

  return (
    <section class="mt-10">
      <h2 class="label mb-1.5">Repositories</h2>
      <ul class="border-t border-line">
        {repos.value.map((repo) => (
          <RepoRow
            key={repo.id}
            repo={repo}
            pending={pending === repo.id}
            onOpen={() => {
              setPending(repo.id)
              void openRepo(repo, { gesture: true }).finally(() => setPending(null))
            }}
            onForget={() => void forgetRepo(repo.id)}
          />
        ))}
      </ul>
    </section>
  )
}

function RepoRow({
  repo,
  pending,
  onOpen,
  onForget,
}: {
  repo: RepoRecord
  pending: boolean
  onOpen: () => void
  onForget: () => void
}) {
  const needsPermission = repo.kind === 'fsa'

  return (
    <li class="group flex items-center gap-3 border-b border-line py-2">
      <span class="swatch h-2.5 w-2.5 shrink-0" style={tintStyle(repo.color)} />
      <button
        type="button"
        onClick={onOpen}
        disabled={pending}
        class="min-w-0 flex-1 text-left disabled:opacity-50"
      >
        <span class="block truncate text-[13px] text-ink group-hover:text-accent">
          {repo.name}
        </span>
        <span class="block truncate text-[11px] text-ink-4">
          {repo.kind === 'demo' ? 'demo repository' : repo.path}
        </span>
      </button>
      {needsPermission ? (
        <Chip class="opacity-60">
          <IconBranch size={10} />
          needs access
        </Chip>
      ) : null}
      <span class="num shrink-0 text-[11px] text-ink-4">
        {pending ? 'opening…' : relativeTime(repo.lastOpenedAt)}
      </span>
      <Btn
        variant="ghost"
        icon
        class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        title={`Forget ${repo.name}`}
        onClick={onForget}
      >
        <IconTrash size={13} />
      </Btn>
    </li>
  )
}

/** The product in one glance: the file, and the card it becomes. */
function Specimen() {
  const lines = SPECIMEN.split('\n')

  return (
    <aside class="w-full shrink-0 lg:w-[352px]">
      <div class="panel overflow-hidden">
        <header class="flex items-center gap-2 border-b border-line bg-panel-2 px-3 py-1.5">
          <span class="h-[9px] w-[2px] rounded-full bg-st-doing" />
          <span class="text-[11px] text-ink-4">sprints/2026-S20/ACME-140.md</span>
        </header>
        <pre class="m-0 overflow-x-auto px-3 py-2.5 text-[11.5px] leading-[1.6]">
          {lines.map((line, index) => {
            const separator = line === '---'
            const key = /^([a-z_]+):/.exec(line)
            const checkbox = /^\s*-\s+\[/.test(line)
            return (
              <div
                key={index}
                class={
                  checkbox
                    ? 'text-ink-3'
                    : key
                      ? 'text-ink'
                      : line.startsWith('##')
                        ? 'text-ink-2'
                        : 'text-ink-2'
                }
              >
                {key ? (
                  <>
                    <span class="text-ink-4">{key[1]}</span>
                    <span class="text-ink-4">:</span>
                    {line.slice(key[0].length)}
                  </>
                ) : separator ? (
                  <span class="text-ink-4">---</span>
                ) : (
                  line || '\u00a0'
                )}
              </div>
            )
          })}
        </pre>
        <footer class="flex items-center gap-2 border-t border-line bg-panel-2 px-3 py-2">
          <span class="swatch" style={{ '--tint': 'var(--e1)' } as never} />
          <span class="text-[11px] text-ink-3">EPIC-01</span>
          <span class="text-ink-4">·</span>
          <span class="num text-[11px] text-ink-3">3 pts</span>
          <span class="ml-auto text-[11px] text-ink-4">tobias-rehn</span>
        </footer>
      </div>

      <p class="mt-3 text-[11.5px] leading-relaxed text-ink-4">
        Front-matter you do not touch is kept. Rename a status and the file moves;
        the prose is never rewritten.
      </p>
    </aside>
  )
}
