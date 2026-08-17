/**
 * The avatar's deterministic identity color: picked from the theme palette by
 * `user.id % n`, so the same account always renders the same circle — across the
 * sidebar, the account page, and reloads — without storing a color anywhere.
 *
 * CSS variable *names*, not resolved colors: the repo's rule is that `theme.css` is
 * the only place a color is defined, so this module hands back `var(--sage)` and
 * lets the stylesheet own what sage actually is.
 */
export const AVATAR_COLOR_VARS = [
  '--blush',
  '--sage',
  '--clay',
  '--rose',
  '--teal',
  '--pale',
] as const

export function avatarColor(userId: number): string {
  // `Math.abs` is a guard, not an expectation — ids are positive, but a negative
  // modulo in JS is negative and would index nothing.
  const index = Math.abs(userId) % AVATAR_COLOR_VARS.length
  return `var(${AVATAR_COLOR_VARS[index]})`
}

/** The letter in the circle: first character of the name, falling back to the email
 *  for accounts with a blank name, and '?' only if both are somehow empty. */
export function avatarInitial(name: string, email: string): string {
  const source = name.trim() || email.trim()
  return source ? source.charAt(0).toUpperCase() : '?'
}
