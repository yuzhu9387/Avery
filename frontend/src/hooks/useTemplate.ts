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

export type ColumnKey = 'everyday' | 'weekday' | 'saturday' | 'sunday' | 'custom'

/** Monday-first, matching the `days` domain (1 = Monday .. 7 = Sunday) used
 *  everywhere else in the template model. */
export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const EVERYDAY = [1, 2, 3, 4, 5, 6, 7]
const WEEKDAY = [1, 2, 3, 4, 5]

function daysEqualUnordered(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].sort((x, y) => x - y)
  const sb = [...b].sort((x, y) => x - y)
  return sa.every((d, i) => d === sb[i])
}

/**
 * Classifies a block into the column that mirrors the paper template's layout.
 *
 * Matches are **exact**, never by superset. The seeded overnight Rest block
 * runs `days = [1..7]` — every night, including Saturday and Sunday. An
 * earlier version of this classifier treated the Mon–Fri check as "covers at
 * least Mon–Fri" so a `[1..7]` block would fold into Mon–Fri; that was wrong:
 * it told the user sleep was scheduled on weekdays only, when it actually
 * runs every night, and the same superset logic would have swallowed a
 * `[1,2,3,4,5,6]` block into Mon–Fri too, silently dropping the fact that it
 * also covers Saturday. A block that touches every day is not a variant of
 * Mon–Fri — it's a distinct, common shape (the nightly routine) that
 * deserves its own column ("Every day") rather than being folded into one
 * column it doesn't fully describe, or dumped into Custom as if it were an
 * arbitrary oddity. Anything that isn't exactly one of the four canonical
 * shapes — a partial week like `[1, 3, 5]`, or a weekend pairing like
 * `[6, 7]` — falls to Custom, where its exact day set is spelled out rather
 * than being silently absorbed into a column that would misrepresent it.
 */
export function classifyDays(days: number[]): ColumnKey {
  if (daysEqualUnordered(days, EVERYDAY)) return 'everyday'
  if (daysEqualUnordered(days, WEEKDAY)) return 'weekday'
  if (daysEqualUnordered(days, [6])) return 'saturday'
  if (daysEqualUnordered(days, [7])) return 'sunday'
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
  if (!daysEqualUnordered(next.days, original.days)) patch.days = next.days
  if (next.start_time !== original.start_time) patch.start_time = next.start_time
  if (next.end_time !== original.end_time) patch.end_time = next.end_time
  if (next.task_name !== original.task_name) patch.task_name = next.task_name
  if (!daysEqualUnordered(next.tag_ids, original.tag_ids)) patch.tag_ids = next.tag_ids
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
