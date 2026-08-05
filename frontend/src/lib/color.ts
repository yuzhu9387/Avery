/** Event blocks are the tag colour at low opacity with a solid bar in the full colour.
 *  Tag colours arrive from the database as `#rrggbb`. */
export function tint(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
