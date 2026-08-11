import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { errorMessage } from '../api/client'
import { invalidateCalendar } from '../api/invalidate'
import { qk } from '../api/keys'
import { archiveTag, createTag, deleteTag, updateTag, type TagWrite } from '../api/tags'
import type { Tag } from '../api/types'
import { formatMinutes } from '../lib/datetime'
import { CategoryEditor, type CategoryDraft, type TagWithDescription } from './CategoryEditor'

// `undefined` tag => create; a tag => edit that one. Kept as its own type rather
// than `TagWithDescription | undefined` so `editor !== null` alone answers "is the
// panel open," independent of which mode it's in.
type EditorState = { tag?: TagWithDescription }

export function CategoryRail({
  tags,
  minutesByTag,
  totalMinutes,
  hidden,
  onToggle,
  onShowAll,
  onHideAll,
  selectableKnown,
}: {
  tags: Tag[]
  minutesByTag: Record<string, number>
  totalMinutes: number
  hidden: Set<number>
  onToggle: (id: number) => void
  onShowAll: () => void
  onHideAll: () => void
  // Whether the caller's selectable-tag list has settled (its tags query resolved) —
  // NOT `tags.length > 0`. Zero categories is a legitimate settled state and must not
  // be confused with "not loaded yet," the same distinction useTagVisibility's
  // `selectableIds` already draws. The per-tag rows below get this for free (an
  // unsettled list is simply an empty `tags` array, so they don't render). This
  // control doesn't get that for free — `hideAll` no-ops before the list is known, so
  // without this gate the button would sit there clickable and silently do nothing.
  selectableKnown: boolean
}) {
  const queryClient = useQueryClient()
  const railRef = useRef<HTMLDivElement>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)
  // Which row's delete 409'd, and the server's message for it. Keyed to a single tag
  // id: only one delete attempt can be in flight from this rail at a time, and the
  // message must stay pinned to the row it came from, not float free.
  const [conflict, setConflict] = useState<{ tagId: number; message: string } | null>(null)

  // A tag write changes card colours across the whole grid, the rail's own contents,
  // and the rule rail's labels — invalidating just ['tags'] leaves the grid showing
  // stale colours until something else happens to refetch it.
  const invalidateTags = () => {
    queryClient.invalidateQueries({ queryKey: qk.tags })
    invalidateCalendar(queryClient)
  }

  const save = useMutation({
    mutationFn: (draft: CategoryDraft) => {
      const body: TagWrite = { name: draft.name, color: draft.color, description: draft.description }
      return editor?.tag ? updateTag(editor.tag.id, body) : createTag(body)
    },
    onSuccess: () => {
      invalidateTags()
      setEditor(null)
    },
  })

  const remove = useMutation({
    mutationFn: (id: number) => deleteTag(id),
    onSuccess: (_data, id) => {
      invalidateTags()
      setConflict((c) => (c?.tagId === id ? null : c))
    },
    onError: (err, id) => {
      // The server's message already names what's still using the category and, for
      // events, the count — shown verbatim, not recomputed here.
      setConflict({ tagId: id, message: errorMessage(err) ?? 'Something went wrong. Please try again.' })
    },
  })

  const archive = useMutation({
    mutationFn: (id: number) => archiveTag(id),
    onSuccess: (_data, id) => {
      invalidateTags()
      setConflict((c) => (c?.tagId === id ? null : c))
    },
  })

  const openEditor = (state: EditorState) => {
    // Anchored off the rail's own box, measured fresh on each open — a fixed-position
    // panel rather than one absolutely positioned inside the rail's scrolling <aside>,
    // which clips overflow-x the moment overflow-y is set (a well-known CSS quirk:
    // 'visible' on one axis computes to 'auto' once the other axis isn't 'visible').
    const rect = railRef.current?.getBoundingClientRect()
    setAnchor(rect ? { left: rect.right + 12, top: rect.top } : null)
    save.reset()
    setEditor(state)
  }

  const closeEditor = () => {
    save.reset()
    setEditor(null)
  }

  const anyHidden = hidden.size > 0

  return (
    <div ref={railRef} className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink-faint">Categories</h2>
        <button
          type="button"
          className="grid size-4 shrink-0 place-items-center rounded-[3px] text-xs font-bold leading-none text-ink-faint transition-colors hover:text-ink"
          style={{ border: '1.5px solid var(--line-strong)' }}
          onClick={() => openEditor({})}
          aria-label="Add category"
        >
          +
        </button>
      </div>

      {/* The None/All select-all control this heading used to carry moved here,
          just below it, rather than vanishing to make room for the +. It was
          requested two rounds ago and is still in active use, so it keeps its exact
          behaviour — only its position changed. */}
      {selectableKnown && tags.length > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            className="text-[10px] font-bold uppercase tracking-wide text-ink-faint transition-colors hover:text-ink"
            onClick={anyHidden ? onShowAll : onHideAll}
            aria-label={anyHidden ? 'Show all categories' : 'Hide all categories'}
          >
            {anyHidden ? 'All' : 'None'}
          </button>
        </div>
      )}

      {tags.map((tag) => {
        const minutes = minutesByTag[String(tag.id)] ?? 0
        const isHidden = hidden.has(tag.id)
        const isDeletingThis = remove.isPending && remove.variables === tag.id
        return (
          <div key={tag.id} className="flex flex-col gap-1">
            {/* Three siblings, not one button wrapping everything: a button can't
                nest a button, and this row now needs three independent click targets
                (visibility, edit, delete). */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="grid size-3.5 shrink-0 place-items-center rounded-[3px] text-[9px] leading-none"
                style={{
                  background: isHidden ? 'transparent' : tag.color,
                  border: `1.5px solid ${tag.color}`,
                  color: 'var(--surface-raised)',
                }}
                onClick={() => onToggle(tag.id)}
                aria-pressed={!isHidden}
                aria-label={isHidden ? `Show ${tag.name}` : `Hide ${tag.name}`}
              >
                {isHidden ? '' : '✓'}
              </button>
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => openEditor({ tag: tag as TagWithDescription })}
                aria-label={`Edit ${tag.name}`}
              >
                <span
                  className="block truncate text-xs font-bold"
                  style={{ color: isHidden ? 'var(--ink-faint)' : 'var(--ink)' }}
                >
                  {tag.name}
                </span>
              </button>
              <span className="shrink-0 text-[10px] tabular-nums text-ink-faint">
                {formatMinutes(minutes)}
              </span>
              <button
                type="button"
                className="shrink-0 text-xs font-bold leading-none text-ink-faint transition-colors hover:text-[var(--over)] disabled:opacity-50"
                disabled={isDeletingThis}
                onClick={() => remove.mutate(tag.id)}
                aria-label={`Delete ${tag.name}`}
              >
                −
              </button>
            </div>
            {/* Share of the week. Scaled against the week's total, not against the sum
                of the buckets, so untagged time shows as the gap it is. */}
            <div className="ml-5 h-1 rounded-full" style={{ background: 'var(--line)' }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: totalMinutes > 0 ? `${(minutes / totalMinutes) * 100}%` : '0%',
                  background: tag.color,
                  opacity: isHidden ? 0.3 : 1,
                }}
              />
            </div>
            {conflict?.tagId === tag.id && (
              <div className="ml-5 rounded-[8px] p-2 text-[10px]" style={{ background: 'var(--surface)' }}>
                <p style={{ color: 'var(--over)' }}>{conflict.message}</p>
                <div className="mt-1 flex gap-3">
                  <button
                    type="button"
                    className="font-bold text-ink-muted transition-colors hover:text-ink"
                    disabled={archive.isPending}
                    onClick={() => archive.mutate(tag.id)}
                  >
                    {archive.isPending ? 'Archiving…' : 'Archive instead'}
                  </button>
                  <button
                    type="button"
                    className="text-ink-faint transition-colors hover:text-ink"
                    onClick={() => setConflict(null)}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {editor && (
        <CategoryEditor
          tag={editor.tag}
          anchor={anchor}
          isPending={save.isPending}
          error={errorMessage(save.error)}
          onClose={closeEditor}
          onSave={(draft) => save.mutate(draft)}
        />
      )}
    </div>
  )
}
