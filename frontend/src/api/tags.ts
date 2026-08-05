import type { Tag } from './types'
import { apiGet, apiSend } from './client'

export const listTags = (includeArchived = false) =>
  apiGet<Tag[]>('/tags', { include_archived: includeArchived })

export const createTag = (body: Partial<Tag>) => apiSend<Tag>('POST', '/tags', body)
export const updateTag = (id: number, body: Partial<Tag>) =>
  apiSend<Tag>('PATCH', `/tags/${id}`, body)
export const archiveTag = (id: number) => apiSend<Tag>('DELETE', `/tags/${id}`)
