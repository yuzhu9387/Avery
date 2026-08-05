import { addDays } from './datetime'

export const GRID = {
  /** The grid shows 06:00–24:00. Sleep before 06:00 is off-grid by design; the
   *  week view is about waking hours, and the seeded rest block ends at 07:00. */
  startHour: 6,
  endHour: 24,
  pxPerHour: 56,
  slotMinutes: 15,
  /** A 5-minute event would otherwise render as a 4px sliver with unreadable text. */
  minBlockPx: 14,
} as const

export const GRID_MINUTES = (GRID.endHour - GRID.startHour) * 60
export const GRID_HEIGHT_PX = (GRID.endHour - GRID.startHour) * GRID.pxPerHour

export function minutesToPx(minutes: number): number {
  return (minutes / 60) * GRID.pxPerHour
}

export function pxToMinutes(px: number): number {
  return (px / GRID.pxPerHour) * 60
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
 * Three things make this non-trivial and are why it is tested rather than inlined:
 * an event can cross midnight into another column; the grid floor at 06:00 means
 * part of an event may be invisible; and an event can lie entirely outside either
 * the week or the visible hours, in which case it contributes nothing.
 */
export function segmentsForEvent(start: Date, end: Date, weekStart: Date): Segment[] {
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
      topPx: minutesToPx(topMinutes),
      heightPx: Math.max(GRID.minBlockPx, minutesToPx(durationMinutes)),
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
