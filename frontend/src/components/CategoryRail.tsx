import type { Tag } from '../api/types'
import { formatMinutes } from '../lib/datetime'

export function CategoryRail({
  tags,
  minutesByTag,
  totalMinutes,
  hidden,
  onToggle,
}: {
  tags: Tag[]
  minutesByTag: Record<string, number>
  totalMinutes: number
  hidden: Set<number>
  onToggle: (id: number) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      {tags.map((tag) => {
        const minutes = minutesByTag[String(tag.id)] ?? 0
        const isHidden = hidden.has(tag.id)
        return (
          <button
            key={tag.id}
            type="button"
            className="text-left"
            onClick={() => onToggle(tag.id)}
            aria-pressed={!isHidden}
          >
            <div className="flex items-center gap-2">
              <span
                className="grid size-3.5 shrink-0 place-items-center rounded-[3px] text-[9px] leading-none"
                style={{
                  background: isHidden ? 'transparent' : tag.color,
                  border: `1.5px solid ${tag.color}`,
                  color: 'var(--surface-raised)',
                }}
              >
                {isHidden ? '' : '✓'}
              </span>
              <span
                className="min-w-0 flex-1 truncate text-xs font-bold"
                style={{ color: isHidden ? 'var(--ink-faint)' : 'var(--ink)' }}
              >
                {tag.name}
              </span>
              <span className="shrink-0 text-[10px] tabular-nums text-ink-faint">
                {formatMinutes(minutes)}
              </span>
            </div>
            {/* Share of the week. Scaled against the week's total, not against the sum
                of the buckets, so untagged time shows as the gap it is. */}
            <div className="mt-1 ml-5 h-1 rounded-full" style={{ background: 'var(--line)' }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: totalMinutes > 0 ? `${(minutes / totalMinutes) * 100}%` : '0%',
                  background: tag.color,
                  opacity: isHidden ? 0.3 : 1,
                }}
              />
            </div>
          </button>
        )
      })}
    </div>
  )
}
