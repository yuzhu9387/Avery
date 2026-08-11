import { useState } from 'react'

/**
 * A field that looks like text until you click it.
 *
 * Used for the name and note on a version card, where the card itself is a click
 * target that shows that version. That makes the event plumbing the whole point of
 * this component rather than an afterthought:
 *
 *  - `stopPropagation` on click, so editing the text does not also re-tune the
 *    screen behind it.
 *  - `stopPropagation` on keydown, so typing a space into a note does not activate
 *    the card's Enter/Space handler.
 *  - Enter commits, Escape reverts. Without Escape the only way out of a
 *    half-typed edit is to blur, which commits it.
 *
 * The draft is local and `null` when not editing, so the field always shows the
 * server's value until the user actually types — a version renamed in another tab
 * shows up here rather than being masked by stale local state.
 */
export function InlineText({
  value,
  onCommit,
  ariaLabel,
  placeholder,
  className,
  allowEmpty = false,
}: {
  value: string
  onCommit: (next: string) => void
  ariaLabel: string
  placeholder?: string
  className?: string
  /** A note may be cleared; a name may not. */
  allowEmpty?: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)

  const commit = () => {
    if (draft === null) return
    const next = draft.trim()
    setDraft(null)
    if (!next && !allowEmpty) return
    if (next !== value) onCommit(next)
  }

  return (
    <input
      value={draft ?? value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        // `isComposing` guards an IME candidate-selection Enter (e.g. confirming a
        // Chinese candidate) from being read as commit-and-blur — without it, Enter
        // mid-composition would blur the field before the user finished typing.
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault()
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          setDraft(null)
          e.currentTarget.blur()
        }
      }}
      onBlur={commit}
      className={[
        // Transparent and borderless at rest so it reads as text, with the grey
        // cell appearing on hover to advertise that it is editable.
        'w-full truncate rounded-[5px] border border-transparent bg-transparent px-1 outline-none',
        'transition-colors hover:border-line hover:bg-[var(--pale)]/60',
        'focus:border-line focus:bg-[var(--surface-raised)]',
        className ?? '',
      ].join(' ')}
    />
  )
}
