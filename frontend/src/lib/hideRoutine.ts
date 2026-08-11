export const HIDE_ROUTINE_KEY = 'avery.hideRoutine'

type Readable = { getItem: (key: string) => string | null }
type Writable = { setItem: (key: string, value: string) => void }

/**
 * Whether events generated from the routine template (`event.source === 'routine'`)
 * are currently hidden from the calendar. Mirrors readHiddenTags/writeHiddenTags in
 * tagVisibility.ts: any read that isn't cleanly "true" falls back to "not hidden" —
 * a corrupt or unexpected value should show too much, never silently blank the
 * calendar.
 */
export function readHideRoutine(storage: Readable): boolean {
  try {
    return storage.getItem(HIDE_ROUTINE_KEY) === 'true'
  } catch {
    return false
  }
}

export function writeHideRoutine(storage: Writable, hideRoutine: boolean): void {
  storage.setItem(HIDE_ROUTINE_KEY, hideRoutine ? 'true' : 'false')
}
