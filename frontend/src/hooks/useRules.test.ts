import { describe, expect, it } from 'vitest'

import { computeBands, describeConflict, findConflicts, formatBand, formatBands } from './useRules'

const SEED_GROUPS = [
  { key: 'A', label: 'Work · Study · Commute', ratio: 6 },
  { key: 'B', label: 'Kids · Chores', ratio: 3 },
  { key: 'C', label: 'Fitness', ratio: 1 },
]

describe('computeBands', () => {
  it('derives the seeded 6:3:1 bands at 20% tolerance', () => {
    const bands = computeBands(SEED_GROUPS, 0.2)
    expect(bands.map((b) => Math.round(b.target * 100))).toEqual([60, 30, 10])
    expect(bands.map((b) => [Math.round(b.lo * 100), Math.round(b.hi * 100)])).toEqual([
      [48, 72],
      [24, 36],
      [8, 12],
    ])
  })

  it('formats a single band and the joined preview line', () => {
    const bands = computeBands(SEED_GROUPS, 0.2)
    expect(formatBand(bands[0])).toBe('A: 48–72%')
    expect(formatBands(bands)).toBe('A: 48–72% · B: 24–36% · C: 8–12%')
  })

  it('treats an all-zero ratio set as zero share rather than dividing by zero', () => {
    const bands = computeBands([{ key: 'A', label: 'A', ratio: 0 }], 0.2)
    expect(bands).toEqual([{ key: 'A', label: 'A', target: 0, lo: 0, hi: 0 }])
  })
})

describe('findConflicts', () => {
  const groups = () => [
    { key: 'A', tag_ids: [1, 2] },
    { key: 'B', tag_ids: [3] },
  ]

  it('finds nothing wrong with a clean split', () => {
    expect(findConflicts(groups(), [4])).toEqual([])
  })

  it('flags a tag placed in two groups', () => {
    const conflicts = findConflicts([{ key: 'A', tag_ids: [1] }, { key: 'B', tag_ids: [1] }], [])
    expect(conflicts).toEqual([{ type: 'tag-in-two-groups', tagId: 1, keys: ['A', 'B'] }])
  })

  it('flags a tag that is both excluded and grouped', () => {
    const conflicts = findConflicts(groups(), [1])
    expect(conflicts).toEqual([{ type: 'tag-excluded-and-grouped', tagId: 1, key: 'A' }])
  })

  it('flags duplicate group keys', () => {
    const conflicts = findConflicts(
      [{ key: 'A', tag_ids: [1] }, { key: 'A', tag_ids: [2] }],
      [],
    )
    expect(conflicts).toEqual([{ type: 'duplicate-key', key: 'A' }])
  })

  it('describes each conflict kind in words a user can act on', () => {
    const tagName = (id: number) => (id === 1 ? 'Rest' : `tag ${id}`)
    expect(describeConflict({ type: 'duplicate-key', key: 'A' }, tagName)).toContain('"A"')
    expect(
      describeConflict({ type: 'tag-in-two-groups', tagId: 1, keys: ['A', 'B'] }, tagName),
    ).toBe('Rest is in both group A and B.')
    expect(
      describeConflict({ type: 'tag-excluded-and-grouped', tagId: 1, key: 'A' }, tagName),
    ).toContain('excluded wins')
  })
})
