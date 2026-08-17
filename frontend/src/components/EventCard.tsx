import type { AveryEvent, Tag } from '../api/types'
import type { Segment } from '../lib/geometry'
import { formatTimeRange } from '../lib/datetime'
import { DONE_OPACITY, chipShape } from '../lib/chipStyle'

/** The strip of column left free down the right-hand side of every card. It is a live
 *  hit target for creating a new card at that time, which is the point of leaving it. */
export const CARD_RIGHT_GUTTER_PX = 12

/** The left inset every card keeps from the day column's edge, at any column count. */
const CARD_LEFT_PX = 2

/** Horizontal breathing room between two side-by-side conflicting cards, so they
 *  read as two distinct cards rather than one wide one. */
const CARD_GAP_PX = 3

/**
 * Horizontal placement for a card occupying `columnSpan` of `columnCount` equal
 * slots within the span the card would otherwise have entirely to itself
 * (`CARD_LEFT_PX` in from the left, `CARD_RIGHT_GUTTER_PX` free on the right),
 * starting at `columnIndex`.
 *
 * `columnSpan` lets a card that only conflicts with *some* of its cluster reclaim
 * the columns nothing else needs at its own time — see `layoutSegments` in
 * `lib/overlap.ts`, which computes it. A card genuinely boxed in on all sides
 * (three-way overlap, say) gets `columnSpan` 1 and renders at a plain `1/columnCount`
 * width; a card whose only conflict is a single long background event can expand
 * across every other column, since nothing else is actually there at its time.
 *
 * At `columnCount` 1 (and therefore `columnSpan` 1) this returns the exact
 * `{ left, right }` pair the card has always used — same keys, same values — so a
 * non-conflicting card (the overwhelming majority) renders byte-identical to
 * before this feature existed. Only when a card actually shares its cluster does
 * it switch to a `{ left, width }` pair expressed via `calc()`, since both the
 * slot width and the span depend on the day column's runtime pixel width, not
 * just fixed pixel insets.
 *
 * The right-hand gutter stays untouched regardless of span: even a card
 * expanding all the way to the cluster's last column still ends exactly
 * `CARD_RIGHT_GUTTER_PX` from the column's edge, because the fixed pixel budget
 * (left inset + right gutter + internal gaps) is divided out of the available
 * width before the columns are split, not added on top of it — the algebra holds
 * for any `columnSpan` up to `columnCount - columnIndex`, not just 1.
 */
export function cardColumnStyle(
  columnIndex: number,
  columnCount: number,
  columnSpan: number,
): { left: number | string; right?: number; width?: string } {
  if (columnCount <= 1) {
    return { left: CARD_LEFT_PX, right: CARD_RIGHT_GUTTER_PX }
  }

  // Total fixed pixels consumed by insets and the gaps between columns; the rest
  // of the day column's width is split evenly across `columnCount` slots.
  const fixedPx = CARD_LEFT_PX + CARD_RIGHT_GUTTER_PX + (columnCount - 1) * CARD_GAP_PX
  const slotWidthPxOffset = fixedPx / columnCount
  const leftPercent = (columnIndex / columnCount) * 100
  const leftPxOffset = CARD_LEFT_PX + columnIndex * (CARD_GAP_PX - slotWidthPxOffset)

  // A card spanning multiple slots is one continuous box: it keeps the gap
  // before its first slot and after its last, but not the internal gaps
  // between the slots it itself occupies.
  const widthPercent = (100 / columnCount) * columnSpan
  const widthPxOffset = slotWidthPxOffset * columnSpan - (columnSpan - 1) * CARD_GAP_PX

  return {
    left: `calc(${leftPercent}% + ${leftPxOffset}px)`,
    width: `calc(${widthPercent}% - ${widthPxOffset}px)`,
  }
}

export function EventCard({
  event,
  segment,
  tag,
  title,
  columnIndex = 0,
  columnCount = 1,
  columnSpan = 1,
  onPointerDown,
  onToggleComplete,
  isDragging,
  dragOffset,
}: {
  event: AveryEvent
  segment: Segment
  tag: Tag | undefined
  title: string
  /** Which of `columnCount` side-by-side slots this card sits in, for events that
   *  conflict in time with another. Defaults to the un-split single column. */
  columnIndex?: number
  columnCount?: number
  /** How many of `columnCount` slots, starting at `columnIndex`, this card
   *  actually draws across — see `cardColumnStyle`. Defaults to the un-split
   *  single column. */
  columnSpan?: number
  onPointerDown?: (e: React.PointerEvent) => void
  /** Toggles completion from the glyph directly, bypassing the card's double-click
   *  arbitration. `point` is the viewport coordinate the confetti burst should
   *  originate from. Only rendered as a button when supplied. */
  onToggleComplete?: (point: { x: number; y: number }) => void
  isDragging?: boolean
  dragOffset?: { dx: number; dy: number }
}) {
  const color = tag?.color ?? 'var(--pale)'
  const isTask = event.kind === 'task'
  const isDone = event.completed_at !== null

  const corners = {
    borderTopLeftRadius: segment.isStart ? 6 : 0,
    borderTopRightRadius: segment.isStart ? 6 : 0,
    borderBottomLeftRadius: segment.isEnd ? 6 : 0,
    borderBottomRightRadius: segment.isEnd ? 6 : 0,
  }

  const shape = chipShape({ color, isTask, isDone })
  const columnStyle = cardColumnStyle(columnIndex, columnCount, columnSpan)

  return (
    <div
      className="absolute overflow-hidden text-left select-none"
      style={{
        top: segment.topPx,
        height: segment.heightPx,
        ...columnStyle,
        ...corners,
        ...shape,
        opacity: isDone ? DONE_OPACITY : isDragging ? 0.85 : undefined,
        cursor: isDragging ? 'grabbing' : onPointerDown ? 'pointer' : 'default',
        transform: dragOffset ? `translate(${dragOffset.dx}px, ${dragOffset.dy}px)` : undefined,
        zIndex: isDragging ? 20 : undefined,
        boxShadow: isDragging ? 'var(--shadow-card)' : undefined,
      }}
      // The title wraps within the card's own width instead (see the
      // `calendar-card-title` class below), but a caption clipped by the card's
      // fixed height still needs to be reachable without a mouse — the native
      // `title` tooltip (and its use as an accessible-name fallback) covers that.
      title={title}
      onPointerDown={onPointerDown}
    >
      <div className="flex items-start gap-1 px-1.5 py-0.5">
        {isTask &&
          (onToggleComplete ? (
            <button
              type="button"
              aria-label={isDone ? 'Mark not done' : 'Mark done'}
              className="shrink-0 appearance-none border-0 bg-transparent text-[11px] leading-tight"
              style={{
                color,
                // Pads the click target out to a comfortable size without disturbing
                // the row's layout: padding grows the hit area, and the equal-and-
                // opposite margin keeps this element's contribution to the flex row
                // (its margin box) the same size as the bare glyph — so a completed
                // and an incomplete card still line up, and the title never shifts.
                // `marginTop` alone is nudged by the glyph's original 1px offset
                // (matching the sibling title's line-box) minus the added padding.
                margin: -6,
                marginTop: 1 - 6,
                padding: 6,
              }}
              onPointerDown={(e) => {
                e.stopPropagation()
                onToggleComplete({ x: e.clientX, y: e.clientY })
              }}
            >
              {isDone ? '✓' : '○'}
            </button>
          ) : (
            <span className="mt-px shrink-0 text-[11px] leading-tight" style={{ color }}>
              {isDone ? '✓' : '○'}
            </span>
          ))}
        <div className="min-w-0 flex-1">
          <div
            // Wraps within the card's own width — never `truncate` — so a long
            // name reads across multiple lines instead of drawing outside the
            // card box. `break-words` lets an unbroken run (a long word, or a
            // URL with no spaces) break mid-string once it can't fit a line on
            // its own, which matters in a narrow overlap column that can be as
            // little as ~30px wide; CJK text already has a break opportunity
            // between every character, so it wraps without any extra rule. The
            // outer card is `overflow-hidden` at a fixed `height` (this card's
            // own time slot), so if the wrapped title still doesn't fit it clips
            // vertically instead of growing the card or reflowing the grid.
            className="calendar-card-title break-words text-[11px] font-bold leading-tight"
            style={isDone ? { textDecoration: 'line-through' } : undefined}
          >
            {title}
          </div>
          {segment.heightPx > 30 && (
            <div className="truncate text-[10px] font-medium text-ink-muted">
              {formatTimeRange(event.start_at, event.end_at)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
