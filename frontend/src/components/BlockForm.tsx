import { useState } from 'react'
import type { FormEvent } from 'react'

import type { TemplateBlock } from '../api/types'
import { DAY_LABELS, diffBlock } from '../hooks/useTemplate'
import { useTags } from '../hooks/useTags'
import { Field } from './Field'
import { TagChip } from './TagChip'

const INPUT = 'rounded-[8px] border border-line bg-surface px-2 py-1.5 text-sm text-ink'

/** `<input type="time">` speaks "HH:MM"; the backend speaks "HH:MM:SS". */
const toTimeInput = (t: string) => t.slice(0, 5)
const fromTimeInput = (t: string) => (t.length === 5 ? `${t}:00` : t)

/** Create and edit share one form: pass `block` to seed the fields, diff on
 *  submit, and change the label; omit it to start blank and send the full body. */
export function BlockForm({
  block,
  initialDays,
  onSubmit,
  onCancel,
  submitting = false,
  error,
}: {
  block?: TemplateBlock
  /** Days to preselect when creating (ignored when editing) — e.g. a column's
   *  "+" button seeds its own canonical day set instead of always Mon–Fri. */
  initialDays?: number[]
  onSubmit: (body: Partial<TemplateBlock>) => void
  onCancel: () => void
  submitting?: boolean
  /** Surfaced verbatim — e.g. `ApiError.detail` from a 422 for an unknown tag id. */
  error?: string | null
}) {
  const tagsQuery = useTags()
  const tags = tagsQuery.data ?? []

  const [days, setDays] = useState<number[]>(block?.days ?? initialDays ?? [1, 2, 3, 4, 5])
  const [startTime, setStartTime] = useState(toTimeInput(block?.start_time ?? '09:00:00'))
  const [endTime, setEndTime] = useState(toTimeInput(block?.end_time ?? '10:00:00'))
  const [taskName, setTaskName] = useState(block?.task_name ?? '')
  const [tagIds, setTagIds] = useState<number[]>(block?.tag_ids ?? [])

  const toggleDay = (d: number) => {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))
  }
  const toggleTag = (id: number) => {
    setTagIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]))
  }

  // Not an error: it's how the 23:00–07:00 rest block is stored.
  const crossesMidnight = endTime <= startTime

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!taskName.trim() || days.length === 0) return

    const next = {
      days: [...days].sort((a, b) => a - b),
      start_time: fromTimeInput(startTime),
      end_time: fromTimeInput(endTime),
      task_name: taskName.trim(),
      tag_ids: tagIds,
    }

    if (!block) {
      onSubmit(next)
      return
    }

    const patch = diffBlock(block, next)
    if (Object.keys(patch).length === 0) {
      onCancel()
      return
    }
    onSubmit(patch)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col">
      <Field label="Days">
        <div className="flex gap-1">
          {DAY_LABELS.map((label, i) => {
            const d = i + 1
            const active = days.includes(d)
            return (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                aria-pressed={active}
                className="rounded-[8px] px-2 py-1 text-xs font-medium transition-opacity"
                style={{
                  background: active ? 'var(--pale)' : 'var(--surface)',
                  border: '1px solid var(--line)',
                  opacity: active ? 1 : 0.55,
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
        {days.length === 0 && (
          <span className="text-xs text-[var(--over)]">Pick at least one day.</span>
        )}
      </Field>

      <div className="flex gap-3">
        <Field label="Start time">
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className={INPUT}
          />
        </Field>
        <Field label="End time">
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className={INPUT}
          />
        </Field>
      </div>
      {crossesMidnight && (
        <p className="-mt-2 mb-3 text-xs text-ink-faint">
          Crosses midnight — ends the morning after it starts.
        </p>
      )}

      <Field label="Task name">
        <input
          type="text"
          value={taskName}
          onChange={(e) => setTaskName(e.target.value)}
          className={INPUT}
          autoFocus
        />
      </Field>

      <Field label="Tags">
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => {
            const active = tagIds.includes(tag.id)
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
          {tagsQuery.isSuccess && tags.length === 0 && (
            <span className="text-xs text-ink-faint">No tags yet.</span>
          )}
        </div>
      </Field>

      {error && <p className="mb-3 text-xs text-[var(--over)]">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-[8px] px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-[var(--pale)]/50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || !taskName.trim() || days.length === 0}
          className="rounded-[8px] bg-[var(--pale)] px-3 py-1.5 text-sm font-medium text-ink transition-opacity hover:opacity-80 disabled:opacity-50"
        >
          {submitting ? 'Saving…' : block ? 'Save' : 'Create'}
        </button>
      </div>
    </form>
  )
}
