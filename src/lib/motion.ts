// The mini entry, not the full DOM runtime: scrumit animates opacity and
// transform on a handful of elements, and nothing else it offers is needed.
import { animate } from 'motion/mini'

/**
 * Motion with a narrow remit. Everything here answers something the user just
 * did, or marks the one moment where the screen changes wholesale (a view
 * opening). Nothing loops, nothing decorates.
 */

function reduced(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

const EASE = [0.22, 0.8, 0.24, 1] as const

/** Columns and rows arriving at once, offset so the eye reads them in order. */
export function enterStagger(elements: Element[], step = 0.045, distance = 8): void {
  if (reduced()) return
  elements.forEach((element, index) => {
    animate(
      element,
      { opacity: [0, 1], transform: [`translateY(${distance}px)`, 'translateY(0px)'] },
      { duration: 0.32, delay: index * step, ease: EASE },
    )
  })
}

/** A panel or drawer taking the stage. */
export function enterPanel(element: Element): void {
  if (reduced()) return
  animate(
    element,
    { opacity: [0, 1], transform: ['translateX(16px)', 'translateX(0px)'] },
    { duration: 0.26, ease: EASE },
  )
}

/** A line drawn under the column a card just landed in. */
export function sweep(element: Element): void {
  if (reduced()) return
  animate(
    element,
    { transform: ['scaleX(0)', 'scaleX(1)'], opacity: [1, 1, 0] },
    { duration: 0.75, ease: 'easeOut' },
  )
}

/** A card being placed. */
export function settle(element: Element): void {
  if (reduced()) return
  animate(
    element,
    { transform: ['scale(1.02)', 'scale(1)'] },
    { duration: 0.2, ease: 'easeOut' },
  )
}
