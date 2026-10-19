import { serializeEpic, serializeIssue, serializeSprint } from './artefacts.ts'
import { defaultConfig, serializeConfig } from './config.ts'
import { epicPath, issuePath, sprintPath } from './paths.ts'
import { getPref, setPref } from './db.ts'
import { CONFIG_PATH, IGNORED_DIRS, type PermissionState, type RepoSource } from './source.ts'
import type { Epic, Issue, IssueType, Priority, Sprint, Status } from './model.ts'

/**
 * A seeded repo, held in memory and mirrored into Dexie so edits survive a
 * reload. This is what makes the app explorable before you have pointed it at a
 * real checkout — and it keeps the whole UI exercisable without the File System
 * Access API.
 */

type Row = [
  id: string,
  title: string,
  status: Status,
  type: IssueType,
  epic: string | null,
  sprint: string | null,
  points: number | null,
  assignee: string | null,
  priority: Priority | null,
  labels: string[],
  blockedBy: string[],
]

const S19 = '2026-S19'
const S20 = '2026-S20'

const ROWS: Row[] = [
  // ── Backlog ───────────────────────────────────────────────────────────────
  ['ACME-118', 'Add idempotency keys to the refund API', 'backlog', 'story', 'EPIC-01', null, 5, 'tobias-rehn', 1, ['payments', 'api'], []],
  ['ACME-121', 'Support SEPA Instant in payout routing', 'backlog', 'story', 'EPIC-01', null, 8, 'lise-okafor', 1, ['payouts', 'compliance'], []],
  ['ACME-124', 'Merchant dashboard: test-mode data toggle', 'backlog', 'story', 'EPIC-02', null, 3, 'priya-raman', 2, ['dashboard'], []],
  ['ACME-127', 'Rate-limit public webhooks per merchant', 'backlog', 'story', 'EPIC-03', null, 3, 'marco-diaz', 2, ['reliability'], []],
  ['ACME-129', 'Move ledger writes to an append-only journal', 'backlog', 'spike', 'EPIC-04', null, 5, 'yuki-tanabe', 1, ['ledger', 'architecture'], []],
  ['ACME-133', 'CLI to replay dead-lettered webhooks', 'backlog', 'chore', 'EPIC-05', null, 2, 'ana-marin', 3, ['tooling'], []],
  ['ACME-136', 'GDPR export must include dispute attachments', 'backlog', 'story', 'EPIC-04', null, 5, 'lise-okafor', 1, ['compliance'], ['ACME-129']],
  ['ACME-138', 'Alert when a settlement file is late', 'backlog', 'story', 'EPIC-03', null, 2, 'marco-diaz', 2, ['observability'], []],

  // ── To do (current sprint) ────────────────────────────────────────────────
  ['ACME-140', 'Retry webhook delivery with backoff', 'todo', 'story', 'EPIC-01', S20, 3, 'tobias-rehn', 1, ['reliability'], []],
  ['ACME-141', 'Show decline reason codes in the payments table', 'todo', 'story', 'EPIC-02', S20, 3, 'priya-raman', 2, ['dashboard'], []],
  ['ACME-143', 'Persist onboarding progress across sessions', 'todo', 'story', 'EPIC-02', S20, 5, 'priya-raman', 2, ['onboarding'], []],
  ['ACME-144', 'Replace status polling with server-sent events', 'todo', 'story', 'EPIC-05', S20, 8, 'ana-marin', 2, ['api'], []],
  ['ACME-146', 'Make audit log retention configurable', 'todo', 'chore', 'EPIC-04', S20, 2, 'yuki-tanabe', 3, ['compliance'], []],

  // ── Doing ─────────────────────────────────────────────────────────────────
  ['ACME-131', 'Partial captures do not reconcile against the ledger', 'doing', 'bug', 'EPIC-01', S20, 5, 'lise-okafor', 0, ['ledger', 'bug'], []],
  ['ACME-142', 'Surface p99 latency per merchant', 'doing', 'story', 'EPIC-03', S20, 3, 'marco-diaz', 1, ['observability'], []],
  ['ACME-145', 'Sandbox: simulate 3-D Secure challenge flows', 'doing', 'story', 'EPIC-05', S20, 5, 'ana-marin', 2, ['sandbox'], []],

  // ── Review ────────────────────────────────────────────────────────────────
  ['ACME-137', 'Validate IBAN checksum before submission', 'review', 'bug', 'EPIC-01', S20, 2, 'lise-okafor', 0, ['validation', 'bug'], []],
  ['ACME-139', 'Bulk assign issues from the board', 'review', 'story', 'EPIC-02', S20, 3, 'priya-raman', 3, ['dashboard'], ['ACME-143']],

  // ── Closed in the previous sprint ─────────────────────────────────────────
  ['ACME-120', 'Rotate API keys without downtime', 'done', 'story', 'EPIC-05', S19, 5, 'ana-marin', 1, ['api'], []],
  ['ACME-122', 'Verify settlement file checksums nightly', 'done', 'story', 'EPIC-03', S19, 3, 'marco-diaz', 2, ['reliability'], []],
  ['ACME-125', 'Notify merchants when KYC status changes', 'done', 'story', 'EPIC-02', S19, 3, 'priya-raman', 2, ['onboarding'], []],
  ['ACME-128', 'Document the webhook signature scheme', 'done', 'chore', 'EPIC-05', S19, 1, 'tobias-rehn', 3, ['docs'], []],
  ['ACME-130', 'Timezone drift in the daily payout cutoff', 'done', 'bug', 'EPIC-01', S19, 2, 'lise-okafor', 0, ['bug'], []],
  ['ACME-134', 'Reduce cold start of the pricing service', 'done', 'chore', 'EPIC-03', S19, 3, 'yuki-tanabe', 3, ['performance'], []],
  ['ACME-135', 'Export PCI evidence for the auditor', 'done', 'story', 'EPIC-04', S19, 5, 'lise-okafor', 2, ['compliance'], []],

  // ── Already finished in the running sprint ────────────────────────────────
  ['ACME-147', 'Emit delivery-attempt metrics from the webhook worker', 'done', 'story', 'EPIC-03', S20, 3, 'marco-diaz', 1, ['observability', 'reliability'], []],
  ['ACME-148', 'Document the idempotency key header', 'done', 'chore', 'EPIC-05', S20, 2, 'tobias-rehn', 2, ['docs', 'api'], []],
]

const BODIES: Record<string, string> = {
  'ACME-140': `## Context

Webhook consumers see duplicate deliveries when a 5xx is followed by a slow
recovery, and permanent failures vanish without a trace. Delivery needs bounded
retries with an idempotency key the consumer can deduplicate on.

## Acceptance criteria

- [ ] Retry at 1s, 8s, 60s, then dead-letter
- [ ] Every attempt carries a stable \`Idempotency-Key\`
- [ ] Duplicate deliveries drop below 0.01%
- [ ] Dead-lettered events are visible in the merchant dashboard

## Notes

Consumers that have not opted into signed payloads keep the old single-shot
behaviour for one release.`,
  'ACME-131': `## Context

A partial capture writes the captured amount to the ledger but leaves the
authorisation row on its original amount, so reconciliation reports a phantom
balance on every partial capture.

## Steps to reproduce

1. Authorise 100.00 EUR
2. Capture 40.00 EUR
3. Run \`ledger reconcile --date today\`

Expected a clean run; got a 60.00 EUR discrepancy.

## Acceptance criteria

- [ ] Reconciliation is clean after a partial capture
- [ ] A migration corrects historical rows
- [ ] Regression test covers capture → refund → void`,
  'ACME-143': `## Context

Onboarding is four steps and a form submit. Anything that interrupts it — a tab
close, a validation error, a slower network — sends the merchant back to step
one. Support sees this weekly.

## Acceptance criteria

- [ ] Draft state persists server-side per step
- [ ] Returning to onboarding resumes at the last incomplete step
- [ ] Drafts expire after 30 days
- [ ] "Start over" is available and confirmed`,
  'ACME-144': `## Context

The merchant dashboard polls \`/status\` every 2s per open tab. At current usage
that is 40% of our API traffic for data that changes a few times an hour.

## Acceptance criteria

- [ ] Status updates stream over SSE
- [ ] Reconnect with backoff after a dropped connection
- [ ] Polling stays available behind a flag for one release
- [ ] p99 time-to-visible-update under 1s`,
  'ACME-137': `## Context

Malformed IBANs reach the bank and come back as a generic rejection two hours
later. A local Mod-97 check catches almost all of them in milliseconds.

## Acceptance criteria

- [ ] Mod-97 validation before submission
- [ ] Field-level error naming the failing segment
- [ ] Accepted for countries outside SEPA`,
  'ACME-129': `## Context

Ledger rows are updated in place, so we cannot answer "what did this account look
like at 14:03 last Tuesday" without a snapshot table that we do not have.

## Questions to answer

- Append-only journal vs. event sourcing: where is the line worth it?
- Storage growth over 24 months at current write volume
- Migration path for existing rows, and how to keep reads fast

## Deliverable

A one-page decision record with a recommendation, cost estimate and migration
sketch.`,
  'ACME-142': `## Context

Latency regressions show up as merchant complaints before they show up in
Grafana, because our panels aggregate across all merchants.

## Acceptance criteria

- [ ] p50, p95 and p99 per merchant
- [ ] Panels split by endpoint family
- [ ] A merchant's panel is one click from their detail page`,
  'ACME-139': `## Context

Triaging a fresh backlog means assigning twenty issues one at a time.

## Acceptance criteria

- [ ] Multi-select on the board and the backlog
- [ ] Assignee and sprint set in one action
- [ ] Keyboard-only path through the flow
- [ ] Undo available for the whole batch`,
  'ACME-145': `## Context

Integrators cannot reproduce a 3-D Secure challenge locally, so every challenge
bug costs a day of staging coordination.

## Acceptance criteria

- [ ] Sandbox flag forces a challenge on a test card
- [ ] Outcomes: pass, fail, timeout, abandoned
- [ ] Sandbox-only, rejected in live mode`,
  'ACME-141': `## Context

"Payment declined" is not actionable. The processor returns a reason code we
already store and never display.

## Acceptance criteria

- [ ] Reason code column, human-readable label on hover
- [ ] Filter by reason code
- [ ] Raw code available via the API for integrators`,
  'ACME-146': `## Context

Audit log retention is a hard-coded 90 days. Two enterprise contracts require
seven years, and one requires 30 days for GDPR minimisation.

## Acceptance criteria

- [ ] Retention configurable per environment
- [ ] A scheduled job enforces it
- [ ] Changing retention writes its own audit entry`,
  'ACME-118': `## Context

A client retry after a timeout can refund twice. The refund endpoint takes no
idempotency key.

## Acceptance criteria

- [ ] \`Idempotency-Key\` header supported on \`POST /refunds\`
- [ ] Replays return the original response, not an error
- [ ] Keys expire after 24h
- [ ] Documented in the API reference`,
  'ACME-138': `## Context

When the acquirer's settlement file is late we find out from finance the next
morning.

## Acceptance criteria

- [ ] Alert if no settlement file by 06:00 local
- [ ] Alert if the file is short by more than 0.5%
- [ ] Routing to the on-call payments rotation`,
  'ACME-136': `## Context

A GDPR export currently returns disputes without their attachments, so the
export is incomplete and we are technically non-compliant.

## Acceptance criteria

- [ ] Attachments included as links valid for 30 days
- [ ] Export job reports attachment count
- [ ] PII in attachments is disclosed in the manifest`,
  'ACME-134': `## Context

The pricing service takes 11s to serve its first request after a deploy because
it loads the full rate table eagerly.

## Acceptance criteria

- [ ] Cold start under 2s
- [ ] Rate table loads per region on demand`,
  'ACME-130': `## Context

Payouts scheduled for 23:30 local were running at 00:30 for merchants in
Dublin during BST, because the cutoff used a fixed UTC offset.

## Acceptance criteria

- [ ] Cutoff computed in the merchant's timezone
- [ ] Regression test across both DST boundaries
- [ ] Historical payouts left as they are`,
  'ACME-135': `## Context

The PCI auditor asked for evidence of change control and access review for the
last 12 months. We assembled it by hand over three days.

## Acceptance criteria

- [ ] One command produces the evidence bundle
- [ ] Includes change log, access review and scan results
- [ ] Bundle is reproducible from git history`,
  'ACME-147': `## Context

We can see that deliveries fail, but not why. Every attempt should report its
outcome so the dashboard can distinguish a consumer problem from ours.

## Acceptance criteria

- [x] Attempt, outcome and latency recorded per delivery
- [x] Labelled by merchant and endpoint family
- [x] Retained for 30 days`,
  'ACME-148': `## Context

Two integrators sent duplicate refunds last month because the header was only
mentioned in a changelog entry.

## Acceptance criteria

- [x] Header documented on every mutating endpoint
- [x] Replay semantics stated explicitly
- [x] 24-hour key expiry documented`,
  'ACME-120': `## Context

Rotating a leaked API key meant a deploy, because keys were read from a file
baked into the image.

## Acceptance criteria

- [x] Keys read from the secret store at request time
- [x] Old and new keys both valid during a 24h overlap
- [x] Rotation requires no deploy`,
  'ACME-122': `## Context

Two settlement files arrived truncated in Q3 and both were processed.

## Acceptance criteria

- [x] Checksum file verified before processing
- [x] Processing halts and pages on mismatch`,
  'ACME-125': `## Context

Merchants polled KYC status for days after submitting documents.

## Acceptance criteria

- [x] \`kyc.updated\` webhook on status change
- [x] Retries follow the standard delivery policy`,
  'ACME-128': `## Context

Integrators could not verify webhook signatures from the docs alone.

## Acceptance criteria

- [x] Signed example in three languages
- [x] Timestamp tolerance documented
- [x] Rotation behaviour documented`,
  'ACME-127': `## Context

One merchant's misconfigured consumer generated 4M requests in an hour and
degraded delivery for everyone else.

## Acceptance criteria

- [ ] Per-merchant token bucket, configurable
- [ ] 429 with \`Retry-After\`
- [ ] Sustained overage notifies the merchant`,
  'ACME-121': `## Context

SEPA Instant is now mandatory for euro payouts in several markets, and our
routing only knows SEPA Credit Transfer.

## Acceptance criteria

- [ ] Instant preferred when the BIC supports it
- [ ] Automatic fallback to standard within the 10s window
- [ ] Fee difference surfaced before confirmation`,
  'ACME-124': `## Context

Test-mode and live data are visually identical, and every onboarding session
produces at least one "why is this number wrong" question.

## Acceptance criteria

- [ ] Global test-mode toggle, per session
- [ ] Chrome tint plus a persistent badge
- [ ] Never restored across logins`,
  'ACME-133': `## Context

Replaying dead-lettered webhooks meant writing a throwaway script each time.

## Acceptance criteria

- [ ] \`scrumctl webhooks replay --since <time> --filter <merchant>\`
- [ ] Dry run by default
- [ ] Reports delivered, failed and skipped counts`,
}

const EPICS: { id: string; title: string; state: Epic['state']; owner: string; target: string; color: number; description: string }[] = [
  {
    id: 'EPIC-01',
    title: 'Checkout reliability',
    state: 'active',
    owner: 'lise-okafor',
    target: '2026-12-15',
    color: 1,
    description: `Every path from authorisation to settlement should be idempotent, reconcilable and
self-explaining. If a payment fails, the merchant should be able to find out why
without asking us.

**Done means:** no phantom balances after reconciliation, refunds that cannot
double-spend, and decline reasons visible in the dashboard.`,
  },
  {
    id: 'EPIC-02',
    title: 'Merchant onboarding',
    state: 'active',
    owner: 'priya-raman',
    target: '2026-11-30',
    color: 2,
    description: `Getting a merchant from signup to first live payment in under a day.

The bottleneck is not the form, it is the interruption. Everything here is about
making the process resumable and legible.`,
  },
  {
    id: 'EPIC-03',
    title: 'Observability and alerting',
    state: 'active',
    owner: 'marco-diaz',
    target: '2026-12-01',
    color: 3,
    description: `We currently learn about problems from merchants. This epic moves detection inside
the platform, at the grain where a problem is actually diagnosable — per
merchant, per endpoint family.`,
  },
  {
    id: 'EPIC-04',
    title: 'Compliance and reporting',
    state: 'planned',
    owner: 'yuki-tanabe',
    target: '2027-03-31',
    color: 4,
    description: `Audit, GDPR and PCI obligations, handled as products rather than as an annual
scramble. Evidence should be reproducible from git history.`,
  },
  {
    id: 'EPIC-05',
    title: 'Developer experience',
    state: 'active',
    owner: 'ana-marin',
    target: '2027-01-15',
    color: 5,
    description: `The API and the sandbox are the product for anyone integrating with us. Reduce
the number of round trips between "I want to try this" and "it worked".`,
  },
]

const SPRINTS: { id: string; name: string; state: Sprint['state']; goal: string; start: string; end: string; capacity: number; wipSoft?: number | null; wipHard?: number | null; notes: string }[] = [
  {
    id: S20,
    name: 'Sprint 20',
    state: 'active',
    goal: 'Make webhook delivery trustworthy end to end.',
    start: '2026-10-15',
    end: '2026-10-28',
    capacity: 34,
    wipSoft: 6,
    wipHard: 8,
    notes: `## Working agreements

- Wednesday is integration day; no new branches after 15:00
- Anything blocked for two days goes back to the backlog at standup
- Lise is on-call, so pair on ledger work rather than assigning it to her solo

## Carry-over

Two items came in half-finished from Sprint 19 and were deliberately not
re-opened: \`ACME-131\` and \`ACME-142\`.`,
  },
  {
    id: S19,
    name: 'Sprint 19',
    state: 'closed',
    goal: 'Close every known reconciliation gap before the auditor arrives.',
    start: '2026-10-01',
    end: '2026-10-14',
    capacity: 30,
    notes: `## Retro

**Keep** — splitting bug work from feature work on the board; the WIP limit on
Doing finally held for a full sprint.

**Drop** — estimating in half-points. Nobody agreed on what a half was.

**Try** — writing the acceptance criteria before the estimate. Four of seven
items would not have been started had we done this.

Committed 22 points, delivered 21. The one miss (\`ACME-135\`) needed the auditor's
clarification and was not ours to unblock.`,
  },
]

/**
 * Dates are relative to today so the demo always looks like a project that is
 * being worked on: in-flight items were touched this week, closed items were
 * touched during their sprint, and the backlog has been sitting a while.
 */
function daysAgo(days: number): string {
  const now = new Date()
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return new Date(midnight - days * 86_400_000).toISOString().slice(0, 10)
}

export function buildDemoIssues(): Issue[] {
  const counts = new Map<Status, number>()
  const clock = { doneThisSprint: 0, doneLastSprint: 0, inFlight: 0, backlog: 0 }

  return ROWS.map((row) => {
    const [id, title, status, type, epic, sprint, points, assignee, priority, labels, blockedBy] = row
    const seen = counts.get(status) ?? 0
    counts.set(status, seen + 1)

    let updatedDaysAgo: number
    if (status === 'done' && sprint === S20) {
      updatedDaysAgo = clock.doneThisSprint++ === 0 ? 0 : 1
    } else if (status === 'done') {
      updatedDaysAgo = 4 + clock.doneLastSprint++ * 2
    } else if (sprint !== null) {
      updatedDaysAgo = 1 + ((clock.inFlight++ * 4) % 9)
    } else {
      updatedDaysAgo = 15 + clock.backlog++ * 5
    }

    // Lead time tracks the estimate, which is what a real backlog looks like
    // and gives the flow metrics something honest to average.
    const leadDays = 2 + (points ?? 1)
    const created = daysAgo(updatedDaysAgo + leadDays)
    const updated = daysAgo(updatedDaysAgo)

    const issue: Issue = {
      id,
      title,
      status,
      type,
      epic,
      sprint,
      points,
      assignee,
      priority,
      labels,
      blockedBy,
      links: [],
      order: seen * 10,
      created,
      updated,
      body: BODIES[id] ? `\n${BODIES[id]}\n` : '\n',
      path: null,
      extra: {},
    }
    // One issue carries foreign keys, to prove unknown front-matter survives a
    // round-trip through the editor.
    if (id === 'ACME-140') {
      issue.extra = { jira: 'ACME-2210', design_review: 'not-required' }
    }
    return issue
  })
}

export function buildDemoEpics(): Epic[] {
  return EPICS.map((e) => ({
    id: e.id,
    title: e.title,
    state: e.state,
    owner: e.owner,
    target: e.target,
    color: e.color,
    description: e.description,
    path: null,
    extra: {},
  }))
}

export function buildDemoSprints(): Sprint[] {
  return SPRINTS.map((s) => ({
    id: s.id,
    name: s.name,
    state: s.state,
    goal: s.goal,
    start: s.start,
    end: s.end,
    capacity: s.capacity,
    wipSoft: s.wipSoft ?? null,
    wipHard: s.wipHard ?? null,
    notes: s.notes,
    path: null,
    extra: {},
  }))
}

export function buildDemoFiles(): Map<string, string> {
  const base = defaultConfig()
  // The demo has enough work in flight to make WIP signals visible without
  // making the first drag in the tour hit a hard wall.
  const config = {
    ...base,
    project: 'Acme Payments Platform',
    columns: base.columns.map((column) =>
      column.id === 'doing' || column.id === 'review'
        ? {
            ...column,
            softWip: column.id === 'doing' ? 4 : 4,
            wip: column.id === 'doing' ? 6 : 6,
          }
        : column,
    ),
  }
  const files = new Map<string, string>()
  files.set(CONFIG_PATH, serializeConfig(config))
  // A plausible HEAD so the branch indicator has something real to read.
  files.set('.git/HEAD', 'ref: refs/heads/main\n')

  for (const epic of buildDemoEpics()) {
    files.set(epicPath(epic, config.dirs), serializeEpic(epic))
  }
  for (const sprint of buildDemoSprints()) {
    files.set(sprintPath(sprint, config.dirs), serializeSprint(sprint))
  }
  for (const issue of buildDemoIssues()) {
    issue.path = issuePath(issue, config.dirs)
    files.set(issue.path, serializeIssue(issue))
  }
  return files
}

const DEMO_PREF = 'demo.files'

/**
 * In-memory repo, mirrored into Dexie after every write so the demo behaves
 * like the real thing across reloads. Reset clears the mirror and reseeds.
 */
export class DemoSource implements RepoSource {
  readonly kind = 'demo'
  readonly label = 'demo://acme-payments'
  readonly capabilities = {
    canWrite: true,
    canWatch: false,
    access: 'none',
    git: 'none',
  } as const
  #files: Map<string, string>
  #flush: ReturnType<typeof setTimeout> | null = null

  constructor(files: Map<string, string>) {
    this.#files = files
  }

  static async load(): Promise<DemoSource> {
    const stored = await getPref<Record<string, string> | null>(DEMO_PREF, null)
    if (stored && Object.keys(stored).length > 0) {
      return new DemoSource(new Map(Object.entries(stored)))
    }
    return new DemoSource(buildDemoFiles())
  }

  static async reset(): Promise<DemoSource> {
    await setPref(DEMO_PREF, null)
    return new DemoSource(buildDemoFiles())
  }

  #persist(): void {
    if (this.#flush !== null) clearTimeout(this.#flush)
    this.#flush = setTimeout(() => {
      void setPref(DEMO_PREF, Object.fromEntries(this.#files))
    }, 150)
  }

  async list(): Promise<string[]> {
    return [...this.#files.keys()].filter(
      (path) => !path.split('/').some((segment) => IGNORED_DIRS.has(segment)),
    )
  }

  async read(path: string): Promise<string> {
    const text = this.#files.get(path)
    if (text === undefined) throw new Error(`Not found: ${path}`)
    return text
  }

  async write(path: string, text: string): Promise<void> {
    this.#files.set(path, text)
    this.#persist()
  }

  async remove(path: string): Promise<void> {
    this.#files.delete(path)
    this.#persist()
  }

  async exists(path: string): Promise<boolean> {
    return this.#files.has(path)
  }

  async permission(): Promise<PermissionState> {
    return 'granted'
  }

  async request(): Promise<PermissionState> {
    return 'granted'
  }
}
