const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export function isoToDate(iso: string | null): Date | null {
  if (!iso) return null
  const time = Date.parse(`${iso}T00:00:00Z`)
  return Number.isNaN(time) ? null : new Date(time)
}

export function addDays(iso: string, days: number): string {
  const date = isoToDate(iso)
  if (!date) return iso
  return new Date(date.getTime() + days * 86_400_000).toISOString().slice(0, 10)
}

export function daysBetween(from: string | null, to: string | null): number | null {
  const a = isoToDate(from)
  const b = isoToDate(to)
  if (!a || !b) return null
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

/** `14 Oct`, or `14 Oct 25` once the year stops being obvious. */
export function humanDate(iso: string | null): string {
  const date = isoToDate(iso)
  if (!date) return '—'
  const sameYear = date.getUTCFullYear() === new Date().getUTCFullYear()
  const base = `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`
  return sameYear ? base : `${base} ${String(date.getUTCFullYear()).slice(2)}`
}

export function dayMonth(iso: string | null): string {
  const date = isoToDate(iso)
  if (!date) return '—'
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`
}

export function relativeTime(at: number | null): string {
  if (!at) return '—'
  const delta = Date.now() - at
  const minutes = Math.round(delta / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.round(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.round(months / 12)}y ago`
}

/** `lise-okafor` → `Lise Okafor`. */
export function personName(handle: string): string {
  return handle
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function initials(handle: string): string {
  const parts = handle.split(/[-_.\s]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

/** Deterministic hue so the same person keeps the same colour everywhere. */
export function personHue(handle: string): number {
  let h = 0
  for (let i = 0; i < handle.length; i++) h = (h * 31 + handle.charCodeAt(i)) % 8
  return h + 1
}

export function plural(count: number, word: string, suffix = 's'): string {
  return `${count} ${word}${count === 1 ? '' : suffix}`
}

export function pointsLabel(points: number | null): string {
  if (points === null) return '–'
  return Number.isInteger(points) ? String(points) : points.toFixed(1)
}

export function sumPoints(items: { points: number | null }[]): number {
  return items.reduce((total, item) => total + (item.points ?? 0), 0)
}

export function bytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
