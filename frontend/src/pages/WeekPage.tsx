import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import { ApiError, errorMessage } from '../api/client'
import { invalidateCalendar } from '../api/invalidate'
import { qk } from '../api/keys'
import { listTasks } from '../api/tasks'
import { materializeWeek } from '../api/templates'
import type { AveryEvent, Task } from '../api/types'
import { CategoryRail } from '../components/CategoryRail'
import { Confetti, type Burst } from '../components/Confetti'
import { QuickCreatePopover } from '../components/QuickCreatePopover'
import { RatioBars } from '../components/RatioBars'
import { WeekGrid, type SlotClick } from '../components/WeekGrid'
import { useEventDrag } from '../hooks/useEventDrag'
import { useEventMutations } from '../hooks/useEventMutations'
import { useGridZoom } from '../hooks/useGridZoom'
import { useTagMap, useTags } from '../hooks/useTags'
import { useTagVisibility } from '../hooks/useTagVisibility'
import { useWeek, useWeekRatios } from '../hooks/useWeek'
import { addDays, formatDate, mondayOf } from '../lib/datetime'
import { minutesToPx } from '../lib/geometry'
import { isEventVisible } from '../lib/tagVisibility'

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
  const navigate = useNavigate()
  const [monday, setMonday] = useState(() => mondayOf(new Date()))
  const day = formatDate(monday)

  const week = useWeek(monday)
  // Gated on `week` resolving first — see the comment on `useWeekRatios` for why
  // firing this in parallel can cache a false "0 minutes" snapshot.
  const ratios = useWeekRatios(monday, week.isSuccess)
  const tagMap = useTagMap()
  const tags = useTags()
  const selectableTags = useMemo(() => (tags.data ?? []).filter((t) => !t.archived), [tags.data])
  // `undefined` (not `[]`) while the tags query hasn't settled — see the comment on
  // useTagVisibility for why that distinction matters: a genuinely-empty tag list and
  // a not-yet-loaded one must never be treated the same way.
  const selectableTagIds = useMemo(
    () => (tags.isSuccess ? selectableTags.map((t) => t.id) : undefined),
    [tags.isSuccess, selectableTags],
  )
  const { hidden, toggle } = useTagVisibility(selectableTagIds)
  const { create, complete, uncomplete } = useEventMutations()
  const [slot, setSlot] = useState<SlotClick | null>(null)

  // A callback ref (via state) rather than a plain useRef: the grid only mounts once
  // `week.isSuccess` (see the conditional render below), so on a cold load a plain
  // ref's object identity never changes and an effect keyed on it would attach to
  // nothing and never retry. Keying zoom and the mount-scroll effect on this state
  // value instead makes them re-run whenever the actual DOM node appears, changes,
  // or disappears.
  const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null)
  const scrolledOnce = useRef(false)
  const { pxPerHour, columnPx } = useGridZoom(gridEl)
  const { draft, beginMove, onPointerDownResize } = useEventDrag(pxPerHour)
  const [burst, setBurst] = useState<Burst | null>(null)
  const clearBurst = useCallback(() => setBurst(null), [])

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

  // Open on waking hours. Without this the full-day grid opens on six empty rows.
  useEffect(() => {
    if (scrolledOnce.current || !gridEl) return
    scrolledOnce.current = true
    gridEl.scrollTop = minutesToPx(7 * 60, pxPerHour)
    // pxPerHour is intentionally excluded: this effect must run once per grid mount
    // (guarded by scrolledOnce above) and must not re-fire when zoom changes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridEl])

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
    // Materialization creates both events and tasks; see invalidateCalendar for why
    // we invalidate every key an event can be seen through.
    onSuccess: () => invalidateCalendar(queryClient),
  })

  const events = week.data?.events ?? []
  const visibleEvents = useMemo(
    () => events.filter((e) => isEventVisible(e.tag_ids, hidden)),
    [events, hidden],
  )
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

        <h2 className="mb-3 mt-6 text-xs font-bold uppercase tracking-wide text-ink-faint">
          Categories
        </h2>
        <CategoryRail
          tags={selectableTags}
          minutesByTag={ratios.data?.metrics.minutes_by_primary_tag ?? {}}
          totalMinutes={ratios.data?.metrics.total_minutes ?? 0}
          hidden={hidden}
          onToggle={toggle}
        />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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

        {(complete.isError || uncomplete.isError) && (
          <div className="border-b border-line px-4 py-2 text-xs" style={{ color: 'var(--over)' }}>
            Couldn't update that card. It's still as it was.
          </div>
        )}

        <div className="min-h-0 flex-1">
          {week.isLoading && <p className="p-4 text-sm text-ink-faint">Loading week…</p>}
          {week.isError && <p className="p-4 text-sm text-ink-faint">Couldn't load this week.</p>}
          {week.isSuccess && (
            <WeekGrid
              weekStart={monday}
              events={visibleEvents}
              tagMap={tagMap}
              taskMap={taskMap}
              onOpen={onOpen}
              onToggleComplete={onToggleComplete}
              onDragStart={beginMove}
              onEventPointerDownResize={onPointerDownResize}
              onEmptyClick={setSlot}
              draft={draft}
              scrollRef={setGridEl}
              pxPerHour={pxPerHour}
              columnPx={columnPx}
            />
          )}
        </div>
      </div>
      {slot && (
        <QuickCreatePopover
          slot={slot}
          tags={tags.data ?? []}
          isPending={create.isPending}
          error={errorMessage(create.error)}
          onClose={() => {
            setSlot(null)
            create.reset()
          }}
          onSave={(draft) =>
            create.mutate(draft, {
              onSuccess: () => setSlot(null),
            })
          }
        />
      )}
      <Confetti burst={burst} onDone={clearBurst} />
    </div>
  )
}
