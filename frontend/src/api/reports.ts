import type { Report } from './types'
import { apiGet, apiSend } from './client'

export const listReports = (month?: string) => apiGet<Report[]>('/reports', month ? { month } : undefined)

export const runReport = (month: string) => apiSend<Report>('POST', '/reports/run', { month })

export const deleteReport = (id: number) => apiSend<void>('DELETE', `/reports/${id}`)
