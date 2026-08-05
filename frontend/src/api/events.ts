import type { AveryEvent } from './types'
import { apiGet, apiSend } from './client'

export const listEvents = (params?: { start?: string; end?: string; task_id?: number }) =>
  apiGet<AveryEvent[]>('/events', params)

export const createEvent = (body: Partial<AveryEvent>) =>
  apiSend<AveryEvent>('POST', '/events', body)

export const updateEvent = (id: number, body: Partial<AveryEvent>) =>
  apiSend<AveryEvent>('PATCH', `/events/${id}`, body)

export const moveEvent = (id: number, start_at: string) =>
  apiSend<AveryEvent>('POST', `/events/${id}/move`, { start_at })

export const deleteEvent = (id: number) => apiSend<void>('DELETE', `/events/${id}`)
