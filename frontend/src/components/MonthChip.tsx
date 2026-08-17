import { useCallback, useRef } from 'react'

import type { AveryEvent, Tag } from '../api/types'
import { useCardGestures } from '../hooks/useCardGestures'
import { DONE_OPACITY, chipShape } from '../lib/chipStyle'
import { formatTimeRange } from '../lib/datetime'

/**
 * One event as a single line inside a month cell.
 *
 * Its own component because `useCardGestures` is a hook and hooks cannot be
 * called inside `map` — the same reason `WeekGrid` has a per-card component.
 *
 * Gestures here are the week grid's minus the drag: a single press opens the
 * event, a double press toggles completion — except for a routine occurrence,
 * which only ever opens. It represents the weekly allocation rather than a
 * concrete appointment, so it must not be directly completable from the
 * calendar (that mutates the occurrence; the fix belongs on the Routine page,
 * against the block). Routing it through `useCardGestures`'s double-click
 * arbitration and then just not calling `onToggleComplete` from routine
 * detail page would still eat every second press waiting to see if it's a
 * completion — a control that looks live but does nothing. Disabling at the
 * source instead: a routine chip never enters the click/double-click hook at
 * all, so a plain click opens it immediately rather than trailing the
 * `DOUBLE_CLICK_MS` window with no toggle to arbitrate against.
 */
export function MonthChip({
  event,
  tag,
  title,
  onOpen,
  onToggleComplete,
}: {
  event: AveryEvent
  tag: Tag | undefined
  title: string
  onOpen: (event: AveryEvent) => void
  onToggleComplete: (event: AveryEvent, point: { x: number; y: number }) => void
}) {
  const isRoutine = event.source === 'routine'

  // Open and toggle-complete resolve up to DOUBLE_CLICK_MS after pointer-up, so the
  // handlers must be read at fire time rather than captured — a stale `event` here
  // would complete whatever card happened to be under this slot when the press began.
  const latest = useRef({ event, onOpen, onToggleComplete })
  latest.current = { event, onOpen, onToggleComplete }

  // Called unconditionally either way — hooks cannot be called conditionally — but
  // its `onPointerDown` is only ever wired up below when the chip is not routine.
  const { onPointerDown } = useCardGestures({
    onOpen: useCallback(() => latest.current.onOpen(latest.current.event), []),
    onToggleComplete: useCallback(
      (point: { x: number; y: number }) =>
        latest.current.onToggleComplete(latest.current.event, point),
      [],
    ),
    // No `onDragStart`: see the hook's docstring.
  })

  const color = tag?.color ?? 'var(--pale)'
  const isTask = event.kind === 'task'
  const isDone = event.completed_at !== null
  const time = formatTimeRange(event.start_at, event.end_at)

  return (
    <div
      role={isRoutine ? 'button' : undefined}
      tabIndex={isRoutine ? 0 : undefined}
      // A chip is too narrow to show its own time, so the native tooltip carries it.
      title={
        isRoutine
          ? `${time} · ${title} · from your Routine — click to view (edit on the Routine page)`
          : `${time} · ${title}`
      }
      className="flex shrink-0 items-center gap-1 overflow-hidden rounded-[4px] px-1.5 py-[3px] text-left select-none"
      style={{
        ...chipShape({ color, isTask, isDone }),
        opacity: isDone ? DONE_OPACITY : undefined,
        cursor: 'pointer',
      }}
      onPointerDown={isRoutine ? undefined : onPointerDown}
      onClick={(e) => {
        // The cell behind this chip selects the day when clicked. Without this,
        // pressing a chip would also swing the day panel open on top of the
        // action just taken.
        e.stopPropagation()
        if (isRoutine) onOpen(event)
      }}
      onKeyDown={
        isRoutine
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onOpen(event)
              }
            }
          : undefined
      }
    >
      {isTask && (
        <span className="shrink-0 text-[10px] leading-none" style={{ color }}>
          {isDone ? '✓' : '○'}
        </span>
      )}
      <span
        className="truncate text-[11px] font-medium leading-tight"
        style={isDone ? { textDecoration: 'line-through' } : undefined}
      >
        {title}
      </span>
    </div>
  )
}
