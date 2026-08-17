import { useState } from 'react'
import { Link, Navigate, Outlet } from 'react-router-dom'

import { useMe } from './hooks/useAuth'

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
  const me = useMe()

  // The AuthGate. Three states, no routes involved — a swap here is simpler and more
  // robust than an auth redirect, and it means a signed-out deep link to /tasks keeps
  // its URL and lands exactly there once the cookie exists.
  //
  // 1. Still asking /auth/me: a quiet splash rather than a flash of the login form
  //    at every reload for users who are in fact signed in (the common case).
  if (me.isPending) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <img src="/avery-logo.png" alt="" width={48} height={48} />
        <span className="font-display text-2xl font-semibold tracking-tight">Avery</span>
      </div>
    )
  }

  // 2. No user — a 401 resolves to `data: null` (see useMe), and a genuinely failed
  //    request lands here too: the login page is the one screen that can still do
  //    something useful about it. A real redirect to /login (not an in-place swap),
  //    so signing in has its own URL and the address bar tells the truth.
  if (!me.data) return <Navigate to="/login" replace />

  // 3. Signed in — the app, exactly as before the gate existed.
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
          className="flex shrink-0 items-center gap-2 transition-opacity hover:opacity-70"
        >
          {/* Served at 256px for a 32px slot so it stays sharp on a retina screen.
           *  Cropped to the mark with a transparent field, so no radius or tile
           *  treatment is needed — it sits directly on the header. `alt=""` because
           *  the wordmark beside it already names the link; a second "Avery" would
           *  only be announced twice. */}
          <img src="/avery-logo.png" alt="" width={32} height={32} className="shrink-0" />
          <span className="text-lg font-bold tracking-tight">Avery</span>
        </Link>
      </header>

      <main className="min-h-0 flex-1 overflow-auto">
        <Outlet context={{ railOpen } satisfies HeaderSlot} />
      </main>
    </div>
  )
}
