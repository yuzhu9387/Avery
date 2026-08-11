import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'

import { listEvents } from '../api/events'
import { qk } from '../api/keys'
import type { AveryEvent } from '../api/types'
import { useRules } from '../hooks/useRules'
import { useTagMap } from '../hooks/useTags'
import { formatMinutes, formatTimeRange, parseLocal } from '../lib/datetime'

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function dayHeading(dateKey: string): string {
  const d = parseLocal(dateKey)
  return `${MONTH[d.getMonth()]} ${d.getDate()}, ${WEEKDAY[d.getDay()]}`
}

function eventMinutes(event: AveryEvent): number {
  return Math.max(
    0,
    Math.round((parseLocal(event.end_at).getTime() - parseLocal(event.start_at).getTime()) / 60000),
  )
}

/**
 * Every event in a period, grouped by day — the list behind a bar or a category in
 * the left rail.
 *
 * Driven entirely by the URL (`?start&end&tag|group&label`) rather than router state,
 * so the view survives a reload and can be linked to. `start`/`end` are the naive
 * local `YYYY-MM-DDTHH:MM:SS` the rest of the app uses; `end` is exclusive.
 *
 * Filtering happens here rather than server-side because the rail's own numbers come
 * from the same `/api/events` range the calendar already has cached — asking the
 * server for a filtered copy would be a second source of truth for "which events are
 * in this bar", and the two could disagree.
 */
export default function EventsListPage() {
  const [params] = useSearchParams()
  const start = params.get('start')
  const end = params.get('end')
  const tagParam = params.get('tag')
  const groupParam = params.get('group')
  const label = params.get('label')

  const tagMap = useTagMap()
  const rulesQuery = useRules()

  const range = start && end ? { start, end } : undefined
  const eventsQuery = useQuery({
    queryKey: qk.events(range ?? {}),
    queryFn: () => listEvents(range),
  })
  /** Which tags this view is restricted to, or `null` for "no filter".
   *
   *  A `group` is resolved through the *active* rule, which is the same rule the
   *  rail drew its bars from — resolving it against any other version would list
   *  events that were never in the bar that was clicked. */
  const filterTagIds = useMemo<Set<number> | null>(() => {
    if (tagParam) {
      const id = Number(tagParam)
      return Number.isFinite(id) ? new Set([id]) : null
    }
    if (groupParam) {
      const active = (rulesQuery.data ?? []).find((r) => r.effective_to === null)
      const group = active?.groups.find((g) => g.key === groupParam)
      // An unknown group key filters to nothing rather than falling through to
      // "everything" — showing the whole period under a group's heading would be a
      // quiet lie about what the user clicked.
      return new Set(group?.tag_ids ?? [])
    }
    return null
  }, [tagParam, groupParam, rulesQuery.data])

  const byDay = useMemo(() => {
    const map = new Map<string, AveryEvent[]>()
    for (const event of eventsQuery.data ?? []) {
      if (filterTagIds && !event.tag_ids.some((id) => filterTagIds.has(id))) continue
      // `start_at` is naive local, so the date is its prefix — grouped by the day an
      // event *starts*, the same rule the month grid uses.
      const key = event.start_at.slice(0, 10)
      const list = map.get(key)
      if (list) list.push(event)
      else map.set(key, [event])
    }
    for (const list of map.values()) list.sort((a, b) => a.start_at.localeCompare(b.start_at))
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [eventsQuery.data, filterTagIds])

  const total = byDay.reduce((sum, [, list]) => sum + list.reduce((s, e) => s + eventMinutes(e), 0), 0)
  const count = byDay.reduce((sum, [, list]) => sum + list.length, 0)

  if (eventsQuery.isLoading) return <p className="p-5 text-sm text-ink-faint">Loading events…</p>
  if (eventsQuery.isError) return <p className="p-5 text-sm text-ink-faint">Couldn't load events.</p>

  return (
    <div className="p-4 sm:p-5">
      <div className="mb-4">
        <h1 className="font-display text-xl text-ink">{label ?? 'Events'}</h1>
        <p className="text-xs text-ink-faint">
          {count} event{count === 1 ? '' : 's'} · {formatMinutes(total)}
          {start && end ? ` · ${start.slice(0, 10)} – ${end.slice(0, 10)}` : ''}
        </p>
      </div>

      {byDay.length === 0 ? (
        <p className="text-sm text-ink-faint">Nothing here in this period.</p>
      ) : (
        <div className="flex flex-col gap-5">
          {byDay.map(([dateKey, list]) => (
            <section key={dateKey}>
              <h2 className="mb-1.5 flex items-baseline gap-2 text-xs font-bold uppercase tracking-wide text-ink-faint">
                {dayHeading(dateKey)}
                <span className="font-normal normal-case tracking-normal">
                  {formatMinutes(list.reduce((s, e) => s + eventMinutes(e), 0))}
                </span>
              </h2>
              <ul className="overflow-hidden rounded-[12px] border border-line bg-surface">
                {list.map((event) => {
                  const tag = tagMap.get(event.tag_ids[0])
                  const done = event.completed_at !== null
                  return (
                    <li
                      key={event.id}
                      className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0"
                    >
                      <Link
                        to={`/events/${event.id}`}
                        className="min-w-0 flex-1 truncate text-sm text-ink hover:underline"
                        style={done ? { textDecoration: 'line-through', opacity: 0.55 } : undefined}
                      >
                        {event.title}
                      </Link>
                      <span className="w-[104px] shrink-0 text-right text-xs tabular-nums text-ink-faint">
                        {formatTimeRange(event.start_at, event.end_at)}
                      </span>
                      <span className="w-[58px] shrink-0 text-right text-xs tabular-nums text-ink-muted">
                        {formatMinutes(eventMinutes(event))}
                      </span>
                      <span className="flex w-[124px] shrink-0 items-center gap-1.5">
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: tag?.color ?? 'var(--line-strong)' }}
                        />
                        <span className="truncate text-xs leading-[1.45] text-ink-muted">
                          {tag?.name ?? 'Uncategorized'}
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
