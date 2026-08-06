import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { qk } from '../api/keys'
import { createReminder, deleteReminder, listReminders, updateReminder } from '../api/reminders'
import type { Channel, Reminder, TaskStatus } from '../api/types'
import { Field } from '../components/Field'
import { Modal } from '../components/Modal'
import { TagChip } from '../components/TagChip'
import { TaskForm } from '../components/TaskForm'
import { useArchiveTask, useTask, useTaskStats, useUpdateTask } from '../hooks/useTasks'
import { useTagMap } from '../hooks/useTags'
import { formatDate, formatLocal, formatMinutes, formatTimeRange, parseLocal } from '../lib/datetime'
import type { AveryEvent } from '../api/types'

const STATUSES: TaskStatus[] = ['todo', 'doing', 'done']
const CHANNELS: Channel[] = ['inapp', 'lark', 'both']

const INPUT = 'rounded-[8px] border border-line bg-surface px-2 py-1.5 text-sm text-ink'

function remindAtLabel(s: string): string {
  const d = parseLocal(s)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${formatDate(d)} ${hh}:${mm}`
}

export default function TaskDetailPage() {
  const params = useParams<{ taskId: string }>()
  // Two detail routes share one component instance under React Router — without a
  // key tied to the route param, `notes` typed for task A (and every other bit of
  // local state below) would survive a navigation straight into task B, and the
  // next blur would PATCH A's edits onto B. Keying by taskId forces a full remount
  // on every navigation between tasks instead.
  return <TaskDetail key={params.taskId} taskId={Number(params.taskId)} />
}

function TaskDetail({ taskId }: { taskId: number }) {
  const navigate = useNavigate()

  const taskQuery = useTask(taskId)
  const statsQuery = useTaskStats(taskId)
  const tagMap = useTagMap()

  const updateTask = useUpdateTask()
  const archiveTask = useArchiveTask()

  const [editOpen, setEditOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [name, setName] = useState<string | null>(null)
  const [notes, setNotes] = useState<string | null>(null)

  const task = taskQuery.data
  const displayName = name ?? task?.name ?? ''
  const displayNotes = notes ?? task?.notes ?? ''

  if (taskQuery.isLoading) return <p className="p-6 text-sm text-ink-faint">Loading task…</p>
  if (taskQuery.isError || !task) return <p className="p-6 text-sm text-ink-faint">Couldn't load this task.</p>

  const commitName = () => {
    if (name !== null && name.trim() !== task.name) {
      updateTask.mutate({ id: task.id, body: { name: name.trim() } })
    }
  }

  const commitNotes = () => {
    if (notes !== null && notes !== task.notes) {
      updateTask.mutate({ id: task.id, body: { notes } })
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-2 flex items-start justify-between gap-3">
        <input
          value={displayName}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          className="w-full flex-1 border-none bg-transparent font-display text-2xl outline-none focus:ring-0"
          aria-label="Task name"
        />
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="rounded-[8px] px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-[var(--pale)]/50 hover:text-ink"
          >
            Edit details
          </button>
          <button
            type="button"
            onClick={() => setArchiveOpen(true)}
            className="rounded-[8px] px-3 py-1.5 text-sm text-[var(--over)] transition-colors hover:bg-[var(--over)]/15"
          >
            Archive
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {task.tag_ids.map((id) => (
          <TagChip key={id} tag={tagMap.get(id)} />
        ))}
        {task.status === 'archived' ? (
          // Folding "archived" into the "done" option made re-archiving unreachable:
          // the select already read "done", so picking "done" again fired no change
          // event. Showing it as its own state with an explicit Restore action is the
          // only way back.
          <div className="ml-2 flex items-center gap-2">
            <span className="rounded-[8px] border border-line bg-surface px-2 py-1 text-xs text-ink-faint">
              archived
            </span>
            <button
              type="button"
              onClick={() => updateTask.mutate({ id: task.id, body: { status: 'todo' } })}
              disabled={updateTask.isPending}
              className="text-xs font-medium text-ink-muted underline hover:text-ink disabled:opacity-50"
            >
              Restore
            </button>
          </div>
        ) : (
          <select
            value={task.status}
            onChange={(e) =>
              updateTask.mutate({ id: task.id, body: { status: e.target.value as TaskStatus } })
            }
            className="ml-2 rounded-[8px] border border-line bg-surface px-2 py-1 text-xs text-ink"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
      </div>

      <Field label="Notes">
        <textarea
          value={displayNotes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={commitNotes}
          rows={3}
          className={INPUT}
        />
      </Field>

      {/* The number the user came for. It comes from the API, not a client-side
       *  sum over events, so it can never disagree with the Review page's ratios —
       *  both share the same minute-clipping rule. */}
      <section className="my-6 rounded-[12px] border border-line bg-surface p-5">
        {statsQuery.isLoading && <p className="text-sm text-ink-faint">Loading stats…</p>}
        {statsQuery.isError && <p className="text-sm text-ink-faint">Couldn't load stats.</p>}
        {statsQuery.data && (
          <div className="grid grid-cols-3 gap-4 text-center">
            <Stat label="This week" minutes={statsQuery.data.minutes_this_week} />
            <Stat label="This month" minutes={statsQuery.data.minutes_this_month} />
            <Stat label="All time" minutes={statsQuery.data.minutes_all_time} />
          </div>
        )}
        {statsQuery.data && (
          <p className="mt-4 text-center text-xs text-ink-faint">
            {statsQuery.data.event_count} event{statsQuery.data.event_count === 1 ? '' : 's'} total
          </p>
        )}
      </section>

      {statsQuery.data && (
        <div className="mb-6 grid grid-cols-2 gap-6">
          <EventList title="Upcoming" events={statsQuery.data.upcoming} />
          <EventList title="Recent" events={statsQuery.data.recent} />
        </div>
      )}

      <RemindersSection taskId={task.id} />

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit task">
        <TaskForm
          task={task}
          submitting={updateTask.isPending}
          onCancel={() => setEditOpen(false)}
          onSubmit={(body) =>
            updateTask.mutate({ id: task.id, body }, { onSuccess: () => setEditOpen(false) })
          }
        />
      </Modal>

      <Modal open={archiveOpen} onClose={() => setArchiveOpen(false)} title="Archive this task?">
        <p className="mb-4 text-sm text-ink-muted">
          Archiving removes "{task.name}" from your task lists. Its events and history are
          preserved — nothing on the calendar changes, and past totals stay intact.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setArchiveOpen(false)}
            className="rounded-[8px] px-3 py-1.5 text-sm text-ink-muted hover:bg-[var(--pale)]/50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={archiveTask.isPending}
            onClick={() =>
              archiveTask.mutate(task.id, { onSuccess: () => navigate('/tasks') })
            }
            className="rounded-[8px] bg-[var(--over)] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-50"
          >
            {archiveTask.isPending ? 'Archiving…' : 'Archive'}
          </button>
        </div>
      </Modal>
    </div>
  )
}

function Stat({ label, minutes }: { label: string; minutes: number }) {
  return (
    <div>
      <div className="font-display text-2xl text-ink">{formatMinutes(minutes)}</div>
      <div className="mt-1 text-xs uppercase tracking-wide text-ink-faint">{label}</div>
    </div>
  )
}

function EventList({ title, events }: { title: string; events: AveryEvent[] }) {
  return (
    <div>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-faint">{title}</h2>
      {events.length === 0 ? (
        <p className="text-sm text-ink-faint">None.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {events.map((event) => (
            <li key={event.id} className="text-sm">
              <Link to="/month" className="text-ink hover:underline">
                {formatDate(parseLocal(event.start_at))} · {formatTimeRange(event.start_at, event.end_at)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RemindersSection({ taskId }: { taskId: number }) {
  const queryClient = useQueryClient()
  const remindersQuery = useQuery({
    queryKey: qk.reminders({ task_id: taskId }),
    queryFn: () => listReminders({ task_id: taskId }),
  })

  // Invalidating the exact key (['reminders', {task_id}]) does not prefix-match
  // TasksPage's ['reminders', {pending_only: true}] — React Query keys match by
  // exact-prefix array equality, not by overlapping filter params. Invalidating the
  // bare ['reminders'] prefix catches every reminders query, including the bells
  // on the Tasks page.
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['reminders'] })

  const setDismissed = useMutation({
    mutationFn: ({ id, dismissedAt }: { id: number; dismissedAt: string | null }) =>
      updateReminder(id, { dismissed_at: dismissedAt }),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: number) => deleteReminder(id),
    onSuccess: invalidate,
  })
  const create = useMutation({
    mutationFn: (body: Partial<Reminder>) => createReminder(body),
    onSuccess: invalidate,
  })

  const [remindAt, setRemindAt] = useState('')
  const [channel, setChannel] = useState<Channel>('inapp')

  const reminders = remindersQuery.data ?? []

  const handleAdd = () => {
    if (!remindAt) return
    // parseLocal/formatLocal are the only sanctioned datetime paths in this codebase
    // (toISOString() shifts to UTC and was banned for exactly that reason) — `new
    // Date(remindAt)` was the one place that still bypassed it. It also directly
    // handles the seconds-less "YYYY-MM-DDTHH:mm" a datetime-local input produces,
    // reading it as local wall-clock, the same assumption the rest of the app makes.
    const d = parseLocal(remindAt)
    create.mutate(
      { task_id: taskId, remind_at: formatLocal(d), channel },
      { onSuccess: () => setRemindAt('') },
    )
  }

  return (
    <section>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-faint">Reminders</h2>

      {remindersQuery.isLoading && <p className="text-sm text-ink-faint">Loading reminders…</p>}
      {remindersQuery.isError && <p className="text-sm text-ink-faint">Couldn't load reminders.</p>}

      {reminders.length > 0 && (
        <ul className="mb-3 flex flex-col gap-1.5">
          {reminders.map((r) => {
            const dismissed = !!r.dismissed_at
            return (
              <li
                key={r.id}
                className="flex items-center gap-3 rounded-[8px] border border-line bg-surface px-3 py-2 text-sm"
              >
                <span className={dismissed ? 'text-ink-faint line-through' : 'text-ink'}>
                  {remindAtLabel(r.remind_at)} · {r.channel}
                </span>
                <div className="ml-auto flex gap-2 text-xs">
                  <button
                    type="button"
                    className="text-ink-muted hover:text-ink"
                    onClick={() =>
                      setDismissed.mutate({
                        id: r.id,
                        dismissedAt: dismissed ? null : formatLocal(new Date()),
                      })
                    }
                  >
                    {dismissed ? 'Un-dismiss' : 'Dismiss'}
                  </button>
                  <button
                    type="button"
                    className="text-[var(--over)] hover:opacity-80"
                    onClick={() => remove.mutate(r.id)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex items-end gap-2">
        <input
          type="datetime-local"
          value={remindAt}
          onChange={(e) => setRemindAt(e.target.value)}
          className={INPUT}
        />
        <select
          value={channel}
          onChange={(e) => setChannel(e.target.value as Channel)}
          className={INPUT}
        >
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!remindAt || create.isPending}
          onClick={handleAdd}
          className="rounded-[8px] bg-[var(--pale)] px-3 py-1.5 text-sm font-medium text-ink transition-opacity hover:opacity-80 disabled:opacity-50"
        >
          Add reminder
        </button>
      </div>
    </section>
  )
}
