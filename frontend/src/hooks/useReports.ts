import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { listReports, runReport } from '../api/reports'
import { qk } from '../api/keys'

/** Mirrors `NARRATIVE_PLACEHOLDER` in `app/services/reports.py` exactly. The written
 *  narrative arrives with the agent layer in a later plan; until then every report
 *  carries this literal string and the UI must recognize it rather than print it. */
export const NARRATIVE_PLACEHOLDER = 'Narrative generation arrives with the agent layer.'

export function useReports(month: string) {
  return useQuery({ queryKey: qk.reports(month), queryFn: () => listReports(month) })
}

/** Reports are append-only — running a month again inserts a new row rather than
 *  replacing the last one, so every report list for that month (and the unscoped
 *  'all' list) needs to refetch after a run. */
export function useRunReport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (month: string) => runReport(month),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reports'] }),
  })
}
