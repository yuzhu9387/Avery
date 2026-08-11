import { useCallback, useState } from 'react'

import { readHiddenTags, writeHiddenTags } from '../lib/tagVisibility'

export function useTagVisibility() {
  const [hidden, setHidden] = useState<Set<number>>(() => readHiddenTags(window.localStorage))

  const toggle = useCallback((id: number) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      writeHiddenTags(window.localStorage, next)
      return next
    })
  }, [])

  return { hidden, toggle }
}
