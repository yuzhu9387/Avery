import { useCallback } from 'react'

import type { AveryEvent, Tag, Task } from '../api/types'
import type { DragDraft } from '../hooks/useEventDrag'
import type { GestureOrigin } from '../hooks/useCardGestures'
import { useCardGestures } from '../hooks/useCardGestures'
import { addDays, formatDate, parseLocal } from '../lib/datetime'
import {
  GRID,
  GRID_MINUTES,
  gridHeightPx,
  hourMarks,
  minutesToPx,
  segmentsForEvent,
  type Segment,
} from '../lib/geometry'
import { CARD_RIGHT_GUTTER_PX, EventCard } from './EventCard'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const GUTTER_PX = 56

/** One card plus its resize handles. A real component, not a function called in a
 *  loop — `useCardGestures` is a hook, and hooks cannot be called inside `map`. */
function GridCard({
  event,
  segment,
  tag,
  title,
  isDragging,
  dragOffset,
  onOpen,
  onToggleComplete,
  onDragStart,
  onPointerDownResize,
}: {
  event: AveryEvent
  segment: Segment
  tag: Tag | undefined
  title: string
  isDragging: boolean
  dragOffset?: { dx: number; dy: number }
  onOpen: (event: AveryEvent) => void
  onToggleComplete: (event: AveryEvent, point: { x: number; y: number }) => void
  onDragStart: (event: AveryEvent, origin: GestureOrigin) => void
  onPointerDownResize?: (e: React.PointerEvent, edge: 'start' | 'end') => void
}) {
  const { onPointerDown } = useCardGestures({
    onOpen: useCallback(() => onOpen(event), [onOpen, event]),
    onToggleComplete: useCallback((p) => onToggleComplete(event, p), [onToggleComplete, event]),
    onDragStart: useCallback((o) => onDragStart(event, o), [onDragStart, event]),
  })

  return (
    <div className="contents">
      <EventCard
        event={event}
        segment={segment}
        tag={tag}
        title={title}
        onPointerDown={onPointerDown}
        isDragging={isDragging}
        dragOffset={dragOffset}
      />
      {onPointerDownResize && segment.isStart && (
        <div
          className="absolute z-10 h-1.5 cursor-ns-resize"
          style={{ top: segment.topPx, left: 2, right: CARD_RIGHT_GUTTER_PX }}
          onPointerDown={(e) => {
            e.stopPropagation()
            onPointerDownResize(e, 'start')
          }}
        />
      )}
      {onPointerDownResize && segment.isEnd && (
        <div
          className="absolute z-10 h-1.5 cursor-ns-resize"
          style={{
            top: segment.topPx + segment.heightPx - 6,
            left: 2,
            right: CARD_RIGHT_GUTTER_PX,
          }}
          onPointerDown={(e) => {
            e.stopPropagation()
            onPointerDownResize(e, 'end')
          }}
        />
      )}
    </div>
  )
}

/** "6" -> "6 AM", "13" -> "1 PM", "24" (midnight, the grid's floor label for the next
 *  day) -> "12 AM". */
function hourLabel(hour: number): string {
  const h = hour % 24
  const period = h < 12 ? 'AM' : 'PM'
  const display = h % 12 === 0 ? 12 : h % 12
  return `${display} ${period}`
}

export function WeekGrid({
  weekStart,
  events,
  tagMap,
  taskMap,
  onOpen,
  onToggleComplete,
  onDragStart,
  onEventPointerDownResize,
  draft,
  pxPerHour,
  columnPx,
  scrollRef,
}: {
  weekStart: Date
  events: AveryEvent[]
  tagMap: Map<number, Tag>
  taskMap: Map<number, Task>
  /** Opens the detail page for a card after a single, un-repeated press. */
  onOpen: (event: AveryEvent) => void
  /** Toggles completion; `point` is the viewport coordinate the confetti burst
   *  should originate from. */
  onToggleComplete: (event: AveryEvent, point: { x: number; y: number }) => void
  /** A press held past the long-press threshold — the card has lifted into a drag. */
  onDragStart: (event: AveryEvent, origin: GestureOrigin) => void
  onEventPointerDownResize?: (
    event: AveryEvent,
  ) => (e: React.PointerEvent, edge: 'start' | 'end') => void
  /** The event mid-drag, if any, and its live pixel offset. */
  draft?: DragDraft | null
  /** Pixels per hour at the current zoom. */
  pxPerHour: number
  /** Minimum width of one day column at the current zoom. */
  columnPx: number
  /** The scroll container, so the page can position it and zoom can anchor to it. A
   *  `React.Ref` (object or callback) rather than a plain `RefObject`: the page hands
   *  down a callback ref backed by state so it can react to the node appearing,
   *  changing, or disappearing across mounts. */
  scrollRef?: React.Ref<HTMLDivElement>
}) {
  const marks = hourMarks()
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const todayKey = formatDate(new Date())
  const todayIndex = days.findIndex((d) => formatDate(d) === todayKey)

  const nowMinutes = (() => {
    const now = new Date()
    return now.getHours() * 60 + now.getMinutes() - GRID.startHour * 60
  })()
  const showNowLine = todayIndex >= 0 && nowMinutes >= 0 && nowMinutes <= GRID_MINUTES

  const segmentsByDay: { event: AveryEvent; segment: Segment }[][] = Array.from(
    { length: 7 },
    () => [],
  )
  for (const event of events) {
    const segments = segmentsForEvent(
      parseLocal(event.start_at),
      parseLocal(event.end_at),
      weekStart,
      pxPerHour,
    )
    for (const segment of segments) {
      segmentsByDay[segment.dayIndex].push({ event, segment })
    }
  }

  const heightPx = gridHeightPx(pxPerHour)

  return (
    <div ref={scrollRef} className="h-full min-h-0 overflow-auto">
      <div
        className="grid"
        style={{
          gridTemplateColumns: `${GUTTER_PX}px repeat(7, minmax(0, 1fr))`,
          // When the columns' minimum exceeds the container the grid overflows and the
          // container scrolls horizontally; below that the 1fr columns just fill it.
          minWidth: GUTTER_PX + 7 * columnPx,
        }}
      >
        {/* corner: sticky on both axes so it covers the gutter under the header.
            z-index stack (back to front): resting cards/gridlines (auto/0) < now-line
            (10) < a dragging EventCard (20, set in EventCard.tsx) < gutter (30) <
            day headers (40) < this corner (50). The day-column divs have no z-index of
            their own, so a dragging card's z-20 is compared directly against these
            sticky siblings in the same stacking context — it must stay under all
            three, which is why they sit at 30/40/50 rather than 10/20/30. */}
        <div className="sticky left-0 top-0 z-50 border-b border-line bg-surface" />
        {days.map((d, i) => {
          const isToday = i === todayIndex
          return (
            <div
              key={i}
              className="sticky top-0 z-40 border-b border-l border-line bg-surface px-2 py-2 text-center"
            >
              <div className="text-[11px] uppercase tracking-wide text-ink-faint">
                {DAY_NAMES[i]}
              </div>
              <div
                className={
                  isToday
                    ? 'mx-auto mt-0.5 flex size-7 items-center justify-center rounded-full text-sm font-bold'
                    : 'mt-0.5 text-sm font-medium text-ink-muted'
                }
                style={
                  isToday
                    ? { background: 'var(--rose-deep)', color: 'var(--surface-raised)' }
                    : undefined
                }
              >
                {d.getDate()}
              </div>
            </div>
          )
        })}

        <div
          className="sticky left-0 z-30 bg-surface"
          style={{ height: heightPx }}
        >
          {marks.map((h) => (
            <div
              key={h}
              className="absolute right-0 w-full -translate-y-1/2 pr-2 text-right text-[11px] text-ink-faint"
              style={{ top: minutesToPx((h - GRID.startHour) * 60, pxPerHour) }}
            >
              {h === GRID.startHour ? '' : hourLabel(h)}
            </div>
          ))}
        </div>

        {days.map((_, dayIndex) => {
          const isToday = dayIndex === todayIndex
          return (
            <div
              key={dayIndex}
              className="relative border-l border-line"
              style={{ height: heightPx }}
            >
              {isToday && (
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{ background: 'var(--pale)', opacity: 0.28 }}
                />
              )}
              {marks
                .filter((h) => h !== GRID.startHour)
                .map((h) => (
                  <div
                    key={h}
                    className="pointer-events-none absolute inset-x-0 border-t border-line"
                    style={{ top: minutesToPx((h - GRID.startHour) * 60, pxPerHour) }}
                  />
                ))}
              {isToday && showNowLine && (
                <div
                  className="pointer-events-none absolute inset-x-0 z-10 h-px"
                  style={{
                    top: minutesToPx(nowMinutes, pxPerHour),
                    background: 'var(--rose-deep)',
                  }}
                />
              )}
              {segmentsByDay[dayIndex].map(({ event, segment }) => {
                const isDragging = draft?.eventId === event.id
                let renderSegment = segment
                let dragOffset: { dx: number; dy: number } | undefined

                if (isDragging && draft) {
                  if (draft.kind === 'move') {
                    dragOffset = { dx: draft.dx, dy: draft.dy }
                  } else if (draft.edge === 'end') {
                    const heightPx = Math.max(GRID.minBlockPx, segment.heightPx + draft.dy)
                    renderSegment = { ...segment, heightPx }
                  } else {
                    const heightPx = Math.max(GRID.minBlockPx, segment.heightPx - draft.dy)
                    const topPx = segment.topPx + (segment.heightPx - heightPx)
                    renderSegment = { ...segment, topPx, heightPx }
                  }
                }

                return (
                  <GridCard
                    key={`${event.id}-${segment.dayIndex}`}
                    event={event}
                    segment={renderSegment}
                    tag={tagMap.get(event.tag_ids[0])}
                    title={taskMap.get(event.task_id)?.name ?? `Task #${event.task_id}`}
                    isDragging={isDragging}
                    dragOffset={dragOffset}
                    onOpen={onOpen}
                    onToggleComplete={onToggleComplete}
                    onDragStart={onDragStart}
                    onPointerDownResize={onEventPointerDownResize?.(event)}
                  />
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
