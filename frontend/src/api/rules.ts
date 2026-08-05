import type { Rule } from './types'
import { apiGet, apiSend } from './client'

export const listRules = () => apiGet<Rule[]>('/rules')

export const getActiveRule = () => apiGet<Rule>('/rules/active')

export const createRuleVersion = (body: Partial<Rule>) => apiSend<Rule>('POST', '/rules', body)

export const deleteRule = (id: number) => apiSend<void>('DELETE', `/rules/${id}`)
