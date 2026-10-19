import type { ComponentChildren, JSX } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { initials, personHue, pointsLabel } from '../lib/format.ts'
import { IconChevronDown, IconX } from './icons.tsx'

export type Tone = 'neutral' | 'accent' | 'signal' | 'ok' | 'warn'

/** Anything hue-tinted goes through here so the token wiring stays in one place. */
export function tintStyle(hue: number): JSX.CSSProperties {
  return { '--tint': `var(--e${hue})` } as JSX.CSSProperties
}

export function statusStyle(status: string): JSX.CSSProperties {
  return { '--tint': `var(--st-${status})` } as JSX.CSSProperties
}

/* ------------------------------------------------------------------ controls */

interface BtnProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  icon?: boolean
  children?: ComponentChildren
}

export function Btn({ variant = 'default', icon = false, class: cls, ...rest }: BtnProps) {
  const variantClass =
    variant === 'primary'
      ? 'btn-primary'
      : variant === 'ghost'
        ? 'btn-ghost'
        : variant === 'danger'
          ? 'btn-danger'
          : ''
  const classes = ['btn', variantClass, icon ? 'btn-icon' : '', cls ?? '']
    .filter(Boolean)
    .join(' ')
  return <button type="button" {...rest} class={classes} />
}

export function Kbd({ children }: { children: ComponentChildren }) {
  return (
    <kbd class="inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-sm border border-line-2 bg-panel-2 px-1 text-[10px] font-medium text-ink-3">
      {children}
    </kbd>
  )
}

export function Chip({
  children,
  tint,
  class: cls,
  title,
}: {
  children: ComponentChildren
  tint?: number | string
  class?: string
  title?: string
}) {
  const style =
    tint === undefined
      ? undefined
      : typeof tint === 'number'
        ? tintStyle(tint)
        : statusStyle(tint)
  return (
    <span class={`chip ${tint !== undefined ? 'chip-tint' : ''} ${cls ?? ''}`} style={style} title={title}>
      {children}
    </span>
  )
}

export function Swatch({ hue }: { hue: number }) {
  return <span class="swatch" style={tintStyle(hue)} />
}

export function Avatar({ handle, size = 18 }: { handle: string | null; size?: number }) {
  if (!handle) return null
  const hue = personHue(handle)
  return (
    <span
      class="inline-flex shrink-0 items-center justify-center rounded-sm font-medium"
      style={{
        ...tintStyle(hue),
        width: `${size}px`,
        height: `${size}px`,
        fontSize: `${Math.round(size * 0.44)}px`,
        background: 'color-mix(in oklab, var(--tint) 16%, transparent)',
        border: '1px solid color-mix(in oklab, var(--tint) 42%, transparent)',
        color: 'color-mix(in oklab, var(--tint) 82%, var(--ink))',
      }}
      title={handle}
    >
      {initials(handle)}
    </span>
  )
}

export function Pts({ value, class: cls }: { value: number | null; class?: string }) {
  if (value === null) {
    return (
      <span class={`num text-[11px] text-ink-4 ${cls ?? ''}`} title="Not estimated">
        ·
      </span>
    )
  }
  return (
    <span
      class={`num inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-sm bg-panel-3 px-1 text-[11px] text-ink-2 ${cls ?? ''}`}
      title={`${pointsLabel(value)} points`}
    >
      {pointsLabel(value)}
    </span>
  )
}

export function StatusDot({ status }: { status: string }) {
  return (
    <span
      class="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
      style={{ background: `var(--st-${status})` }}
    />
  )
}

export function Progress({
  value,
  tone = 'accent',
  height = 4,
  marker,
  softMarker,
}: {
  value: number
  tone?: Tone
  height?: number
  marker?: number | null
  softMarker?: number | null
}) {
  const pct = Math.round(Math.min(Math.max(value, 0), 1) * 1000) / 10
  const color =
    tone === 'signal'
      ? 'var(--signal)'
      : tone === 'ok'
        ? 'var(--ok)'
        : tone === 'warn'
          ? 'var(--warn)'
          : 'var(--accent)'
  return (
    <span
      class="relative block w-full overflow-hidden rounded-full bg-panel-3"
      style={{ height: `${height}px` }}
    >
      <span
        class="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-out"
        style={{ width: `${pct}%`, background: color }}
      />
      {softMarker !== undefined && softMarker !== null ? (
        <span
          class="absolute inset-y-0 w-px bg-warn"
          style={{ left: `${Math.min(Math.max(softMarker, 0), 1) * 100}%` }}
          title="Flexible WIP limit"
        />
      ) : null}
      {marker !== undefined && marker !== null ? (
        <span
          class="absolute inset-y-0 w-px bg-ink-4"
          style={{ left: `${Math.min(Math.max(marker, 0), 1) * 100}%` }}
          title="Committed capacity"
        />
      ) : null}
    </span>
  )
}

/* ------------------------------------------------------------------- overlay */

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 520,
}: {
  title: string
  onClose: () => void
  children: ComponentChildren
  footer?: ComponentChildren
  width?: number
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div class="fixed inset-0 z-50 flex items-start justify-center bg-[rgb(0_0_0/0.45)] pt-[12vh]">
      <div
        class="absolute inset-0"
        onClick={onClose}
        role="presentation"
      />
      <div
        class="pop relative z-10 flex max-h-[76vh] flex-col overflow-hidden"
        style={{ width: `min(${width}px, calc(100vw - 32px))` }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header class="flex shrink-0 items-center justify-between border-b border-line px-3 py-2">
          <h2 class="text-[13px] font-medium text-ink">{title}</h2>
          <Btn variant="ghost" icon onClick={onClose} aria-label="Close">
            <IconX size={14} />
          </Btn>
        </header>
        <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3">{children}</div>
        {footer ? (
          <footer class="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-panel-2 px-3 py-2">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  )
}

/** Click-outside dropdown. Anchor-relative, no positioning library. */
export function Menu({
  label,
  children,
  align = 'left',
  class: cls,
  menuClass,
  title,
}: {
  label: ComponentChildren
  children: (close: () => void) => ComponentChildren
  align?: 'left' | 'right'
  class?: string
  menuClass?: string
  title?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div class={`relative ${cls ?? ''}`} ref={ref}>
      <button
        type="button"
        class="flex h-7 w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-sm border border-transparent px-2 text-[12px] text-ink-2 hover:border-line-2 hover:bg-panel-2 hover:text-ink"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={title}
      >
        <span class="min-w-0 flex-1 truncate text-left">{label}</span>
        <IconChevronDown size={12} class="shrink-0 opacity-60" />
      </button>
      {open ? (
        <div
          class={`pop absolute z-40 mt-1 min-w-[190px] overflow-y-auto p-1 ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${menuClass ?? ''}`}
          style={{ maxHeight: '340px' }}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  )
}

export function MenuItem({
  children,
  onClick,
  selected = false,
  disabled = false,
  hint,
}: {
  children: ComponentChildren
  onClick: () => void
  selected?: boolean
  disabled?: boolean
  hint?: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      class={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] disabled:opacity-40 ${
        selected ? 'bg-accent-soft text-ink' : 'text-ink-2 hover:bg-panel-2 hover:text-ink'
      }`}
    >
      <span class="min-w-0 flex-1 truncate">{children}</span>
      {hint ? <span class="num shrink-0 text-[11px] text-ink-4">{hint}</span> : null}
      {selected ? <span class="shrink-0 text-[11px] text-accent">●</span> : null}
    </button>
  )
}


/**
 * A textarea that grows to its content. Titles, goals and epic descriptions are
 * one to three lines and should never make the reader guess where the rest of
 * the sentence went.
 */
export function AutoTextarea({
  value,
  onInput,
  class: cls,
  rows = 1,
  ...rest
}: {
  value: string
  onInput: (value: string) => void
  rows?: number
} & Omit<JSX.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onInput'>) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    if (element.offsetParent === null) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  })

  return (
    <textarea
      {...rest}
      ref={ref}
      rows={rows}
      class={cls}
      value={value}
      onInput={(event) => onInput(event.currentTarget.value)}
    />
  )
}
