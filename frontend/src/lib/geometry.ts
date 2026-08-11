import { addDays } from './datetime'

export const GRID = {
  /** The grid shows the full day. Nothing is off-grid: an event at 03:00 is a real
   *  event, and hiding it made the week lie about what was scheduled. */
  startHour: 0,
  endHour: 24,
  /** Pixels per hour at zoom 1. The live value is a parameter, not this constant —
   *  pinch zoom varies it, and anything that hardcodes it drags to the wrong time. */
  basePxPerHour: 56,
  /** Minimum width of a day column at zoom 1. Above zoom 1 the seven columns exceed
   *  the container and the grid scrolls horizontally. */
  baseColumnPx: 120,
  minZoom: 0.5,
  maxZoom: 3,
  slotMinutes: 15,
  /** A 5-minute event would otherwise render as a 4px sliver with unreadable text. */
  minBlockPx: 14,
} as const

export const GRID_MINUTES = (GRID.endHour - GRID.startHour) * 60

export function gridHeightPx(pxPerHour: number): number {
  return (GRID.endHour - GRID.startHour) * pxPerHour
}

export function minutesToPx(minutes: number, pxPerHour: number): number {
  return (minutes / 60) * pxPerHour
}

export function pxToMinutes(px: number, pxPerHour: number): number {
  return (px / pxPerHour) * 60
}

export function snapMinutes(minutes: number): number {
  return Math.round(minutes / GRID.slotMinutes) * GRID.slotMinutes
}

export interface Segment {
  dayIndex: number
  topPx: number
  heightPx: number
  /** False when the block is continued from the previous day, so the UI can square
   *  off that edge and omit the resize handle. */
  isStart: boolean
  isEnd: boolean
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/**
 * Break an event into the visible slices it occupies on a Mon-start week grid.
 *
 * Two things make this non-trivial and are why it is tested rather than inlined:
 * an event can cross midnight into another column, and an event can lie entirely
 * outside the week, in which case it contributes nothing.
 */
export function segmentsForEvent(
  start: Date,
  end: Date,
  weekStart: Date,
  pxPerHour: number,
): Segment[] {
  const out: Segment[] = []
  const weekBegin = startOfDay(weekStart)

  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const day = addDays(weekBegin, dayIndex)
    const visibleFrom = new Date(day)
    visibleFrom.setHours(GRID.startHour, 0, 0, 0)
    const visibleTo = new Date(day)
    visibleTo.setHours(0, 0, 0, 0)
    visibleTo.setHours(GRID.endHour, 0, 0, 0)

    const lo = start > visibleFrom ? start : visibleFrom
    const hi = end < visibleTo ? end : visibleTo
    if (hi <= lo) continue

    const topMinutes = (lo.getTime() - visibleFrom.getTime()) / 60000
    const durationMinutes = (hi.getTime() - lo.getTime()) / 60000

    out.push({
      dayIndex,
      topPx: minutesToPx(topMinutes, pxPerHour),
      heightPx: Math.max(GRID.minBlockPx, minutesToPx(durationMinutes, pxPerHour)),
      isStart: lo.getTime() === start.getTime(),
      isEnd: hi.getTime() === end.getTime(),
    })
  }

  return out
}

/** Hour labels down the gutter. */
export function hourMarks(): number[] {
  const out: number[] = []
  for (let h = GRID.startHour; h <= GRID.endHour; h += 1) out.push(h)
  return out
}
