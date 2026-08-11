import { useState } from 'react'

import { ApiError } from '../api/client'
import type { Rule, RuleGroup, Tag } from '../api/types'
import {
  computeBands,
  describeConflict,
  findConflicts,
  formatBands,
  useCreateRuleVersion,
} from '../hooks/useRules'
import { useTagMap, useTags } from '../hooks/useTags'
import { Field } from './Field'
import { Modal } from './Modal'
import { TagChip } from './TagChip'

type Owner = { kind: 'group'; key: string; label: string } | { kind: 'excluded' }

/** Which group (or the excluded list) currently claims each tag. Built fresh from the
 *  draft state on every render, so the picker always reflects the in-progress edit, not
 *  the last-saved rule. */
function ownerMap(groups: RuleGroup[], excludeTagIds: number[]): Map<number, Owner> {
  const map = new Map<number, Owner>()
  for (const g of groups) {
    for (const id of g.tag_ids) map.set(id, { kind: 'group', key: g.key, label: g.label })
  }
  for (const id of excludeTagIds) {
    if (!map.has(id)) map.set(id, { kind: 'excluded' })
  }
  return map
}

/**
 * The active-rule editor: group ratios, tag assignment, exclusions, tolerance, and a
 * live band preview. Saving never mutates `rule` — it always posts a brand-new version,
 * closing the one this editor started from. Parents should remount this component
 * (`key={rule.id}`) once that happens, so a freshly created version starts its own,
 * unedited draft rather than inheriting stale local state.
 */
export function RuleEditor({ rule, onSaved }: { rule: Rule; onSaved?: () => void }) {
  const tagsQuery = useTags()
  const tagMap = useTagMap()
  const tags = tagsQuery.data ?? []

  const [groups, setGroups] = useState<RuleGroup[]>(() => rule.groups.map((g) => ({ ...g, tag_ids: [...g.tag_ids] })))
  const [excludeTagIds, setExcludeTagIds] = useState<number[]>([...rule.exclude_tag_ids])
  const [tolerancePct, setTolerancePct] = useState(Math.round(rule.tolerance * 100))

  const [noteModalOpen, setNoteModalOpen] = useState(false)
  const [note, setNote] = useState('')

  const createVersion = useCreateRuleVersion()

  const owners = ownerMap(groups, excludeTagIds)
  const conflicts = findConflicts(groups, excludeTagIds)
  const tagName = (id: number) => tagMap.get(id)?.name ?? `tag ${id}`

  const bands = computeBands(groups, tolerancePct / 100)
  const bandsPreview = formatBands(bands)

  const setRatio = (key: string, ratio: number) => {
    setGroups((prev) => prev.map((g) => (g.key === key ? { ...g, ratio } : g)))
  }

  /** Toggling in a group's own picker only ever adds or removes membership in *that*
   *  group — a tag owned elsewhere renders disabled (see TagPicker) so this is never
   *  called for a tag that would create a two-group or excluded-and-grouped conflict. */
  const toggleGroupTag = (key: string, tagId: number) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.key === key
          ? {
              ...g,
              tag_ids: g.tag_ids.includes(tagId)
                ? g.tag_ids.filter((id) => id !== tagId)
                : [...g.tag_ids, tagId],
            }
          : g,
      ),
    )
  }

  const toggleExcludedTag = (tagId: number) => {
    setExcludeTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    )
  }

  const canSave = conflicts.length === 0

  const openSaveModal = () => {
    createVersion.reset()
    setNote('')
    setNoteModalOpen(true)
  }

  const closeSaveModal = () => {
    setNoteModalOpen(false)
  }

  const confirmSave = () => {
    if (!note.trim()) return
    createVersion.mutate(
      {
        name: rule.name,
        groups,
        tolerance: tolerancePct / 100,
        exclude_tag_ids: excludeTagIds,
        note: note.trim(),
      },
      {
        onSuccess: () => {
          closeSaveModal()
          onSaved?.()
        },
      },
    )
  }

  const saveError =
    createVersion.error instanceof ApiError
      ? createVersion.error.detail
      : createVersion.isError
        ? 'Could not save the new version.'
        : null

  return (
    <div
      className="rounded-[12px] border border-line bg-surface p-4"
      style={{ boxShadow: 'var(--shadow-card)' }}
    >
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg">{rule.name}</h2>
        <span className="text-xs text-ink-faint">Editing creates a new version — it never changes this one.</span>
      </div>

      <div className="flex flex-col gap-4">
        {groups.map((g) => (
          <GroupRow
            key={g.key}
            group={g}
            tags={tags}
            owners={owners}
            onRatioChange={(ratio) => setRatio(g.key, ratio)}
            onToggleTag={(tagId) => toggleGroupTag(g.key, tagId)}
          />
        ))}
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <Field label="Excluded from the ratio">
          <p className="mb-2 -mt-1 text-xs text-ink-faint">
            Time in these tags never enters the ratio at all — not counted, not judged.
          </p>
          <TagPicker
            tags={tags}
            selectedIds={excludeTagIds}
            isTaken={(tag) => {
              const owner = owners.get(tag.id)
              return owner !== undefined && owner.kind === 'group'
            }}
            takenLabel={(tag) => {
              const owner = owners.get(tag.id)
              return owner?.kind === 'group' ? `in group ${owner.key}` : ''
            }}
            onToggle={toggleExcludedTag}
          />
        </Field>

        <Field label={`Tolerance — ${tolerancePct}%`}>
          <input
            type="range"
            min={0}
            max={50}
            step={1}
            value={tolerancePct}
            onChange={(e) => setTolerancePct(Number(e.target.value))}
            className="w-full"
            aria-label="Tolerance percentage"
          />
        </Field>
      </div>

      <div className="mt-4 rounded-[8px] px-3 py-2 text-sm" style={{ background: 'var(--pale)' }}>
        <span className="font-medium text-ink">{bandsPreview}</span>
      </div>

      {!canSave && (
        <ul className="mt-3 flex flex-col gap-1">
          {conflicts.map((c, i) => (
            <li key={i} className="text-xs text-[var(--over)]">
              {describeConflict(c, tagName)}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          disabled={!canSave}
          onClick={openSaveModal}
          title={canSave ? undefined : 'Resolve the tag conflicts above before saving.'}
          className="rounded-[8px] bg-[var(--pale)] px-3 py-1.5 text-sm font-medium text-ink transition-opacity hover:opacity-80 disabled:opacity-40"
        >
          Save as new version
        </button>
      </div>

      <Modal open={noteModalOpen} onClose={closeSaveModal} title="Save as new version">
        <p className="mb-3 text-sm text-ink-muted">Why are you changing this?</p>
        <p className="mb-3 text-xs text-ink-faint">
          Past reports keep the rule they were generated with — this note is the record the
          monthly review reads back to you, so future-you knows why the bands moved.
        </p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          autoFocus
          placeholder="e.g. Loosening fitness tolerance while recovering from an injury."
          className="mb-3 w-full rounded-[8px] border border-line bg-surface px-2 py-1.5 text-sm text-ink"
        />
        {saveError && <p className="mb-3 text-xs text-[var(--over)]">{saveError}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={closeSaveModal}
            className="rounded-[8px] px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-[var(--pale)]/50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!note.trim() || createVersion.isPending}
            onClick={confirmSave}
            className="rounded-[8px] bg-[var(--pale)] px-3 py-1.5 text-sm font-medium text-ink transition-opacity hover:opacity-80 disabled:opacity-40"
          >
            {createVersion.isPending ? 'Saving…' : 'Save version'}
          </button>
        </div>
      </Modal>
    </div>
  )
}

function GroupRow({
  group,
  tags,
  owners,
  onRatioChange,
  onToggleTag,
}: {
  group: RuleGroup
  tags: Tag[]
  owners: Map<number, Owner>
  onRatioChange: (ratio: number) => void
  onToggleTag: (tagId: number) => void
}) {
  return (
    <div className="rounded-[8px] border border-line p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-ink">{group.label}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={`Decrease ${group.label} ratio`}
            disabled={group.ratio <= 1}
            onClick={() => onRatioChange(Math.max(1, group.ratio - 1))}
            className="size-6 rounded-[6px] border border-line text-sm text-ink-muted hover:bg-[var(--pale)]/50 disabled:opacity-30"
          >
            −
          </button>
          <span className="w-6 text-center text-sm tabular-nums text-ink">{group.ratio}</span>
          <button
            type="button"
            aria-label={`Increase ${group.label} ratio`}
            onClick={() => onRatioChange(group.ratio + 1)}
            className="size-6 rounded-[6px] border border-line text-sm text-ink-muted hover:bg-[var(--pale)]/50"
          >
            +
          </button>
        </div>
      </div>
      <TagPicker
        tags={tags}
        selectedIds={group.tag_ids}
        isTaken={(tag) => {
          const owner = owners.get(tag.id)
          return owner !== undefined && !(owner.kind === 'group' && owner.key === group.key)
        }}
        takenLabel={(tag) => {
          const owner = owners.get(tag.id)
          if (!owner) return ''
          return owner.kind === 'excluded' ? 'excluded' : `in group ${owner.key}`
        }}
        onToggle={onToggleTag}
      />
    </div>
  )
}

/**
 * A tag button is either mine (selected here), taken (owned by another group or the
 * excluded list — disabled, so the three backend-rejected conflicts are unreachable by
 * clicking), or free. Moving a tag means clearing it from its current owner first.
 */
function TagPicker({
  tags,
  selectedIds,
  isTaken,
  takenLabel,
  onToggle,
}: {
  tags: Tag[]
  selectedIds: number[]
  isTaken: (tag: Tag) => boolean
  takenLabel: (tag: Tag) => string
  onToggle: (tagId: number) => void
}) {
  if (tags.length === 0) {
    return <span className="text-xs text-ink-faint">No tags yet.</span>
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => {
        const mine = selectedIds.includes(tag.id)
        const taken = !mine && isTaken(tag)
        return (
          <button
            key={tag.id}
            type="button"
            disabled={taken}
            title={taken ? `Already ${takenLabel(tag)} — remove it there first.` : undefined}
            onClick={() => onToggle(tag.id)}
            className="rounded-full transition-opacity disabled:cursor-not-allowed"
            style={{ opacity: mine ? 1 : taken ? 0.3 : 0.45 }}
          >
            <TagChip tag={tag} size="xs" />
          </button>
        )
      })}
    </div>
  )
}
