import { IconTrash } from './icons'

/**
 * A destructive control that fires on a second click rather than a first: a
 * clearly-a-trash-can icon button every version card can afford space for, then
 * an explicit "Delete?" a click later. Not `window.confirm` — a native dialog
 * would block the card's own click-to-show interaction and read as some
 * unrelated part of the page interrupting. Which card is armed lives in the
 * parent (only one at a time), so clicking a different card's delete arms that
 * one instead.
 *
 * Sized and coloured to be found without hovering (item 2 of the rail-polish
 * pass) — a bare "×" at low opacity was easy to miss entirely: a 28px hit area
 * (`h-7 w-7`), `text-ink-muted` at rest for real contrast against the card, and
 * `var(--over)` on hover *and* keyboard focus so the danger colour isn't
 * hover-only.
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
        'flex h-7 shrink-0 items-center justify-center gap-1 rounded-[7px] text-[11px] font-medium leading-none transition-colors disabled:opacity-40',
        'outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--over)]',
        armed
          ? 'min-w-7 px-2 text-white'
          : 'w-7 text-ink-muted hover:bg-[var(--pale)] hover:text-[var(--over)] focus-visible:bg-[var(--pale)] focus-visible:text-[var(--over)]',
      ].join(' ')}
      style={armed ? { background: 'var(--over)' } : undefined}
    >
      {pending ? '…' : armed ? 'Delete?' : <IconTrash width={15} height={15} />}
    </button>
  )
}
