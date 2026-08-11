import { useMutation, useQueryClient } from '@tanstack/react-query'

import { completeEvent, createEvent, rollOverEvents, uncompleteEvent } from '../api/events'
import { invalidateCalendar } from '../api/invalidate'
import type { AveryEvent, EventKind } from '../api/types'

export interface NewEvent {
  task_name: string
  kind: EventKind
  start_at: string
  end_at: string
  tag_ids: number[]
}

/** Every write the week view can make. Each settles by invalidating the whole
 *  calendar; none of them swallows its error — the callers surface `isError`. */
export function useEventMutations() {
  const queryClient = useQueryClient()
  const settle = () => invalidateCalendar(queryClient)

  const create = useMutation({
    mutationFn: (body: NewEvent) => createEvent(body as Partial<AveryEvent>),
    onSettled: settle,
  })

  const complete = useMutation({
    mutationFn: (id: number) => completeEvent(id),
    onSettled: settle,
  })

  const uncomplete = useMutation({
    mutationFn: (id: number) => uncompleteEvent(id),
    onSettled: settle,
  })

  const rollOver = useMutation({
    mutationFn: ({ ids, toDate }: { ids: number[]; toDate: string }) =>
      rollOverEvents(ids, toDate),
    onSettled: settle,
  })

  return { create, complete, uncomplete, rollOver }
}
