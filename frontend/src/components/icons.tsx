import type { SVGProps } from 'react'

/** Shared stroke setup for every line icon below: 16px, `currentColor`, no fill —
 *  minimal glyphs to replace the emoji that used to sit in the sidebar footer and
 *  the overlay shell's title row. Individual `<path>`/`<line>`/`<circle>` elements
 *  inherit `fill="none"` from the `<svg>` itself, so none of them need to repeat it. */
const BASE: SVGProps<SVGSVGElement> = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

type IconProps = SVGProps<SVGSVGElement>

/** A checkbox-list glyph for Tasks. */
export function IconTasks(props: IconProps) {
  return (
    <svg {...BASE} aria-hidden {...props}>
      <rect x="1.75" y="2" width="3" height="3" rx="0.5" />
      <path d="M2.35 3.5l0.55 0.55L4.25 2.8" />
      <line x1="7" y1="3.5" x2="14.25" y2="3.5" />
      <rect x="1.75" y="6.5" width="3" height="3" rx="0.5" />
      <line x1="7" y1="8" x2="14.25" y2="8" />
      <rect x="1.75" y="11" width="3" height="3" rx="0.5" />
      <line x1="7" y1="12.5" x2="14.25" y2="12.5" />
    </svg>
  )
}

/** A cycle/two-arrows glyph for Routine. */
export function IconRoutine(props: IconProps) {
  return (
    <svg {...BASE} aria-hidden {...props}>
      <path d="M3.5 5A5 5 0 0 1 13 7.8" />
      <path d="M13 4.5v3.3h-3.3" />
      <path d="M12.5 11A5 5 0 0 1 3 8.2" />
      <path d="M3 11.5V8.2h3.3" />
    </svg>
  )
}

/** A sliders/scale glyph for Rules. */
export function IconRules(props: IconProps) {
  return (
    <svg {...BASE} aria-hidden {...props}>
      <line x1="3" y1="2" x2="3" y2="14" />
      <circle cx="3" cy="6" r="1.3" />
      <line x1="8" y1="2" x2="8" y2="14" />
      <circle cx="8" cy="10" r="1.3" />
      <line x1="13" y1="2" x2="13" y2="14" />
      <circle cx="13" cy="5" r="1.3" />
    </svg>
  )
}
