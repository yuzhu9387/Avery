import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'

import {
  createBlock,
  deleteBlock,
  getActiveTemplate,
  previewWeek,
  updateBlock,
  updateTemplate,
} from '../api/templates'
import { qk } from '../api/keys'
import type { Template, TemplateBlock } from '../api/types'

export type ColumnKey = 'weekday' | 'saturday' | 'sunday' | 'custom'

/** Monday-first, matching the `days` domain (1 = Monday .. 7 = Sunday) used
 *  everywhere else in the template model. */
export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * Classifies a block into the column that mirrors the paper template's layout.
 *
 * The weekday check is "covers at least Mon–Fri" rather than "equals Mon–Fri":
 * the seeded template's overnight Rest block runs every day of the week
 * (`days = [1..7]`), and folding that "daily" shape into the Mon–Fri column —
 * the one column it is guaranteed to touch in full — is what keeps Saturday
 * and Sunday showing only their own day-specific blocks. Saturday and Sunday
 * stay exact-match: nothing else in the data model produces a day set that is
 * a superset of one of them without also being a superset of the weekdays,
 * so this ordering never has to arbitrate a real ambiguity. Anything that
 * doesn't fully cover one of the three shapes — a partial week like
 * `[1, 3, 5]`, or a weekend pairing like `[6, 7]` — falls to Custom, where its
 * exact day set is spelled out rather than being silently absorbed into a
 * column that would misrepresent it.
 */
export function classifyDays(days: number[]): ColumnKey {
  const set = new Set(days)
  if ([1, 2, 3, 4, 5].every((d) => set.has(d))) return 'weekday'
  if (days.length === 1 && days[0] === 6) return 'saturday'
  if (days.length === 1 && days[0] === 7) return 'sunday'
  return 'custom'
}

/** "Mon · Wed · Fri" for the Custom column, so an arbitrary day set still reads
 *  at a glance instead of as a bare array of numbers. */
export function formatDaySet(days: number[]): string {
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => DAY_LABELS[d - 1])
    .join(' · ')
}

function daysEqual(a: number[], b: number[]): boolean {
  const sa = [...a].sort((x, y) => x - y)
  const sb = [...b].sort((x, y) => x - y)
  return sa.length === sb.length && sa.every((d, i) => d === sb[i])
}

function idsEqual(a: number[], b: number[]): boolean {
  return daysEqual(a, b)
}

/** Diffs an edited block against its persisted values so an edit sends only
 *  the fields that actually changed — the PATCH endpoint is partial by
 *  design, and sending untouched fields back would just be noise (or, for a
 *  field the user never touched, a false signal that it was deliberately set). */
export function diffBlock(
  original: TemplateBlock,
  next: {
    days: number[]
    start_time: string
    end_time: string
    task_name: string
    tag_ids: number[]
  },
): Partial<TemplateBlock> {
  const patch: Partial<TemplateBlock> = {}
  if (!daysEqual(next.days, original.days)) patch.days = next.days
  if (next.start_time !== original.start_time) patch.start_time = next.start_time
  if (next.end_time !== original.end_time) patch.end_time = next.end_time
  if (next.task_name !== original.task_name) patch.task_name = next.task_name
  if (!idsEqual(next.tag_ids, original.tag_ids)) patch.tag_ids = next.tag_ids
  return patch
}

export function useActiveTemplate() {
  return useQuery({ queryKey: qk.activeTemplate, queryFn: getActiveTemplate })
}

/** A block mutation can change what any future, not-yet-materialized week looks
 *  like, and rule evaluation reads through events — so the week grid and the
 *  ratio rail both need their caches dropped alongside the template itself. */
function invalidateTemplateEffects(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ['template'] })
  queryClient.invalidateQueries({ queryKey: ['week'] })
  queryClient.invalidateQueries({ queryKey: ['evaluate'] })
}

export function useUpdateTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<Template> }) => updateTemplate(id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['template'] }),
  })
}

export function useCreateBlock() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ templateId, body }: { templateId: number; body: Partial<TemplateBlock> }) =>
      createBlock(templateId, body),
    onSuccess: () => invalidateTemplateEffects(queryClient),
  })
}

export function useUpdateBlock() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<TemplateBlock> }) => updateBlock(id, body),
    onSuccess: () => invalidateTemplateEffects(queryClient),
  })
}

export function useDeleteBlock() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteBlock(id),
    onSuccess: () => invalidateTemplateEffects(queryClient),
  })
}

/** Disabled by default — the preview is fetched on demand when the user
 *  clicks "Preview next week", never eagerly, so it stays obviously opt-in. */
export function usePreviewWeek(day: string) {
  return useQuery({
    queryKey: qk.preview(day),
    queryFn: () => previewWeek(day),
    enabled: false,
  })
}
