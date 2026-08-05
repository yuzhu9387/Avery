import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { listReminders } from '../api/reminders'
import { qk } from '../api/keys'
import type { Task } from '../api/types'
import { Modal } from '../components/Modal'
import { TagChip } from '../components/TagChip'
import { TaskForm } from '../components/TaskForm'
import { useCreateTask, useTasks, useUpdateTask } from '../hooks/useTasks'
import { useTagMap } from '../hooks/useTags'
import { formatDate } from '../lib/datetime'

export default function TasksPage() {
  const [modalOpen, setModalOpen] = useState(false)

  const tagMap = useTagMap()

  const scheduledQuery = useTasks()
  const floatingQuery = useTasks({ floating_only: true })
  const doneQuery = useTasks({ status_filter: 'done' })

  const pendingRemindersQuery = useQuery({
    queryKey: qk.reminders({ pending_only: true }),
    queryFn: () => listReminders({ pending_only: true }),
  })
  const pendingTaskIds = useMemo(
    () => new Set((pendingRemindersQuery.data ?? []).map((r) => r.task_id)),
    [pendingRemindersQuery.data],
  )

  // `floating_only` already means "flagged floating AND has no events" — a floating
  // task that has since been scheduled drops out of this set and belongs in Scheduled.
  const floatingIds = useMemo(
    () => new Set((floatingQuery.data ?? []).map((t) => t.id)),
    [floatingQuery.data],
  )
  const scheduled = (scheduledQuery.data ?? []).filter(
    (t) => t.status !== 'done' && !floatingIds.has(t.id),
  )
  const floating = floatingQuery.data ?? []
  const done = doneQuery.data ?? []

  const updateTask = useUpdateTask()
  const createTask = useCreateTask()

  const toggleDone = (task: Task) => {
    updateTask.mutate({ id: task.id, body: { status: task.status === 'done' ? 'todo' : 'done' } })
  }

  const anyLoading = scheduledQuery.isLoading || floatingQuery.isLoading || doneQuery.isLoading
  const anyError = scheduledQuery.isError || floatingQuery.isError || doneQuery.isError

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-xl">Tasks</h1>
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
        <div className="flex flex-col gap-8">
          <TaskSection
            title="Scheduled"
            tasks={scheduled}
            tagMap={tagMap}
            pendingTaskIds={pendingTaskIds}
            onToggleDone={toggleDone}
            emptyLabel="No scheduled tasks."
          />
          <TaskSection
            title="Floating"
            tasks={floating}
            tagMap={tagMap}
            pendingTaskIds={pendingTaskIds}
            onToggleDone={toggleDone}
            emptyLabel="No floating tasks."
          />
          <TaskSection
            title="Done"
            tasks={done}
            tagMap={tagMap}
            pendingTaskIds={pendingTaskIds}
            onToggleDone={toggleDone}
            emptyLabel="Nothing done yet."
          />
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New task">
        <TaskForm
          submitting={createTask.isPending}
          onCancel={() => setModalOpen(false)}
          onSubmit={(body) =>
            createTask.mutate(body, { onSuccess: () => setModalOpen(false) })
          }
        />
      </Modal>
    </div>
  )
}

function TaskSection({
  title,
  tasks,
  tagMap,
  pendingTaskIds,
  onToggleDone,
  emptyLabel,
}: {
  title: string
  tasks: Task[]
  tagMap: ReturnType<typeof useTagMap>
  pendingTaskIds: Set<number>
  onToggleDone: (task: Task) => void
  emptyLabel: string
}) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-faint">
        {title} ({tasks.length})
      </h2>
      {tasks.length === 0 ? (
        <p className="text-sm text-ink-faint">{emptyLabel}</p>
      ) : (
        <ul className="rounded-[12px] border border-line bg-surface">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              tagMap={tagMap}
              hasPendingReminder={pendingTaskIds.has(task.id)}
              onToggleDone={onToggleDone}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function TaskRow({
  task,
  tagMap,
  hasPendingReminder,
  onToggleDone,
}: {
  task: Task
  tagMap: ReturnType<typeof useTagMap>
  hasPendingReminder: boolean
  onToggleDone: (task: Task) => void
}) {
  const overdue = !!task.due_date && task.due_date < formatDate(new Date()) && task.status !== 'done'

  return (
    <li
      className={[
        'flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0',
        overdue ? 'bg-[var(--over)]/15' : '',
      ].join(' ')}
    >
      <input
        type="checkbox"
        checked={task.status === 'done'}
        onChange={() => onToggleDone(task)}
        aria-label={`Mark ${task.name} ${task.status === 'done' ? 'not done' : 'done'}`}
      />
      <Link to={`/tasks/${task.id}`} className="flex-1 truncate text-sm text-ink hover:underline">
        {task.name}
      </Link>
      {task.tag_ids.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {task.tag_ids.map((id) => (
            <TagChip key={id} tag={tagMap.get(id)} size="xs" />
          ))}
        </div>
      )}
      {task.due_date && <span className="text-xs text-ink-faint">{task.due_date}</span>}
      {hasPendingReminder && (
        <span role="img" aria-label="Reminder pending" title="Reminder pending">
          🔔
        </span>
      )}
    </li>
  )
}
