import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { errorMessage } from '../api/client'
import { deleteEvent, getEvent } from '../api/events'
import { invalidateCalendar } from '../api/invalidate'
import { qk } from '../api/keys'
import { getTask } from '../api/tasks'
import { useEventMutations } from '../hooks/useEventMutations'
import { useTagMap } from '../hooks/useTags'
import { formatTimeRange, parseLocal } from '../lib/datetime'

export default function EventDetailPage() {
  const { eventId } = useParams()
  const id = Number(eventId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const tagMap = useTagMap()
  const { complete, uncomplete } = useEventMutations()

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

  if (event.isLoading) return <p className="p-6 text-sm text-ink-faint">Loading…</p>
  if (event.isError || !event.data)
    return <p className="p-6 text-sm text-ink-faint">Couldn't load that event.</p>

  const data = event.data
  const isDone = data.completed_at !== null
  const day = parseLocal(data.start_at)

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
        <dd>
          {day.toDateString()} · {formatTimeRange(data.start_at, data.end_at)}
        </dd>
        <dt className="text-ink-faint">Categories</dt>
        <dd>{data.tag_ids.map((t) => tagMap.get(t)?.name ?? `#${t}`).join(', ') || '—'}</dd>
        <dt className="text-ink-faint">Source</dt>
        <dd>{data.source}</dd>
        <dt className="text-ink-faint">Notes</dt>
        <dd>{data.notes || '—'}</dd>
      </dl>

      <div className="mt-6 flex gap-2">
        <button
          type="button"
          className="rounded-[8px] px-3 py-1.5 text-sm font-bold"
          style={{ background: 'var(--pale)' }}
          onClick={() => (isDone ? uncomplete.mutate(id) : complete.mutate(id))}
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

      {remove.isError && (
        <p className="mt-2 text-xs" style={{ color: 'var(--over)' }}>
          {errorMessage(remove.error)}
        </p>
      )}
    </div>
  )
}
