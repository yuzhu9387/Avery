import type { Tag } from '../api/types'

/**
 * A day's shape at a glance: one segment per primary tag, width proportional
 * to minutes. `total_minutes` can exceed the sum of the buckets — untagged
 * events count toward the total but land in no bucket — so segments are
 * scaled against `totalMinutes`, not against their own sum. The gap that
 * leaves at the end of the bar is the untagged remainder, left unfilled on
 * purpose: that's the honest rendering, not a bug to normalise away.
 */
export function DayTagBar({
  minutesByPrimaryTag,
  totalMinutes,
  tagMap,
}: {
  minutesByPrimaryTag: Record<string, number>
  totalMinutes: number
  tagMap: Map<number, Tag>
}) {
  const segments = Object.entries(minutesByPrimaryTag)
    .map(([id, minutes]) => ({ id, minutes, tag: tagMap.get(Number(id)) }))
    // Stable ordering across days comes from `sort_order`; tags missing from the
    // map (archived-and-unloaded) sink to the end rather than jumping around.
    .sort((a, b) => (a.tag?.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.tag?.sort_order ?? Number.MAX_SAFE_INTEGER))

  return (
    <div className="flex h-1 w-full overflow-hidden rounded-full" style={{ background: 'var(--line)' }}>
      {totalMinutes > 0 &&
        segments.map(({ id, minutes, tag }) => (
          <div
            key={id}
            className="h-full"
            style={{
              width: `${(minutes / totalMinutes) * 100}%`,
              // A tag id absent from the map still gets a segment — dropping it
              // would silently understate the day instead of just looking plain.
              background: tag?.color ?? 'var(--pale)',
            }}
          />
        ))}
    </div>
  )
}
