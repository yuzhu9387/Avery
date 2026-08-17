import type { UseQueryResult } from '@tanstack/react-query'
import { NavLink } from 'react-router-dom'

import { ApiError } from '../api/client'
import type { Evaluation, Tag } from '../api/types'
import { useMe } from '../hooks/useAuth'
import { avatarColor, avatarInitial } from '../lib/avatar'
import { formatDate } from '../lib/datetime'
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
  externalCalendars,
  hiddenSources,
  onToggleSource,
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
  /** Connected external calendars, in display order. Each is a SOURCE toggle:
   *  their events are ordinary categorised events in every total. */
  externalCalendars: { provider: 'google' | 'lark'; email: string }[]
  /** Providers whose events are currently hidden from the calendar. */
  hiddenSources: string[]
  onToggleSource: (provider: string) => void
}) {
  const noActiveRule = ratios.error instanceof ApiError && ratios.error.status === 409

  // Already resolved by the AuthGate before anything under it renders, so this reads
  // straight from the cache — no second /auth/me request, no loading state to design.
  const user = useMe().data

  /** What every link out of this rail has to carry so the calendar behind the panel
   *  stays where the user left it: which view, and — for the week view — which week.
   *  Without the week, opening Tasks from a future week snapped the backdrop back to
   *  today, the same way opening anything from the month view used to snap to the
   *  week grid. */
  const context: Record<string, string> =
    view === 'month'
      ? { view }
      : { week: formatDate(selectedWeekStart) }

  const linkTo = (to: string, params: Record<string, string> = {}) =>
    `${to}?${new URLSearchParams({ ...params, ...context })}`

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
                return linkTo('/events', {
                  start: periodStart,
                  end: periodEnd,
                  group: key,
                  label: `${label} · ${periodLabel.toLowerCase()}`,
                })
              }}
            />
          )}
        </div>

        <div className="mt-4 border-t border-line pt-4">
          <CategoryRail
            hrefForTag={(id) => {
              const name = tags.find((t) => t.id === id)?.name ?? `Tag ${id}`
              return linkTo('/events', {
                start: periodStart,
                end: periodEnd,
                tag: String(id),
                label: `${name} · ${periodLabel.toLowerCase()}`,
              })
            }}
            tags={tags}
            minutesByTag={ratios.data?.metrics.minutes_by_primary_tag ?? {}}
            totalMinutes={ratios.data?.metrics.total_minutes ?? 0}
            hidden={hidden}
            onToggle={onToggle}
            hideRoutine={hideRoutine}
            onToggleHideRoutine={onToggleHideRoutine}
          />

          {externalCalendars.length > 0 && (
            /* Below a divider and outside CategoryRail: the rows above are Avery's
               own tags, aggregated by minutes. These are SOURCES, not categories —
               each mirrored event carries an Avery tag of its own and is counted
               under that tag above. This section only toggles their visibility. */
            <div className="mt-3 border-t border-line pt-3">
              <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wide text-ink-faint">
                External calendars
              </h3>
              {externalCalendars.map(({ provider, email }) => (
                <label
                  key={provider}
                  className="flex cursor-pointer items-center gap-2 py-[3px]"
                >
                  <input
                    type="checkbox"
                    checked={!hiddenSources.includes(provider)}
                    onChange={() => onToggleSource(provider)}
                    aria-label={`Show events from ${email}`}
                  />
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: `var(--external-${provider})` }}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">
                    {/* Provider first: the same address is often connected to both,
                        and two identical rows tell you nothing about which is which. */}
                    <span className="capitalize">{provider}</span>
                    {email && <span className="text-ink-faint"> · {email}</span>}
                  </span>
                </label>
              ))}
            </div>
          )}
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
            to={linkTo(to)}
            className={({ isActive }) =>
              [FOOTER_LINK, i < FOOTER_LINKS.length - 1 ? 'mb-0.5' : '', isActive ? FOOTER_LINK_ACTIVE : FOOTER_LINK_INACTIVE].join(' ')
            }
          >
            <Icon />
            {label}
          </NavLink>
        ))}

        {/* The account row: same linkTo() as the footer links above, so opening
         *  Account keeps the calendar behind the panel on the week/month the user
         *  was looking at instead of snapping back to today. */}
        {user && (
          <div className="mt-2 border-t border-line pt-2">
            <NavLink
              to={linkTo('/account')}
              className={({ isActive }) =>
                [
                  'flex items-center gap-2 rounded-full px-2 py-1.5 transition-colors',
                  isActive ? 'bg-[var(--pale)]' : 'hover:bg-[var(--pale)]/50',
                ].join(' ')
              }
            >
              <span
                aria-hidden
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-ink"
                style={{ background: avatarColor(user.id) }}
              >
                {avatarInitial(user.name, user.email)}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-bold text-ink">{user.name}</span>
                <span className="truncate text-[11px] text-ink-faint">{user.email}</span>
              </span>
            </NavLink>
          </div>
        )}
      </div>
    </aside>
  )
}
