import type { NewRoutine, PreviewResult, Routine, RoutineBlock } from './types'
import { apiGet, apiSend } from './client'

export interface MaterializeResult {
  week_start: string
  created: number
  skipped_days: string[]
}

export const listRoutines = () => apiGet<Routine[]>('/routines')

export const getActiveRoutine = () => apiGet<Routine>('/routines/active')

// `NewRoutine` rather than `Partial<Routine>`: `copy_blocks_from_active` is a
// request-only instruction, not a field a routine has.
export const createRoutine = (body: NewRoutine) => apiSend<Routine>('POST', '/routines', body)

export const updateRoutine = (id: number, body: Partial<Routine>) =>
  apiSend<Routine>('PATCH', `/routines/${id}`, body)

export const createBlock = (routineId: number, body: Partial<RoutineBlock>) =>
  apiSend<RoutineBlock>('POST', `/routines/${routineId}/blocks`, body)

export const updateBlock = (id: number, body: Partial<RoutineBlock>) =>
  apiSend<RoutineBlock>('PATCH', `/routine-blocks/${id}`, body)

export const deleteBlock = (id: number) => apiSend<void>('DELETE', `/routine-blocks/${id}`)

export const previewWeek = (day: string) =>
  apiGet<PreviewResult>(`/routines/active/preview/${day}`)

export const materializeWeek = (day: string) =>
  apiSend<MaterializeResult>('POST', `/weeks/${day}/materialize`)
