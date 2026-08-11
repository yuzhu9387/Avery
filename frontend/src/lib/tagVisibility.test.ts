import { describe, expect, it } from 'vitest'

import { isEventVisible, pruneHidden, readHiddenTags, writeHiddenTags } from './tagVisibility'

/** vitest runs in the node environment, so there is no real localStorage. */
function fakeStorage(initial?: string) {
  const box = { value: initial }
  return {
    getItem: () => box.value ?? null,
    setItem: (_key: string, value: string) => {
      box.value = value
    },
    read: () => box.value,
  }
}

describe('readHiddenTags', () => {
  it('is empty when nothing has been stored', () => {
    expect(readHiddenTags(fakeStorage())).toEqual(new Set())
  })

  it('round-trips through writeHiddenTags', () => {
    const storage = fakeStorage()
    writeHiddenTags(storage, new Set([3, 1]))
    expect(readHiddenTags(storage)).toEqual(new Set([1, 3]))
  })

  it('falls back to nothing hidden on unparseable JSON', () => {
    expect(readHiddenTags(fakeStorage('{oops'))).toEqual(new Set())
  })

  it('falls back to nothing hidden when the stored value is not an array', () => {
    expect(readHiddenTags(fakeStorage('{"a":1}'))).toEqual(new Set())
  })

  it('drops non-numeric entries rather than poisoning the set', () => {
    expect(readHiddenTags(fakeStorage('[1,"two",3]'))).toEqual(new Set([1, 3]))
  })
})

describe('isEventVisible', () => {
  it('hides an event whose primary tag is hidden', () => {
    expect(isEventVisible([2, 5], new Set([2]))).toBe(false)
  })

  it('shows an event whose primary tag is visible, even if a secondary is hidden', () => {
    expect(isEventVisible([5, 2], new Set([2]))).toBe(true)
  })

  it('always shows an untagged event', () => {
    // Hiding it would make it unreachable: no checkbox exists that could bring it back.
    expect(isEventVisible([], new Set([1, 2, 3]))).toBe(true)
  })
})

describe('pruneHidden', () => {
  it('keeps a hidden id that is still selectable', () => {
    expect(pruneHidden(new Set([1, 2]), [1, 2, 3])).toEqual(new Set([1, 2]))
  })

  it('drops a hidden id that is no longer selectable', () => {
    // e.g. the tag was archived after being hidden — its row, and checkbox, is gone.
    expect(pruneHidden(new Set([1, 2]), [1])).toEqual(new Set([1]))
  })

  it('treats an empty selectable list as "not yet known" and drops nothing', () => {
    // Otherwise a tag query that hasn't resolved yet would look identical to "zero
    // selectable tags" and wipe a saved selection on every page load.
    expect(pruneHidden(new Set([1, 2]), [])).toEqual(new Set([1, 2]))
  })

  it('does not mutate its inputs', () => {
    const hidden = new Set([1, 2])
    const selectableIds = [1]
    pruneHidden(hidden, selectableIds)
    expect(hidden).toEqual(new Set([1, 2]))
    expect(selectableIds).toEqual([1])
  })
})
