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
})
