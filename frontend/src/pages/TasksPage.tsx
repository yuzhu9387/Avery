import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { listEvents } from '../api/events'
import { qk } from '../api/keys'
import { listTasks } from '../api/tasks'
import type { AveryEvent, Task } from '../api/types'
import { Modal } from '../components/Modal'
import { TagChip } from '../components/TagChip'
import { TaskForm } from '../components/TaskForm'
import { useCreateTask, useUpdateTask } from '../hooks/useTasks'
import { useTagMap } from '../hooks/useTags'
import { formatDate, formatLocal, formatTimeRange, parseLocal } from '../lib/datetime'
import {
  doneTasksSorted,
  formatDueDate,
  nextUpcomingEvent,
  paginateActiveTasksByDueDate,
} from '../lib/taskGroups'

const PAGE_SIZE = 20
const DONE_CAP = 20

export default function TasksPage() {
  const [modalOpen, setModalOpen] = useState(false)
  const [page, setPage] = useState(1)

  const tagMap = useTagMap()

  // Archived tasks have no business on this page at all — never shown active,
  // never shown done.
  const tasksQuery = useQuery({
    queryKey: qk.tasks({ include_archived: false }),
    queryFn: () => listTasks({ include_archived: false }),
  })
  // A single, unparameterized fetch: this is a single-user app, so there is no
  // per-page or per-task events endpoint worth calling N times — one list, then
  // grouped client-side by task_id below.
  const eventsQuery = useQuery({ queryKey: qk.events(), queryFn: () => listEvents() })

  const eventsByTask = useMemo(() => {
    const map = new Map<number, AveryEvent[]>()
    for (const event of eventsQuery.data ?? []) {
      // A plain calendar event or a routine-materialized event carries no Task —
      // only a to-do (`task_id` set) belongs in this per-task lookup.
      if (event.task_id === null) continue
      const list = map.get(event.task_id)
      if (list) list.push(event)
      else map.set(event.task_id, [event])
    }
    return map
  }, [eventsQuery.data])

  const tasks = tasksQuery.data ?? []
  const today = useMemo(() => formatDate(new Date()), [])
  const now = useMemo(() => formatLocal(new Date()), [])

  const paged = useMemo(
    () => paginateActiveTasksByDueDate(tasks, today, page, PAGE_SIZE, eventsByTask),
    [tasks, today, page, eventsByTask],
  )
  const done = useMemo(() => doneTasksSorted(tasks, DONE_CAP), [tasks])
  const totalDone = useMemo(() => tasks.filter((t) => t.status === 'done').length, [tasks])

  const updateTask = useUpdateTask()
  const createTask = useCreateTask()

  const toggleDone = (task: Task) => {
    updateTask.mutate({ id: task.id, body: { status: task.status === 'done' ? 'todo' : 'done' } })
  }

  const anyLoading = tasksQuery.isLoading || eventsQuery.isLoading
  const anyError = tasksQuery.isError || eventsQuery.isError

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <p className="text-sm text-ink-faint">
          {paged.totalActive} active, {totalDone} done
        </p>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="rounded-[8px] bg-[var(--pale)] px-3 py-1.5 text-sm font-medium text-ink transition-opacity hover:opacity-80"
        >
          New task
        </button>
      </div>

      {anyLoading && <p className="text-sm text-ink-faint">Loading tasks…</p>}
      {anyError && <p className="text-sm text-ink-faint">Couldn't load tasks.</p>}

      {!anyLoading && !anyError && (
        <>
          {paged.groups.length === 0 ? (
            <p className="text-sm text-ink-faint">No active tasks.</p>
          ) : (
            <div className="flex flex-col gap-6">
              {paged.groups.map((group) => (
                <section key={group.key}>
                  <h2
                    className="mb-2 text-xs font-bold uppercase tracking-wide"
                    style={{ color: group.overdue ? 'var(--over)' : 'var(--ink-faint)' }}
                  >
                    {group.dueDate ? formatDueDate(group.dueDate) : 'No due date'}
                  </h2>
                  <ul className="rounded-[12px] border border-line bg-surface">
                    {group.tasks.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        tagMap={tagMap}
                        event={nextUpcomingEvent(eventsByTask.get(task.id) ?? [], now)}
                        today={today}
                        overdue={group.overdue}
                        onToggleDone={toggleDone}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}

          {paged.pageCount > 1 && (
            <div className="mt-4 flex items-center justify-center gap-4 text-sm">
              <button
                type="button"
                aria-label="Previous page"
                disabled={paged.page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded-full px-2 py-1 text-ink-muted transition-colors hover:bg-[var(--pale)]/50 hover:text-ink disabled:opacity-30"
              >
                ‹
              </button>
              <span className="text-ink-muted">
                Page {paged.page} of {paged.pageCount}
              </span>
              <button
                type="button"
                aria-label="Next page"
                disabled={paged.page >= paged.pageCount}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-full px-2 py-1 text-ink-muted transition-colors hover:bg-[var(--pale)]/50 hover:text-ink disabled:opacity-30"
              >
                ›
              </button>
            </div>
          )}

          <section className="mt-8 border-t border-line pt-6">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-faint">Done</h2>
            {done.length === 0 ? (
              <p className="text-sm text-ink-faint">Nothing done yet.</p>
            ) : (
              <>
                <ul className="rounded-[12px] border border-line bg-surface">
                  {done.map((task) => (
                    <DoneRow key={task.id} task={task} tagMap={tagMap} onToggleDone={toggleDone} />
                  ))}
                </ul>
                {totalDone > DONE_CAP && (
                  <p className="mt-2 text-xs text-ink-faint">
                    Showing the {DONE_CAP} most recently completed of {totalDone}.
                  </p>
                )}
              </>
            )}
          </section>
        </>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New task">
        <TaskForm
          submitting={createTask.isPending}
          onCancel={() => setModalOpen(false)}
          onSubmit={(body) => createTask.mutate(body, { onSuccess: () => setModalOpen(false) })}
        />
      </Modal>
    </div>
  )
}

/** The one row of times worth showing: the task's next upcoming event, with its
 *  date prefixed only when that date isn't today — today's own time range doesn't
 *  need the date restated. An em dash stands in for "no events at all". */
function timeLabel(event: AveryEvent | null, today: string): string {
  if (!event) return '—'
  const eventDate = formatDate(parseLocal(event.start_at))
  const range = formatTimeRange(event.start_at, event.end_at)
  return eventDate === today ? range : `${formatDueDate(eventDate)} ${range}`
}

function TaskRow({
  task,
  tagMap,
  event,
  today,
  overdue,
  onToggleDone,
}: {
  task: Task
  tagMap: ReturnType<typeof useTagMap>
  event: AveryEvent | null
  today: string
  /** From the row's own due-date section, so "late" is decided in one place
   *  (`groupActiveTasksByDueDate`) rather than recomputed per row and risking a row
   *  that disagrees with the heading above it. */
  overdue: boolean
  onToggleDone: (task: Task) => void
}) {
  const extraTags = task.tag_ids.length - 1

  return (
    <li
      className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0"
      // A left bar rather than a red row: tinting the whole row would fight the
      // category chip for meaning, and colour alone is not a signal everyone can
      // read — hence the "Overdue" word as well.
      style={overdue ? { boxShadow: 'inset 3px 0 0 0 var(--over)' } : undefined}
    >
      <input
        type="checkbox"
        checked={task.status === 'done'}
        onChange={() => onToggleDone(task)}
        aria-label={`Mark ${task.name} done`}
      />
      <Link to={`/tasks/${task.id}`} className="flex-1 truncate text-sm text-ink hover:underline">
        {task.name}
      </Link>
      {overdue && (
        <span
          className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
          style={{ background: 'var(--blush)', color: 'var(--over)' }}
        >
          Overdue
        </span>
      )}
      <span
        className="shrink-0 text-xs"
        style={{ color: overdue ? 'var(--over)' : 'var(--ink-faint)' }}
      >
        {timeLabel(event, today)}
      </span>
      {task.tag_ids.length > 0 && (
        <div className="flex shrink-0 items-center gap-1">
          <TagChip tag={tagMap.get(task.tag_ids[0])} size="xs" />
          {extraTags > 0 && <span className="text-xs text-ink-faint">+{extraTags}</span>}
        </div>
      )}
    </li>
  )
}

function DoneRow({
  task,
  tagMap,
  onToggleDone,
}: {
  task: Task
  tagMap: ReturnType<typeof useTagMap>
  onToggleDone: (task: Task) => void
}) {
  const extraTags = task.tag_ids.length - 1

  return (
    <li className="flex items-center gap-3 border-b border-line px-3 py-2 opacity-60 last:border-b-0">
      <input
        type="checkbox"
        checked
        onChange={() => onToggleDone(task)}
        aria-label={`Mark ${task.name} not done`}
      />
      <Link to={`/tasks/${task.id}`} className="flex-1 truncate text-sm text-ink line-through hover:underline">
        {task.name}
      </Link>
      {task.tag_ids.length > 0 && (
        <div className="flex shrink-0 items-center gap-1">
          <TagChip tag={tagMap.get(task.tag_ids[0])} size="xs" />
          {extraTags > 0 && <span className="text-xs text-ink-faint">+{extraTags}</span>}
        </div>
      )}
    </li>
  )
}
