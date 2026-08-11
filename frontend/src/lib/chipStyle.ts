import type { CSSProperties } from 'react'

import { tint } from './color'

/**
 * The two shapes a calendar card takes, shared by the week grid and the month
 * grid so that one card never reads as a to-do in one view and as booked time
 * in the other.
 *
 *   kind="task"  -> a to-do with a slot: light surface, thin outline, tick box
 *   kind="event" -> occupied time: filled, with a solid spine down the left
 *
 * A completed card of either kind drops its fill and keeps only its outline, so
 * a finished day reads as emptier than a full one at a glance — which is the
 * whole point of looking at a month.
 */
export function chipShape({
  color,
  isTask,
  isDone,
}: {
  color: string
  isTask: boolean
  isDone: boolean
}): CSSProperties {
  return isTask
    ? {
        background: isDone ? 'transparent' : 'var(--surface-raised)',
        border: `1px solid ${color}`,
      }
    : {
        background: isDone ? 'transparent' : tint(color, 0.22),
        borderLeft: `3px solid ${color}`,
      }
}

/** Completed cards are dimmed wherever they appear. */
export const DONE_OPACITY = 0.45
