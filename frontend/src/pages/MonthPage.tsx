import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'

import type { HeaderSlot } from '../App'
import { listEvents } from '../api/events'
import { qk } from '../api/keys'
import { listTasks } from '../api/tasks'
import type { AveryEvent, MonthDay, Task } from '../api/types'
import { CalendarSidebar } from '../components/CalendarSidebar'
import { CalendarToolbar } from '../components/CalendarToolbar'
import { Confetti, type Burst } from '../components/Confetti'
import { DayTagBar } from '../components/DayTagBar'
import { MonthChip } from '../components/MonthChip'
import { TagChip } from '../components/TagChip'
import { useEventMutations } from '../hooks/useEventMutations'
import { useHideRoutine } from '../hooks/useHideRoutine'
import { useMonth } from '../hooks/useMonth'
import { useTagMap, useTags } from '../hooks/useTags'
import { useTagVisibility } from '../hooks/useTagVisibility'
import { monthRange, usePeriodRatios, useWeek } from '../hooks/useWeek'
import { addDays, formatDate, formatLocal, formatMinutes, formatTimeRange, mondayOf, parseLocal } from '../lib/datetime'
import { isEventVisible } from '../lib/tagVisibility'
import { type MonthCell, buildCells } from '../lib/monthGrid'

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
  const { railOpen } = useOutletContext<HeaderSlot>()
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()))
  const [selected, setSelected] = useState<string | null>(null)
  const [burst, setBurst] = useState<Burst | null>(null)
  const clearBurst = useCallback(() => setBurst(null), [])
  const navigate = useNavigate()

  // The sidebar's mini-month/ratios/categories are the same regardless of which
  // month the grid is browsing — they always describe the *actual* current week,
  // exactly as they do on WeekPage. `useState` (not a bare call) keeps the value
  // stable across this component's own re-renders, matching WeekPage's pattern.
  const [thisWeekMonday] = useState(() => mondayOf(new Date()))
  const week = useWeek(thisWeekMonday)
  // The month on screen, not the current week: the rail sits beside a month grid, so
  // its heading and its numbers both have to be monthly (item 4).
  const period = monthRange(viewMonth)
  const ratios = usePeriodRatios(period.start, period.end, week.isSuccess)
  const tags = useTags()
  const selectableTags = useMemo(() => (tags.data ?? []).filter((t) => !t.archived), [tags.data])
  const selectableTagIds = useMemo(
    () => (tags.isSuccess ? selectableTags.map((t) => t.id) : undefined),
    [tags.isSuccess, selectableTags],
  )
  const { hidden, toggle } = useTagVisibility(selectableTagIds)
  const { hideRoutine, toggle: toggleHideRoutine } = useHideRoutine()

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

  // The hidden-category and hide-routine toggles only ever affect which cards draw
  // client-side, here and in DayPanel below — the aggregate totals each cell shows
  // (from `month.data`, the server month payload) are untouched, same as their
  // per-day minutes always have been regardless of the rail's checkboxes.
  const visibleEvents = useMemo(
    () =>
      (eventsQuery.data ?? []).filter(
        (e) => isEventVisible(e.tag_ids, hidden) && (!hideRoutine || e.source !== 'routine'),
      ),
    [eventsQuery.data, hidden, hideRoutine],
  )

  /** Cards grouped by the day they *start*. An event running past midnight belongs
   *  to the day it began, which is the same rule the backend uses to decide whether
   *  a routine day is occupied — a card that appeared in two cells would be counted
   *  twice by eye and read as a duplicate. */
  const eventsByDay = useMemo(() => {
    const map = new Map<string, AveryEvent[]>()
    for (const event of visibleEvents) {
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
  }, [visibleEvents])

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
    <div className="flex h-full min-h-0">
      {railOpen && (
        <CalendarSidebar
          selectedWeekStart={thisWeekMonday}
          // A day picked here can't carry the click through to WeekPage without
          // lifting week state up to App — out of scope for this pass. Landing on
          // whatever week WeekPage was last showing is a known limitation.
          onPickDay={() => navigate('/')}
          ratios={ratios}
          view="month"
          periodLabel="This month"
          periodStart={period.start}
          periodEnd={period.end}
          tags={selectableTags}
          hidden={hidden}
          onToggle={toggle}
          hideRoutine={hideRoutine}
          onToggleHideRoutine={toggleHideRoutine}
        />
      )}

      {/* Below `lg`, the grid and the day panel stack and the whole column scrolls
          together — giving the panel a fixed flex sibling squeezed the grid down to a
          sliver whenever the event list was tall. At `lg` and up they sit side by side,
          each scrolling independently within the shared height. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <div className="flex flex-col lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          <CalendarToolbar
            title={`${MONTH_NAMES[viewMonth.getMonth()]} ${viewMonth.getFullYear()}`}
            onPrev={() => setViewMonth((m) => addMonths(m, -1))}
            onNext={() => setViewMonth((m) => addMonths(m, 1))}
            onToday={() => setViewMonth(startOfMonth(new Date()))}
          />
          <div className="border-b border-line px-4 py-1.5 text-right text-xs text-ink-faint">
            Double-click a card to mark it done
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
            hidden={hidden}
            hideRoutine={hideRoutine}
            onClose={() => setSelected(null)}
          />
        )}
      </div>

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
  hidden,
  hideRoutine,
  onClose,
}: {
  date: string
  total: number
  eventCount: number
  tagMap: ReturnType<typeof useTagMap>
  taskMap: Map<number, Task>
  hidden: Set<number>
  hideRoutine: boolean
  onClose: () => void
}) {
  const dayStart = parseLocal(date)
  const start = formatLocal(dayStart)
  const end = formatLocal(addDays(dayStart, 1))

  const eventsQuery = useQuery({
    queryKey: qk.events({ start, end }),
    queryFn: () => listEvents({ start, end }),
  })

  // `total`/`eventCount` above come from the server month payload and stay as they
  // are — see the comment on `visibleEvents` in MonthPage — but the list rendered
  // below is client-side, so it gets the same filter WeekPage and the grid apply.
  const events = (eventsQuery.data ?? [])
    .filter((e) => isEventVisible(e.tag_ids, hidden) && (!hideRoutine || e.source !== 'routine'))
    .sort((a, b) => a.start_at.localeCompare(b.start_at))

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
