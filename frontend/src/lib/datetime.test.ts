import { describe, expect, it } from 'vitest'

import { addDays, formatLocal, mondayOf, monthKey, parseLocal } from './datetime'

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
