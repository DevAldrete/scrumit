/**
 * Text helpers that run everywhere, with no dependencies. Markdown rendering
 * lives in `render.ts` and is loaded on demand: it pulls in a parser and a
 * sanitiser, and neither is needed until someone opens a preview.
 */

/** Strip markdown to a plain one-liner, for previews and search results. */
export function plainExcerpt(text: string, max = 160): string {
  const stripped = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+\[[ xX]\]\s*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/[*_`>#[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return stripped.length > max ? `${stripped.slice(0, max - 1)}…` : stripped
}

export interface ChecklistStats {
  total: number
  done: number
}

/** Acceptance-criteria progress, for the card face and the editor header. */
export function checklistStats(text: string): ChecklistStats {
  const boxes = text.match(/^\s*[-*]\s+\[([ xX])\]/gm) ?? []
  const done = boxes.filter((line) => /\[[xX]\]/.test(line)).length
  return { total: boxes.length, done }
}
