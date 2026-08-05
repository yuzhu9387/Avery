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
