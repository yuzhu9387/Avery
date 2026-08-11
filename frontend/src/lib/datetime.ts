const pad = (n: number) => String(n).padStart(2, '0')

/**
 * The backend speaks naive local time. `toISOString()` converts to UTC and would
 * shift every timestamp by the machine's offset, so it is never used here.
 */
export function formatLocal(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  )
}

export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Parses `YYYY-MM-DDTHH:MM:SS` as local wall-clock, not UTC. */
export function parseLocal(s: string): Date {
  const [datePart, timePart = '00:00:00'] = s.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh, mm, ss] = timePart.split(':').map(Number)
  return new Date(y, m - 1, d, hh, mm, ss || 0)
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

/** ISO weeks start Monday. `getDay()` returns 0 for Sunday, hence the remap. */
export function mondayOf(d: Date): Date {
  const iso = d.getDay() === 0 ? 7 : d.getDay()
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  out.setDate(out.getDate() - (iso - 1))
  return out
}

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

export function formatTimeRange(startAt: string, endAt: string): string {
  const s = parseLocal(startAt)
  const e = parseLocal(endAt)
  return `${pad(s.getHours())}:${pad(s.getMinutes())}–${pad(e.getHours())}:${pad(e.getMinutes())}`
}

/**
 * Turns a calendar day plus start/end minutes-since-midnight into naive local
 * `start_at`/`end_at` strings, ready for `updateEvent`.
 *
 * An end at or before the start reads as crossing midnight — the same convention
 * `QuickCreatePopover`'s `submit` uses for a block like 23:00-01:00 — so the end is
 * rolled onto the following day here, before the request goes out. The backend's
 * `EventUpdate` validator rejects `end_at <= start_at` outright; sending the wrap
 * as two same-day instants would fail that check, so the wrap must be resolved
 * client-side rather than sent as-is.
 *
 * Only the calendar date of `day` is used — any time-of-day it carries (e.g. when
 * it comes from `parseLocal(event.start_at)`) is discarded in favor of midnight.
 */
export function resolveDayTimeRange(
  day: Date,
  startMinutes: number,
  endMinutes: number,
): { start_at: string; end_at: string } {
  const midnight = new Date(day.getFullYear(), day.getMonth(), day.getDate())
  const start = new Date(midnight.getTime() + startMinutes * 60000)
  const end =
    endMinutes > startMinutes
      ? new Date(midnight.getTime() + endMinutes * 60000)
      : new Date(addDays(midnight, 1).getTime() + endMinutes * 60000)
  return { start_at: formatLocal(start), end_at: formatLocal(end) }
}
