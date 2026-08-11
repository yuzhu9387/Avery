import type { UseQueryResult } from '@tanstack/react-query'
import { NavLink } from 'react-router-dom'

import { ApiError } from '../api/client'
import type { Evaluation, Tag } from '../api/types'
import { CategoryRail } from './CategoryRail'
import { IconRoutine, IconRules, IconTasks } from './icons'
import { MiniMonth } from './MiniMonth'
import { RatioBars } from './RatioBars'

const FOOTER_LINK =
  'flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-bold transition-colors'
const FOOTER_LINK_ACTIVE = 'bg-[var(--pale)] text-ink'
const FOOTER_LINK_INACTIVE = 'text-ink-muted hover:bg-[var(--pale)]/50 hover:text-ink'

const FOOTER_LINKS = [
  { to: '/tasks', Icon: IconTasks, label: 'Tasks' },
  { to: '/routine', Icon: IconRoutine, label: 'Routine' },
  { to: '/rules', Icon: IconRules, label: 'Rules' },
] as const

/** The calendar's left-hand chrome: mini month, this week's rule ratios, and the
 *  category rail — shared verbatim by WeekPage and MonthPage so switching views
 *  never reflows or re-fetches this column. Collapses in lockstep with the shared
 *  hamburger via the caller's own `railOpen` check, same as before this was split
 *  out of WeekPage. */
export function CalendarSidebar({
  selectedWeekStart,
  onPickDay,
  ratios,
  periodLabel,
  periodStart,
  periodEnd,
  view,
  tags,
  hidden,
  onToggle,
  hideRoutine,
  onToggleHideRoutine,
}: {
  selectedWeekStart: Date
  onPickDay: (day: Date) => void
  ratios: UseQueryResult<Evaluation, Error>
  /** "This week" on the week view, "This month" on the month view. The heading and
   *  the range below it have to agree — a rail headed "This week" showing month
   *  totals is the kind of wrong that reads as correct. */
  periodLabel: string
  /** The period the numbers cover, as naive local `YYYY-MM-DDTHH:MM:SS`; `periodEnd`
   *  is exclusive. Threaded through to the drill-down links so the event list shows
   *  exactly the events the bar was drawn from. */
  periodStart: string
  periodEnd: string
  /** Which calendar this rail is attached to. Threaded onto every link it renders so
   *  `CalendarOverlayShell` can keep that calendar as the backdrop — otherwise every
   *  link opened from the month view dropped the user back onto the week grid, since
   *  the shell renders its base page from the path alone and the overlay paths say
   *  nothing about which calendar you came from. */
  view: 'week' | 'month'
  tags: Tag[]
  hidden: Set<number>
  onToggle: (id: number) => void
  hideRoutine: boolean
  onToggleHideRoutine: () => void
}) {
  const noActiveRule = ratios.error instanceof ApiError && ratios.error.status === 409

  /** `view` is only appended for the month, so week links stay the short default. */
  const withView = (params: Record<string, string>) =>
    `?${new URLSearchParams(view === 'month' ? { ...params, view } : params)}`
  const footerHref = (to: string) => (view === 'month' ? `${to}?view=month` : to)

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-surface">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <MiniMonth selectedWeekStart={selectedWeekStart} onPick={onPickDay} />

        <div className="mt-4 border-t border-line pt-4">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-faint">
            {periodLabel}
          </h2>
          {ratios.isLoading && <p className="text-xs text-ink-faint">Checking your rule…</p>}
          {noActiveRule && (
            <p className="text-xs text-ink-faint">
              No active rule yet — set one on the Rules page to see this period against it.
            </p>
          )}
          {!noActiveRule && ratios.isError && (
            <p className="text-xs text-ink-faint">Couldn't load these ratios.</p>
          )}
          {ratios.data && (
            <RatioBars
              groups={ratios.data.metrics.groups}
              tolerance={ratios.data.rule.tolerance}
              compact
              hrefForGroup={(key) => {
                const label = ratios.data.metrics.groups.find((g) => g.key === key)?.label ?? key
                return `/events${withView({
                  start: periodStart,
                  end: periodEnd,
                  group: key,
                  label: `${label} · ${periodLabel.toLowerCase()}`,
                })}`
              }}
            />
          )}
        </div>

        <div className="mt-4 border-t border-line pt-4">
          <CategoryRail
            hrefForTag={(id) => {
              const name = tags.find((t) => t.id === id)?.name ?? `Tag ${id}`
              return `/events${withView({
                start: periodStart,
                end: periodEnd,
                tag: String(id),
                label: `${name} · ${periodLabel.toLowerCase()}`,
              })}`
            }}
            tags={tags}
            minutesByTag={ratios.data?.metrics.minutes_by_primary_tag ?? {}}
            totalMinutes={ratios.data?.metrics.total_minutes ?? 0}
            hidden={hidden}
            onToggle={onToggle}
            hideRoutine={hideRoutine}
            onToggleHideRoutine={onToggleHideRoutine}
          />
        </div>
      </div>

      {/* Pinned outside the scroll region. Tasks, Routine, and Rules each open as a
       *  sub-window over the calendar (see CalendarOverlayShell) rather than
       *  navigating away, so this rail — and the rest of the calendar underneath —
       *  stays visible on all three. Account and settings join them down here once
       *  they exist. */}
      <div className="shrink-0 border-t border-line p-3">
        {FOOTER_LINKS.map(({ to, Icon, label }, i) => (
          <NavLink
            key={to}
            to={footerHref(to)}
            className={({ isActive }) =>
              [FOOTER_LINK, i < FOOTER_LINKS.length - 1 ? 'mb-0.5' : '', isActive ? FOOTER_LINK_ACTIVE : FOOTER_LINK_INACTIVE].join(' ')
            }
          >
            <Icon />
            {label}
          </NavLink>
        ))}
      </div>
    </aside>
  )
}
