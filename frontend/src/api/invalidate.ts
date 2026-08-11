import type { QueryClient } from '@tanstack/react-query'

/**
 * Everything a written event can be seen through.
 *
 * Four separate bugs in the previous wave came from invalidating a subset: staleTime
 * is 30s with no refetch on focus, so a wrong answer stays on screen rather than
 * blinking. Any mutation that creates, moves, completes or deletes an event calls
 * this — do not hand-roll a shorter list.
 */
export function invalidateCalendar(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: ['week'] })
  queryClient.invalidateQueries({ queryKey: ['evaluate'] })
  queryClient.invalidateQueries({ queryKey: ['month'] })
  queryClient.invalidateQueries({ queryKey: ['task'] })
  queryClient.invalidateQueries({ queryKey: ['tasks'] })
  queryClient.invalidateQueries({ queryKey: ['events'] })
}
