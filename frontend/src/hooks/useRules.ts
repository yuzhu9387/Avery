import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'

import { ApiError } from '../api/client'
import { createRuleVersion, deleteRule, getActiveRule, listRules } from '../api/rules'
import { qk } from '../api/keys'
import type { Rule } from '../api/types'

export function useActiveRule() {
  return useQuery({
    queryKey: qk.activeRule,
    queryFn: getActiveRule,
    // A 404 here means "no active rule configured" — a normal, common, non-transient
    // state, not a flaky request. Retrying it three times over several seconds just
    // delays the empty state for no benefit; only retry errors that might genuinely
    // be transient.
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 3,
  })
}

export function useRules() {
  return useQuery({ queryKey: qk.rules, queryFn: listRules })
}

/** A new version closes the old one and every screen that reads through a rule (the
 *  timeline, the active-rule card, and any week/month evaluation whose bands were
 *  computed against the version that just closed) needs to refetch. Deleting a version
 *  has the same reach — including the active one, since a version with no report
 *  referencing it can be deleted even while open. */
function invalidateRuleEffects(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: qk.rules })
  queryClient.invalidateQueries({ queryKey: qk.activeRule })
  queryClient.invalidateQueries({ queryKey: ['evaluate'] })
}

export function useCreateRuleVersion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<Rule>) => createRuleVersion(body),
    onSuccess: () => invalidateRuleEffects(queryClient),
  })
}

export function useDeleteRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteRule(id),
    onSuccess: () => invalidateRuleEffects(queryClient),
  })
}

export interface Band {
  key: string
  label: string
  target: number
  lo: number
  hi: number
}

/**
 * Mirrors the backend's share math exactly (`share = ratio / sum(ratios)`, band =
 * `share × (1 ∓ tolerance)`) so the preview shown before saving never drifts from what
 * `POST /api/rules` will actually enforce once the version exists. `tolerance` is a
 * fraction (0.2 for 20%), not a percentage.
 */
export function computeBands(
  groups: { key: string; label: string; ratio: number }[],
  tolerance: number,
): Band[] {
  const total = groups.reduce((sum, g) => sum + g.ratio, 0)
  return groups.map((g) => {
    const target = total > 0 ? g.ratio / total : 0
    return {
      key: g.key,
      label: g.label,
      target,
      lo: target * (1 - tolerance),
      hi: target * (1 + tolerance),
    }
  })
}

export function formatBand(band: Band): string {
  return `${band.key}: ${Math.round(band.lo * 100)}–${Math.round(band.hi * 100)}%`
}

export function formatBands(bands: Band[]): string {
  return bands.map(formatBand).join(' · ')
}

export type Conflict =
  | { type: 'duplicate-key'; key: string }
  | { type: 'tag-in-two-groups'; tagId: number; keys: [string, string] }
  | { type: 'tag-excluded-and-grouped'; tagId: number; key: string }

/**
 * Mirrors `RuleCreate.check_tag_mapping` on the backend (the three tag-mapping mistakes
 * it rejects with a 422) so the save button can be disabled client-side before the round
 * trip. The picker built on top of this (see RuleEditor) additionally makes each of these
 * unreachable by construction — this function is the backstop that still runs before
 * every save, in case that construction is ever bypassed.
 */
export function findConflicts(
  groups: { key: string; tag_ids: number[] }[],
  excludeTagIds: number[],
): Conflict[] {
  const conflicts: Conflict[] = []

  const seenKeys = new Set<string>()
  for (const g of groups) {
    if (seenKeys.has(g.key)) conflicts.push({ type: 'duplicate-key', key: g.key })
    seenKeys.add(g.key)
  }

  const seenTags = new Map<number, string>()
  for (const g of groups) {
    for (const tagId of g.tag_ids) {
      const priorKey = seenTags.get(tagId)
      if (priorKey !== undefined && priorKey !== g.key) {
        conflicts.push({ type: 'tag-in-two-groups', tagId, keys: [priorKey, g.key] })
      } else {
        seenTags.set(tagId, g.key)
      }
    }
  }

  const excluded = new Set(excludeTagIds)
  for (const [tagId, key] of seenTags) {
    if (excluded.has(tagId)) conflicts.push({ type: 'tag-excluded-and-grouped', tagId, key })
  }

  return conflicts
}

export function describeConflict(conflict: Conflict, tagName: (id: number) => string): string {
  switch (conflict.type) {
    case 'duplicate-key':
      return `Group key "${conflict.key}" is used twice.`
    case 'tag-in-two-groups':
      return `${tagName(conflict.tagId)} is in both group ${conflict.keys[0]} and ${conflict.keys[1]}.`
    case 'tag-excluded-and-grouped':
      return (
        `${tagName(conflict.tagId)} is both excluded and in group ${conflict.key} — ` +
        `excluded wins, so its time would leave the ratio entirely.`
      )
  }
}
