import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { archiveTask, createTask, getTask, getTaskStats, listTasks, updateTask } from '../api/tasks'
import { qk } from '../api/keys'
import type { Task } from '../api/types'

export function useTasks(params?: Record<string, unknown>) {
  return useQuery({ queryKey: qk.tasks(params), queryFn: () => listTasks(params) })
}

export function useTask(id: number) {
  return useQuery({ queryKey: qk.task(id), queryFn: () => getTask(id) })
}

export function useTaskStats(id: number) {
  return useQuery({ queryKey: qk.taskStats(id), queryFn: () => getTaskStats(id) })
}

export function useCreateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<Task>) => createTask(body),
    // A new task can change what the Scheduled/Floating split looks like.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

export function useUpdateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<Task> }) => updateTask(id, body),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: qk.task(id) })
    },
  })
}

/** Archiving can remove a task from what the routine and rule pickers show —
 *  the week grid names tasks by id and rule evaluation groups by tag through
 *  events, both of which read stale if those caches are not also dropped. */
export function useArchiveTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => archiveTask(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: qk.task(id) })
      queryClient.invalidateQueries({ queryKey: ['week'] })
      queryClient.invalidateQueries({ queryKey: ['evaluate'] })
    },
  })
}
