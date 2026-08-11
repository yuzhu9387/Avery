import { describe, expect, it } from 'vitest'

import type { Task } from '../api/types'
import {
  doneTasksSorted,
  formatDueDate,
  groupActiveTasksByDueDate,
  paginate,
  paginateActiveTasksByDueDate,
} from './taskGroups'

/** Every field a `Task` needs, with sane defaults — tests override only what they
 *  care about, so a grouping test that doesn't care about `notes` doesn't have to
 *  spell it out. */
function makeTask(overrides: Partial<Task> & { id: number }): Task {
  return {
    name: `Task ${overrides.id}`,
    tag_ids: [],
    notes: '',
    status: 'todo',
    due_date: null,
    est_minutes: null,
    is_floating: false,
    priority: 'normal',
    created_at: '2026-08-01T00:00:00',
    completed_at: null,
    ...overrides,
  }
}

describe('groupActiveTasksByDueDate', () => {
  it('sorts dated sections ascending', () => {
    const tasks = [
      makeTask({ id: 1, due_date: '2026-08-20' }),
      makeTask({ id: 2, due_date: '2026-08-12' }),
      makeTask({ id: 3, due_date: '2026-08-15' }),
    ]
    const groups = groupActiveTasksByDueDate(tasks, '2026-08-11')
    expect(groups.map((g) => g.dueDate)).toEqual(['2026-08-12', '2026-08-15', '2026-08-20'])
  })

  it('marks a section overdue when its date is before today', () => {
    const tasks = [
      makeTask({ id: 1, due_date: '2026-08-01' }),
      makeTask({ id: 2, due_date: '2026-08-11' }),
      makeTask({ id: 3, due_date: '2026-08-12' }),
    ]
    const groups = groupActiveTasksByDueDate(tasks, '2026-08-11')
    const overdueByDate = Object.fromEntries(groups.map((g) => [g.dueDate, g.overdue]))
    expect(overdueByDate).toEqual({
      '2026-08-01': true,
      '2026-08-11': false, // due today is not yet overdue
      '2026-08-12': false,
    })
  })

  it('puts null-due-date tasks in a final "No due date" bucket, never overdue', () => {
    const tasks = [
      makeTask({ id: 1, due_date: null }),
      makeTask({ id: 2, due_date: '2026-08-01' }),
    ]
    const groups = groupActiveTasksByDueDate(tasks, '2026-08-11')
    expect(groups.at(-1)).toMatchObject({ key: 'no-due-date', dueDate: null, overdue: false })
    expect(groups.at(-1)?.tasks.map((t) => t.id)).toEqual([1])
  })

  it('omits the no-due-date bucket entirely when nothing is undated', () => {
    const tasks = [makeTask({ id: 1, due_date: '2026-08-01' })]
    const groups = groupActiveTasksByDueDate(tasks, '2026-08-11')
    expect(groups.some((g) => g.key === 'no-due-date')).toBe(false)
  })

  it('excludes done and archived tasks', () => {
    const tasks = [
      makeTask({ id: 1, due_date: '2026-08-01', status: 'done', completed_at: '2026-08-02T00:00:00' }),
      makeTask({ id: 2, due_date: '2026-08-01', status: 'archived' }),
      makeTask({ id: 3, due_date: '2026-08-01', status: 'todo' }),
    ]
    const groups = groupActiveTasksByDueDate(tasks, '2026-08-11')
    expect(groups).toHaveLength(1)
    expect(groups[0].tasks.map((t) => t.id)).toEqual([3])
  })

  it('groups same-day tasks together under one section', () => {
    const tasks = [
      makeTask({ id: 1, due_date: '2026-08-12' }),
      makeTask({ id: 2, due_date: '2026-08-12' }),
    ]
    const groups = groupActiveTasksByDueDate(tasks, '2026-08-11')
    expect(groups).toHaveLength(1)
    expect(groups[0].tasks.map((t) => t.id)).toEqual([1, 2])
  })
})

describe('doneTasksSorted', () => {
  it('sorts by completed_at descending', () => {
    const tasks = [
      makeTask({ id: 1, status: 'done', completed_at: '2026-08-01T00:00:00' }),
      makeTask({ id: 2, status: 'done', completed_at: '2026-08-10T00:00:00' }),
      makeTask({ id: 3, status: 'done', completed_at: '2026-08-05T00:00:00' }),
    ]
    expect(doneTasksSorted(tasks).map((t) => t.id)).toEqual([2, 3, 1])
  })

  it('excludes anything not done', () => {
    const tasks = [
      makeTask({ id: 1, status: 'todo' }),
      makeTask({ id: 2, status: 'archived' }),
      makeTask({ id: 3, status: 'done', completed_at: '2026-08-05T00:00:00' }),
    ]
    expect(doneTasksSorted(tasks).map((t) => t.id)).toEqual([3])
  })

  it('caps the result when a limit is given', () => {
    const tasks = Array.from({ length: 25 }, (_, i) =>
      makeTask({ id: i, status: 'done', completed_at: `2026-08-${String(i + 1).padStart(2, '0')}T00:00:00` }),
    )
    expect(doneTasksSorted(tasks, 20)).toHaveLength(20)
    // Latest completions first.
    expect(doneTasksSorted(tasks, 20)[0].id).toBe(24)
  })
})

describe('paginate', () => {
  it('slices stably across consecutive pages with no gaps or overlaps', () => {
    const items = Array.from({ length: 45 }, (_, i) => i)
    const page1 = paginate(items, 1, 20)
    const page2 = paginate(items, 2, 20)
    const page3 = paginate(items, 3, 20)
    expect(page1.items).toEqual(items.slice(0, 20))
    expect(page2.items).toEqual(items.slice(20, 40))
    expect(page3.items).toEqual(items.slice(40, 45))
    expect(page1.pageCount).toBe(3)
    expect([...page1.items, ...page2.items, ...page3.items]).toEqual(items)
  })

  it('clamps a page below 1 up to 1', () => {
    const items = [1, 2, 3]
    expect(paginate(items, 0, 20).page).toBe(1)
    expect(paginate(items, -5, 20).page).toBe(1)
  })

  it('clamps a page past the end down to the last page', () => {
    const items = Array.from({ length: 25 }, (_, i) => i)
    const result = paginate(items, 99, 20)
    expect(result.page).toBe(2)
    expect(result.items).toEqual(items.slice(20, 25))
  })

  it('reports a single page of 1 for an empty list, with no items', () => {
    const result = paginate([], 1, 20)
    expect(result.pageCount).toBe(1)
    expect(result.items).toEqual([])
  })
})

describe('paginateActiveTasksByDueDate', () => {
  it('splits a due-date section across a page boundary without dropping or duplicating tasks', () => {
    // 15 tasks due 08-12, 10 tasks due 08-13 — page size 20 cuts the first section.
    const tasks = [
      ...Array.from({ length: 15 }, (_, i) => makeTask({ id: i, due_date: '2026-08-12' })),
      ...Array.from({ length: 10 }, (_, i) => makeTask({ id: 100 + i, due_date: '2026-08-13' })),
    ]
    const page1 = paginateActiveTasksByDueDate(tasks, '2026-08-11', 1, 20)
    const page2 = paginateActiveTasksByDueDate(tasks, '2026-08-11', 2, 20)

    expect(page1.pageCount).toBe(2)
    expect(page1.totalActive).toBe(25)
    const page1Ids = page1.groups.flatMap((g) => g.tasks.map((t) => t.id))
    const page2Ids = page2.groups.flatMap((g) => g.tasks.map((t) => t.id))
    expect(page1Ids).toHaveLength(20)
    expect(page2Ids).toHaveLength(5)
    // No task appears twice, none missing.
    expect(new Set([...page1Ids, ...page2Ids]).size).toBe(25)

    // Page 1 exhausts the 15 tasks due 08-12 and takes the first 5 of the 10 due
    // 08-13; the 08-13 section then continues as page 2's only section.
    expect(page1.groups.map((g) => g.dueDate)).toEqual(['2026-08-12', '2026-08-13'])
    expect(page1.groups[1].tasks).toHaveLength(5)
    expect(page2.groups.map((g) => g.dueDate)).toEqual(['2026-08-13'])
    expect(page2.groups[0].tasks).toHaveLength(5)
  })

  it('is stable: re-requesting the same page returns the same slice', () => {
    const tasks = Array.from({ length: 30 }, (_, i) => makeTask({ id: i, due_date: '2026-08-12' }))
    const a = paginateActiveTasksByDueDate(tasks, '2026-08-11', 2, 20)
    const b = paginateActiveTasksByDueDate(tasks, '2026-08-11', 2, 20)
    expect(a.groups.flatMap((g) => g.tasks.map((t) => t.id))).toEqual(
      b.groups.flatMap((g) => g.tasks.map((t) => t.id)),
    )
  })

  it('excludes done tasks from pagination entirely', () => {
    const tasks = [
      makeTask({ id: 1, due_date: '2026-08-12', status: 'done', completed_at: '2026-08-11T00:00:00' }),
      makeTask({ id: 2, due_date: '2026-08-12', status: 'todo' }),
    ]
    const result = paginateActiveTasksByDueDate(tasks, '2026-08-11', 1, 20)
    expect(result.totalActive).toBe(1)
    expect(result.groups.flatMap((g) => g.tasks.map((t) => t.id))).toEqual([2])
  })
})

describe('formatDueDate', () => {
  it('formats as "Mon D, Ddd"', () => {
    expect(formatDueDate('2026-08-12')).toBe('Aug 12, Wed')
  })

  it('handles a different month/weekday combination', () => {
    expect(formatDueDate('2026-01-01')).toBe('Jan 1, Thu')
  })
})
