import { useCallback, useState } from 'react'

import { readHideRoutine, writeHideRoutine } from '../lib/hideRoutine'

/** Whether events generated from the routine template are currently hidden from the
 *  calendar, backed by localStorage so the choice survives a reload. */
export function useHideRoutine() {
  const [hideRoutine, setHideRoutine] = useState(() => readHideRoutine(window.localStorage))

  const toggle = useCallback(() => {
    setHideRoutine((prev) => {
      const next = !prev
      writeHideRoutine(window.localStorage, next)
      return next
    })
  }, [])

  return { hideRoutine, toggle }
}
