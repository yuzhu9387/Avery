import type { Reminder } from './types'
import { apiGet, apiSend } from './client'

export const listReminders = (params?: { task_id?: number; pending_only?: boolean }) =>
  apiGet<Reminder[]>('/reminders', params)

export const createReminder = (body: Partial<Reminder>) =>
  apiSend<Reminder>('POST', '/reminders', body)

export const updateReminder = (id: number, body: Partial<Reminder>) =>
  apiSend<Reminder>('PATCH', `/reminders/${id}`, body)

export const deleteReminder = (id: number) => apiSend<void>('DELETE', `/reminders/${id}`)
