import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { errorMessage } from '../api/client'
import { deleteEvent, getEvent, updateEvent } from '../api/events'
import { invalidateCalendar } from '../api/invalidate'
import { qk } from '../api/keys'
import { getTask } from '../api/tasks'
import { useEventMutations } from '../hooks/useEventMutations'
import { useTagMap } from '../hooks/useTags'
import { parseLocal, resolveDayTimeRange } from '../lib/datetime'

const pad = (n: number) => String(n).padStart(2, '0')
const toTimeInput = (minutes: number) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`
const fromTimeInput = (value: string) => {
  const [h, m] = value.split(':').map(Number)
  return h * 60 + m
}

export default function EventDetailPage() {
  const { eventId } = useParams()
  const id = Number(eventId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const tagMap = useTagMap()
  const { complete, uncomplete } = useEventMutations()

  // Local drafts of the start/end minutes-since-midnight shown in the time inputs.
  // `syncedId` tracks which event's data these drafts were last derived from, so
  // switching to a different event (id changes) re-derives them, while the user's
  // own in-progress edits on the current event are left alone.
  const [syncedId, setSyncedId] = useState<number | null>(null)
  const [startMinutes, setStartMinutes] = useState(0)
  const [endMinutes, setEndMinutes] = useState(0)

  const event = useQuery({ queryKey: qk.event(id), queryFn: () => getEvent(id) })
  const task = useQuery({
    queryKey: qk.task(event.data?.task_id ?? 0),
    queryFn: () => getTask(event.data!.task_id),
    enabled: event.isSuccess,
  })

  const remove = useMutation({
    mutationFn: () => deleteEvent(id),
    onSuccess: () => {
      invalidateCalendar(queryClient)
      navigate('/')
    },
  })

  // `updateEvent` isn't wrapped by `useEventMutations`, so this page wires its own
  // invalidation through the same shared helper every other write uses.
  const saveTimes = useMutation({
    mutationFn: (body: { start_at: string; end_at: string }) => updateEvent(id, body),
    onSuccess: () => invalidateCalendar(queryClient),
  })

  if (event.isLoading) return <p className="p-6 text-sm text-ink-faint">Loading…</p>
  if (event.isError || !event.data)
    return <p className="p-6 text-sm text-ink-faint">Couldn't load that event.</p>

  const data = event.data
  const isDone = data.completed_at !== null
  const day = parseLocal(data.start_at)

  // "Adjusting state during rendering" (a React-documented pattern): when the
  // loaded event changes, re-derive the drafts from its data before this render
  // commits, so there is no frame where the inputs briefly show stale minutes.
  // A save of this same event doesn't retrigger this — `data.id` is unchanged, so
  // the drafts (already holding what was just saved) are left as the source of truth.
  if (data.id !== syncedId) {
    setSyncedId(data.id)
    const start = parseLocal(data.start_at)
    const end = parseLocal(data.end_at)
    setStartMinutes(start.getHours() * 60 + start.getMinutes())
    setEndMinutes(end.getHours() * 60 + end.getMinutes())
  }

  // A mutation's `error`/`isError` survives until that same mutation is re-invoked —
  // TanStack Query has no idea the other one has since run. Without resetting both
  // before firing either, a failed "Mark done" followed by a failed "Mark not done"
  // would leave the banner showing the older of the two errors (`??` below picks
  // whichever `.error` is non-null, not whichever is most recent). Resetting both
  // here makes "at most one of the two carries an error" actually true, and also
  // clears a stale banner the instant the user retries rather than leaving it up
  // while the new request is in flight.
  const toggleDone = () => {
    complete.reset()
    uncomplete.reset()
    if (isDone) uncomplete.mutate(id)
    else complete.mutate(id)
  }

  return (
    <div className="mx-auto max-w-lg p-6">
      <Link to="/" className="text-xs text-ink-muted">
        ‹ Back to the week
      </Link>

      <h1 className="mt-3 text-xl" style={isDone ? { textDecoration: 'line-through' } : undefined}>
        {task.data?.name ?? `Task #${data.task_id}`}
      </h1>

      <dl className="mt-4 grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
        <dt className="text-ink-faint">Kind</dt>
        <dd className="capitalize">{data.kind}</dd>
        <dt className="text-ink-faint">When</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <span>{day.toDateString()}</span>
          <input
            type="time"
            step={60}
            value={toTimeInput(startMinutes)}
            className="rounded-[8px] px-2 py-1"
            style={{ background: 'var(--surface)' }}
            onChange={(e) => setStartMinutes(fromTimeInput(e.target.value))}
          />
          <span className="text-ink-faint">–</span>
          <input
            type="time"
            step={60}
            value={toTimeInput(endMinutes)}
            className="rounded-[8px] px-2 py-1"
            style={{ background: 'var(--surface)' }}
            onChange={(e) => setEndMinutes(fromTimeInput(e.target.value))}
          />
          <button
            type="button"
            className="rounded-[8px] px-2 py-1 text-xs font-bold disabled:opacity-50"
            style={{ background: 'var(--pale)' }}
            disabled={saveTimes.isPending}
            onClick={() => saveTimes.mutate(resolveDayTimeRange(day, startMinutes, endMinutes))}
          >
            {saveTimes.isPending ? 'Saving…' : 'Save'}
          </button>
        </dd>
        <dt className="text-ink-faint">Categories</dt>
        <dd>{data.tag_ids.map((t) => tagMap.get(t)?.name ?? `#${t}`).join(', ') || '—'}</dd>
        <dt className="text-ink-faint">Source</dt>
        <dd>{data.source}</dd>
        <dt className="text-ink-faint">Notes</dt>
        <dd>{data.notes || '—'}</dd>
      </dl>

      {saveTimes.isError && (
        <p className="mt-2 text-xs" style={{ color: 'var(--over)' }}>
          {errorMessage(saveTimes.error)}
        </p>
      )}

      <div className="mt-6 flex gap-2">
        <button
          type="button"
          className="rounded-[8px] px-3 py-1.5 text-sm font-bold"
          style={{ background: 'var(--pale)' }}
          onClick={toggleDone}
        >
          {isDone ? 'Mark not done' : 'Mark done'}
        </button>
        <Link
          to={`/tasks/${data.task_id}`}
          className="rounded-[8px] px-3 py-1.5 text-sm text-ink-muted"
        >
          Open the task
        </Link>
        <button
          type="button"
          className="ml-auto rounded-[8px] px-3 py-1.5 text-sm"
          style={{ color: 'var(--over)' }}
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          {remove.isPending ? 'Deleting…' : 'Delete'}
        </button>
      </div>

      {(complete.isError || uncomplete.isError) && (
        <p className="mt-2 text-xs" style={{ color: 'var(--over)' }}>
          {errorMessage(complete.error ?? uncomplete.error)}
        </p>
      )}

      {remove.isError && (
        <p className="mt-2 text-xs" style={{ color: 'var(--over)' }}>
          {errorMessage(remove.error)}
        </p>
      )}
    </div>
  )
}
