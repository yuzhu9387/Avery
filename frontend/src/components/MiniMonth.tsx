import { useEffect, useState } from 'react'

import { addDays, formatDate } from '../lib/datetime'
import { gridDays, isWeekVisibleIn } from '../lib/miniMonth'

const DAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function MiniMonth({
  selectedWeekStart,
  onPick,
}: {
  selectedWeekStart: Date
  onPick: (day: Date) => void
}) {
  const [cursor, setCursor] = useState(() => new Date(selectedWeekStart))
  const days = gridDays(cursor)
  const todayKey = formatDate(new Date())
  const weekEnd = addDays(selectedWeekStart, 6)

  // Sync cursor only when the selected week is not visible in the current grid.
  // Paging the mini month (‹ › arrows) is deliberate exploration and must not be interrupted.
  // Only re-sync when the main grid navigates (selectedWeekStart changes).
  useEffect(() => {
    setCursor((prev) => (isWeekVisibleIn(gridDays(prev), selectedWeekStart) ? prev : new Date(selectedWeekStart)))
  }, [selectedWeekStart])

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-ink-faint">
          {MONTH_NAMES[cursor.getMonth()]} {cursor.getFullYear()}
        </span>
        <span className="flex gap-1">
          <button
            type="button"
            aria-label="Previous month"
            className="px-1 text-ink-muted"
            onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Next month"
            className="px-1 text-ink-muted"
            onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
          >
            ›
          </button>
        </span>
      </div>

      <div className="grid grid-cols-7 gap-y-0.5 text-center">
        {DAY_INITIALS.map((d, i) => (
          <span key={i} className="text-[9px] text-ink-faint">
            {d}
          </span>
        ))}
        {days.map((day) => {
          const key = formatDate(day)
          const inMonth = day.getMonth() === cursor.getMonth()
          const inSelectedWeek = day >= selectedWeekStart && day <= weekEnd
          const isToday = key === todayKey
          return (
            <button
              key={key}
              type="button"
              className="mx-auto grid size-5 place-items-center rounded-full text-[10px] tabular-nums"
              style={{
                background: isToday
                  ? 'var(--rose-deep)'
                  : inSelectedWeek
                    ? 'var(--pale)'
                    : 'transparent',
                color: isToday
                  ? 'var(--surface-raised)'
                  : inMonth
                    ? 'var(--ink)'
                    : 'var(--ink-faint)',
                fontWeight: isToday || inSelectedWeek ? 700 : 500,
              }}
              onClick={() => onPick(day)}
            >
              {day.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}
