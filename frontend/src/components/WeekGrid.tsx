import type { AveryEvent, Tag, Task } from '../api/types'
import type { DragDraft } from '../hooks/useEventDrag'
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
import { EventBlock } from './EventBlock'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const GRID_COLUMNS = '56px repeat(7, minmax(0, 1fr))'

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
  onEventPointerDownMove,
  onEventPointerDownResize,
  draft,
}: {
  weekStart: Date
  events: AveryEvent[]
  tagMap: Map<number, Tag>
  taskMap: Map<number, Task>
  onEventPointerDownMove?: (event: AveryEvent, segment: Segment) => (e: React.PointerEvent) => void
  onEventPointerDownResize?: (
    event: AveryEvent,
    segment: Segment,
  ) => (e: React.PointerEvent, edge: 'start' | 'end') => void
  /** The event mid-drag, if any, and its live pixel offset. */
  draft?: DragDraft | null
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
      GRID.basePxPerHour,
    )
    for (const segment of segments) {
      segmentsByDay[segment.dayIndex].push({ event, segment })
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="grid shrink-0 border-b border-line"
        style={{ gridTemplateColumns: GRID_COLUMNS }}
      >
        <div />
        {days.map((d, i) => {
          const isToday = i === todayIndex
          return (
            <div key={i} className="border-l border-line px-2 py-2 text-center">
              <div className="text-[11px] uppercase tracking-wide text-ink-faint">
                {DAY_NAMES[i]}
              </div>
              <div
                className={
                  isToday
                    ? 'mx-auto mt-0.5 flex size-6 items-center justify-center rounded-full text-sm font-semibold text-ink'
                    : 'mt-0.5 text-sm text-ink-muted'
                }
                style={isToday ? { background: 'var(--pale)' } : undefined}
              >
                {d.getDate()}
              </div>
            </div>
          )
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns: GRID_COLUMNS }}>
          <div className="relative" style={{ height: gridHeightPx(GRID.basePxPerHour) }}>
            {marks.map((h) => (
              <div
                key={h}
                className="absolute inset-x-0 -translate-y-1/2 pr-2 text-right text-[11px] text-ink-faint"
                style={{ top: minutesToPx((h - GRID.startHour) * 60, GRID.basePxPerHour) }}
              >
                {hourLabel(h)}
              </div>
            ))}
          </div>

          {days.map((_, dayIndex) => {
            const isToday = dayIndex === todayIndex
            return (
              <div
                key={dayIndex}
                className="relative border-l border-line"
                style={{ height: gridHeightPx(GRID.basePxPerHour) }}
              >
                {isToday && (
                  <div
                    className="absolute inset-0"
                    style={{ background: 'var(--pale)', opacity: 0.28 }}
                  />
                )}
                {marks
                  .filter((h) => h !== GRID.startHour)
                  .map((h) => (
                    <div
                      key={h}
                      className="absolute inset-x-0 border-t border-line"
                      style={{ top: minutesToPx((h - GRID.startHour) * 60, GRID.basePxPerHour) }}
                    />
                  ))}
                {isToday && showNowLine && (
                  <div
                    className="absolute inset-x-0 h-px"
                    style={{ top: minutesToPx(nowMinutes, GRID.basePxPerHour), background: 'var(--rose-deep)' }}
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
                    <EventBlock
                      key={`${event.id}-${segment.dayIndex}`}
                      event={event}
                      segment={renderSegment}
                      tag={tagMap.get(event.tag_ids[0])}
                      title={taskMap.get(event.task_id)?.name ?? `Task #${event.task_id}`}
                      onPointerDownMove={onEventPointerDownMove?.(event, segment)}
                      onPointerDownResize={onEventPointerDownResize?.(event, segment)}
                      isDragging={isDragging}
                      dragOffset={dragOffset}
                    />
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
