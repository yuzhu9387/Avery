import { describe, expect, it } from 'vitest'

import { addDays, formatLocal, mondayOf, monthKey, parseLocal, resolveDayTimeRange } from './datetime'

describe('naive local datetimes', () => {
  it('round-trips without drifting into UTC', () => {
    const s = '2026-08-03T09:30:00'
    expect(formatLocal(parseLocal(s))).toBe(s)
  })

  it('never emits a Z or an offset', () => {
    expect(formatLocal(new Date(2026, 7, 3, 23, 0, 0))).toBe('2026-08-03T23:00:00')
  })

  it('finds the Monday of any day, including a Sunday', () => {
    expect(mondayOf(new Date(2026, 7, 5))).toEqual(new Date(2026, 7, 3)) // Wed -> Mon
    expect(mondayOf(new Date(2026, 7, 3))).toEqual(new Date(2026, 7, 3)) // Mon -> itself
    expect(mondayOf(new Date(2026, 7, 9))).toEqual(new Date(2026, 7, 3)) // Sun -> that Mon
  })

  it('adds days across a month boundary', () => {
    expect(addDays(new Date(2026, 7, 31), 1)).toEqual(new Date(2026, 8, 1))
  })

  it('formats a month key', () => {
    expect(monthKey(new Date(2026, 7, 5))).toBe('2026-08')
  })
})

describe('resolveDayTimeRange', () => {
  const day = new Date(2026, 7, 3) // a Monday

  it('keeps start and end on the same day when end is after start', () => {
    expect(resolveDayTimeRange(day, 9 * 60 + 30, 17 * 60)).toEqual({
      start_at: '2026-08-03T09:30:00',
      end_at: '2026-08-03T17:00:00',
    })
  })

  it('rolls the end onto the next day when it is before the start', () => {
    // 23:00 -> 01:00 crosses midnight, same convention as QuickCreatePopover.
    expect(resolveDayTimeRange(day, 23 * 60, 60)).toEqual({
      start_at: '2026-08-03T23:00:00',
      end_at: '2026-08-04T01:00:00',
    })
  })

  it('rolls the end onto the next day when it equals the start', () => {
    // An end "at" the start is read the same as an end before it: a full day later.
    expect(resolveDayTimeRange(day, 9 * 60, 9 * 60)).toEqual({
      start_at: '2026-08-03T09:00:00',
      end_at: '2026-08-04T09:00:00',
    })
  })

  it('is unaffected by any time-of-day already present on the day argument', () => {
    // Only the calendar date of `day` matters — resolveDayTimeRange re-anchors to
    // that day's midnight, so a `day` carrying its own hours/minutes (as
    // parseLocal(data.start_at) does) must not leak into the result.
    const dayWithTime = new Date(2026, 7, 3, 14, 45, 0)
    expect(resolveDayTimeRange(dayWithTime, 9 * 60, 10 * 60)).toEqual({
      start_at: '2026-08-03T09:00:00',
      end_at: '2026-08-03T10:00:00',
    })
  })
})
