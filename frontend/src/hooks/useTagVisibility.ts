import { useCallback, useEffect, useState } from 'react'

import { pruneHidden, readHiddenTags, writeHiddenTags } from '../lib/tagVisibility'

/**
 * `selectableIds` is the set of tag ids the rail currently offers a checkbox for.
 *
 * Pass `undefined` while that list is still unknown — e.g. the tags query hasn't
 * settled yet — and the real (possibly empty) array once it has. This must be driven
 * by the query's own success/settled signal, not by "the array is non-empty": a user
 * can legitimately have zero non-archived tags, and that state must not be confused
 * with "not loaded yet," or a saved selection would be pruned away on every load.
 *
 * Once `selectableIds` is known, any hidden id no longer in it (e.g. its tag was
 * archived after being hidden) is dropped and the pruned set is persisted, so a
 * stale id never lingers hidden forever with no checkbox able to bring it back.
 */
export function useTagVisibility(selectableIds: number[] | undefined) {
  const [hidden, setHidden] = useState<Set<number>>(() => readHiddenTags(window.localStorage))

  useEffect(() => {
    if (selectableIds === undefined) return
    const next = pruneHidden(hidden, selectableIds)
    if (next.size === hidden.size) return
    writeHiddenTags(window.localStorage, next)
    setHidden(next)
    // `hidden` is intentionally excluded: this effect reacts to the selectable list
    // changing (e.g. tags query settling, or a tag getting archived), not to every
    // toggle. Toggle's own setter already keeps `hidden` and storage in sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectableIds])

  const toggle = useCallback(
    (id: number) => {
      const next = new Set(hidden)
      if (!next.delete(id)) next.add(id)
      writeHiddenTags(window.localStorage, next)
      setHidden(next)
    },
    [hidden],
  )

  // Both of these are one-line, branch-free constructions of a Set — the same shape
  // toggle's own body already has above, and unlike pruneHidden there is no "empty
  // means not yet known" subtlety worth pulling into lib/tagVisibility.ts for its own
  // tests. hideAll's ids come from `selectableIds`, the same set pruneHidden takes;
  // if that list hasn't loaded yet there is nothing real to hide, so it no-ops rather
  // than guessing.
  const hideAll = useCallback(() => {
    if (selectableIds === undefined) return
    const next = new Set(selectableIds)
    writeHiddenTags(window.localStorage, next)
    setHidden(next)
  }, [selectableIds])

  const showAll = useCallback(() => {
    const next = new Set<number>()
    writeHiddenTags(window.localStorage, next)
    setHidden(next)
  }, [])

  return { hidden, toggle, hideAll, showAll }
}
