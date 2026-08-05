import { describe, expect, it } from 'vitest'

import { parseLocal } from './datetime'
import { GRID, pxToMinutes, minutesToPx, segmentsForEvent, snapMinutes } from './geometry'

const week = new Date(2026, 7, 3) // Monday 2026-08-03

const seg = (startAt: string, endAt: string) =>
  segmentsForEvent(parseLocal(startAt), parseLocal(endAt), week)

describe('snapping', () => {
  it('snaps to the nearest 15 minutes', () => {
    expect(snapMinutes(0)).toBe(0)
    expect(snapMinutes(7)).toBe(0)
    expect(snapMinutes(8)).toBe(15)
    expect(snapMinutes(22)).toBe(15)
    expect(snapMinutes(23)).toBe(30)
    expect(snapMinutes(-8)).toBe(-15)
  })
})

describe('pixel conversion', () => {
  it('round-trips through minutes', () => {
    expect(pxToMinutes(minutesToPx(90))).toBeCloseTo(90)
  })

  it('measures an hour as PX_PER_HOUR', () => {
    expect(minutesToPx(60)).toBe(GRID.pxPerHour)
  })
})

describe('segmentsForEvent', () => {
  it('places a simple same-day event in one column', () => {
    const s = seg('2026-08-03T09:30:00', '2026-08-03T16:30:00')
    expect(s).toHaveLength(1)
    expect(s[0].dayIndex).toBe(0)
    expect(s[0].topPx).toBe(minutesToPx((9.5 - GRID.startHour) * 60))
    expect(s[0].heightPx).toBe(minutesToPx(7 * 60))
    expect(s[0].isStart && s[0].isEnd).toBe(true)
  })

  it('splits an overnight block and drops the off-grid small hours', () => {
    // 23:00 Mon -> 07:00 Tue. The grid runs 06:00-24:00, so Monday shows 23:00-24:00
    // and Tuesday shows 06:00-07:00; 00:00-06:00 Tuesday is outside the grid.
    const s = seg('2026-08-03T23:00:00', '2026-08-04T07:00:00')
    expect(s).toHaveLength(2)

    expect(s[0].dayIndex).toBe(0)
    expect(s[0].heightPx).toBe(minutesToPx(60))
    expect(s[0].isStart).toBe(true)
    expect(s[0].isEnd).toBe(false)

    expect(s[1].dayIndex).toBe(1)
    expect(s[1].topPx).toBe(0)
    expect(s[1].heightPx).toBe(minutesToPx(60))
    expect(s[1].isStart).toBe(false)
    expect(s[1].isEnd).toBe(true)
  })

  it('clips an event that starts before the grid floor', () => {
    const s = seg('2026-08-03T04:00:00', '2026-08-03T07:00:00')
    expect(s).toHaveLength(1)
    expect(s[0].topPx).toBe(0)
    expect(s[0].heightPx).toBe(minutesToPx(60))
    expect(s[0].isStart).toBe(false)
  })

  it('returns nothing for an event entirely inside the off-grid hours', () => {
    expect(seg('2026-08-03T01:00:00', '2026-08-03T05:00:00')).toEqual([])
  })

  it('returns nothing for an event outside the week', () => {
    expect(seg('2026-08-11T09:00:00', '2026-08-11T10:00:00')).toEqual([])
    expect(seg('2026-08-02T09:00:00', '2026-08-02T10:00:00')).toEqual([])
  })

  it('covers a multi-day event on every day it touches', () => {
    const s = seg('2026-08-03T22:00:00', '2026-08-06T08:00:00')
    expect(s.map((x) => x.dayIndex)).toEqual([0, 1, 2, 3])
    expect(s[1].heightPx).toBe(minutesToPx((24 - GRID.startHour) * 60))
  })

  it('gives a very short event the minimum legible height', () => {
    const s = seg('2026-08-03T09:00:00', '2026-08-03T09:05:00')
    expect(s[0].heightPx).toBe(GRID.minBlockPx)
  })
})
