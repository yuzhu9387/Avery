import { describe, expect, it } from 'vitest'

import { layoutSegments } from './overlap'
import type { Segment } from './geometry'

/** Builds a minimal Segment for a single day, varying only the pixel span that
 *  `layoutSegments` cares about. dayIndex/isStart/isEnd are irrelevant to the
 *  algorithm but kept realistic. */
const seg = (topPx: number, heightPx: number): Segment => ({
  dayIndex: 0,
  topPx,
  heightPx,
  isStart: true,
  isEnd: true,
})

describe('layoutSegments', () => {
  it('gives a single segment the whole column', () => {
    const [a] = layoutSegments([seg(0, 60)])
    expect(a.columnIndex).toBe(0)
    expect(a.columnCount).toBe(1)
  })

  it('splits two fully-overlapping events into columns 0 and 1', () => {
    const [a, b] = layoutSegments([seg(0, 60), seg(0, 60)])
    expect(a.columnCount).toBe(2)
    expect(b.columnCount).toBe(2)
    expect(new Set([a.columnIndex, b.columnIndex])).toEqual(new Set([0, 1]))
  })

  it('splits three concurrent events into columns 0, 1, 2', () => {
    const result = layoutSegments([seg(0, 60), seg(0, 60), seg(0, 60)])
    expect(result.map((r) => r.columnCount)).toEqual([3, 3, 3])
    expect(new Set(result.map((r) => r.columnIndex))).toEqual(new Set([0, 1, 2]))
  })

  it('treats a transitive chain (A-B overlap, B-C overlap, A-C do not) as one cluster', () => {
    // A: 0-60, B: 30-90, C: 60-120. A and C touch only at the boundary (not
    // overlapping each other), but both overlap B, so all three share a cluster.
    // No instant has all three active at once (A ends exactly as C starts), so
    // the cluster's true peak concurrency — and hence every member's
    // columnCount — is 2, not 3. The point of this test is that it is one
    // shared number: A and C do not silently widen to full-column while B alone
    // is squeezed into a third of the space.
    const a = seg(0, 60)
    const b = seg(30, 60) // 30-90
    const c = seg(60, 60) // 60-120
    const result = layoutSegments([a, b, c])
    expect(result.every((r) => r.columnCount === 2)).toBe(true)
    // B genuinely overlaps both, so it must not share a column with either.
    const [ra, rb, rc] = result
    expect(rb.columnIndex).not.toBe(ra.columnIndex)
    expect(rb.columnIndex).not.toBe(rc.columnIndex)
  })

  it('does not treat back-to-back events (one ends exactly where the next starts) as overlapping', () => {
    const result = layoutSegments([seg(0, 60), seg(60, 60)])
    expect(result[0].columnIndex).toBe(0)
    expect(result[0].columnCount).toBe(1)
    expect(result[1].columnIndex).toBe(0)
    expect(result[1].columnCount).toBe(1)
  })

  it('lets two sequential short events share a column inside a long containing event', () => {
    // Long event spans 0-120. Two short ones, 0-60 and 60-120, are back-to-back
    // with each other but each overlaps the long one.
    const long = seg(0, 120)
    const short1 = seg(0, 60)
    const short2 = seg(60, 60)
    const result = layoutSegments([long, short1, short2])
    expect(result.every((r) => r.columnCount === 2)).toBe(true)
    const [rLong, rShort1, rShort2] = result
    expect(rShort1.columnIndex).toBe(rShort2.columnIndex)
    expect(rLong.columnIndex).not.toBe(rShort1.columnIndex)
  })

  it('closes a cluster and starts a fresh one once the active set empties', () => {
    // Two unrelated overlapping pairs, far apart in time.
    const result = layoutSegments([seg(0, 60), seg(0, 60), seg(200, 60), seg(200, 60)])
    expect(result.map((r) => r.columnCount)).toEqual([2, 2, 2, 2])
  })

  it('does not mutate the input segments', () => {
    const input = [seg(0, 60), seg(0, 60)]
    const snapshot = input.map((s) => ({ ...s }))
    layoutSegments(input)
    expect(input).toEqual(snapshot)
    expect('columnIndex' in input[0]).toBe(false)
  })

  it('returns an empty array for an empty day', () => {
    expect(layoutSegments([])).toEqual([])
  })
})
