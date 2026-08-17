import { describe, expect, it } from 'vitest'

import { AVATAR_COLOR_VARS, avatarColor, avatarInitial } from './avatar'

describe('avatarColor', () => {
  it('is deterministic — same id, same color, every call', () => {
    for (const id of [0, 1, 7, 42, 9999]) {
      expect(avatarColor(id)).toBe(avatarColor(id))
    }
  })

  it('picks by id % n, walking the palette in order', () => {
    const n = AVATAR_COLOR_VARS.length
    for (let id = 0; id < n * 2; id++) {
      expect(avatarColor(id)).toBe(`var(${AVATAR_COLOR_VARS[id % n]})`)
    }
  })

  it('always returns a var() over a theme variable, never a literal color', () => {
    for (let id = 0; id < 20; id++) {
      expect(avatarColor(id)).toMatch(/^var\(--[a-z-]+\)$/)
    }
  })

  it('survives a negative id rather than indexing off the palette', () => {
    expect(AVATAR_COLOR_VARS).toContain(avatarColor(-3).slice(4, -1))
  })
})

describe('avatarInitial', () => {
  it('takes the first letter of the name, uppercased', () => {
    expect(avatarInitial('leona', 'x@y.z')).toBe('L')
  })

  it('falls back to the email when the name is blank', () => {
    expect(avatarInitial('  ', 'guo@example.com')).toBe('G')
  })

  it('keeps a CJK first character as-is', () => {
    expect(avatarInitial('小雨', 'x@y.z')).toBe('小')
  })

  it('returns ? when both are empty', () => {
    expect(avatarInitial('', '')).toBe('?')
  })
})
