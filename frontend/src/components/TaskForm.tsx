import { useState } from 'react'
import type { FormEvent } from 'react'

import type { Priority, Task } from '../api/types'
import { useTags } from '../hooks/useTags'
import { Field } from './Field'
import { TagChip } from './TagChip'

const PRIORITIES: Priority[] = ['low', 'normal', 'high']

const INPUT = 'rounded-[8px] border border-line bg-surface px-2 py-1.5 text-sm text-ink'

/** Create and edit share one form: pass `task` to seed the fields and change the
 *  submit label, omit it to start blank. */
export function TaskForm({
  task,
  onSubmit,
  onCancel,
  submitting = false,
}: {
  task?: Task
  onSubmit: (body: Partial<Task>) => void
  onCancel: () => void
  submitting?: boolean
}) {
  const tagsQuery = useTags()
  const tags = tagsQuery.data ?? []

  const [name, setName] = useState(task?.name ?? '')
  const [tagIds, setTagIds] = useState<number[]>(task?.tag_ids ?? [])
  const [notes, setNotes] = useState(task?.notes ?? '')
  const [dueDate, setDueDate] = useState(task?.due_date ?? '')
  const [estMinutes, setEstMinutes] = useState(
    task?.est_minutes != null ? String(task.est_minutes) : '',
  )
  const [priority, setPriority] = useState<Priority>(task?.priority ?? 'normal')
  const [isFloating, setIsFloating] = useState(task?.is_floating ?? false)

  const toggleTag = (id: number) => {
    setTagIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]))
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onSubmit({
      name: name.trim(),
      tag_ids: tagIds,
      notes,
      due_date: dueDate === '' ? null : dueDate,
      est_minutes: estMinutes.trim() === '' ? null : Number(estMinutes),
      priority,
      is_floating: isFloating,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col">
      <Field label="Name">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
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

      <Field label="Notes">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className={INPUT}
        />
      </Field>

      <div className="flex gap-3">
        <Field label="Due date">
          <input
            type="date"
            value={dueDate ?? ''}
            onChange={(e) => setDueDate(e.target.value)}
            className={INPUT}
          />
        </Field>

        <Field label="Estimated minutes">
          <input
            type="number"
            min={0}
            value={estMinutes}
            onChange={(e) => setEstMinutes(e.target.value)}
            className={INPUT}
          />
        </Field>
      </div>

      <Field label="Priority">
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as Priority)}
          className={INPUT}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </Field>

      <label className="mb-4 flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={isFloating}
          onChange={(e) => setIsFloating(e.target.checked)}
        />
        Floating (not tied to a fixed schedule)
      </label>

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
          disabled={submitting || !name.trim()}
          className="rounded-[8px] bg-[var(--pale)] px-3 py-1.5 text-sm font-medium text-ink transition-opacity hover:opacity-80 disabled:opacity-50"
        >
          {submitting ? 'Saving…' : task ? 'Save' : 'Create'}
        </button>
      </div>
    </form>
  )
}
