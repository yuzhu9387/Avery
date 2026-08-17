import { GRID, snapMinutes } from './geometry'
import { formatLocal, parseLocal } from './datetime'

export type DragIntent =
  | { kind: 'move'; deltaMinutes: number; deltaDays: number }
  | { kind: 'resize'; edge: 'start' | 'end'; deltaMinutes: number }

export type DragPlan =
  | { kind: 'move'; start_at: string }
  | { kind: 'patch'; body: { start_at?: string; end_at?: string } }

const shift = (d: Date, minutes: number) => new Date(d.getTime() + minutes * 60000)

/**
 * How many day columns the pointer has landed away from the one it started in.
 *
 * Derived from where the pointer *is* relative to the origin column, not from how far
 * it has travelled since the grab. Measuring travel meant the result depended on where
 * inside the card the user happened to press: grabbing near a card's right edge and
 * moving 70px — still visually within the same column — rounded to a whole day and
 * moved the event, while grabbing near the left edge and dropping clearly over the
 * next column could round to 0 and snap back.
 *
 * `floor` is what gives "the column under the cursor": staying inside the origin
 * column keeps the ratio in [0, 1) -> 0, one column right lands in [1, 2) -> 1, and
 * anywhere left of the origin goes negative -> -1 or beyond.
 */
export function dayColumnDelta(clientX: number, columnLeft: number, columnWidth: number): number {
  if (columnWidth <= 0) return 0
  return Math.floor((clientX - columnLeft) / columnWidth)
}

/**
 * Turn a pointer gesture into the request to send, or null when nothing changed.
 *
 * Pure on purpose: this is where snapping, day shifts and the minimum-duration clamp
 * live, and all three are easy to get subtly wrong in the middle of an event handler.
 * A move goes to POST /events/{id}/move, which preserves duration server-side; a
 * resize goes to PATCH, which validates the new bounds.
 */
export function resolveDrag(
  event: { start_at: string; end_at: string },
  intent: DragIntent,
): DragPlan | null {
  const start = parseLocal(event.start_at)
  const end = parseLocal(event.end_at)

  if (intent.kind === 'move') {
    const minutes = snapMinutes(intent.deltaMinutes) + intent.deltaDays * 24 * 60
    if (minutes === 0) return null
    return { kind: 'move', start_at: formatLocal(shift(start, minutes)) }
  }

  const minutes = snapMinutes(intent.deltaMinutes)
  if (minutes === 0) return null

  if (intent.edge === 'end') {
    const floor = shift(start, GRID.slotMinutes)
    const next = shift(end, minutes)
    return { kind: 'patch', body: { end_at: formatLocal(next < floor ? floor : next) } }
  }

  const ceiling = shift(end, -GRID.slotMinutes)
  const next = shift(start, minutes)
  return { kind: 'patch', body: { start_at: formatLocal(next > ceiling ? ceiling : next) } }
}
