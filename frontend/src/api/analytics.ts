import type { Evaluation } from './types'
import { apiSend } from './client'

export const evaluatePeriod = (body: { period_start: string; period_end: string; rule_id?: number }) =>
  apiSend<Evaluation>('POST', '/analytics/evaluate', body)
