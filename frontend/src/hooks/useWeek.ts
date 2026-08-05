import { useQuery } from '@tanstack/react-query'

import { getWeek } from '../api/calendar'
import { evaluatePeriod } from '../api/analytics'
import { qk } from '../api/keys'
import { addDays, formatDate, formatLocal } from '../lib/datetime'

export function useWeek(monday: Date) {
  const day = formatDate(monday)
  return useQuery({ queryKey: qk.week(day), queryFn: () => getWeek(day) })
}

/** The rule rail: the same evaluation the Review page runs, scoped to this week. */
export function useWeekRatios(monday: Date) {
  const start = formatLocal(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate()))
  const end = formatLocal(addDays(monday, 7))
  return useQuery({
    queryKey: qk.evaluate(start, end),
    queryFn: () => evaluatePeriod({ period_start: start, period_end: end }),
    retry: false, // a 409 "no active rule" is a state, not a transient failure
  })
}
