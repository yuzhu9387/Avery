import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { errorMessage } from '../api/client'
import { deleteEvent, getEvent, updateEvent } from '../api/events'
import { invalidateCalendar } from '../api/invalidate'
import { qk } from '../api/keys'
import { TagChip } from '../components/TagChip'
import { useEventMutations } from '../hooks/useEventMutations'
import { useTags } from '../hooks/useTags'
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
  const tagsQuery = useTags()
  const { complete, uncomplete } = useEventMutations()

  // Local drafts of the start/end minutes-since-midnight shown in the time inputs,
  // plus the task name, tag picker, and notes drafts below. `syncedId` tracks which
  // event's data these drafts were last derived from, so switching to a different
  // event (id changes) re-derives them, while the user's own in-progress edits on
  // the current event are left alone.
  const [syncedId, setSyncedId] = useState<number | null>(null)
  const [startMinutes, setStartMinutes] = useState(0)
  const [endMinutes, setEndMinutes] = useState(0)
  // `null` means "no draft yet — read live from the loaded data", the same
  // null-means-unset convention TaskDetailPage's name/notes drafts use, so a draft
  // started before the task/event finished loading is never silently overwritten
  // by data that arrives afterward.
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [notesDraft, setNotesDraft] = useState<string | null>(null)
  const [tagIdsDraft, setTagIdsDraft] = useState<number[] | null>(null)

  const event = useQuery({ queryKey: qk.event(id), queryFn: () => getEvent(id) })

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

  const saveName = useMutation({
    mutationFn: (body: { title: string }) => updateEvent(id, body),
    onSuccess: () => invalidateCalendar(queryClient),
  })

  const saveTags = useMutation({
    mutationFn: (body: { tag_ids: number[] }) => updateEvent(id, body),
    onSuccess: () => invalidateCalendar(queryClient),
  })

  const saveNotes = useMutation({
    mutationFn: (body: { notes: string }) => updateEvent(id, body),
    onSuccess: () => invalidateCalendar(queryClient),
  })

  if (event.isLoading) return <p className="p-6 text-sm text-ink-faint">Loading…</p>
  if (event.isError || !event.data)
    return <p className="p-6 text-sm text-ink-faint">Couldn't load that event.</p>

  const data = event.data
  const isDone = data.completed_at !== null
  const day = parseLocal(data.start_at)

  // "Adjusting state during rendering" (a React-documented pattern): when the
  // loaded event changes, re-derive the time drafts from its data before this
  // render commits, so there is no frame where the inputs briefly show stale
  // minutes. Name/notes/tag drafts are reset to `null` instead of pre-filled —
  // they read live from `data` at render time (see below).
  // A save of this same event doesn't retrigger this — `data.id` is unchanged, so
  // the drafts (already holding what was just saved) are left as the source of truth.
  if (data.id !== syncedId) {
    setSyncedId(data.id)
    const start = parseLocal(data.start_at)
    const end = parseLocal(data.end_at)
    setStartMinutes(start.getHours() * 60 + start.getMinutes())
    setEndMinutes(end.getHours() * 60 + end.getMinutes())
    setNameDraft(null)
    setNotesDraft(null)
    setTagIdsDraft(null)
  }

  const displayName = nameDraft ?? data.title
  const displayNotes = notesDraft ?? data.notes
  const displayTagIds = tagIdsDraft ?? data.tag_ids

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

  const commitName = () => {
    const trimmed = displayName.trim()
    if (trimmed && trimmed !== data.title) saveName.mutate({ title: trimmed })
  }

  const commitNotes = () => {
    if (displayNotes !== data.notes) saveNotes.mutate({ notes: displayNotes })
  }

  const toggleTag = (tagId: number) => {
    const next = displayTagIds.includes(tagId)
      ? displayTagIds.filter((t) => t !== tagId)
      : [...displayTagIds, tagId]
    setTagIdsDraft(next)
  }

  const saveTagsDirty = tagIdsDraft !== null

  return (
    <div className="mx-auto max-w-lg p-6">
      <Link to="/" className="text-xs text-ink-muted">
        ‹ Back to the week
      </Link>

      <input
        value={displayName}
        onChange={(e) => setNameDraft(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          // An IME commits its composition with Enter, and the browser still
          // reports that keydown with isComposing set — without this guard,
          // accepting IME-composed characters would also submit the name mid-word.
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            commitName()
            e.currentTarget.blur()
          }
        }}
        aria-label="Event title"
        style={isDone ? { textDecoration: 'line-through' } : undefined}
        className="mt-3 w-full border-none bg-transparent text-xl outline-none focus:ring-0"
      />
      {saveName.isError && (
        <p className="mt-1 text-xs" style={{ color: 'var(--over)' }}>
          {errorMessage(saveName.error)}
        </p>
      )}

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
        <dd>
          <div className="flex flex-wrap items-center gap-1.5">
            {(tagsQuery.data ?? []).map((tag) => {
              const active = displayTagIds.includes(tag.id)
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTag(tag.id)}
                  className="rounded-full transition-opacity"
                  style={{ opacity: active ? 1 : 0.4 }}
                >
                  <TagChip tag={tag} size="xs" />
                </button>
              )
            })}
            {tagsQuery.isSuccess && (tagsQuery.data ?? []).length === 0 && (
              <span className="text-xs text-ink-faint">No tags yet.</span>
            )}
            {saveTagsDirty && (
              <button
                type="button"
                className="rounded-[8px] px-2 py-1 text-xs font-bold disabled:opacity-50"
                style={{ background: 'var(--pale)' }}
                disabled={saveTags.isPending}
                onClick={() =>
                  saveTags.mutate({ tag_ids: displayTagIds }, { onSuccess: () => setTagIdsDraft(null) })
                }
              >
                {saveTags.isPending ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
          {saveTags.isError && (
            <p className="mt-1 text-xs" style={{ color: 'var(--over)' }}>
              {errorMessage(saveTags.error)}
            </p>
          )}
        </dd>
        <dt className="text-ink-faint">Source</dt>
        <dd>{data.source}</dd>
        <dt className="text-ink-faint">Notes</dt>
        <dd>
          <textarea
            value={displayNotes}
            onChange={(e) => setNotesDraft(e.target.value)}
            onBlur={commitNotes}
            rows={3}
            className="w-full rounded-[8px] px-2 py-1 text-sm"
            style={{ background: 'var(--surface)' }}
          />
          {saveNotes.isError && (
            <p className="mt-1 text-xs" style={{ color: 'var(--over)' }}>
              {errorMessage(saveNotes.error)}
            </p>
          )}
        </dd>
      </dl>

      {saveTimes.isError && (
        <p className="mt-2 text-xs" style={{ color: 'var(--over)' }}>
          {errorMessage(saveTimes.error)}
        </p>
      )}

      {/* The two actions that change or remove *this* event sit together on the left;
       *  the links that navigate elsewhere are grouped to the right. Delete used to
       *  carry `ml-auto`, which pushed it to the far edge — a long way from the other
       *  control acting on the same event. */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-[8px] px-3 py-1.5 text-sm font-bold"
          style={{ background: 'var(--pale)' }}
          onClick={toggleDone}
        >
          {isDone ? 'Mark not done' : 'Mark done'}
        </button>
        <button
          type="button"
          className="rounded-[8px] px-3 py-1.5 text-sm transition-colors hover:bg-[var(--blush)]/40"
          style={{ color: 'var(--over)' }}
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          {remove.isPending ? 'Deleting…' : 'Delete'}
        </button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
        {data.task_id !== null && (
          <Link
            to={`/tasks/${data.task_id}`}
            className="rounded-[8px] px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-[var(--pale)]/50 hover:text-ink"
          >
            Open the task
          </Link>
        )}
        {/* Routine-born events don't own their own schedule — the block that
         *  generated them does, and only the Routine page edits blocks. Passed as a
         *  `?block=<id>` query param on the route rather than router state, so the
         *  link works even if the Routine page is opened directly (a state object
         *  would be lost on a hard navigation or reload). */}
        {data.routine_block_id !== null && (
          <Link
            to={`/routine?block=${data.routine_block_id}`}
            className="rounded-[8px] px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-[var(--pale)]/50 hover:text-ink"
          >
            Edit routine block
          </Link>
        )}
        </div>
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
