import type { AveryEvent, Tag } from '../api/types'
import type { Segment } from '../lib/geometry'
import { formatTimeRange } from '../lib/datetime'
import { tint } from '../lib/color'

/** The strip of column left free down the right-hand side of every card. It is a live
 *  hit target for creating a new card at that time, which is the point of leaving it. */
export const CARD_RIGHT_GUTTER_PX = 12

export function EventCard({
  event,
  segment,
  tag,
  title,
  onPointerDown,
  isDragging,
  dragOffset,
}: {
  event: AveryEvent
  segment: Segment
  tag: Tag | undefined
  title: string
  onPointerDown?: (e: React.PointerEvent) => void
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

  // A task card reads as a to-do with a slot: light surface, thin outline, a tick box.
  // An event card reads as occupied time: filled, with a solid spine on the left.
  const shape = isTask
    ? {
        background: isDone ? 'transparent' : 'var(--surface-raised)',
        border: `1px solid ${color}`,
      }
    : {
        background: isDone ? 'transparent' : tint(color, 0.22),
        borderLeft: `3px solid ${color}`,
      }

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
        opacity: isDone ? 0.45 : isDragging ? 0.85 : undefined,
        cursor: isDragging ? 'grabbing' : onPointerDown ? 'pointer' : 'default',
        transform: dragOffset ? `translate(${dragOffset.dx}px, ${dragOffset.dy}px)` : undefined,
        zIndex: isDragging ? 20 : undefined,
        boxShadow: isDragging ? 'var(--shadow-card)' : undefined,
      }}
      onPointerDown={onPointerDown}
    >
      <div className="flex items-start gap-1 px-1.5 py-0.5">
        {isTask && (
          <span className="mt-px shrink-0 text-[11px] leading-tight" style={{ color }}>
            {isDone ? '✓' : '○'}
          </span>
        )}
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
