import { useCallback, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { moveEvent, updateEvent } from '../api/events'
import type { AveryEvent } from '../api/types'
import { resolveDrag } from '../lib/drag'
import { pxToMinutes } from '../lib/geometry'
import type { Segment } from '../lib/geometry'

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
 */
export function useEventDrag() {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<DragDraft | null>(null)

  const settle = useCallback(() => {
    // The week payload and every ratio derived from it (the rule rail) are now stale.
    queryClient.invalidateQueries({ queryKey: ['week'] })
    queryClient.invalidateQueries({ queryKey: ['evaluate'] })
    queryClient.invalidateQueries({ queryKey: ['month'] })
  }, [queryClient])

  const move = useMutation({
    mutationFn: ({ id, start_at }: { id: number; start_at: string }) => moveEvent(id, start_at),
    onSettled: settle,
  })

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<AveryEvent> }) =>
      updateEvent(id, body),
    onSettled: settle,
  })

  const onPointerDownMove = useCallback(
    (event: AveryEvent, _segment: Segment) => (e: React.PointerEvent) => {
      const el = e.currentTarget as HTMLElement
      // Measured, not assumed: the day column is this block's parent, and reading
      // its width here (rather than hardcoding one) keeps deltaDays correct across
      // window resizes.
      const columnWidth = el.parentElement?.getBoundingClientRect().width ?? 0
      const originX = e.clientX
      const originY = e.clientY

      // Pointer capture lets this element keep receiving move/up events even once
      // the cursor leaves the block's bounds.
      el.setPointerCapture(e.pointerId)
      setDraft({ eventId: event.id, kind: 'move', dx: 0, dy: 0 })

      const handleMove = (ev: PointerEvent) => {
        setDraft({
          eventId: event.id,
          kind: 'move',
          dx: ev.clientX - originX,
          dy: ev.clientY - originY,
        })
      }

      const handleUp = (ev: PointerEvent) => {
        el.removeEventListener('pointermove', handleMove)
        el.removeEventListener('pointerup', handleUp)
        el.releasePointerCapture(e.pointerId)
        setDraft(null)

        const deltaMinutes = pxToMinutes(ev.clientY - originY)
        const deltaDays = columnWidth > 0 ? Math.round((ev.clientX - originX) / columnWidth) : 0
        const plan = resolveDrag(event, { kind: 'move', deltaMinutes, deltaDays })
        // A sub-snap delta resolves to null — that is a click, not a zero-delta move.
        if (!plan || plan.kind !== 'move') return
        move.mutate({ id: event.id, start_at: plan.start_at })
      }

      el.addEventListener('pointermove', handleMove)
      el.addEventListener('pointerup', handleUp, { once: true })
    },
    [move],
  )

  const onPointerDownResize = useCallback(
    (event: AveryEvent, _segment: Segment) =>
      (e: React.PointerEvent, edge: 'start' | 'end') => {
        const el = e.currentTarget as HTMLElement
        const originY = e.clientY

        el.setPointerCapture(e.pointerId)
        setDraft({ eventId: event.id, kind: 'resize', edge, dx: 0, dy: 0 })

        const handleMove = (ev: PointerEvent) => {
          setDraft({ eventId: event.id, kind: 'resize', edge, dx: 0, dy: ev.clientY - originY })
        }

        const handleUp = (ev: PointerEvent) => {
          el.removeEventListener('pointermove', handleMove)
          el.removeEventListener('pointerup', handleUp)
          el.releasePointerCapture(e.pointerId)
          setDraft(null)

          const deltaMinutes = pxToMinutes(ev.clientY - originY)
          const plan = resolveDrag(event, { kind: 'resize', edge, deltaMinutes })
          if (!plan || plan.kind !== 'patch') return
          patch.mutate({ id: event.id, body: plan.body })
        }

        el.addEventListener('pointermove', handleMove)
        el.addEventListener('pointerup', handleUp, { once: true })
      },
    [patch],
  )

  return { draft, onPointerDownMove, onPointerDownResize }
}
