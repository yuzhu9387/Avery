import { addDays, formatDate } from './datetime'

export interface MonthCell {
  date: string
  /** False for the neighbouring months' days that pad the first and last rows. */
  inMonth: boolean
}

/** Day 0 of the next month is the last day of this one. */
export function daysInMonth(monthStart: Date): number {
  return new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate()
}

/** ISO weeks (and this grid) start Monday. `getDay()` returns 0 for Sunday,
 *  hence the remap — the same one `mondayOf` in datetime.ts uses. */
export function leadingBlanks(monthStart: Date): number {
  const day = monthStart.getDay()
  return (day === 0 ? 7 : day) - 1
}

/**
 * The 7-column month grid as a flat list of real days.
 *
 * Computed from the month alone, deliberately independent of the server's month
 * payload: the events query is keyed on this range, and deriving the range from
 * fetched data instead would fire it once against an empty range and again on
 * arrival, caching a blank month under the first key for `staleTime`.
 *
 * The leading and trailing cells are the neighbouring months' days rather than
 * blanks. With a fixed cell height, empty corner cells read as a broken grid,
 * and a card sitting on the 31st is worth seeing from either month.
 *
 * Always a whole number of weeks, so the result length is a multiple of 7.
 */
export function buildCells(monthStart: Date): MonthCell[] {
  const blanks = leadingBlanks(monthStart)
  const count = daysInMonth(monthStart)
  const trailing = (7 - ((blanks + count) % 7)) % 7
  const first = addDays(monthStart, -blanks)
  return Array.from({ length: blanks + count + trailing }, (_, i) => {
    const d = addDays(first, i)
    return { date: formatDate(d), inMonth: i >= blanks && i < blanks + count }
  })
}
