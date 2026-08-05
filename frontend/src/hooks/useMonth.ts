import { useQuery } from '@tanstack/react-query'

import { getMonth } from '../api/calendar'
import { qk } from '../api/keys'
import { monthKey } from '../lib/datetime'

export function useMonth(viewMonth: Date) {
  const key = monthKey(viewMonth)
  return useQuery({ queryKey: qk.month(key), queryFn: () => getMonth(key) })
}
