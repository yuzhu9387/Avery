import { describe, expect, it } from 'vitest'

import { bandColumnStyle } from './WeekGrid'

describe('bandColumnStyle', () => {
  it('returns no override for a lone band, so it keeps the plain inset-x-0 class', () => {
    expect(bandColumnStyle(0, 1, 1)).toEqual({})
  })

  it('splits two overlapping bands into equal left/right halves with a gap between', () => {
    const left = bandColumnStyle(0, 2, 1)
    const right = bandColumnStyle(1, 2, 1)
    expect(left.left).toBe('calc(0% + 0px)')
    expect(left.width).toBe('calc(50% - 1.5px)')
    expect(right.left).toBe('calc(50% + 1.5px)')
    expect(right.width).toBe('calc(50% - 1.5px)')
  })

  it('lets a band expand across columns nothing else occupies at its own time', () => {
    // Same shape as layoutSegments' columnSpan expansion: column 0 stays a single
    // slot, but a band with columnSpan 2 out of columnCount 2 should reclaim the
    // full width minus only the outer... there is no outer inset for bands, so it
    // should come out identical to a lone band's math for span 2 of 2.
    const full = bandColumnStyle(0, 2, 2)
    expect(full.left).toBe('calc(0% + 0px)')
    expect(full.width).toBe('calc(100% - 0px)')
  })

  it('splits three concurrent bands into equal thirds with gaps between neighbours', () => {
    const a = bandColumnStyle(0, 3, 1)
    const b = bandColumnStyle(1, 3, 1)
    const c = bandColumnStyle(2, 3, 1)
    expect(a.left).toBe('calc(0% + 0px)')
    expect(b.left).toBe('calc(33.33333333333333% + 1px)')
    expect(c.left).toBe('calc(66.66666666666666% + 2px)')
    // Each slot is 1/3 of the width minus its share of the two 3px gaps.
    expect(a.width).toBe('calc(33.333333333333336% - 2px)')
  })
})
