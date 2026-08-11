import type { Tag } from '../api/types'
import { formatMinutes } from '../lib/datetime'

export function CategoryRail({
  tags,
  minutesByTag,
  totalMinutes,
  hidden,
  onToggle,
  onShowAll,
  onHideAll,
  selectableKnown,
}: {
  tags: Tag[]
  minutesByTag: Record<string, number>
  totalMinutes: number
  hidden: Set<number>
  onToggle: (id: number) => void
  onShowAll: () => void
  onHideAll: () => void
  // Whether the caller's selectable-tag list has settled (its tags query resolved) —
  // NOT `tags.length > 0`. Zero categories is a legitimate settled state and must not
  // be confused with "not loaded yet," the same distinction useTagVisibility's
  // `selectableIds` already draws. The per-tag rows below get this for free (an
  // unsettled list is simply an empty `tags` array, so they don't render). This
  // control doesn't get that for free — `hideAll` no-ops before the list is known, so
  // without this gate the button would sit there clickable and silently do nothing.
  selectableKnown: boolean
}) {
  // "All" when something is hidden (click shows everything); "None" once nothing is
  // hidden (click hides everything) — a single control whose label is always the
  // opposite of the current state, so the same target both switches the whole list
  // on and off.
  const anyHidden = hidden.size > 0
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink-faint">Categories</h2>
        {selectableKnown && (
          <button
            type="button"
            className="text-[10px] font-bold uppercase tracking-wide text-ink-faint transition-colors hover:text-ink"
            onClick={anyHidden ? onShowAll : onHideAll}
            aria-label={anyHidden ? 'Show all categories' : 'Hide all categories'}
          >
            {anyHidden ? 'All' : 'None'}
          </button>
        )}
      </div>
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
