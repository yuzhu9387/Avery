import { describe, expect, it } from 'vitest'

import { ApiError, errorMessage } from './client'

describe('errorMessage', () => {
  it('is null when there is nothing to show', () => {
    expect(errorMessage(null)).toBeNull()
    expect(errorMessage(undefined)).toBeNull()
  })

  it("prefers an ApiError's detail — the backend's own message", () => {
    expect(errorMessage(new ApiError(422, 'task_name is required'))).toBe('task_name is required')
  })

  it('falls back to a plain Error message, e.g. a rejected fetch when offline', () => {
    expect(errorMessage(new TypeError('Failed to fetch'))).toBe('Failed to fetch')
  })

  it('never returns null for a real, non-Error failure', () => {
    expect(errorMessage('network down')).not.toBeNull()
    expect(typeof errorMessage('network down')).toBe('string')
  })

  // The general invariant: for any non-null input, errorMessage must hand the
  // caller something to render — never '' and never null. `{error && (...)}`
  // in JSX treats an empty string exactly like null, so a falsy-but-defined
  // message is the same silent-failure bug as returning null outright.
  it.each([
    ['an ApiError with a detail', new ApiError(422, 'task_name is required')],
    // unwrap() falls back to res.statusText when a failed response's body
    // isn't {detail: string}-shaped, and every HTTP/2 response has
    // statusText === '' (HTTP/2 dropped the reason phrase from the
    // protocol) — so an ApiError with an empty detail is a real case, not a
    // hypothetical one.
    ['an ApiError with an empty detail (HTTP/2 statusText)', new ApiError(500, '')],
    ['a plain Error with a message', new TypeError('Failed to fetch')],
    ['a plain Error with an empty message', new Error('')],
    ['a non-Error throw', 'network down'],
  ])('returns a non-empty string for %s', (_label, error) => {
    const message = errorMessage(error)
    expect(message).not.toBeNull()
    expect(message).not.toBe('')
  })
})
