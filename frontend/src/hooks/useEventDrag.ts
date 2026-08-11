import { useCallback, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { moveEvent, updateEvent } from '../api/events'
import { invalidateCalendar } from '../api/invalidate'
import type { AveryEvent } from '../api/types'
import type { GestureOrigin } from './useCardGestures'
import { resolveDrag } from '../lib/drag'
import { pxToMinutes } from '../lib/geometry'

/** A live pointer offset for whichever event is mid-drag. Purely visual — the
 *  authoritative bounds only change once the pointer lifts and the mutation lands. */
export interface DragDraft {
  eventId: number
  kind: 'move' | 'resize'
  edge?: 'start' | 'end'
  dx: number
  dy: number
}

/**
 * Binds pointer gestures on the week grid to the pure planner in `lib/drag.ts`.
 *
 * The live pixel offset lives in state so the dragged block follows the cursor
 * without refetching. The mutation only fires once, on pointer-up, after
 * `resolveDrag` turns the gesture into a request — or decides nothing moved, in
 * which case this does nothing and the gesture reads as a click.
 *
 * Takes `pxPerHour` rather than reading `GRID.basePxPerHour` directly so drag math
 * stays correct at any zoom level.
 */
export function useEventDrag(pxPerHour: number) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<DragDraft | null>(null)

  // Every key an event is visible through — see invalidateCalendar for why all of them.
  const settle = useCallback(() => invalidateCalendar(queryClient), [queryClient])

  const move = useMutation({
    mutationFn: ({ id, start_at }: { id: number; start_at: string }) => moveEvent(id, start_at),
    onSettled: settle,
  })

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<AveryEvent> }) =>
      updateEvent(id, body),
    onSettled: settle,
  })

  const beginMove = useCallback(
    (event: AveryEvent, origin: GestureOrigin) => {
      const el = origin.el
      // Measured, not assumed: the day column is this card's parent, and reading its
      // width here keeps deltaDays correct across window resizes and zoom changes.
      const columnWidth = el.parentElement?.getBoundingClientRect().width ?? 0
      const originX = origin.clientX
      const originY = origin.clientY

      // Pointer capture lets this element keep receiving move/up events once the
      // cursor leaves the card's bounds.
      el.setPointerCapture(origin.pointerId)
      setDraft({ eventId: event.id, kind: 'move', dx: 0, dy: 0 })

      const handleMove = (ev: PointerEvent) => {
        setDraft({ eventId: event.id, kind: 'move', dx: ev.clientX - originX, dy: ev.clientY - originY })
      }

      const finish = () => {
        el.removeEventListener('pointermove', handleMove)
        el.removeEventListener('pointerup', handleUp)
        el.removeEventListener('pointercancel', handleCancel)
        try {
          el.releasePointerCapture(origin.pointerId)
        } catch {
          // The pointer is already gone on a cancel; releasing it again is not an error.
        }
        setDraft(null)
      }

      const handleUp = (ev: PointerEvent) => {
        const deltaMinutes = pxToMinutes(ev.clientY - originY, pxPerHour)
        const deltaDays = columnWidth > 0 ? Math.round((ev.clientX - originX) / columnWidth) : 0
        finish()
        const plan = resolveDrag(event, { kind: 'move', deltaMinutes, deltaDays })
        if (!plan || plan.kind !== 'move') return
        move.mutate({ id: event.id, start_at: plan.start_at })
      }

      // A cancelled gesture must clear the draft. Without this the card stays drawn at
      // a time it does not occupy until the next render.
      const handleCancel = () => finish()

      el.addEventListener('pointermove', handleMove)
      el.addEventListener('pointerup', handleUp, { once: true })
      el.addEventListener('pointercancel', handleCancel, { once: true })
    },
    [move, pxPerHour],
  )

  const onPointerDownResize = useCallback(
    (event: AveryEvent) => (e: React.PointerEvent, edge: 'start' | 'end') => {
      const el = e.currentTarget as HTMLElement
      const originY = e.clientY
      const pointerId = e.pointerId

      el.setPointerCapture(pointerId)
      setDraft({ eventId: event.id, kind: 'resize', edge, dx: 0, dy: 0 })

      const handleMove = (ev: PointerEvent) => {
        setDraft({ eventId: event.id, kind: 'resize', edge, dx: 0, dy: ev.clientY - originY })
      }

      const finish = () => {
        el.removeEventListener('pointermove', handleMove)
        el.removeEventListener('pointerup', handleUp)
        el.removeEventListener('pointercancel', handleCancel)
        try {
          el.releasePointerCapture(pointerId)
        } catch {
          // The pointer is already gone on a cancel; releasing it again is not an error.
        }
        setDraft(null)
      }

      const handleUp = (ev: PointerEvent) => {
        const deltaMinutes = pxToMinutes(ev.clientY - originY, pxPerHour)
        finish()
        const plan = resolveDrag(event, { kind: 'resize', edge, deltaMinutes })
        if (!plan || plan.kind !== 'patch') return
        patch.mutate({ id: event.id, body: plan.body })
      }

      // A cancelled gesture must clear the draft, for the same reason as beginMove.
      const handleCancel = () => finish()

      el.addEventListener('pointermove', handleMove)
      el.addEventListener('pointerup', handleUp, { once: true })
      el.addEventListener('pointercancel', handleCancel, { once: true })
    },
    [patch, pxPerHour],
  )

  return { draft, beginMove, onPointerDownResize }
}
