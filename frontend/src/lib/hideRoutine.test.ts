import { describe, expect, it } from 'vitest'

import { readHideRoutine, writeHideRoutine } from './hideRoutine'

/** vitest runs in the node environment, so there is no real localStorage. */
function fakeStorage(initial?: string) {
  const box = { value: initial }
  return {
    getItem: () => box.value ?? null,
    setItem: (_key: string, value: string) => {
      box.value = value
    },
  }
}

describe('readHideRoutine', () => {
  it('is false when nothing has been stored', () => {
    expect(readHideRoutine(fakeStorage())).toBe(false)
  })

  it('round-trips through writeHideRoutine', () => {
    const storage = fakeStorage()
    writeHideRoutine(storage, true)
    expect(readHideRoutine(storage)).toBe(true)
    writeHideRoutine(storage, false)
    expect(readHideRoutine(storage)).toBe(false)
  })

  it('falls back to false on an unexpected stored value', () => {
    expect(readHideRoutine(fakeStorage('oops'))).toBe(false)
  })

  it('falls back to false when the storage read throws', () => {
    const storage = {
      getItem: () => {
        throw new Error('boom')
      },
    }
    expect(readHideRoutine(storage)).toBe(false)
  })
})
