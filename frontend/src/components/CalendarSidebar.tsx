import type { UseQueryResult } from '@tanstack/react-query'
import { NavLink } from 'react-router-dom'

import { ApiError } from '../api/client'
import type { Evaluation, Tag } from '../api/types'
import { CategoryRail } from './CategoryRail'
import { MiniMonth } from './MiniMonth'
import { RatioBars } from './RatioBars'

const FOOTER_LINK =
  'block rounded-full px-3 py-1.5 text-sm font-bold transition-colors'
const FOOTER_LINK_ACTIVE = 'bg-[var(--pale)] text-ink'
const FOOTER_LINK_INACTIVE = 'text-ink-muted hover:bg-[var(--pale)]/50 hover:text-ink'

/** The calendar's left-hand chrome: mini month, this week's rule ratios, and the
 *  category rail — shared verbatim by WeekPage and MonthPage so switching views
 *  never reflows or re-fetches this column. Collapses in lockstep with the shared
 *  hamburger via the caller's own `railOpen` check, same as before this was split
 *  out of WeekPage. */
export function CalendarSidebar({
  selectedWeekStart,
  onPickDay,
  ratios,
  tags,
  hidden,
  onToggle,
  hideRoutine,
  onToggleHideRoutine,
}: {
  selectedWeekStart: Date
  onPickDay: (day: Date) => void
  ratios: UseQueryResult<Evaluation, Error>
  tags: Tag[]
  hidden: Set<number>
  onToggle: (id: number) => void
  hideRoutine: boolean
  onToggleHideRoutine: () => void
}) {
  const noActiveRule = ratios.error instanceof ApiError && ratios.error.status === 409

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-surface">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <MiniMonth selectedWeekStart={selectedWeekStart} onPick={onPickDay} />

        <div className="mt-4 border-t border-line pt-4">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-faint">
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
        </div>

        <div className="mt-4 border-t border-line pt-4">
          <CategoryRail
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

      {/* Pinned outside the scroll region. Account and settings join Routine and
       *  Rules down here once they exist — this is their future home. */}
      <div className="shrink-0 border-t border-line p-3">
        <NavLink
          to="/routine"
          className={({ isActive }) =>
            [FOOTER_LINK, 'mb-0.5', isActive ? FOOTER_LINK_ACTIVE : FOOTER_LINK_INACTIVE].join(' ')
          }
        >
          Routine
        </NavLink>
        <NavLink
          to="/rules"
          className={({ isActive }) => [FOOTER_LINK, isActive ? FOOTER_LINK_ACTIVE : FOOTER_LINK_INACTIVE].join(' ')}
        >
          Rules
        </NavLink>
      </div>
    </aside>
  )
}
