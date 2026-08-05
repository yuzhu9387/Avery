import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { listEvents } from '../api/events'
import { qk } from '../api/keys'
import { listTasks } from '../api/tasks'
import type { AveryEvent, Task } from '../api/types'
import { DayTagBar } from '../components/DayTagBar'
import { TagChip } from '../components/TagChip'
import { useMonth } from '../hooks/useMonth'
import { useTagMap } from '../hooks/useTags'
import { addDays, formatDate, formatLocal, formatMinutes, formatTimeRange, parseLocal } from '../lib/datetime'

const NAV_BUTTON =
  'rounded-[8px] px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-[var(--pale)]/50 hover:text-ink'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1)
}

/** ISO weeks (and this grid) start Monday. `getDay()` returns 0 for Sunday,
 *  hence the remap — the same one `mondayOf` in lib/datetime.ts uses. */
function leadingBlanks(monthStart: Date): number {
  const day = monthStart.getDay()
  return (day === 0 ? 7 : day) - 1
}

export default function MonthPage() {
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()))
  const [selected, setSelected] = useState<string | null>(null)

  const month = useMonth(viewMonth)
  const tagMap = useTagMap()

  const tasksQuery = useQuery({
    queryKey: qk.tasks({ include_archived: true }),
    queryFn: () => listTasks({ include_archived: true }),
  })
  const taskMap = useMemo(() => {
    const map = new Map<number, Task>()
    for (const task of tasksQuery.data ?? []) map.set(task.id, task)
    return map
  }, [tasksQuery.data])

  const days = month.data?.days ?? []
  const blanks = leadingBlanks(viewMonth)
  const trailing = days.length > 0 ? (7 - ((blanks + days.length) % 7)) % 7 : 0
  const todayKey = formatDate(new Date())

  const selectedDay = days.find((d) => d.date === selected) ?? null

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
        </div>

        {month.isLoading && <p className="p-4 text-sm text-ink-faint">Loading month…</p>}
        {month.isError && <p className="p-4 text-sm text-ink-faint">Couldn't load this month.</p>}

        {month.isSuccess && (
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

              {Array.from({ length: blanks }, (_, i) => (
                <div key={`lead-${i}`} className="min-h-24 border-r border-b border-line" />
              ))}

              {days.map((d) => {
                const isToday = d.date === todayKey
                const isSelected = d.date === selected
                return (
                  <button
                    key={d.date}
                    type="button"
                    onClick={() => setSelected(d.date)}
                    className="flex min-h-24 flex-col gap-1 border-r border-b border-line p-2 text-left transition-colors hover:bg-[var(--pale)]/30"
                    style={{
                      background: isSelected ? 'var(--pale)' : undefined,
                      boxShadow: isToday ? 'inset 0 0 0 2px var(--line-strong)' : undefined,
                    }}
                  >
                    <div className="text-sm text-ink">{Number(d.date.slice(-2))}</div>
                    <div className="text-[11px] text-ink-faint">
                      {formatMinutes(d.total_minutes)} · {d.event_count}
                    </div>
                    <div className="mt-auto">
                      <DayTagBar
                        minutesByPrimaryTag={d.minutes_by_primary_tag}
                        totalMinutes={d.total_minutes}
                        tagMap={tagMap}
                      />
                    </div>
                  </button>
                )
              })}

              {Array.from({ length: trailing }, (_, i) => (
                <div key={`trail-${i}`} className="min-h-24 border-r border-b border-line" />
              ))}
            </div>
          </div>
        )}
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
