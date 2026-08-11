import { useEffect, useRef, useState } from 'react'

import type { EventKind, Tag } from '../api/types'
import type { SlotClick } from './WeekGrid'
import { addDays, formatLocal } from '../lib/datetime'

const POPOVER_WIDTH = 320
const DEFAULT_DURATION_MINUTES = 60

const pad = (n: number) => String(n).padStart(2, '0')
const toTimeInput = (minutes: number) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`
const fromTimeInput = (value: string) => {
  const [h, m] = value.split(':').map(Number)
  return h * 60 + m
}

export interface QuickCreateDraft {
  task_name: string
  kind: EventKind
  start_at: string
  end_at: string
  tag_ids: number[]
}

export function QuickCreatePopover({
  slot,
  tags,
  isPending,
  error,
  onClose,
  onSave,
}: {
  slot: SlotClick
  tags: Tag[]
  isPending: boolean
  error: string | null
  onClose: () => void
  onSave: (draft: QuickCreateDraft) => void
}) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<EventKind>('event')
  const [startMinutes, setStartMinutes] = useState(slot.minutes)
  const [endMinutes, setEndMinutes] = useState(slot.minutes + DEFAULT_DURATION_MINUTES)
  const [tagId, setTagId] = useState<number | ''>('')
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => nameRef.current?.focus(), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = () => {
    if (!name.trim() || isPending) return
    const midnight = new Date(slot.day.getFullYear(), slot.day.getMonth(), slot.day.getDate())
    const start = new Date(midnight.getTime() + startMinutes * 60000)
    // An end at or before the start is read as crossing midnight, which is what a
    // 23:00-01:00 block means — the same convention the routine already uses.
    const end =
      endMinutes > startMinutes
        ? new Date(midnight.getTime() + endMinutes * 60000)
        : new Date(addDays(midnight, 1).getTime() + endMinutes * 60000)
    onSave({
      task_name: name.trim(),
      kind,
      start_at: formatLocal(start),
      end_at: formatLocal(end),
      tag_ids: tagId === '' ? [] : [tagId],
    })
  }

  // Kept inside the viewport: anchored at the click, but flipped left or lifted up
  // when the click was near the right or bottom edge.
  const left = Math.min(slot.x + 8, window.innerWidth - POPOVER_WIDTH - 16)
  const top = Math.min(slot.y - 24, window.innerHeight - 340)

  return (
    <>
      <div className="fixed inset-0 z-40" onPointerDown={onClose} />
      <div
        className="fixed z-50 p-4"
        style={{
          left: Math.max(16, left),
          top: Math.max(16, top),
          width: POPOVER_WIDTH,
          background: 'var(--surface-raised)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-card)',
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <input
          ref={nameRef}
          value={name}
          placeholder="Add title"
          className="mb-3 w-full border-b-2 pb-1 text-base font-bold outline-none"
          style={{ borderColor: 'var(--rose-deep)', background: 'transparent' }}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            // An IME commits its composition with Enter, and the browser reports that
            // keydown with isComposing set. Without this guard, typing 陪娃去看牙医 and
            // pressing Enter to accept the characters would create the event instead.
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit()
          }}
        />

        <div className="mb-3 flex gap-1">
          {(['event', 'task'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className="rounded-[8px] px-3 py-1 text-xs font-bold capitalize transition-colors"
              style={
                kind === option
                  ? { background: 'var(--rose-deep)', color: 'var(--surface-raised)' }
                  : { background: 'var(--pale)', color: 'var(--ink-muted)' }
              }
              onClick={() => setKind(option)}
            >
              {option}
            </button>
          ))}
        </div>

        <div className="mb-3 flex items-center gap-2 text-sm">
          <input
            type="time"
            step={900}
            value={toTimeInput(startMinutes)}
            className="rounded-[8px] px-2 py-1"
            style={{ background: 'var(--surface)' }}
            onChange={(e) => setStartMinutes(fromTimeInput(e.target.value))}
          />
          <span className="text-ink-faint">–</span>
          <input
            type="time"
            step={900}
            value={toTimeInput(endMinutes)}
            className="rounded-[8px] px-2 py-1"
            style={{ background: 'var(--surface)' }}
            onChange={(e) => setEndMinutes(fromTimeInput(e.target.value))}
          />
        </div>

        <select
          value={tagId}
          className="mb-3 w-full rounded-[8px] px-2 py-1 text-sm"
          style={{ background: 'var(--surface)' }}
          onChange={(e) => setTagId(e.target.value === '' ? '' : Number(e.target.value))}
        >
          <option value="">No category</option>
          {tags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </select>

        {error && (
          <p className="mb-2 text-xs" style={{ color: 'var(--over)' }}>
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className="px-3 py-1 text-sm text-ink-muted" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!name.trim() || isPending}
            className="rounded-[8px] px-4 py-1 text-sm font-bold disabled:opacity-50"
            style={{ background: 'var(--rose-deep)', color: 'var(--surface-raised)' }}
            onClick={submit}
          >
            {isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </>
  )
}
