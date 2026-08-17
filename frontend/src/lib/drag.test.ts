import { describe, expect, it } from 'vitest'

import { dayColumnDelta, resolveDrag } from './drag'

const ev = { start_at: '2026-08-03T09:00:00', end_at: '2026-08-03T10:30:00' }

describe('resolveDrag — move', () => {
  it('snaps and preserves duration', () => {
    const r = resolveDrag(ev, { kind: 'move', deltaMinutes: 22, deltaDays: 0 })
    expect(r).toEqual({ kind: 'move', start_at: '2026-08-03T09:15:00' })
  })

  it('shifts whole days', () => {
    const r = resolveDrag(ev, { kind: 'move', deltaMinutes: 0, deltaDays: 2 })
    expect(r).toEqual({ kind: 'move', start_at: '2026-08-05T09:00:00' })
  })

  it('is a no-op when nothing moved', () => {
    expect(resolveDrag(ev, { kind: 'move', deltaMinutes: 3, deltaDays: 0 })).toBeNull()
  })
})

describe('resolveDrag — resize', () => {
  it('drags the end edge later', () => {
    const r = resolveDrag(ev, { kind: 'resize', edge: 'end', deltaMinutes: 30 })
    expect(r).toEqual({ kind: 'patch', body: { end_at: '2026-08-03T11:00:00' } })
  })

  it('drags the start edge earlier', () => {
    const r = resolveDrag(ev, { kind: 'resize', edge: 'start', deltaMinutes: -60 })
    expect(r).toEqual({ kind: 'patch', body: { start_at: '2026-08-03T08:00:00' } })
  })

  it('refuses to collapse an event below one slot', () => {
    // end dragged back past start would invert it; clamp to a 15-minute floor.
    const r = resolveDrag(ev, { kind: 'resize', edge: 'end', deltaMinutes: -120 })
    expect(r).toEqual({ kind: 'patch', body: { end_at: '2026-08-03T09:15:00' } })
  })

  it('refuses to collapse from the start edge either', () => {
    const r = resolveDrag(ev, { kind: 'resize', edge: 'start', deltaMinutes: 120 })
    expect(r).toEqual({ kind: 'patch', body: { start_at: '2026-08-03T10:15:00' } })
  })

  it('preserves an overnight event when only the end moves', () => {
    const overnight = { start_at: '2026-08-03T23:00:00', end_at: '2026-08-04T07:00:00' }
    const r = resolveDrag(overnight, { kind: 'resize', edge: 'end', deltaMinutes: 60 })
    expect(r).toEqual({ kind: 'patch', body: { end_at: '2026-08-04T08:00:00' } })
  })
})

describe('dayColumnDelta', () => {
  // A 138px column starting at x=450 — the real geometry of a 7-day grid at 1280px.
  const LEFT = 450
  const W = 138

  it('stays on the same day anywhere inside the origin column', () => {
    expect(dayColumnDelta(LEFT, LEFT, W)).toBe(0)
    expect(dayColumnDelta(LEFT + 1, LEFT, W)).toBe(0)
    expect(dayColumnDelta(LEFT + W - 1, LEFT, W)).toBe(0)
  })

  it('does not depend on where inside the card the drag began', () => {
    // The bug this replaces: `Math.round((clientX - grabX) / width)` moved the event a
    // whole day for a 70px drag that never left the column, purely because the grab
    // started near the card's right edge. Landing position is all that matters now.
    expect(dayColumnDelta(LEFT + 120, LEFT, W)).toBe(0)
    expect(dayColumnDelta(LEFT + W + 4, LEFT, W)).toBe(1)
  })

  it('counts each column crossed, in both directions', () => {
    expect(dayColumnDelta(LEFT + W, LEFT, W)).toBe(1)
    expect(dayColumnDelta(LEFT + 2 * W + 10, LEFT, W)).toBe(2)
    expect(dayColumnDelta(LEFT - 1, LEFT, W)).toBe(-1)
    expect(dayColumnDelta(LEFT - W - 1, LEFT, W)).toBe(-2)
  })

  it('is a no-op when the column has no measurable width', () => {
    // An unmeasurable column would otherwise divide by zero and shift the event by
    // Infinity days, producing an Invalid Date in `resolveDrag`.
    expect(dayColumnDelta(LEFT + 500, LEFT, 0)).toBe(0)
  })
})
