import type { AveryEvent, Task } from '../api/types'
import { formatDate, parseLocal } from './datetime'

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export interface DueGroup {
  /** `due_date` itself for a dated section, or the literal `'no-due-date'` for the
   *  trailing undated bucket — stable and unique either way, so callers can key a
   *  React list on it directly. */
  key: string
  dueDate: string | null
  tasks: Task[]
  /** Always `false` for the undated bucket — there is nothing to be overdue against. */
  overdue: boolean
}

function isActiveTask(task: Task): boolean {
  return task.status !== 'done' && task.status !== 'archived'
}

function isDoneTask(task: Task): boolean {
  return task.status === 'done'
}

/** The `YYYY-MM-DD` of the latest of a set of events' `end_at`, or `null` when
 *  there are none — the fallback due date for a task whose own `due_date` is
 *  `null` but that has already been scheduled onto the calendar. */
export function latestEventEndDate(events: AveryEvent[]): string | null {
  if (events.length === 0) return null
  const latest = events.reduce((a, b) => (a.end_at > b.end_at ? a : b))
  return formatDate(parseLocal(latest.end_at))
}

/** A task's `due_date` when it has one; otherwise the latest end date among its own
 *  events (via `eventsByTask`, keyed by `task_id`), so a scheduled-but-undated task
 *  groups under a real date instead of always falling to "No due date"; `null` when
 *  neither is available (or no event lookup was given at all). */
function effectiveDueDate(task: Task, eventsByTask: Map<number, AveryEvent[]> | undefined): string | null {
  if (task.due_date !== null) return task.due_date
  if (!eventsByTask) return null
  return latestEventEndDate(eventsByTask.get(task.id) ?? [])
}

/** Groups active (not done, not archived) tasks by `due_date` — falling back to the
 *  latest end date of the task's own events when `due_date` is `null`, see
 *  `effectiveDueDate` — into ascending-sorted sections, with a final "No due date"
 *  bucket for whatever still has neither — omitted entirely when nothing is undated,
 *  so callers never render an empty section. A section is `overdue` when its date is
 *  strictly before `today` (an injected `YYYY-MM-DD`, not `new Date()`, so this stays
 *  pure and testable). */
export function groupActiveTasksByDueDate(
  tasks: Task[],
  today: string,
  eventsByTask?: Map<number, AveryEvent[]>,
): DueGroup[] {
  const active = tasks.filter(isActiveTask)
  const byDate = new Map<string, Task[]>()
  const noDueDate: Task[] = []

  for (const task of active) {
    const dueDate = effectiveDueDate(task, eventsByTask)
    if (dueDate === null) {
      noDueDate.push(task)
      continue
    }
    const bucket = byDate.get(dueDate)
    if (bucket) bucket.push(task)
    else byDate.set(dueDate, [task])
  }

  // `YYYY-MM-DD` strings sort correctly as plain strings.
  const dates = [...byDate.keys()].sort()
  const groups: DueGroup[] = dates.map((date) => ({
    key: date,
    dueDate: date,
    tasks: byDate.get(date)!,
    overdue: date < today,
  }))

  if (noDueDate.length > 0) {
    groups.push({ key: 'no-due-date', dueDate: null, tasks: noDueDate, overdue: false })
  }

  return groups
}

/** Completed tasks, most recently completed first. A task somehow marked `done`
 *  without a `completed_at` sorts as if completed at the epoch, so it falls to the
 *  bottom rather than throwing off the order of everything with a real timestamp. */
export function doneTasksSorted(tasks: Task[], limit?: number): Task[] {
  const done = tasks.filter(isDoneTask)
  done.sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
  return typeof limit === 'number' ? done.slice(0, limit) : done
}

export interface Page<T> {
  items: T[]
  /** Clamped into `[1, pageCount]` — always a page that actually exists. */
  page: number
  pageCount: number
}

/** Generic, stable client-side slicing: page 1 is always `items[0..pageSize)`,
 *  page 2 is always the next `pageSize`, and so on — independent of how many pages
 *  were requested previously, so re-requesting the same page number is idempotent. */
export function paginate<T>(items: T[], page: number, pageSize: number): Page<T> {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const clamped = Math.min(Math.max(1, Math.trunc(page) || 1), pageCount)
  const start = (clamped - 1) * pageSize
  return { items: items.slice(start, start + pageSize), page: clamped, pageCount }
}

export interface PagedDueGroups {
  groups: DueGroup[]
  page: number
  pageCount: number
  /** Total active tasks across every page — what "Page N of M" is counting. */
  totalActive: number
}

/** The Tasks page's active list: due-date sections in ascending order, sliced 20
 *  (by default) to a page. A section that straddles a page boundary is split
 *  between the two pages' `groups` rather than kept whole — flattening to due-date
 *  order first and paginating that flat list is what makes each page always show
 *  exactly `pageSize` tasks (except the last), instead of a variable count that
 *  depends on where section boundaries happen to fall. */
export function paginateActiveTasksByDueDate(
  tasks: Task[],
  today: string,
  page: number,
  pageSize = 20,
  eventsByTask?: Map<number, AveryEvent[]>,
): PagedDueGroups {
  const flat = groupActiveTasksByDueDate(tasks, today, eventsByTask).flatMap((g) => g.tasks)
  const sliced = paginate(flat, page, pageSize)
  return {
    groups: groupActiveTasksByDueDate(sliced.items, today, eventsByTask),
    page: sliced.page,
    pageCount: sliced.pageCount,
    totalActive: flat.length,
  }
}

/** `"Aug 12, Wed"` — deliberately not `toLocaleDateString`, whose weekday/month
 *  order and abbreviations vary by locale; this format is fixed regardless of the
 *  viewer's locale, matching the rest of the app's date labels (see `WeekPage`'s
 *  `rangeLabel`). */
export function formatDueDate(dueDate: string): string {
  const d = parseLocal(dueDate)
  return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}, ${WEEKDAY_SHORT[d.getDay()]}`
}

/** The earliest of a task's events that hasn't started yet (`start_at >= now`) —
 *  the one row of times worth showing next to a task name. Falls back to the most
 *  recently *started* past event when nothing is upcoming, so a task whose events
 *  already happened still shows something instead of a bare dash; `null` only when
 *  the task has no events at all. `now` is injected (a `formatLocal`-shaped string)
 *  so this stays pure and testable rather than reaching for `new Date()` itself. */
export function nextUpcomingEvent(events: AveryEvent[], now: string): AveryEvent | null {
  if (events.length === 0) return null
  const sorted = [...events].sort((a, b) => a.start_at.localeCompare(b.start_at))
  const upcoming = sorted.find((e) => e.start_at >= now)
  return upcoming ?? sorted[sorted.length - 1]
}
