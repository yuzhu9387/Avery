import { useState } from 'react'
import { Link, Outlet } from 'react-router-dom'

/** `railOpen` rides the outlet context so a page's own left-hand chrome
 *  (CalendarSidebar's mini-month/categories aside) can collapse in lockstep with
 *  the shared hamburger — one piece of state, all left-hand chrome. The calendar's
 *  own date controls (Today/arrows/range, Week/Month) now live inside the calendar
 *  column itself (see CalendarToolbar), so this slot no longer needs to carry them. */
export interface HeaderSlot {
  railOpen: boolean
}

export default function App() {
  const [railOpen, setRailOpen] = useState(true)

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
      </header>

      <main className="min-h-0 flex-1 overflow-auto">
        <Outlet context={{ railOpen } satisfies HeaderSlot} />
      </main>
    </div>
  )
}
