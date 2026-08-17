import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { syncExternalCalendar } from '../api/integrations'
import { invalidateCalendar } from '../api/invalidate'

/**
 * Mirrors the connected external calendar into the events table for a window,
 * then drops every calendar cache so the mirrors appear through the normal
 * /api/events read — week, month, lists and ratios all see them with no second
 * code path.
 *
 * Fire-and-refresh rather than a query: the sync is a write (upsert + prune),
 * and its result is only interesting through the reads it refreshes. A 409
 * ("not connected" / "consent revoked") is an ordinary state and is swallowed —
 * the calendar simply shows nothing external.
 */
export function useExternalSync(provider: 'google' | 'lark', start: string, end: string, enabled: boolean) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    syncExternalCalendar(provider, start, end)
      .then((result) => {
        if (cancelled) return
        // Refresh only when something actually changed server-side; a no-op sync
        // otherwise forces a refetch of every calendar query each week switch.
        if (result.created || result.updated || result.pruned) {
          invalidateCalendar(queryClient)
        }
      })
      .catch(() => {
        // Not connected, revoked, offline — all states the views already render.
      })
    return () => {
      cancelled = true
    }
  }, [provider, start, end, enabled, queryClient])
}
