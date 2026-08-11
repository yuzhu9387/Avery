import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

/** Filled by the active page through the outlet context, so the date controls can
 *  live in the shared header without lifting the week's state out of WeekPage.
 *  `railOpen` rides the same channel so a page's own left-hand chrome (WeekPage's
 *  mini-month/categories aside) can collapse in lockstep with the shared nav rail —
 *  one hamburger, one piece of state, all left-hand chrome. */
export interface HeaderSlot {
  setControls: (node: React.ReactNode) => void
  railOpen: boolean
}

const RAIL_LINKS = [
  { to: '/', label: 'Week' },
  { to: '/month', label: 'Month' },
  { to: '/tasks', label: 'Tasks' },
  { to: '/routine', label: 'Routine' },
  { to: '/rules', label: 'Rules' },
]

export default function App() {
  const [railOpen, setRailOpen] = useState(true)
  const [controls, setControls] = useState<React.ReactNode>(null)
  const location = useLocation()
  const navigate = useNavigate()
  // The switcher can only truthfully describe these two routes. Elsewhere it would
  // have to render a selection that doesn't match where the user actually is, so it
  // is omitted rather than shown with a misleading value — the rail's own highlighted
  // link already communicates "you are somewhere else."
  const isWeekOrMonth = location.pathname === '/' || location.pathname === '/month'

  return (
    <div className="flex h-full flex-col">
      {/* `justify-between` (not `ml-auto` on the switcher) anchors the right-hand
       *  group, so the left-hand group (hamburger, wordmark, controls) stays put
       *  whether or not the switcher renders — it never depended on the switcher's
       *  own margin to hold its position. */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            aria-label="Toggle sidebar"
            className="rounded-full px-2 py-1 text-lg text-ink-muted transition-colors hover:bg-[var(--pale)]/50"
            onClick={() => setRailOpen((v) => !v)}
          >
            ☰
          </button>
          {/* The wordmark goes home, which is the week calendar. `title` rather than
           *  `aria-label`, so the accessible name stays the visible word "Avery"
           *  while sighted users still get a hint that it is more than a label. */}
          <Link
            to="/"
            title="Avery — go to this week"
            className="shrink-0 text-lg font-bold tracking-tight transition-opacity hover:opacity-70"
          >
            Avery
          </Link>
          {controls}
        </div>
        {isWeekOrMonth && (
          <select
            value={location.pathname}
            className="shrink-0 rounded-[8px] px-2 py-1 text-sm font-bold"
            style={{ background: 'var(--pale)' }}
            onChange={(e) => navigate(e.target.value)}
          >
            <option value="/">Week</option>
            <option value="/month">Month</option>
          </select>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        {railOpen && (
          <nav className="w-52 shrink-0 overflow-y-auto border-r border-line bg-surface p-3">
            {RAIL_LINKS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  [
                    'mb-0.5 block rounded-full px-3 py-1.5 text-sm font-bold transition-colors',
                    isActive
                      ? 'bg-[var(--pale)] text-ink'
                      : 'text-ink-muted hover:bg-[var(--pale)]/50 hover:text-ink',
                  ].join(' ')
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}
        <main className="min-h-0 flex-1 overflow-auto">
          <Outlet context={{ setControls, railOpen } satisfies HeaderSlot} />
        </main>
      </div>
    </div>
  )
}
