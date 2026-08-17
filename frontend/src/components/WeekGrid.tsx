import { useCallback, useRef } from 'react'

import type { AveryEvent, Tag } from '../api/types'
import type { DragDraft } from '../hooks/useEventDrag'
import type { GestureOrigin } from '../hooks/useCardGestures'
import { useCardGestures } from '../hooks/useCardGestures'
import { tint } from '../lib/color'
import { addDays, formatDate, parseLocal } from '../lib/datetime'
import {
  GRID,
  GRID_MINUTES,
  gridHeightPx,
  hourMarks,
  minutesToPx,
  pxToMinutes,
  segmentsForEvent,
  snapMinutes,
  type Segment,
} from '../lib/geometry'
import { layoutSegments, type LaidOutSegment } from '../lib/overlap'
import { EventCard, cardColumnStyle } from './EventCard'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const GUTTER_PX = 56

export interface SlotClick {
  day: Date
  /** Minutes from midnight, snapped to the grid's 15-minute slots. */
  minutes: number
  x: number
  y: number
}

/** One card plus its resize handles. A real component, not a function called in a
 *  loop — `useCardGestures` is a hook, and hooks cannot be called inside `map`. */
function GridCard({
  event,
  segment,
  tag,
  title,
  columnIndex,
  columnCount,
  columnSpan,
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
  /** Which of `columnCount` side-by-side slots this card sits in, when it
   *  conflicts in time with another event. */
  columnIndex: number
  columnCount: number
  /** How many of `columnCount` slots, starting at `columnIndex`, this card
   *  actually draws across — see `layoutSegments` in `lib/overlap.ts`. */
  columnSpan: number
  isDragging: boolean
  dragOffset?: { dx: number; dy: number }
  onOpen: (event: AveryEvent) => void
  onToggleComplete: (event: AveryEvent, point: { x: number; y: number }) => void
  onDragStart: (event: AveryEvent, origin: GestureOrigin) => void
  onPointerDownResize?: (e: React.PointerEvent, edge: 'start' | 'end') => void
}) {
  // Open and toggle-complete are deferred (up to DOUBLE_CLICK_MS after pointer-up),
  // and a long press waits LONG_PRESS_MS before it resolves — `invalidateCalendar`
  // refetches on every mutation, so a new `event` object (and new `onOpen` etc.
  // identities) can arrive mid-gesture. A plain closure over the press-start values
  // would run the deferred callback against whatever was current when the press
  // began; this ref is written every render so the callbacks below always read the
  // latest, regardless of when in the gesture they actually fire.
  const latest = useRef({ event, onOpen, onToggleComplete, onDragStart })
  latest.current = { event, onOpen, onToggleComplete, onDragStart }

  const { onPointerDown } = useCardGestures({
    onOpen: useCallback(() => latest.current.onOpen(latest.current.event), []),
    onToggleComplete: useCallback(
      (p: { x: number; y: number }) => latest.current.onToggleComplete(latest.current.event, p),
      [],
    ),
    onDragStart: useCallback(
      (o: GestureOrigin) => latest.current.onDragStart(latest.current.event, o),
      [],
    ),
  })
  // The circle's own click bypasses gesture arbitration entirely (it stops the
  // pointer event before `onPointerDown` above ever sees it), so it needs its own
  // binding — but it must go through the same latest ref as the gestures do, or a
  // refetch mid-gesture could fire it against a stale event just the same.
  const onGlyphToggleComplete = useCallback(
    (p: { x: number; y: number }) => latest.current.onToggleComplete(latest.current.event, p),
    [],
  )

  // Resize handles are hit targets laid directly over the card's own top/bottom
  // edge, so they must track the same column slot the card itself occupies —
  // otherwise a handle would stretch across a sibling card sharing the row.
  const handleStyle = cardColumnStyle(columnIndex, columnCount, columnSpan)

  return (
    <div className="contents" onPointerDown={(e) => e.stopPropagation()}>
      <EventCard
        event={event}
        segment={segment}
        tag={tag}
        title={title}
        columnIndex={columnIndex}
        columnCount={columnCount}
        columnSpan={columnSpan}
        onPointerDown={onPointerDown}
        onToggleComplete={onGlyphToggleComplete}
        isDragging={isDragging}
        dragOffset={dragOffset}
      />
      {onPointerDownResize && segment.isStart && (
        <div
          className="absolute z-10 h-1.5 cursor-ns-resize"
          style={{ top: segment.topPx, ...handleStyle }}
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
            ...handleStyle,
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
  onOpen,
  onToggleComplete,
  onDragStart,
  onEventPointerDownResize,
  onEmptyClick,
  draft,
  pxPerHour,
  columnPx,
  scrollRef,
}: {
  weekStart: Date
  events: AveryEvent[]
  tagMap: Map<number, Tag>
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
  /** A press that reached the empty column — including the gutter strip every card
   *  leaves free down its right side — rather than a card or resize handle. */
  onEmptyClick?: (slot: SlotClick) => void
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

  // Routine blocks are the allocation, not appointments: they render as full-width
  // background bands and stay OUT of the overlap layout, so a real event placed on
  // top of "Work" does not split into columns against it — the band is the ground
  // the day is drawn on, the events are what actually happened.
  const backgroundByDay: { event: AveryEvent; segment: Segment }[][] = Array.from(
    { length: 7 },
    () => [],
  )
  const segmentsByDay: { event: AveryEvent; segment: Segment }[][] = Array.from(
    { length: 7 },
    () => [],
  )
  const allDayByDay: AveryEvent[][] = Array.from({ length: 7 }, () => [])
  for (const event of events) {
    if (event.all_day) {
      // A day marker, not allocated time: pin it as a banner instead of a block —
      // rendered as a 24h pillar it swallows the column and buries the day.
      const dayIndex = Math.round(
        (parseLocal(event.start_at).setHours(0, 0, 0, 0) -
          new Date(weekStart).setHours(0, 0, 0, 0)) /
          86_400_000,
      )
      if (dayIndex >= 0 && dayIndex < 7) allDayByDay[dayIndex].push(event)
      continue
    }
    const target = event.source === 'routine' ? backgroundByDay : segmentsByDay
    const segments = segmentsForEvent(
      parseLocal(event.start_at),
      parseLocal(event.end_at),
      weekStart,
      pxPerHour,
    )
    for (const segment of segments) {
      target[segment.dayIndex].push({ event, segment })
    }
  }

  // Lay out each day independently: conflicts on Monday have no bearing on
  // Tuesday's columns. `layoutSegments` returns its results in the same order
  // it was given them, so this zips back onto `event` positionally rather than
  // by any id.

  const laidOutByDay: { event: AveryEvent; segment: LaidOutSegment }[][] = segmentsByDay.map(
    (dayEntries) => {
      const laidOut = layoutSegments(dayEntries.map((entry) => entry.segment))
      return dayEntries.map((entry, i) => ({ event: entry.event, segment: laidOut[i] }))
    },
  )

  // Routine bands share the ground layer with each other the same way real events
  // share the foreground: a second, independent `layoutSegments` pass over just the
  // background segments. This never touches `segmentsByDay`/`laidOutByDay` above, so
  // a real event laid on top of a routine block still renders full-span — only two
  // routine blocks overlapping *each other* now split width instead of drawing on
  // top of one another.
  const laidOutBackgroundByDay: { event: AveryEvent; segment: LaidOutSegment }[][] =
    backgroundByDay.map((dayEntries) => {
      const laidOut = layoutSegments(dayEntries.map((entry) => entry.segment))
      return dayEntries.map((entry, i) => ({ event: entry.event, segment: laidOut[i] }))
    })

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
              {/* Day markers (all-day externals) live in the header: pinned to the
               *  day itself rather than to midnight, which the grid scrolls past. */}
              {allDayByDay[i].map((event) => (
                <button
                  key={`allday-${event.id}`}
                  type="button"
                  onClick={() => onOpen(event)}
                  className="mt-0.5 block w-full truncate rounded-[4px] px-1 text-left text-[9px] font-medium leading-[14px] text-white"
                  style={{
                    background:
                      event.source === 'google'
                        ? 'var(--external-google)'
                        : event.source === 'lark'
                          ? 'var(--external-lark)'
                          : 'var(--line-strong)',
                  }}
                  title={`${event.title} · all day`}
                >
                  {event.title}
                </button>
              ))}
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
              // Read by `useEventDrag` to size a day column while dragging. Marked
              // explicitly because the card is not a direct child: it sits inside a
              // `display: contents` wrapper, which generates no box at all, so
              // measuring `parentElement` yielded a zero-width column and silently
              // pinned every cross-day drag to zero days.
              data-day-column={dayIndex}
              className="relative border-l border-line"
              style={{ height: heightPx }}
              onPointerDown={(e) => {
                // Cards and resize handles stop propagation, so reaching here means
                // the press landed on empty column — including the gutter strip that
                // every card deliberately leaves free down its right-hand side.
                if (!onEmptyClick) return
                const rect = e.currentTarget.getBoundingClientRect()
                onEmptyClick({
                  day: days[dayIndex],
                  minutes: snapMinutes(pxToMinutes(e.clientY - rect.top, pxPerHour)),
                  x: e.clientX,
                  y: e.clientY,
                })
              }}
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
              {laidOutBackgroundByDay[dayIndex].map(({ event, segment }, i) => (
                <RoutineBand
                  key={`bg-${event.id}-${i}`}
                  event={event}
                  segment={segment}
                  columnIndex={segment.columnIndex}
                  columnCount={segment.columnCount}
                  columnSpan={segment.columnSpan}
                  tagMap={tagMap}
                />
              ))}
              {laidOutByDay[dayIndex].map(({ event, segment }) => {
                const isDragging = draft?.eventId === event.id
                let renderSegment: LaidOutSegment = segment
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
                    title={event.title}
                    columnIndex={segment.columnIndex}
                    columnCount={segment.columnCount}
                    columnSpan={segment.columnSpan}
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


/** Horizontal breathing room between two side-by-side overlapping routine bands, so
 *  two read as two rather than one wide one — the background-layer counterpart of
 *  `CARD_GAP_PX` in `EventCard.tsx`. */
const BAND_GAP_PX = 3

/**
 * Horizontal placement for a routine band occupying `columnSpan` of `columnCount`
 * equal slots, mirroring `cardColumnStyle` in `EventCard.tsx` — same algebra, but
 * for a band whose *outer* edges have no inset at all (a lone band runs edge to
 * edge in the day column via the plain `inset-x-0` class), instead of the card's
 * left inset and right gutter. Splitting only ever eats into the band's own span,
 * never that outer edge.
 *
 * At `columnCount` 1 this returns `{}`, so the caller keeps using the bare
 * `inset-x-0` class it always has — a day with no routine overlaps renders
 * byte-identical to before this feature existed.
 */
export function bandColumnStyle(
  columnIndex: number,
  columnCount: number,
  columnSpan: number,
): { left?: string; width?: string } {
  if (columnCount <= 1) return {}

  const fixedPx = (columnCount - 1) * BAND_GAP_PX
  const slotWidthPxOffset = fixedPx / columnCount
  const leftPercent = (columnIndex / columnCount) * 100
  const leftPxOffset = columnIndex * (BAND_GAP_PX - slotWidthPxOffset)

  const widthPercent = (100 / columnCount) * columnSpan
  const widthPxOffset = slotWidthPxOffset * columnSpan - (columnSpan - 1) * BAND_GAP_PX

  return {
    left: `calc(${leftPercent}% + ${leftPxOffset}px)`,
    width: `calc(${widthPercent}% - ${widthPxOffset}px)`,
  }
}

/** A routine block as the day's background: what this stretch of time is FOR, not a
 *  concrete appointment. Full width when nothing else at its time conflicts, tinted
 *  with its category colour, and `pointer-events-none` so every gesture — creating,
 *  dragging, completing — acts on the real events drawn over it. When another
 *  routine block overlaps it in time, the two split the column between them via
 *  `columnIndex`/`columnCount`/`columnSpan` — the same `layoutSegments` clustering
 *  the foreground events use, run as an independent pass over just the background
 *  layer so it never affects real events. */
function RoutineBand({
  event,
  segment,
  columnIndex,
  columnCount,
  columnSpan,
  tagMap,
}: {
  event: AveryEvent
  segment: Segment
  /** Which of `columnCount` side-by-side slots this band sits in, when it
   *  overlaps another routine block in time. */
  columnIndex: number
  columnCount: number
  /** How many of `columnCount` slots, starting at `columnIndex`, this band
   *  actually draws across — see `layoutSegments` in `lib/overlap.ts`. */
  columnSpan: number
  tagMap: Map<number, Tag>
}) {
  const tag = tagMap.get(event.tag_ids[0])
  const color = tag?.color ?? 'var(--pale)'
  const bandStyle = bandColumnStyle(columnIndex, columnCount, columnSpan)
  return (
    <div
      className={
        columnCount <= 1
          ? 'pointer-events-none absolute inset-x-0'
          : 'pointer-events-none absolute'
      }
      style={{
        top: segment.topPx,
        height: segment.heightPx,
        ...bandStyle,
        // Alpha on the BACKGROUND, not `opacity` on the div: container opacity
        // multiplies onto every child, which is exactly how the name label became
        // invisible — 16% of ink is nothing.
        background: tint(color, 0.16),
        borderLeft: `2px solid ${tint(color, 0.45)}`,
      }}
      title={`${event.title} · routine`}
    >
      {segment.heightPx > 18 && (
        // The band itself sits at 0.16 opacity, so the label must NOT inherit that
        // wash: it renders in the app ink with the tag colour as a leading dot,
        // which stays readable on any band colour.
        <div className="flex items-center gap-1 px-1.5 pt-0.5">
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: color }}
          />
          <span className="truncate text-[10px] font-medium uppercase tracking-wide text-ink-muted">
            {event.title}
          </span>
        </div>
      )}
    </div>
  )
}
