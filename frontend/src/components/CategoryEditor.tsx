import { useEffect, useRef, useState } from 'react'

import type { Tag } from '../api/types'

// `Tag` in api/types.ts has no `description` field yet — see the comment in
// api/tags.ts. The backend has put one on every Tag since an earlier task, so it
// really is present at runtime on anything `listTags` returns; this just gives the
// editor a name for it. Fold this into `Tag` itself once types.ts is back in play.
export interface TagWithDescription extends Tag {
  description: string
}

export interface CategoryDraft {
  name: string
  color: string
  description: string
}

const EDITOR_WIDTH = 288

// The seven swatches theme.css defines, as plain data: a colour picker needs literal
// values to offer the user and to compare against the tag's current colour — that's
// not styling, it's the palette's actual content. Rendering still goes through
// `var(--token)` below so no hex literal ends up in a style; these hex values exist
// only for the equality check and for the value that actually gets saved. The seeded
// categories use exactly these hex values, so this list and the existing data agree
// by construction — keep it in sync if theme.css's tokens ever change.
const PALETTE: { token: string; hex: string }[] = [
  { token: '--pale', hex: '#dedecf' },
  { token: '--blush', hex: '#e7c8c8' },
  { token: '--sage', hex: '#bdbd9b' },
  { token: '--clay', hex: '#c9a88f' },
  { token: '--rose', hex: '#da96a4' },
  { token: '--rose-deep', hex: '#c97b8b' },
  { token: '--teal', hex: '#8fa8a2' },
]

/**
 * A side card, not a route: create when `tag` is omitted, edit when it's supplied.
 * Positioned by the caller via `anchor` (viewport coordinates of wherever it should
 * hang off of) rather than by this component, since "beside the rail" only makes
 * sense to whoever owns the rail's layout.
 */
export function CategoryEditor({
  tag,
  anchor,
  isPending,
  error,
  onClose,
  onSave,
}: {
  tag?: TagWithDescription
  anchor: { left: number; top: number } | null
  isPending: boolean
  error: string | null
  onClose: () => void
  onSave: (draft: CategoryDraft) => void
}) {
  const [name, setName] = useState(tag?.name ?? '')
  const [color, setColor] = useState(tag?.color ?? PALETTE[0].hex)
  const [description, setDescription] = useState(tag?.description ?? '')
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
    onSave({ name: name.trim(), color, description })
  }

  // Kept inside the viewport the same way QuickCreatePopover clamps itself.
  const left = Math.min(anchor?.left ?? 16, window.innerWidth - EDITOR_WIDTH - 16)
  const top = Math.min(anchor?.top ?? 16, window.innerHeight - 360)

  return (
    <>
      <div className="fixed inset-0 z-40" onPointerDown={onClose} />
      <div
        className="fixed z-50 p-4"
        style={{
          left: Math.max(16, left),
          top: Math.max(16, top),
          width: EDITOR_WIDTH,
          background: 'var(--surface-raised)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-card)',
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <input
          ref={nameRef}
          value={name}
          placeholder="Category name"
          className="mb-3 w-full border-b-2 pb-1 text-sm font-bold outline-none"
          style={{ borderColor: 'var(--rose-deep)', background: 'transparent' }}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            // An IME commits its composition with Enter, and the browser still
            // reports that keydown with isComposing set. Without this guard, typing
            // 家务 and pressing Enter to accept the characters would save the form
            // mid-word instead — the same bug an earlier task fixed in
            // QuickCreatePopover.
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit()
          }}
        />

        <div className="mb-3 flex flex-wrap items-center gap-2">
          {PALETTE.map((swatch) => (
            <button
              key={swatch.token}
              type="button"
              aria-label={swatch.token.replace('--', '')}
              aria-pressed={color.toLowerCase() === swatch.hex}
              className="size-6 shrink-0 rounded-full border-2"
              style={{
                background: `var(${swatch.token})`,
                borderColor: color.toLowerCase() === swatch.hex ? 'var(--ink)' : 'transparent',
              }}
              onClick={() => setColor(swatch.hex)}
            />
          ))}
          <input
            type="color"
            aria-label="Custom colour"
            value={color}
            className="size-6 shrink-0 cursor-pointer rounded-full border-0 bg-transparent p-0"
            onChange={(e) => setColor(e.target.value)}
          />
        </div>

        <textarea
          value={description}
          placeholder="Description (optional)"
          rows={2}
          className="mb-3 w-full resize-none rounded-[8px] px-2 py-1 text-sm outline-none"
          style={{ background: 'var(--surface)' }}
          onChange={(e) => setDescription(e.target.value)}
        />

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
            {isPending ? 'Saving…' : tag ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </>
  )
}
