import type { Rule } from './types'
import { apiGet, apiSend } from './client'

export const listRules = () => apiGet<Rule[]>('/rules')

export const getActiveRule = () => apiGet<Rule>('/rules/active')

export const createRuleVersion = (body: Partial<Rule>) => apiSend<Rule>('POST', '/rules', body)

// Cosmetic-only: name and note (the UI's "description"). Ratios/groups are immutable —
// the backend rejects anything else in this body with a 422.
export const updateRule = (id: number, body: { name?: string; note?: string }) =>
  apiSend<Rule>('PATCH', `/rules/${id}`, body)

export const deleteRule = (id: number) => apiSend<void>('DELETE', `/rules/${id}`)
