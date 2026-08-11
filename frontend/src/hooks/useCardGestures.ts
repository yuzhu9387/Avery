import { useCallback, useEffect, useRef } from 'react'

const LONG_PRESS_MS = 250
const DOUBLE_CLICK_MS = 220
const MOVE_TOLERANCE_PX = 6

/** What a drag needs from the press that started it. The React synthetic event cannot
 *  be held past its handler — `currentTarget` is nulled — so the pieces are copied out. */
export interface GestureOrigin {
  el: HTMLElement
  clientX: number
  clientY: number
  pointerId: number
}

/**
 * Arbitrates the three gestures a card supports over one pointer stream.
 *
 *   hold 250ms            -> drag (the card lifts)
 *   move >6px before that -> nothing; neither a drag nor a click
 *   quick press, alone    -> open the detail page
 *   quick press, twice    -> toggle completion
 *
 * Opening waits out the double-click window rather than firing on pointer-up. The
 * browser dispatches click before dblclick, so navigating on the first press would
 * leave the page before the second could arrive — the delay is the whole reason this
 * is a hook and not three handlers.
 */
export function useCardGestures({
  onOpen,
  onToggleComplete,
  onDragStart,
}: {
  onOpen: () => void
  onToggleComplete: (point: { x: number; y: number }) => void
  onDragStart: (origin: GestureOrigin) => void
}) {
  const longPressTimer = useRef<number | undefined>(undefined)
  const clickTimer = useRef<number | undefined>(undefined)
  const press = useRef<{ x: number; y: number; lifted: boolean } | null>(null)

  useEffect(
    () => () => {
      window.clearTimeout(longPressTimer.current)
      window.clearTimeout(clickTimer.current)
    },
    [],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // A second press inside the window completes; it is not the start of a gesture.
      if (clickTimer.current !== undefined) {
        window.clearTimeout(clickTimer.current)
        clickTimer.current = undefined
        window.clearTimeout(longPressTimer.current)
        longPressTimer.current = undefined
        press.current = null
        onToggleComplete({ x: e.clientX, y: e.clientY })
        return
      }

      const origin: GestureOrigin = {
        el: e.currentTarget as HTMLElement,
        clientX: e.clientX,
        clientY: e.clientY,
        pointerId: e.pointerId,
      }
      press.current = { x: e.clientX, y: e.clientY, lifted: false }

      const cleanup = () => {
        window.clearTimeout(longPressTimer.current)
        longPressTimer.current = undefined
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
      }

      const onMove = (ev: PointerEvent) => {
        const state = press.current
        if (!state || state.lifted) return
        const moved =
          Math.abs(ev.clientX - state.x) > MOVE_TOLERANCE_PX ||
          Math.abs(ev.clientY - state.y) > MOVE_TOLERANCE_PX
        // Travelling before the hold completes abandons the gesture: the card never
        // lifted, so it is not a drag, and the pointer moved, so it is not a click.
        if (moved) {
          press.current = null
          cleanup()
        }
      }

      const onUp = () => {
        const state = press.current
        press.current = null
        cleanup()
        // A lifted card resolves as a drag however short its travel — it must not
        // fall through and open the page.
        if (!state || state.lifted) return
        clickTimer.current = window.setTimeout(() => {
          clickTimer.current = undefined
          onOpen()
        }, DOUBLE_CLICK_MS)
      }

      const onCancel = () => {
        press.current = null
        cleanup()
      }

      longPressTimer.current = window.setTimeout(() => {
        longPressTimer.current = undefined
        if (!press.current) return
        press.current.lifted = true
        onDragStart(origin)
      }, LONG_PRESS_MS)

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp, { once: true })
      window.addEventListener('pointercancel', onCancel, { once: true })
    },
    [onOpen, onToggleComplete, onDragStart],
  )

  return { onPointerDown }
}
