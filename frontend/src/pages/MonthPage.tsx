import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'

import { listEvents } from '../api/events'
import { qk } from '../api/keys'
import { listTasks } from '../api/tasks'
import type { AveryEvent, MonthDay, Task } from '../api/types'
import { Confetti, type Burst } from '../components/Confetti'
import { DayTagBar } from '../components/DayTagBar'
import { MonthChip } from '../components/MonthChip'
import { TagChip } from '../components/TagChip'
import { useEventMutations } from '../hooks/useEventMutations'
import { useMonth } from '../hooks/useMonth'
import { useTagMap } from '../hooks/useTags'
import { addDays, formatDate, formatLocal, formatMinutes, formatTimeRange, parseLocal } from '../lib/datetime'
import { type MonthCell, buildCells } from '../lib/monthGrid'

const NAV_BUTTON =
  'rounded-[8px] px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-[var(--pale)]/50 hover:text-ink'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Every cell is this tall, whatever it holds — a day with twelve cards is the same
 *  size as an empty one, and overflow scrolls inside the cell instead of stretching
 *  its row. Without a fixed height one busy day drags all seven of its neighbours
 *  down with it and the month stops being scannable as a grid. */
const CELL_HEIGHT_PX = 132

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1)
}

export default function MonthPage() {
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()))
  const [selected, setSelected] = useState<string | null>(null)
  const [burst, setBurst] = useState<Burst | null>(null)
  const clearBurst = useCallback(() => setBurst(null), [])
  const navigate = useNavigate()

  const month = useMonth(viewMonth)
  const tagMap = useTagMap()
  const { complete, uncomplete } = useEventMutations()

  const cells = useMemo(() => buildCells(viewMonth), [viewMonth])
  const rangeStart = formatLocal(parseLocal(cells[0].date))
  const rangeEnd = formatLocal(addDays(parseLocal(cells[cells.length - 1].date), 1))

  // One request for the whole visible grid, rather than one per cell.
  const eventsQuery = useQuery({
    queryKey: qk.events({ start: rangeStart, end: rangeEnd }),
    queryFn: () => listEvents({ start: rangeStart, end: rangeEnd }),
  })

  const tasksQuery = useQuery({
    queryKey: qk.tasks({ include_archived: true }),
    queryFn: () => listTasks({ include_archived: true }),
  })
  const taskMap = useMemo(() => {
    const map = new Map<number, Task>()
    for (const task of tasksQuery.data ?? []) map.set(task.id, task)
    return map
  }, [tasksQuery.data])

  /** Cards grouped by the day they *start*. An event running past midnight belongs
   *  to the day it began, which is the same rule the backend uses to decide whether
   *  a routine day is occupied — a card that appeared in two cells would be counted
   *  twice by eye and read as a duplicate. */
  const eventsByDay = useMemo(() => {
    const map = new Map<string, AveryEvent[]>()
    for (const event of eventsQuery.data ?? []) {
      // `start_at` is a naive local `YYYY-MM-DDTHH:MM:SS`, so the date is its prefix.
      // Going through Date here would reintroduce the timezone shift that this
      // format exists to avoid.
      const key = event.start_at.slice(0, 10)
      const list = map.get(key)
      if (list) list.push(event)
      else map.set(key, [event])
    }
    for (const list of map.values()) list.sort((a, b) => a.start_at.localeCompare(b.start_at))
    return map
  }, [eventsQuery.data])

  const aggregates = useMemo(() => {
    const map = new Map<string, MonthDay>()
    for (const day of month.data?.days ?? []) map.set(day.date, day)
    return map
  }, [month.data])

  const todayKey = formatDate(new Date())
  const selectedDay = selected ? aggregates.get(selected) ?? null : null

  const onOpen = useCallback((event: AveryEvent) => navigate(`/events/${event.id}`), [navigate])

  const onToggleComplete = useCallback(
    (event: AveryEvent, point: { x: number; y: number }) => {
      if (event.completed_at) {
        uncomplete.mutate(event.id)
        return
      }
      complete.mutate(event.id)
      // Only on completion. Reopening a card is a correction, not an achievement.
      setBurst({ id: Date.now(), x: point.x, y: point.y })
    },
    [complete, uncomplete],
  )

  return (
    // Below `lg`, the grid and the day panel stack and the whole column scrolls
    // together — giving the panel a fixed flex sibling squeezed the grid down to a
    // sliver whenever the event list was tall. At `lg` and up they sit side by side,
    // each scrolling independently within the shared height.
    <div className="flex h-full min-h-0 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <div className="flex flex-col lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              aria-label="Previous month"
              className={NAV_BUTTON}
              onClick={() => setViewMonth((m) => addMonths(m, -1))}
            >
              ‹
            </button>
            <button
              type="button"
              className={NAV_BUTTON}
              onClick={() => setViewMonth(startOfMonth(new Date()))}
            >
              Today
            </button>
            <button
              type="button"
              aria-label="Next month"
              className={NAV_BUTTON}
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
            >
              ›
            </button>
          </div>
          <div className="text-sm font-medium text-ink">
            {MONTH_NAMES[viewMonth.getMonth()]} {viewMonth.getFullYear()}
          </div>
          <div className="ml-auto text-xs text-ink-faint">Double-click a card to mark it done</div>
        </div>

        {(complete.isError || uncomplete.isError) && (
          <p className="border-b border-line px-4 py-2 text-xs text-ink-faint">
            Couldn't update that card. It may have been changed elsewhere.
          </p>
        )}

        {month.isError && <p className="p-4 text-sm text-ink-faint">Couldn't load this month.</p>}
        {eventsQuery.isError && !month.isError && (
          <p className="p-4 text-sm text-ink-faint">Couldn't load this month's cards.</p>
        )}

        <div className="p-4">
          <div className="grid grid-cols-7 border-t border-l border-line">
            {WEEKDAY_LABELS.map((label) => (
              <div
                key={label}
                className="border-r border-b border-line px-2 py-1 text-center text-[11px] uppercase tracking-wide text-ink-faint"
              >
                {label}
              </div>
            ))}

            {cells.map((cell) => (
              <DayCell
                key={cell.date}
                cell={cell}
                aggregate={aggregates.get(cell.date)}
                events={eventsByDay.get(cell.date) ?? []}
                isToday={cell.date === todayKey}
                isSelected={cell.date === selected}
                tagMap={tagMap}
                taskMap={taskMap}
                onSelect={() => setSelected(cell.date)}
                onOpen={onOpen}
                onToggleComplete={onToggleComplete}
              />
            ))}
          </div>
        </div>
      </div>

      {selected && (
        <DayPanel
          date={selected}
          total={selectedDay?.total_minutes ?? 0}
          eventCount={selectedDay?.event_count ?? 0}
          tagMap={tagMap}
          taskMap={taskMap}
          onClose={() => setSelected(null)}
        />
      )}

      <Confetti burst={burst} onDone={clearBurst} />
    </div>
  )
}

function DayCell({
  cell,
  aggregate,
  events,
  isToday,
  isSelected,
  tagMap,
  taskMap,
  onSelect,
  onOpen,
  onToggleComplete,
}: {
  cell: MonthCell
  aggregate: MonthDay | undefined
  events: AveryEvent[]
  isToday: boolean
  isSelected: boolean
  tagMap: ReturnType<typeof useTagMap>
  taskMap: Map<number, Task>
  onSelect: () => void
  onOpen: (event: AveryEvent) => void
  onToggleComplete: (event: AveryEvent, point: { x: number; y: number }) => void
}) {
  return (
    // A plain div, not a button: the cards inside are their own press targets, and
    // nesting them in a button is invalid markup that swallows their pointer events.
    // The day number below stays a real button so the day panel is still reachable
    // from the keyboard.
    <div
      className="flex flex-col overflow-hidden border-r border-b border-line transition-colors hover:bg-[var(--pale)]/20"
      style={{
        height: CELL_HEIGHT_PX,
        background: isSelected ? 'var(--pale)' : undefined,
        boxShadow: isToday ? 'inset 0 0 0 2px var(--line-strong)' : undefined,
        opacity: cell.inMonth ? undefined : 0.55,
      }}
      onClick={onSelect}
    >
      <div className="flex shrink-0 items-baseline justify-between px-2 pt-1.5">
        <button
          type="button"
          aria-label={`View ${cell.date}`}
          className="text-sm text-ink hover:underline"
          onClick={onSelect}
        >
          {Number(cell.date.slice(-2))}
        </button>
        {aggregate && aggregate.event_count > 0 && (
          <span className="text-[10px] text-ink-faint">{formatMinutes(aggregate.total_minutes)}</span>
        )}
      </div>

      {/* `min-h-0` is what makes this scroll rather than push the cell taller. */}
      <div className="flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto px-1.5 py-1">
        {events.map((event) => (
          <MonthChip
            key={event.id}
            event={event}
            tag={tagMap.get(event.tag_ids[0])}
            title={taskMap.get(event.task_id)?.name ?? `Task #${event.task_id}`}
            onOpen={onOpen}
            onToggleComplete={onToggleComplete}
          />
        ))}
      </div>

      {aggregate && (
        <div className="shrink-0 px-1.5 pb-1.5">
          <DayTagBar
            minutesByPrimaryTag={aggregate.minutes_by_primary_tag}
            totalMinutes={aggregate.total_minutes}
            tagMap={tagMap}
          />
        </div>
      )}
    </div>
  )
}

function DayPanel({
  date,
  total,
  eventCount,
  tagMap,
  taskMap,
  onClose,
}: {
  date: string
  total: number
  eventCount: number
  tagMap: ReturnType<typeof useTagMap>
  taskMap: Map<number, Task>
  onClose: () => void
}) {
  const dayStart = parseLocal(date)
  const start = formatLocal(dayStart)
  const end = formatLocal(addDays(dayStart, 1))

  const eventsQuery = useQuery({
    queryKey: qk.events({ start, end }),
    queryFn: () => listEvents({ start, end }),
  })

  const events = [...(eventsQuery.data ?? [])].sort((a, b) => a.start_at.localeCompare(b.start_at))

  return (
    <aside className="flex w-full shrink-0 flex-col border-t border-line bg-surface p-4 lg:w-80 lg:min-h-0 lg:overflow-y-auto lg:border-t-0 lg:border-l">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink">{date}</h2>
        <button type="button" className="text-xs text-ink-faint hover:text-ink" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="mb-3 text-xs text-ink-muted">
        {formatMinutes(total)} · {eventCount} event{eventCount === 1 ? '' : 's'}
      </div>

      {eventsQuery.isLoading && <p className="text-xs text-ink-faint">Loading…</p>}
      {eventsQuery.isError && <p className="text-xs text-ink-faint">Couldn't load this day's events.</p>}

      <ul className="flex flex-col gap-3">
        {events.map((event: AveryEvent) => (
          <li key={event.id} className="border-b border-line pb-2 last:border-b-0">
            <div className="text-xs text-ink-faint">{formatTimeRange(event.start_at, event.end_at)}</div>
            <Link to={`/tasks/${event.task_id}`} className="text-sm text-ink hover:underline">
              {taskMap.get(event.task_id)?.name ?? `Task #${event.task_id}`}
            </Link>
            {event.tag_ids.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {event.tag_ids.map((id) => (
                  <TagChip key={id} tag={tagMap.get(id)} size="xs" />
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>

      {eventsQuery.isSuccess && events.length === 0 && (
        <p className="text-xs text-ink-faint">No events this day.</p>
      )}
    </aside>
  )
}
