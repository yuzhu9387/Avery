import { useEffect } from 'react'
import { Outlet, useLocation, useNavigate, useOutletContext } from 'react-router-dom'

import type { HeaderSlot } from '../App'
import WeekPage from '../pages/WeekPage'
import { IconRoutine, IconRules, IconTasks } from './icons'

type IconComponent = typeof IconTasks

const TITLES: Record<string, { Icon: IconComponent | null; label: string }> = {
  '/tasks': { Icon: IconTasks, label: 'Tasks' },
  '/routine': { Icon: IconRoutine, label: 'Routine' },
  '/rules': { Icon: IconRules, label: 'Rules' },
}

/** Detail routes (`/events/:id`, `/tasks/:id`) also live under this shell (see
 *  main.tsx) but aren't in `TITLES` above since their path carries a dynamic id —
 *  matched by prefix instead, with no icon of their own (item 1 only specified
 *  glyphs for Tasks/Routine/Rules). */
function metaFor(pathname: string): { Icon: IconComponent | null; label: string } {
  if (TITLES[pathname]) return TITLES[pathname]
  if (pathname.startsWith('/events/')) return { Icon: null, label: 'Event' }
  if (pathname.startsWith('/tasks/')) return { Icon: null, label: 'Task' }
  return { Icon: null, label: '' }
}

/**
 * Avery's home is the week calendar — opening Tasks, Routine, Rules, or a task/event
 * detail page must never feel like leaving it. This layout route renders `WeekPage`
 * as the base (sidebar + calendar, working unmodified underneath — see `main.tsx`,
 * matched at `/`, `/tasks`, `/routine`, `/rules`, `/tasks/:taskId`, and
 * `/events/:eventId` alike) and layers the matched child route (`Outlet`) as a
 * full-bleed section over the calendar column only — not a floating popup: it
 * occupies the entire column right of the sidebar, below the app header, with an
 * opaque `var(--surface)` background, so the week grid underneath no longer shows
 * through (a section swap, the same way the Month view replaces the week view).
 *
 * Positioning: the panel is anchored with `left-56`, exactly matching
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

  const meta = metaFor(location.pathname)

  return (
    <div className="relative h-full min-h-0">
      <WeekPage />

      <div
        className={['absolute inset-0 z-40 flex flex-col', railOpen ? 'left-56' : 'left-0'].join(
          ' ',
        )}
        style={{ background: 'var(--surface)' }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3">
          <h1 className="flex items-center gap-2 font-display text-lg">
            {meta.Icon && <meta.Icon />}
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
  )
}
