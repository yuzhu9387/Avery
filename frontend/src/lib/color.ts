/** Event blocks are the tag colour at low opacity with a solid bar in the full colour.
 *  Tag colours arrive from the database as `#rrggbb`. An untagged event's caller
 *  falls back to a CSS variable reference (`var(--pale)`) instead — parsing that as
 *  hex would yield `rgba(NaN, NaN, NaN, alpha)`, which browsers render as fully
 *  transparent, silently dropping the fallback background. Anything that isn't a
 *  literal `#rrggbb` is returned unchanged instead of being force-fit through the
 *  hex math. */
export function tint(color: string, alpha: number): string {
  if (!color.startsWith('#')) return color
  const clean = color.slice(1)
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
