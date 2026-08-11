import { useEffect } from 'react'
import { Outlet, useLocation, useNavigate, useOutletContext } from 'react-router-dom'

import type { HeaderSlot } from '../App'
import WeekPage from '../pages/WeekPage'

const TITLES: Record<string, { emoji: string; label: string }> = {
  '/tasks': { emoji: '📋', label: 'Tasks' },
  '/routine': { emoji: '🔁', label: 'Routine' },
  '/rules': { emoji: '📐', label: 'Rules' },
}

/**
 * Avery's home is the week calendar — opening Tasks, Routine, or Rules must never
 * feel like leaving it. This layout route renders `WeekPage` as the base (sidebar
 * + calendar, working unmodified underneath — see `main.tsx`, matched at `/`,
 * `/tasks`, `/routine`, and `/rules` alike) and layers the matched child route
 * (`Outlet`) as a sub-window over the calendar column only.
 *
 * Positioning: the backdrop is anchored with `left-56`, exactly matching
 * `CalendarSidebar`'s own `w-56` — so it never covers the rail — collapsing to
 * `left-0` when the rail is closed. That state comes from `useOutletContext`,
 * the same `{ railOpen }` App already threads through its own `Outlet` — this
 * component is a plain (non-route) child of *that* provider, so the context reads
 * here exactly as it does inside `WeekPage`, with no extra plumbing required.
 *
 * Alternative considered: passing `overlay` as a prop/children slot into
 * `WeekPage` itself. Rejected — it would make WeekPage's signature depend on
 * routing concerns it has no other reason to know about, whereas this shell can
 * import WeekPage as a plain, unmodified component and stay entirely outside it.
 */
export function CalendarOverlayShell() {
  const { railOpen } = useOutletContext<HeaderSlot>()
  const navigate = useNavigate()
  const location = useLocation()

  const close = () => navigate('/')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // `close` is stable enough here (only depends on `navigate`, which react-router
    // guarantees stable) — re-running this on every render would be wasteful for
    // zero benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const meta = TITLES[location.pathname] ?? { emoji: '', label: '' }

  return (
    <div className="relative h-full min-h-0">
      <WeekPage />

      <div
        className={[
          'absolute inset-0 z-40 flex items-center justify-center bg-black/20 p-6',
          railOpen ? 'left-56' : 'left-0',
        ].join(' ')}
        onClick={close}
      >
        <div
          className="flex w-full max-w-3xl flex-col overflow-hidden"
          style={{
            background: 'var(--surface-raised)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-card)',
            maxHeight: '85%',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3">
            <h1 className="flex items-center gap-2 font-display text-lg">
              <span aria-hidden>{meta.emoji}</span>
              {meta.label}
            </h1>
            <button
              type="button"
              aria-label="Close"
              className="rounded-full px-2 py-1 text-lg text-ink-muted transition-colors hover:bg-[var(--pale)]/50"
              onClick={close}
            >
              ✕
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  )
}
