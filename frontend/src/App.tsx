import { NavLink, Outlet } from 'react-router-dom'

const NAV = [
  { to: '/', label: 'Week' },
  { to: '/month', label: 'Month' },
  { to: '/tasks', label: 'Tasks' },
  { to: '/template', label: 'Template' },
  { to: '/rules', label: 'Rules' },
  { to: '/review', label: 'Review' },
]

export default function App() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-8 border-b border-line bg-surface px-6 py-3">
        <span className="font-display text-lg">Avery</span>
        <nav className="flex gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                [
                  'rounded-[8px] px-3 py-1.5 text-sm transition-colors',
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
      </header>
      <main className="min-h-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
