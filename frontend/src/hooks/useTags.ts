import { useQuery } from '@tanstack/react-query'

import { listTags } from '../api/tags'
import { qk } from '../api/keys'
import type { Tag } from '../api/types'

export function useTags(includeArchived = false) {
  return useQuery({
    queryKey: [...qk.tags, includeArchived],
    queryFn: () => listTags(includeArchived),
  })
}

/** Archived tags are included: events keep pointing at them, so the grid still
 *  needs their colour and name to render history. */
export function useTagMap() {
  const { data } = useTags(true)
  const map = new Map<number, Tag>()
  for (const tag of data ?? []) map.set(tag.id, tag)
  return map
}
