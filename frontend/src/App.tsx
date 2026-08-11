import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

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
  { to: '/template', label: 'Template' },
  { to: '/rules', label: 'Rules' },
  { to: '/review', label: 'Review' },
]

export default function App() {
  const [railOpen, setRailOpen] = useState(true)
  const [controls, setControls] = useState<React.ReactNode>(null)
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-4 py-2">
        <button
          type="button"
          aria-label="Toggle sidebar"
          className="rounded-full px-2 py-1 text-lg text-ink-muted transition-colors hover:bg-[var(--pale)]/50"
          onClick={() => setRailOpen((v) => !v)}
        >
          ☰
        </button>
        <span className="shrink-0 text-lg font-bold tracking-tight">Avery</span>
        {controls}
        <select
          value={location.pathname === '/month' ? '/month' : '/'}
          className="ml-auto rounded-[8px] px-2 py-1 text-sm font-bold"
          style={{ background: 'var(--pale)' }}
          onChange={(e) => navigate(e.target.value)}
        >
          <option value="/">Week</option>
          <option value="/month">Month</option>
        </select>
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
