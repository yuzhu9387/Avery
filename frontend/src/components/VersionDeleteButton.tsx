/**
 * A destructive control that fires on a second click rather than a first: the
 * compact "×" every version card can afford space for, then an explicit
 * "Delete?" a click later. Not `window.confirm` — a native dialog would block
 * the card's own click-to-show interaction and read as some unrelated part of
 * the page interrupting. Which card is armed lives in the parent (only one at
 * a time), so clicking a different card's delete arms that one instead.
 */
export function VersionDeleteButton({
  armed,
  pending,
  label,
  onArm,
  onConfirm,
}: {
  /** Whether *this* card's delete is the one primed to fire on the next click. */
  armed: boolean
  pending: boolean
  /** Name of the thing being deleted, for the accessible name only. */
  label: string
  onArm: () => void
  onConfirm: () => void
}) {
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={armed ? `Confirm delete ${label}` : `Delete ${label}`}
      // Stops the click from also landing on the card underneath, which is the
      // click-to-show target — without this, deleting a card would also select it.
      onClick={(e) => {
        e.stopPropagation()
        if (armed) onConfirm()
        else onArm()
      }}
      className={[
        'shrink-0 rounded-[6px] px-1.5 py-0.5 text-[11px] font-medium leading-none transition-colors disabled:opacity-40',
        armed
          ? 'text-white'
          : 'text-ink-faint hover:bg-[var(--pale)] hover:text-[var(--over)]',
      ].join(' ')}
      style={armed ? { background: 'var(--over)' } : undefined}
    >
      {pending ? '…' : armed ? 'Delete?' : '×'}
    </button>
  )
}
