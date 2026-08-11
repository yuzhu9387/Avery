import { useEffect, useRef } from 'react'

const PARTICLE_COUNT = 24
const DURATION_MS = 900
/** px per ms², tuned so particles arc rather than fly straight out. */
const GRAVITY = 0.0016

/** Read from the theme rather than duplicated as hex, so the burst follows the
 *  palette by construction instead of drifting out of sync with it. */
const THEME_VARS = ['--rose', '--rose-deep', '--blush', '--sage', '--clay', '--teal']

export interface Burst {
  /** Changing id is what re-triggers the effect; two bursts at the same point still fire. */
  id: number
  x: number
  y: number
}

export function Confetti({ burst, onDone }: { burst: Burst | null; onDone: () => void }) {
  const layer = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!burst) return
    const root = layer.current
    if (!root) return

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onDone()
      return
    }

    const particles = Array.from({ length: PARTICLE_COUNT }, (_, i) => {
      const el = document.createElement('div')
      const angle = (Math.PI * 2 * i) / PARTICLE_COUNT + Math.random() * 0.3
      const speed = 0.18 + Math.random() * 0.22
      el.style.cssText = [
        'position:absolute',
        'width:6px',
        'height:6px',
        'border-radius:2px',
        'pointer-events:none',
        'will-change:transform,opacity',
        `background:var(${THEME_VARS[i % THEME_VARS.length]})`,
        `left:${burst.x}px`,
        `top:${burst.y}px`,
      ].join(';')
      root.appendChild(el)
      return {
        el,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.15,
        spin: (Math.random() - 0.5) * 720,
      }
    })

    // The particles are moved by writing style directly rather than through state:
    // 24 elements re-rendered at 60fps would drag the whole grid through React.
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = now - start
      if (t >= DURATION_MS) {
        for (const p of particles) p.el.remove()
        onDone()
        return
      }
      const fade = 1 - t / DURATION_MS
      for (const p of particles) {
        const x = p.vx * t
        const y = p.vy * t + 0.5 * GRAVITY * t * t
        p.el.style.transform = `translate(${x}px, ${y}px) rotate(${(p.spin * t) / DURATION_MS}deg)`
        p.el.style.opacity = String(fade)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      for (const p of particles) p.el.remove()
    }
  }, [burst, onDone])

  return <div ref={layer} className="pointer-events-none fixed inset-0 z-[60]" />
}
