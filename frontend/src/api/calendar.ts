import type { MonthPayload, WeekPayload } from './types'
import { apiGet } from './client'

export const getWeek = (day: string) => apiGet<WeekPayload>(`/weeks/${day}`)

export const getMonth = (monthKey: string) => apiGet<MonthPayload>(`/months/${monthKey}`)
