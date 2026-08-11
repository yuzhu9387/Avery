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

  describe('columnSpan (expansion into columns that are free at this segment\'s own time)', () => {
    it('does not expand any of three genuinely concurrent events', () => {
      const result = layoutSegments([seg(0, 60), seg(0, 60), seg(0, 60)])
      expect(result.map((r) => r.columnSpan)).toEqual([1, 1, 1])
    })

    it('expands a back-to-back pair past decoy columns that ended before they began', () => {
      // `long` spans the whole cluster and keeps it open throughout, so nothing
      // here splits into a separate cluster. `a`, `b`, `c` are all mutually
      // concurrent for a short early window (10-20), forcing 4 columns total:
      // long + the three of them. All three end well before `d` and `e` begin.
      // `d` and `e` are back-to-back with each other (200-300, 300-400) and
      // only ever overlap `long` — by the time they start, a/b/c are long gone,
      // so every column but `long`'s own should be free for them to fill.
      const long = seg(0, 1000)
      const a = seg(10, 10) // 10-20
      const b = seg(10, 10) // 10-20
      const c = seg(10, 10) // 10-20
      const d = seg(200, 100) // 200-300
      const e = seg(300, 100) // 300-400, back-to-back with d
      const result = layoutSegments([long, a, b, c, d, e])
      const [rLong, rA, rB, rC, rD, rE] = result

      expect(result.every((r) => r.columnCount === 4)).toBe(true)
      expect([rLong.columnIndex, rA.columnIndex, rB.columnIndex, rC.columnIndex]).toEqual([
        0, 1, 2, 3,
      ])
      expect(rD.columnIndex).toBe(1) // reuses a's freed column
      expect(rE.columnIndex).toBe(1) // reuses it again once d ends

      // long is genuinely overlapped by a for the entirety of a's life, so it
      // can't reach past column 1 even though a itself is short-lived.
      expect(rLong.columnSpan).toBe(1)
      // a, b, c genuinely overlap their immediate right-hand neighbour (each
      // other), so none of them expands.
      expect(rA.columnSpan).toBe(1)
      expect(rB.columnSpan).toBe(1)
      expect(rC.columnSpan).toBe(1)
      // d and e overlap nothing in columns 2 or 3 at their own time (a/b/c
      // ended at 20, long since past) — full remaining span, to the cluster's
      // last column.
      expect(rD.columnSpan).toBe(3)
      expect(rE.columnSpan).toBe(3)
    })

    it('expands into a right-hand column whose occupant only exists outside its own time range', () => {
      // x is long-lived and keeps the cluster open. y and v are concurrent
      // with x (and each other) early on (0-60 / 0-100), forcing a 3rd column.
      // z starts at 100 — exactly when v ends, so v is not overlapping it —
      // and only overlaps x. z reuses y's freed column (0); v's column (1) is
      // free for the whole of z's time, so z should reach it, but x's column
      // (2) genuinely overlaps z the entire time, so z must stop there.
      const x = seg(0, 200) // 0-200
      const y = seg(0, 60) // 0-60
      const v = seg(0, 100) // 0-100, ends exactly as z begins: not overlapping
      const z = seg(100, 50) // 100-150
      const result = layoutSegments([x, y, v, z])
      const [rX, rY, rV, rZ] = result

      expect(result.every((r) => r.columnCount === 3)).toBe(true)
      expect(rY.columnIndex).toBe(0)
      expect(rV.columnIndex).toBe(1)
      expect(rX.columnIndex).toBe(2)
      expect(rZ.columnIndex).toBe(0) // reuses y's freed column

      expect(rZ.columnSpan).toBe(2) // reaches v's column; x's blocks it there
      expect(rY.columnSpan).toBe(1) // v is right there overlapping the whole time
      expect(rV.columnSpan).toBe(1) // x is right there overlapping the whole time
      expect(rX.columnSpan).toBe(1) // already the cluster's last column
    })

    it('does not expand when the right-hand neighbour overlaps by even one pixel', () => {
      // Identical to the previous case except v now ends one pixel into z's
      // time (0-101 instead of 0-100) — a genuine, if tiny, overlap. Column
      // assignment is unaffected (z still reuses column 0), but z can no
      // longer claim column 1.
      const x = seg(0, 200) // 0-200
      const y = seg(0, 60) // 0-60
      const v = seg(0, 101) // 0-101, overlaps z's 100-150 by 1px
      const z = seg(100, 50) // 100-150
      const result = layoutSegments([x, y, v, z])
      const [, , , rZ] = result

      expect(rZ.columnIndex).toBe(0) // assignment is unchanged by the 1px shift
      expect(rZ.columnSpan).toBe(1) // but it can no longer expand into v's column
    })
  })
})
