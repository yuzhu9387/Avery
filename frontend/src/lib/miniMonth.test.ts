import { describe, it, expect } from 'vitest'
import { gridDays, isWeekVisibleIn } from './miniMonth'

describe('miniMonth utilities', () => {
  describe('gridDays', () => {
    it('returns exactly 42 days', () => {
      const cursor = new Date(2026, 7, 10) // Aug 10, 2026
      const days = gridDays(cursor)
      expect(days).toHaveLength(42)
    })

    it('starts on a Monday', () => {
      const cursor = new Date(2026, 7, 10) // Aug 10, 2026
      const days = gridDays(cursor)
      // Monday is day 1 in JavaScript (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
      expect(days[0].getDay()).toBe(1)
    })
  })

  describe('isWeekVisibleIn', () => {
    // Setup: August 2026 grid
    // Aug 1, 2026 is a Friday
    // So the grid starts at Monday July 27, 2026
    // Grid is: July 27 - Sep 6 (42 days)
    // Mondays in grid: July 27, Aug 3, Aug 10, Aug 17, Aug 24, Aug 31
    const cursor = new Date(2026, 7, 1) // Aug 1, 2026
    const grid = gridDays(cursor)

    it('detects week fully inside the grid', () => {
      // Aug 10, 2026 is a Monday in the middle of the grid
      const weekStart = new Date(2026, 7, 10)
      expect(isWeekVisibleIn(grid, weekStart)).toBe(true)
    })

    it('detects week entirely outside (before grid)', () => {
      // July 13, 2026 is before the grid
      const weekStart = new Date(2026, 6, 13)
      expect(isWeekVisibleIn(grid, weekStart)).toBe(false)
    })

    it('detects week entirely outside (after grid)', () => {
      // Sep 14, 2026 is after the grid
      const weekStart = new Date(2026, 8, 14)
      expect(isWeekVisibleIn(grid, weekStart)).toBe(false)
    })

    it('detects week at first row of grid', () => {
      // July 27, 2026 is the first Monday of the grid
      const weekStart = new Date(2026, 6, 27)
      expect(isWeekVisibleIn(grid, weekStart)).toBe(true)
    })

    it('detects week at last row of grid', () => {
      // Aug 31, 2026 is the last Monday of the grid
      const weekStart = new Date(2026, 7, 31)
      expect(isWeekVisibleIn(grid, weekStart)).toBe(true)
    })

    it('returns false for empty grid', () => {
      const weekStart = new Date(2026, 7, 10)
      expect(isWeekVisibleIn([], weekStart)).toBe(false)
    })
  })
})
