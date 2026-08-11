import { useLocation, useNavigate } from 'react-router-dom'

const NAV_BUTTON =
  'rounded-[8px] px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-[var(--pale)]/50 hover:text-ink'

const VIEWS = [
  { to: '/', label: 'Week' },
  { to: '/month', label: 'Month' },
] as const

/** The calendar's own header: `‹ Today ›` plus the current range/title on the left,
 *  a Week/Month switcher on the right. Lives inside the calendar column (WeekPage,
 *  MonthPage), not the shared app header — it no longer needs to travel through
 *  HeaderSlot since each page renders it directly above its own grid. */
export function CalendarToolbar({
  title,
  onPrev,
  onNext,
  onToday,
}: {
  title: string
  onPrev: () => void
  onNext: () => void
  onToday: () => void
}) {
  const location = useLocation()
  const navigate = useNavigate()
  // Any path other than `/` and `/month` never renders this toolbar, but the
  // fallback keeps the segmented control from claiming a view that isn't active.
  const active = location.pathname === '/month' ? '/month' : '/'

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2">
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Previous" className={NAV_BUTTON} onClick={onPrev}>
          ‹
        </button>
        <button
          type="button"
          className="rounded-full border border-line px-3 py-1 text-sm font-bold transition-colors hover:bg-[var(--pale)]/50"
          onClick={onToday}
        >
          Today
        </button>
        <button type="button" aria-label="Next" className={NAV_BUTTON} onClick={onNext}>
          ›
        </button>
        <span className="text-sm font-semibold text-ink">{title}</span>
      </div>

      <div className="flex shrink-0 gap-0.5 rounded-full p-0.5" style={{ background: 'var(--pale)' }}>
        {VIEWS.map((view) => {
          const isActive = view.to === active
          return (
            <button
              key={view.to}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              className="rounded-full px-3 py-1 text-sm font-bold transition-colors"
              style={
                isActive
                  ? { background: 'var(--surface-raised)', color: 'var(--ink)' }
                  : { color: 'var(--ink-muted)' }
              }
              onClick={() => navigate(view.to)}
            >
              {view.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
