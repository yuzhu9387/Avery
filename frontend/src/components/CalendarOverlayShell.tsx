import { useEffect } from 'react'
import { Outlet, useLocation, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'

import type { HeaderSlot } from '../App'
import MonthPage from '../pages/MonthPage'
import WeekPage from '../pages/WeekPage'
import { IconAccount, IconRoutine, IconRules, IconTasks } from './icons'

type IconComponent = typeof IconTasks

const TITLES: Record<string, { Icon: IconComponent | null; label: string }> = {
  '/tasks': { Icon: IconTasks, label: 'Tasks' },
  '/routine': { Icon: IconRoutine, label: 'Routine' },
  '/rules': { Icon: IconRules, label: 'Rules' },
  '/account': { Icon: IconAccount, label: 'Account' },
}

/** Detail routes (`/events/:id`, `/tasks/:id`) also live under this shell (see
 *  main.tsx) but aren't in `TITLES` above since their path carries a dynamic id —
 *  matched by prefix instead, with no icon of their own (item 1 only specified
 *  glyphs for Tasks/Routine/Rules). */
function metaFor(pathname: string): { Icon: IconComponent | null; label: string } {
  if (TITLES[pathname]) return TITLES[pathname]
  if (pathname === '/events') return { Icon: null, label: 'Events' }
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
 * Positioning: the panel is anchored with `left-64`, exactly matching
 * `CalendarSidebar`'s own `w-64` — so it never covers the rail — collapsing to
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
  const [params] = useSearchParams()

  // Which calendar stays behind the panel. The overlay paths (/events, /tasks,
  // /routine, /rules) say nothing about it, so the rail stamps `?view=month` onto
  // its links and this reads it back — without that, opening anything from the month
  // view swapped the backdrop to the week grid and threw the user out of the month.
  const view = params.get('view') === 'month' ? 'month' : 'week'
  const week = params.get('week')
  // Closing returns to the calendar the panel was opened from, on the same week —
  // not to a default that quietly moves the user.
  const close = () =>
    navigate(view === 'month' ? '/month' : week ? `/?week=${week}` : '/')

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
      {view === 'month' ? <MonthPage /> : <WeekPage />}

      <div
        // `z-[60]`, not `z-40`. WeekGrid's sticky chrome climbs to z-50 (its top-left
        // corner cell) and z-40 (the day headers) so it can sit above a dragged card
        // at z-20. At z-40 this panel tied with the headers and lost outright to the
        // corner — which is why a white square stayed pinned over the top-left of
        // every page opened on top of the calendar. The overlay is the modal surface,
        // so it is the thing that must be raised; lowering the grid's sticky layers
        // would put dragged cards back on top of the header they scroll under.
        className={['absolute inset-0 z-[60] flex flex-col', railOpen ? 'left-64' : 'left-0'].join(
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
