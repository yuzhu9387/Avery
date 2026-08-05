import { Link } from 'react-router-dom'

import type { AveryEvent, Tag } from '../api/types'
import type { Segment } from '../lib/geometry'
import { formatTimeRange } from '../lib/datetime'
import { tint } from '../lib/color'

export function EventBlock({
  event,
  segment,
  tag,
  title,
  onPointerDownMove,
  onPointerDownResize,
  isDragging,
  dragOffset,
}: {
  event: AveryEvent
  segment: Segment
  tag: Tag | undefined
  title: string
  onPointerDownMove?: (e: React.PointerEvent) => void
  onPointerDownResize?: (e: React.PointerEvent, edge: 'start' | 'end') => void
  /** True while this block is the one being dragged, so it can read as "lifted"
   *  above the drop target underneath rather than indistinguishable from it. */
  isDragging?: boolean
  /** Live pixel offset for a move drag. Resize previews adjust top/height instead
   *  (computed by the caller), so this stays undefined during a resize. */
  dragOffset?: { dx: number; dy: number }
}) {
  const color = tag?.color ?? 'var(--pale)'
  return (
    <div
      className="absolute inset-x-1 overflow-hidden text-left"
      style={{
        top: segment.topPx,
        height: segment.heightPx,
        background: tint(color, 0.22),
        borderLeft: `3px solid ${color}`,
        borderTopLeftRadius: segment.isStart ? 6 : 0,
        borderTopRightRadius: segment.isStart ? 6 : 0,
        borderBottomLeftRadius: segment.isEnd ? 6 : 0,
        borderBottomRightRadius: segment.isEnd ? 6 : 0,
        cursor: isDragging ? 'grabbing' : onPointerDownMove ? 'grab' : 'default',
        transform: dragOffset ? `translate(${dragOffset.dx}px, ${dragOffset.dy}px)` : undefined,
        zIndex: isDragging ? 20 : undefined,
        opacity: isDragging ? 0.85 : undefined,
      }}
      onPointerDown={onPointerDownMove}
    >
      {segment.isStart && onPointerDownResize && (
        <div
          className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize"
          onPointerDown={(e) => {
            e.stopPropagation()
            onPointerDownResize(e, 'start')
          }}
        />
      )}
      <Link
        to={`/tasks/${event.task_id}`}
        className="block px-1.5 py-0.5"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="truncate text-[11px] font-medium leading-tight">{title}</div>
        {segment.heightPx > 30 && (
          <div className="truncate text-[10px] text-ink-muted">
            {formatTimeRange(event.start_at, event.end_at)}
          </div>
        )}
      </Link>
      {segment.isEnd && onPointerDownResize && (
        <div
          className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
          onPointerDown={(e) => {
            e.stopPropagation()
            onPointerDownResize(e, 'end')
          }}
        />
      )}
    </div>
  )
}
