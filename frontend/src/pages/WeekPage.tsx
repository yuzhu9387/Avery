import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError } from '../api/client'
import { qk } from '../api/keys'
import { listTasks } from '../api/tasks'
import { materializeWeek } from '../api/templates'
import type { Task } from '../api/types'
import { RatioBars } from '../components/RatioBars'
import { WeekGrid } from '../components/WeekGrid'
import { useEventDrag } from '../hooks/useEventDrag'
import { useTagMap } from '../hooks/useTags'
import { useWeek, useWeekRatios } from '../hooks/useWeek'
import { addDays, formatDate, mondayOf } from '../lib/datetime'

const NAV_BUTTON = 'rounded-[8px] px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-[var(--pale)]/50 hover:text-ink'

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function rangeLabel(monday: Date): string {
  const end = addDays(monday, 6)
  const start = `${MONTH_NAMES[monday.getMonth()]} ${monday.getDate()}`
  const finish = `${MONTH_NAMES[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`
  return `${start} – ${finish}`
}

export default function WeekPage() {
  const [monday, setMonday] = useState(() => mondayOf(new Date()))
  const day = formatDate(monday)

  const week = useWeek(monday)
  // Gated on `week` resolving first — see the comment on `useWeekRatios` for why
  // firing this in parallel can cache a false "0 minutes" snapshot.
  const ratios = useWeekRatios(monday, week.isSuccess)
  const tagMap = useTagMap()
  const { draft, onPointerDownMove, onPointerDownResize } = useEventDrag()

  const tasksQuery = useQuery({
    // Archived tasks are included for the same reason useTagMap includes archived
    // tags: an old event still points at one and the grid needs its name to render.
    queryKey: qk.tasks({ include_archived: true }),
    queryFn: () => listTasks({ include_archived: true }),
    // Gated on the week query resolving first: `getWeek` can materialize new tasks
    // on read (see week.materialized). Firing this in parallel let it race the
    // materializing request and cache an empty/stale task list for `staleTime`,
    // which is why every block fell back to "Task #N" the first time a week
    // materialized. Waiting for `week` to settle guarantees those tasks already
    // committed by the time this fetch runs.
    enabled: week.isSuccess,
  })
  const taskMap = useMemo(() => {
    const map = new Map<number, Task>()
    for (const task of tasksQuery.data ?? []) map.set(task.id, task)
    return map
  }, [tasksQuery.data])

  const queryClient = useQueryClient()
  const materialize = useMutation({
    mutationFn: () => materializeWeek(day),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.week(day) }),
  })

  const events = week.data?.events ?? []
  const isPastWeek = monday.getTime() < mondayOf(new Date()).getTime()
  const isEmptyPastWeek = isPastWeek && week.isSuccess && events.length === 0

  const noActiveRule = ratios.error instanceof ApiError && ratios.error.status === 409

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-56 shrink-0 overflow-y-auto border-r border-line bg-surface p-4">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-faint">
          This week
        </h2>
        {ratios.isLoading && <p className="text-xs text-ink-faint">Checking your rule…</p>}
        {noActiveRule && (
          <p className="text-xs text-ink-faint">
            No active rule yet — set one on the Rules page to see this week against it.
          </p>
        )}
        {!noActiveRule && ratios.isError && (
          <p className="text-xs text-ink-faint">Couldn't load this week's ratios.</p>
        )}
        {ratios.data && (
          <RatioBars groups={ratios.data.metrics.groups} tolerance={ratios.data.rule.tolerance} compact />
        )}
      </aside>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              aria-label="Previous week"
              className={NAV_BUTTON}
              onClick={() => setMonday((m) => addDays(m, -7))}
            >
              ‹
            </button>
            <button
              type="button"
              className={NAV_BUTTON}
              onClick={() => setMonday(mondayOf(new Date()))}
            >
              Today
            </button>
            <button
              type="button"
              aria-label="Next week"
              className={NAV_BUTTON}
              onClick={() => setMonday((m) => addDays(m, 7))}
            >
              ›
            </button>
          </div>
          <div className="text-sm font-medium text-ink">{rangeLabel(monday)}</div>
          {week.data?.materialized && (
            <div className="text-xs text-ink-faint">Generated from your template</div>
          )}
        </div>

        {isEmptyPastWeek && (
          <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-2">
            <span className="text-sm text-ink-muted">This week has no events.</span>
            <button
              type="button"
              className="rounded-[8px] bg-[var(--pale)] px-3 py-1 text-xs font-medium text-ink transition-opacity hover:opacity-80 disabled:opacity-50"
              disabled={materialize.isPending}
              onClick={() => materialize.mutate()}
            >
              {materialize.isPending ? 'Generating…' : 'Generate from template'}
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1">
          {week.isLoading && <p className="p-4 text-sm text-ink-faint">Loading week…</p>}
          {week.isError && <p className="p-4 text-sm text-ink-faint">Couldn't load this week.</p>}
          {week.isSuccess && (
            <WeekGrid
              weekStart={monday}
              events={events}
              tagMap={tagMap}
              taskMap={taskMap}
              onEventPointerDownMove={onPointerDownMove}
              onEventPointerDownResize={onPointerDownResize}
              draft={draft}
            />
          )}
        </div>
      </div>
    </div>
  )
}
