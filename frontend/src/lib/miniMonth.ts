import { addDays, mondayOf } from './datetime'

/** Six rows of seven always, so the rail never changes height as months are paged. */
export function gridDays(cursor: Date): Date[] {
  const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const start = mondayOf(firstOfMonth)
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

/**
 * Check if a selected week (starting on Monday) is visible within a 42-day grid.
 * The week is considered visible if its start date falls within the grid range.
 */
export function isWeekVisibleIn(grid: Date[], weekStart: Date): boolean {
  if (grid.length === 0) return false
  const gridStart = grid[0]
  const gridEnd = grid[grid.length - 1]
  return weekStart.getTime() >= gridStart.getTime() && weekStart.getTime() <= gridEnd.getTime()
}
