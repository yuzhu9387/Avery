import { describe, expect, it } from 'vitest'

import { resolveDrag } from './drag'

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
