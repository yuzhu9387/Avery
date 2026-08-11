export const HIDDEN_TAGS_KEY = 'avery.hiddenTags'

type Readable = { getItem: (key: string) => string | null }
type Writable = { setItem: (key: string, value: string) => void }

/**
 * Which categories the week grid is currently not drawing.
 *
 * HIDDEN ids are stored, never visible ones. A tag created after the list was saved
 * is then visible by default, instead of being born invisible because it happened not
 * to be in a list written before it existed.
 *
 * Every failure mode returns "nothing hidden": a corrupt value should show too much,
 * never silently blank the calendar.
 */
export function readHiddenTags(storage: Readable): Set<number> {
  try {
    const raw = storage.getItem(HIDDEN_TAGS_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((v): v is number => typeof v === 'number'))
  } catch {
    return new Set()
  }
}

export function writeHiddenTags(storage: Writable, hidden: Set<number>): void {
  storage.setItem(HIDDEN_TAGS_KEY, JSON.stringify([...hidden].sort((a, b) => a - b)))
}

/** Keyed on the PRIMARY tag — the same field the card takes its colour from, so what
 *  you switch off is exactly what you saw that colour on. An untagged event is always
 *  visible; no checkbox could bring it back. */
export function isEventVisible(tagIds: number[], hidden: Set<number>): boolean {
  if (tagIds.length === 0) return true
  return !hidden.has(tagIds[0])
}
