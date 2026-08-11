import { useQuery } from '@tanstack/react-query'

import { getWeek } from '../api/calendar'
import { evaluatePeriod } from '../api/analytics'
import { qk } from '../api/keys'
import { addDays, formatDate, formatLocal } from '../lib/datetime'

export function useWeek(monday: Date) {
  const day = formatDate(monday)
  return useQuery({ queryKey: qk.week(day), queryFn: () => getWeek(day) })
}

/** The rule rail: the same evaluation the Review page runs, scoped to this week.
 *
 *  `enabled` should be the owning `useWeek` query's `isSuccess`: `getWeek` can
 *  materialize this week's events on read, and firing this evaluation in parallel
 *  lets it race that materialization — computing (and then caching, for
 *  `staleTime`) a false "0 minutes" snapshot against the still-empty week. Waiting
 *  for `useWeek` to settle first guarantees those events already committed. */
export function useWeekRatios(monday: Date, enabled = true) {
  const { start, end } = weekRange(monday)
  return usePeriodRatios(start, end, enabled)
}

/** The naive-local `[start, end)` bounds of the week beginning `monday`. */
export function weekRange(monday: Date): { start: string; end: string } {
  return {
    start: formatLocal(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate())),
    end: formatLocal(addDays(monday, 7)),
  }
}

/** The naive-local `[start, end)` bounds of the month containing `anyDay`. */
export function monthRange(anyDay: Date): { start: string; end: string } {
  const y = anyDay.getFullYear()
  const m = anyDay.getMonth()
  return { start: formatLocal(new Date(y, m, 1)), end: formatLocal(new Date(y, m + 1, 1)) }
}

/** Rule evaluation over an arbitrary period.
 *
 *  Exists because the Month view was rendering `useWeekRatios` — so the rail headed
 *  its numbers "This week" and meant it, while sitting next to a month grid. The
 *  period now comes from whichever page owns the view. */
export function usePeriodRatios(start: string, end: string, enabled = true) {
  return useQuery({
    queryKey: qk.evaluate(start, end),
    queryFn: () => evaluatePeriod({ period_start: start, period_end: end }),
    retry: false, // a 409 "no active rule" is a state, not a transient failure
    enabled,
  })
}
