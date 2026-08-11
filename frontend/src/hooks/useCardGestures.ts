import { useCallback, useEffect, useRef } from 'react'

const LONG_PRESS_MS = 250
// macOS's default double-click threshold is 500ms. A tighter window here was
// clipping genuine double-clicks — a second press 300ms after the first would miss
// it and navigate instead of completing, which reads as the page yanking the user
// away mid-click. 450ms sits just under the platform default so real double-clicks
// land inside it, at the cost of a card opening ~0.45s after a single click.
const DOUBLE_CLICK_MS = 450
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
  // The teardown for whichever press is currently in flight, if any. Timers are
  // owned by this hook and clearTimeout is safe to call from anywhere, but the
  // pointermove/up/cancel listeners a press adds live on `window` and are not tied
  // to this component's lifetime — unmounting mid-press does not remove them on its
  // own. Stashing the active press's own `cleanup` here lets the unmount effect
  // reach in and tear them down too, instead of leaving a phantom `onUp` armed that
  // fires (and can navigate) after the card is gone.
  const activePressCleanup = useRef<(() => void) | null>(null)

  useEffect(
    () => () => {
      window.clearTimeout(longPressTimer.current)
      window.clearTimeout(clickTimer.current)
      activePressCleanup.current?.()
      activePressCleanup.current = null
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
        // This press is over one way or another — it is no longer the one the
        // unmount effect needs to reach.
        if (activePressCleanup.current === cleanup) activePressCleanup.current = null
      }
      // Reachable from unmount for as long as this press is in flight.
      activePressCleanup.current = cleanup

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
