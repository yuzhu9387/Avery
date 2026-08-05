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
