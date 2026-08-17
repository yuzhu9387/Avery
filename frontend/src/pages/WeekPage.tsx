import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'

import type { HeaderSlot } from '../App'
import { errorMessage } from '../api/client'
import { invalidateCalendar } from '../api/invalidate'
import { materializeWeek } from '../api/routines'
import type { AveryEvent } from '../api/types'
import { CalendarSidebar } from '../components/CalendarSidebar'
import { CalendarToolbar } from '../components/CalendarToolbar'
import { Confetti, type Burst } from '../components/Confetti'
import { QuickCreatePopover } from '../components/QuickCreatePopover'
import { WeekGrid, type SlotClick } from '../components/WeekGrid'
import { useEventDrag } from '../hooks/useEventDrag'
import { useEventMutations } from '../hooks/useEventMutations'
import { useGridZoom } from '../hooks/useGridZoom'
import { useHideRoutine } from '../hooks/useHideRoutine'
import { useTagMap, useTags } from '../hooks/useTags'
import { useTagVisibility } from '../hooks/useTagVisibility'
import { useExternalSync } from '../hooks/useExternalSync'
import { useIntegrations } from '../hooks/useAuth'
import { useWeek, useWeekRatios, weekRange } from '../hooks/useWeek'
import { addDays, formatDate, mondayOf, parseLocal } from '../lib/datetime'
import { minutesToPx } from '../lib/geometry'
import { isEventVisible } from '../lib/tagVisibility'

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** The Monday of `param`, or of today when the param is missing or unparseable.
 *  Unguarded, `?week=garbage` yields an Invalid Date that propagates into every
 *  query key and time calculation on the page. */
function weekOf(param: string | null): Date {
  if (param) {
    const parsed = parseLocal(param)
    if (!Number.isNaN(parsed.getTime())) return mondayOf(parsed)
  }
  return mondayOf(new Date())
}

function rangeLabel(monday: Date): string {
  const end = addDays(monday, 6)
  const start = `${MONTH_NAMES[monday.getMonth()]} ${monday.getDate()}`
  const finish = `${MONTH_NAMES[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`
  return `${start} – ${finish}`
}

export default function WeekPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { railOpen } = useOutletContext<HeaderSlot>()
  // The week on screen lives in `?week=YYYY-MM-DD` rather than local state, so it
  // survives opening Tasks/Routine/Rules and coming back, and so the month view's
  // mini-calendar can link straight to a chosen week instead of dumping the user on
  // whatever week this page happened to be showing.
  const [params, setParams] = useSearchParams()
  const weekParam = params.get('week')
  const monday = useMemo(() => weekOf(weekParam), [weekParam])

  // `replace`, not `push`: stepping through weeks with the arrows should not fill the
  // back stack with a dozen entries. Arriving here *from* the month view is a real
  // navigation and pushes, so Back still returns to the month.
  const setMonday = useCallback(
    (next: Date) => {
      setParams(
        (prev) => {
          prev.set('week', formatDate(mondayOf(next)))
          return prev
        },
        { replace: true },
      )
    },
    [setParams],
  )
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

  // The connected external calendar, drawn over the week but never counted: the
  // rail's numbers come straight through: external events are MIRRORED into the
  // events table (see services/external_sync.py), so the week read below already
  // contains them — categorised, overlap-laid-out, and counted once tagged. This
  // hook only refreshes the mirrors for the visible window.
  const integrations = useIntegrations()
  const googleConnected = !!integrations.data?.google.calendar?.connected
  const larkConnected = !!integrations.data?.lark.calendar?.connected
  // One rail row per connected calendar, each toggling its own provider.
  const externalCalendars = (['google', 'lark'] as const)
    .map((provider) => ({
      provider,
      email: integrations.data?.[provider].calendar?.account_email ?? '',
      connected: !!integrations.data?.[provider].calendar?.connected,
    }))
    .filter((c) => c.connected)

  const [hiddenSources, setHiddenSources] = useState<string[]>([])
  const range = weekRange(monday)
  useExternalSync('google', range.start, range.end, googleConnected)
  useExternalSync('lark', range.start, range.end, larkConnected)
  const { hideRoutine, toggle: toggleHideRoutine } = useHideRoutine()
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

  const queryClient = useQueryClient()
  const materialize = useMutation({
    mutationFn: () => materializeWeek(day),
    // Materialization creates both events and tasks; see invalidateCalendar for why
    // we invalidate every key an event can be seen through.
    onSuccess: () => invalidateCalendar(queryClient),
  })

  const events = week.data?.events ?? []
  const visibleEvents = useMemo(
    () =>
      events.filter((e) => {
        const external = e.source === 'google' || e.source === 'lark'
        if (external && hiddenSources.includes(e.source)) return false
        // Untagged mirrors stay visible even when tags are used to hide things:
        // the tag filter is about Avery's taxonomy, and a mirror with no tag yet
        // has not joined it — hiding it would make freshly synced events vanish.
        if (!external && !isEventVisible(e.tag_ids, hidden)) return false
        if (external && e.tag_ids.length > 0 && !isEventVisible(e.tag_ids, hidden)) return false
        if (hideRoutine && e.source === 'routine') return false
        return true
      }),
    [events, hidden, hideRoutine, hiddenSources],
  )
  const isPastWeek = monday.getTime() < mondayOf(new Date()).getTime()
  const isEmptyPastWeek = isPastWeek && week.isSuccess && events.length === 0

  return (
    <div className="flex h-full min-h-0">
      {railOpen && (
        <CalendarSidebar
          selectedWeekStart={monday}
          // Picking a day in the mini calendar always LANDS on the week view. When a
          // panel (Tasks/Routine/Rules/Account) is open, this page is only the
          // backdrop — silently switching the week behind the panel looks like the
          // click did nothing, so navigate to the week itself instead.
          onPickDay={(day) =>
            location.pathname === '/'
              ? setMonday(mondayOf(day))
              : navigate(`/?week=${formatDate(mondayOf(day))}`)
          }
          ratios={ratios}
          view="week"
          periodLabel="This week"
          periodStart={weekRange(monday).start}
          periodEnd={weekRange(monday).end}
          tags={selectableTags}
          externalCalendars={externalCalendars}
          hiddenSources={hiddenSources}
          onToggleSource={(provider) =>
            setHiddenSources((prev) =>
              prev.includes(provider)
                ? prev.filter((p) => p !== provider)
                : [...prev, provider],
            )
          }
          hidden={hidden}
          onToggle={toggle}
          hideRoutine={hideRoutine}
          onToggleHideRoutine={toggleHideRoutine}
        />
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <CalendarToolbar
          title={rangeLabel(monday)}
          onPrev={() => setMonday(addDays(monday, -7))}
          onNext={() => setMonday(addDays(monday, 7))}
          onToday={() => setMonday(mondayOf(new Date()))}
        />

        {week.data?.materialized && (
          <div className="border-b border-line px-4 py-1.5 text-xs text-ink-faint">
            Generated from your routine
          </div>
        )}

        {isEmptyPastWeek && (
          <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-2">
            <span className="text-sm text-ink-muted">This week has no events.</span>
            <button
              type="button"
              className="rounded-[8px] bg-[var(--pale)] px-3 py-1 text-xs font-medium text-ink transition-opacity hover:opacity-80 disabled:opacity-50"
              disabled={materialize.isPending}
              onClick={() => materialize.mutate()}
            >
              {materialize.isPending ? 'Generating…' : 'Generate from routine'}
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
