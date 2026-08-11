import { describe, expect, it } from 'vitest'

import { buildCells, daysInMonth, leadingBlanks } from './monthGrid'

const march2026 = new Date(2026, 2, 1) // a Sunday
const august2026 = new Date(2026, 7, 1) // a Saturday
const february2026 = new Date(2026, 1, 1) // a Sunday, 28 days
const february2024 = new Date(2024, 1, 1) // a leap February

describe('leadingBlanks', () => {
  it('pads a Sunday-starting month with a full six days', () => {
    // The remap exists for exactly this month: getDay() is 0, and treating that
    // as "no padding" would put the 1st under Monday and shift the whole grid.
    expect(leadingBlanks(march2026)).toBe(6)
    expect(leadingBlanks(february2026)).toBe(6)
  })

  it('does not pad a Monday-starting month', () => {
    expect(leadingBlanks(new Date(2026, 5, 1))).toBe(0) // 1 June 2026 is a Monday
  })

  it('pads a Saturday-starting month with five days', () => {
    expect(leadingBlanks(august2026)).toBe(5)
  })
})

describe('daysInMonth', () => {
  it('counts a leap February', () => {
    expect(daysInMonth(february2024)).toBe(29)
    expect(daysInMonth(february2026)).toBe(28)
  })

  it('counts 30- and 31-day months', () => {
    expect(daysInMonth(new Date(2026, 3, 1))).toBe(30)
    expect(daysInMonth(august2026)).toBe(31)
  })
})

describe('buildCells', () => {
  it('always returns whole weeks', () => {
    for (let m = 0; m < 12; m++) {
      const cells = buildCells(new Date(2026, m, 1))
      expect(cells.length % 7).toBe(0)
    }
  })

  it('starts on a Monday and ends on a Sunday', () => {
    const cells = buildCells(august2026)
    expect(new Date(`${cells[0].date}T00:00:00`).getDay()).toBe(1)
    expect(new Date(`${cells[cells.length - 1].date}T00:00:00`).getDay()).toBe(0)
  })

  it('pads with the neighbouring months days, not blanks', () => {
    const cells = buildCells(august2026)
    // August 2026 starts on a Saturday, so the first row runs 27 July - 2 August.
    expect(cells.slice(0, 6).map((c) => c.date)).toEqual([
      '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01',
    ])
    expect(cells.slice(0, 5).every((c) => !c.inMonth)).toBe(true)
    expect(cells[5].inMonth).toBe(true)
  })

  it('marks exactly the month own days as inMonth, in order and without gaps', () => {
    const cells = buildCells(august2026)
    const own = cells.filter((c) => c.inMonth).map((c) => c.date)
    expect(own).toHaveLength(31)
    expect(own[0]).toBe('2026-08-01')
    expect(own[30]).toBe('2026-08-31')
  })

  it('produces strictly consecutive dates with no repeats', () => {
    // A repeated or skipped date is the shape a DST bug takes: `addDays` walks by
    // calendar day precisely so that the spring-forward and fall-back days are
    // one step like any other. March and November are when that goes wrong.
    for (const monthStart of [march2026, new Date(2026, 10, 1)]) {
      const cells = buildCells(monthStart)
      expect(new Set(cells.map((c) => c.date)).size).toBe(cells.length)
      for (let i = 1; i < cells.length; i++) {
        const prev = new Date(`${cells[i - 1].date}T12:00:00`)
        const cur = new Date(`${cells[i].date}T12:00:00`)
        const gapDays = Math.round((cur.getTime() - prev.getTime()) / 86_400_000)
        expect(gapDays).toBe(1)
      }
    }
  })

  it('covers a Sunday-starting month without losing its first day', () => {
    const cells = buildCells(march2026)
    expect(cells[6].date).toBe('2026-03-01')
    expect(cells[6].inMonth).toBe(true)
  })
})
