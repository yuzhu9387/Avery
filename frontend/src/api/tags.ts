import type { Tag } from './types'
import { apiGet, apiSend } from './client'

// `Tag` in api/types.ts hasn't grown a `description` field yet (that file is off
// limits to this task), but the backend's TagCreate/TagUpdate schemas accept it on
// every write and TagOut returns it on every read. Declared here, local to the
// write path, rather than widening `Tag` itself — fold this into `Tag` in a later
// task once types.ts is back in play.
export interface TagWrite {
  name?: string
  color?: string
  description?: string
  icon?: string | null
  sort_order?: number
}

export const listTags = (includeArchived = false) =>
  apiGet<Tag[]>('/tags', { include_archived: includeArchived })

export const createTag = (body: TagWrite) => apiSend<Tag>('POST', '/tags', body)
export const updateTag = (id: number, body: TagWrite) =>
  apiSend<Tag>('PATCH', `/tags/${id}`, body)
// DELETE now really deletes (409s with what's still using the tag); archiving is
// its own route. The old code here called DELETE for archiveTag, which would have
// destroyed a category the user meant to keep, just hidden.
export const deleteTag = (id: number) => apiSend<void>('DELETE', `/tags/${id}`)
export const archiveTag = (id: number) => apiSend<Tag>('POST', `/tags/${id}/archive`)
