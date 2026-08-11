import type { Segment } from './geometry'

export interface LaidOutSegment extends Segment {
  /** Which of `columnCount` equal-width slots this segment sits in, 0-based. */
  columnIndex: number
  /** The width of this segment's cluster, in columns. Segments in unrelated
   *  clusters (no shared time) never affect each other's count. */
  columnCount: number
  /**
   * How many consecutive columns, starting at `columnIndex`, this segment
   * actually draws across. Always at least 1, and at most `columnCount -
   * columnIndex`. A card only reaches into a column to its right if nothing
   * placed there genuinely overlaps it in time — a cluster-mate merely sharing
   * the cluster is not enough, since that neighbour might occupy the same
   * column at a completely different hour. This is what stops a single
   * all-day event from squeezing every other card on the day down to
   * `1/columnCount` width regardless of whether they actually conflict with
   * each other.
   */
  columnSpan: number
}

/**
 * Lay a single day's segments out side by side so overlapping events don't draw on
 * top of one another. Works entirely in the pixel space `Segment` already carries
 * (`topPx`, `topPx + heightPx`) — there is no separate minutes representation here.
 *
 * Columns are assigned per *cluster*, not globally across the whole day. A cluster
 * is a maximal run of transitively-overlapping segments: if A overlaps B and B
 * overlaps C, but A and C do not touch each other, all three still share one
 * cluster and get the *same* `columnCount` — the cluster's peak concurrency,
 * which for a plain A-B-C chain like that is 2 (A and C, never being active at
 * the same instant, end up sharing a column once A's is reclaimed). What matters
 * is that all three carry that one shared number: otherwise A and C could
 * silently render full-width while B alone was squeezed, which reads as a
 * layout bug even though each pairwise overlap was handled correctly.
 *
 * Standard sweep: sort by start then end, walk keeping the set of segments still
 * "active" (started, not yet ended), and hand each new segment the lowest column
 * index not currently occupied. Two segments where one ends exactly when the other
 * begins are back-to-back, not overlapping — a segment stops being active as soon
 * as the sweep reaches its end point, so the newly-starting segment at that same
 * point is free to reuse column 0. When the active set empties, the cluster that
 * was building closes and every member is stamped with the max concurrency it
 * reached; a fresh cluster starts with the next segment.
 *
 * `columnCount` alone is not enough to size a card: a single long background
 * event (say, a 7-hour work block) can pull an entire day's worth of otherwise
 * unrelated short events into one cluster, and every member would render at
 * `1/columnCount` even though most of them never conflict with each other —
 * legible cards become unreadable slivers. So after column *assignment* is
 * settled for a cluster, a second pass computes `columnSpan`: each segment
 * walks rightward from its own column through its cluster-mates' columns,
 * stopping at (not including) the first column holding a segment that
 * genuinely overlaps it in time. A column can be shared with the cluster
 * without blocking anything, provided the segment sitting there never
 * actually coincides with this one.
 *
 * Does not mutate the input.
 */
export function layoutSegments(segments: Segment[]): LaidOutSegment[] {
  if (segments.length === 0) return []

  const indexed = segments.map((segment, originalIndex) => ({ segment, originalIndex }))
  indexed.sort((a, b) => {
    if (a.segment.topPx !== b.segment.topPx) return a.segment.topPx - b.segment.topPx
    const aEnd = a.segment.topPx + a.segment.heightPx
    const bEnd = b.segment.topPx + b.segment.heightPx
    return aEnd - bEnd
  })

  const columnIndexByOriginal = new Map<number, number>()
  const columnCountByOriginal = new Map<number, number>()
  const columnSpanByOriginal = new Map<number, number>()
  const clusterMembers: number[] = []
  // Active segments, each recorded as [endPx, columnIndex]. Cleared out (by end
  // point) as the sweep passes them.
  let active: { endPx: number; columnIndex: number }[] = []
  let clusterMaxConcurrency = 0

  // Two segments genuinely overlap (as opposed to merely sharing a cluster)
  // when their pixel ranges intersect with positive measure — touching at a
  // single point is back-to-back, not overlap, matching the sweep above.
  const timeOverlaps = (a: Segment, b: Segment) =>
    a.topPx < b.topPx + b.heightPx && b.topPx < a.topPx + a.heightPx

  const flushCluster = () => {
    const clusterCount = clusterMaxConcurrency
    for (const originalIndex of clusterMembers) {
      columnCountByOriginal.set(originalIndex, clusterCount)
    }

    // Bucket this cluster's members by the column they landed in, so the
    // expansion pass below can ask "does anything in column N overlap me?"
    // without rescanning the whole cluster for every segment.
    const columns: Segment[][] = Array.from({ length: clusterCount }, () => [])
    for (const originalIndex of clusterMembers) {
      const ci = columnIndexByOriginal.get(originalIndex)!
      columns[ci].push(segments[originalIndex])
    }

    for (const originalIndex of clusterMembers) {
      const ci = columnIndexByOriginal.get(originalIndex)!
      const mySegment = segments[originalIndex]
      let span = 1
      for (let col = ci + 1; col < clusterCount; col += 1) {
        const blocked = columns[col].some((other) => timeOverlaps(mySegment, other))
        if (blocked) break
        span += 1
      }
      columnSpanByOriginal.set(originalIndex, span)
    }

    clusterMembers.length = 0
    clusterMaxConcurrency = 0
  }

  for (const { segment, originalIndex } of indexed) {
    // Drop active segments that have already ended by (or exactly at) this
    // segment's start — back-to-back is not overlap.
    active = active.filter((a) => a.endPx > segment.topPx)

    if (active.length === 0 && clusterMembers.length > 0) {
      // The previous cluster's active set just emptied; close it out before
      // starting the new one.
      flushCluster()
    }

    const usedColumns = new Set(active.map((a) => a.columnIndex))
    let columnIndex = 0
    while (usedColumns.has(columnIndex)) columnIndex += 1

    columnIndexByOriginal.set(originalIndex, columnIndex)
    active.push({ endPx: segment.topPx + segment.heightPx, columnIndex })
    clusterMembers.push(originalIndex)
    clusterMaxConcurrency = Math.max(clusterMaxConcurrency, active.length)
  }
  flushCluster()

  return segments.map((segment, originalIndex) => ({
    ...segment,
    columnIndex: columnIndexByOriginal.get(originalIndex)!,
    columnCount: columnCountByOriginal.get(originalIndex)!,
    columnSpan: columnSpanByOriginal.get(originalIndex)!,
  }))
}
