import { useEffect, useState } from 'react'

import { GRID } from '../lib/geometry'

/** A Safari-only gesture event. Not in lib.dom, so the shape it is used through is
 *  declared here rather than cast to `any` at each site. */
interface GestureLikeEvent extends Event {
  scale: number
  clientX: number
  clientY: number
}

/**
 * Trackpad zoom over the week grid.
 *
 * macOS delivers a two-finger pinch to the browser as a `wheel` event with `ctrlKey`
 * set — there is no separate pinch event in Chrome. Without `preventDefault` the
 * browser applies its own page zoom instead, which would scale the whole app and
 * break every pointer-to-minute calculation on the grid. Safari additionally sends
 * `gesture*` events, handled here for the same reason.
 *
 * Zoom is deliberately not persisted: it is a reading posture, not a preference.
 */
export function useGridZoom(ref: React.RefObject<HTMLDivElement | null>) {
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    /** Scale by `factor`, keeping the grid point under the cursor under the cursor. */
    const applyAt = (factor: number, clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect()
      const offsetX = clientX - rect.left
      const offsetY = clientY - rect.top
      const gridX = el.scrollLeft + offsetX
      const gridY = el.scrollTop + offsetY

      setZoom((prev) => {
        const next = Math.min(GRID.maxZoom, Math.max(GRID.minZoom, prev * factor))
        if (next === prev) return prev
        const ratio = next / prev
        // The new layout does not exist until React repaints, so the scroll
        // correction has to wait a frame or it lands against the old height.
        requestAnimationFrame(() => {
          el.scrollLeft = gridX * ratio - offsetX
          el.scrollTop = gridY * ratio - offsetY
        })
        return next
      })
    }

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      // Exponential so a pinch feels linear; /180 is the damping that makes a full
      // trackpad pinch cover roughly one doubling.
      applyAt(Math.exp(-e.deltaY / 180), e.clientX, e.clientY)
    }

    let lastScale = 1
    const onGestureStart = (e: Event) => {
      e.preventDefault()
      lastScale = 1
    }
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      const g = e as GestureLikeEvent
      applyAt(g.scale / lastScale, g.clientX, g.clientY)
      lastScale = g.scale
    }

    // Non-passive: a passive listener cannot preventDefault, and the browser would
    // page-zoom over the top of us.
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('gesturestart', onGestureStart)
    el.addEventListener('gesturechange', onGestureChange)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('gesturestart', onGestureStart)
      el.removeEventListener('gesturechange', onGestureChange)
    }
  }, [ref])

  return {
    zoom,
    pxPerHour: GRID.basePxPerHour * zoom,
    columnPx: GRID.baseColumnPx * zoom,
  }
}
