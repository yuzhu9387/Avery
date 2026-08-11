import { useState } from 'react'

import { addDays, formatDate, mondayOf } from '../lib/datetime'

const DAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** Six rows of seven always, so the rail never changes height as months are paged. */
function gridDays(cursor: Date): Date[] {
  const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const start = mondayOf(firstOfMonth)
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

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

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-bold">
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
