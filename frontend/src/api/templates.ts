import type { PreviewResult, Template, TemplateBlock } from './types'
import { apiGet, apiSend } from './client'

export interface MaterializeResult {
  week_start: string
  created: number
  skipped_days: string[]
}

export const listTemplates = () => apiGet<Template[]>('/templates')

export const getActiveTemplate = () => apiGet<Template>('/templates/active')

export const createTemplate = (body: Partial<Template>) =>
  apiSend<Template>('POST', '/templates', body)

export const updateTemplate = (id: number, body: Partial<Template>) =>
  apiSend<Template>('PATCH', `/templates/${id}`, body)

export const createBlock = (templateId: number, body: Partial<TemplateBlock>) =>
  apiSend<TemplateBlock>('POST', `/templates/${templateId}/blocks`, body)

export const updateBlock = (id: number, body: Partial<TemplateBlock>) =>
  apiSend<TemplateBlock>('PATCH', `/template-blocks/${id}`, body)

export const deleteBlock = (id: number) => apiSend<void>('DELETE', `/template-blocks/${id}`)

export const previewWeek = (day: string) =>
  apiGet<PreviewResult>(`/templates/active/preview/${day}`)

export const materializeWeek = (day: string) =>
  apiSend<MaterializeResult>('POST', `/weeks/${day}/materialize`)
