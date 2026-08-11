import type { AveryEvent, Tag } from '../api/types'
import type { Segment } from '../lib/geometry'
import { formatTimeRange } from '../lib/datetime'
import { DONE_OPACITY, chipShape } from '../lib/chipStyle'

/** The strip of column left free down the right-hand side of every card. It is a live
 *  hit target for creating a new card at that time, which is the point of leaving it. */
export const CARD_RIGHT_GUTTER_PX = 12

export function EventCard({
  event,
  segment,
  tag,
  title,
  onPointerDown,
  onToggleComplete,
  isDragging,
  dragOffset,
}: {
  event: AveryEvent
  segment: Segment
  tag: Tag | undefined
  title: string
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

  return (
    <div
      className="absolute overflow-hidden text-left select-none"
      style={{
        top: segment.topPx,
        height: segment.heightPx,
        left: 2,
        right: CARD_RIGHT_GUTTER_PX,
        ...corners,
        ...shape,
        opacity: isDone ? DONE_OPACITY : isDragging ? 0.85 : undefined,
        cursor: isDragging ? 'grabbing' : onPointerDown ? 'pointer' : 'default',
        transform: dragOffset ? `translate(${dragOffset.dx}px, ${dragOffset.dy}px)` : undefined,
        zIndex: isDragging ? 20 : undefined,
        boxShadow: isDragging ? 'var(--shadow-card)' : undefined,
      }}
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
            className="truncate text-[11px] font-bold leading-tight"
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
