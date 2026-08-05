import type { Task, TaskStats } from './types'
import { apiGet, apiSend } from './client'

export const listTasks = (params?: Record<string, unknown>) => apiGet<Task[]>('/tasks', params)

export const getTask = (id: number) => apiGet<Task>(`/tasks/${id}`)

export const createTask = (body: Partial<Task>) => apiSend<Task>('POST', '/tasks', body)

export const updateTask = (id: number, body: Partial<Task>) =>
  apiSend<Task>('PATCH', `/tasks/${id}`, body)

export const archiveTask = (id: number) => apiSend<Task>('DELETE', `/tasks/${id}`)

export const getTaskStats = (id: number, today?: string) =>
  apiGet<TaskStats>(`/tasks/${id}/stats`, today ? { today } : undefined)
