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

/** A cycle/two-arrows glyph for Routine.
 *
 *  Drawn to the same optical box as its neighbours (x 1.75–14.25), not just the same
 *  16px `viewBox`. It used to occupy x 3–13 while Tasks and Rules ran the full
 *  1.75–14.25, so the three rows shared a bounding box but this glyph read as
 *  indented and a size smaller — which is what looked misaligned in the sidebar. */
export function IconRoutine(props: IconProps) {
  return (
    <svg {...BASE} aria-hidden {...props}>
      <path d="M2.38 4.25A6.25 6.25 0 0 1 14.25 7.75" />
      <path d="M14.25 3.63v4.12h-4.12" />
      <path d="M13.63 11.75A6.25 6.25 0 0 1 1.75 8.25" />
      <path d="M1.75 12.38V8.25h4.12" />
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

/** A person glyph (head + shoulders) for Account — the overlay shell's title row
 *  and anywhere else the account area needs naming. */
export function IconAccount(props: IconProps) {
  return (
    <svg {...BASE} aria-hidden {...props}>
      <circle cx="8" cy="5.25" r="2.75" />
      <path d="M2.75 14.25a5.25 5.25 0 0 1 10.5 0" />
    </svg>
  )
}

/** A "G" monogram for the Google sign-in/connection rows. Drawn as a stroked arc
 *  with the crossbar into the counter — a brand-neutral mark in `currentColor`,
 *  per the repo rule of not importing third-party logo assets. */
export function IconGoogle(props: IconProps) {
  return (
    <svg {...BASE} aria-hidden {...props}>
      <path d="M11.4 4.6A4.8 4.8 0 1 0 12.8 8" />
      <path d="M12.8 8H8.4" />
    </svg>
  )
}

/** A stylized bird-in-a-square for Lark — rounded tile with an upswept wing, in
 *  `currentColor` like every other glyph here. */
export function IconLark(props: IconProps) {
  return (
    <svg {...BASE} aria-hidden {...props}>
      <rect x="1.75" y="1.75" width="12.5" height="12.5" rx="3" />
      <path d="M4.5 10.75c3.6 0 6.2-2.4 6.9-5.9" />
      <path d="M4.5 10.75c1.6 0 3-.4 4.1-1.2" />
    </svg>
  )
}

/** A trash-can glyph for the version delete control (item 2) — a proper icon in
 *  place of a bare "×", so the affordance reads as "delete" without hovering. */
export function IconTrash(props: IconProps) {
  return (
    <svg {...BASE} aria-hidden {...props}>
      <path d="M2.75 4.25h10.5" />
      <path d="M6.25 4.25V3a1 1 0 0 1 1-1h1.5a1 1 0 0 1 1 1v1.25" />
      <path d="M4.25 4.25l0.55 8.25a1 1 0 0 0 1 0.93h4.4a1 1 0 0 0 1-0.93l0.55-8.25" />
      <line x1="6.5" y1="6.75" x2="6.5" y2="10.75" />
      <line x1="9.5" y1="6.75" x2="9.5" y2="10.75" />
    </svg>
  )
}
