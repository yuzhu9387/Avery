import { useEffect, useMemo, useState } from 'react'

import { ApiError } from '../api/client'
import type { Routine, RoutineBlock, Tag } from '../api/types'
import { BlockForm } from '../components/BlockForm'
import { Modal } from '../components/Modal'
import type { ColumnKey } from '../hooks/useRoutine'
import {
  classifyDays,
  formatDaySet,
  useCreateBlock,
  useCreateRoutine,
  useDeleteBlock,
  useRoutines,
  useUpdateBlock,
  useUpdateRoutine,
} from '../hooks/useRoutine'
import { useTagMap } from '../hooks/useTags'
import { formatMinutes, parseLocal } from '../lib/datetime'

/**
 * The five day-groups, laid out as rows rather than columns.
 *
 * This page renders inside `CalendarOverlayShell`, whose window is `max-w-3xl`
 * (768px), leaving roughly 670px of content however wide the screen is. Five
 * columns in 670px is ~130px each, which is not enough for a time range, a task
 * name and a delete control — that is what was pushing text out of the columns.
 *
 * Worth knowing before "fixing" this with breakpoints: Tailwind's `lg:`/`xl:`
 * prefixes match the *viewport*, not this container. On a 1280px screen `xl:` fires
 * while the window is still 768px, so a five-column grid got narrower exactly when
 * it looked like it should get wider.
 */
const GROUP_DEFS: { key: ColumnKey; title: string; presetDays: number[] }[] = [
  { key: 'everyday', title: 'Every day', presetDays: [1, 2, 3, 4, 5, 6, 7] },
  { key: 'weekday', title: 'Mon–Fri', presetDays: [1, 2, 3, 4, 5] },
  { key: 'saturday', title: 'Saturday', presetDays: [6] },
  { key: 'sunday', title: 'Sunday', presetDays: [7] },
  // No preset: a custom block is by definition an arbitrary day set, so its "+"
  // opens the form with nothing chosen. `BlockForm` already prompts for a day and
  // keeps submit disabled until one is picked, so this is a real starting point.
  { key: 'custom', title: 'Custom', presetDays: [] },
]

/** `end_time <= start_time` is how an overnight block (e.g. 23:00–07:00 rest)
 *  is stored, not a validation error — so its duration wraps past midnight
 *  rather than coming out negative. */
function blockMinutes(block: RoutineBlock): number {
  const [sh, sm] = block.start_time.split(':').map(Number)
  const [eh, em] = block.end_time.split(':').map(Number)
  const start = sh * 60 + sm
  let end = eh * 60 + em
  if (end <= start) end += 24 * 60
  return end - start
}

function formatUpdated(stamp: string): string {
  const d = parseLocal(stamp)
  const day = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  return `${day} ${hh}:${mm}`
}

type ModalState =
  | { mode: 'create'; initialDays: number[] }
  | { mode: 'edit'; block: RoutineBlock }
  | { mode: 'newRoutine' }

export default function RoutinePage() {
  // One query for everything on this page. `RoutineOut` embeds each version's
  // blocks, so the screen can show any version without a second request — and
  // "which version is active" has exactly one source rather than two that can
  // disagree while a mutation is in flight.
  const versionsQuery = useRoutines()
  const tagMap = useTagMap()

  const updateRoutine = useUpdateRoutine()
  const createRoutine = useCreateRoutine()
  const createBlock = useCreateBlock()
  const updateBlock = useUpdateBlock()
  const deleteBlock = useDeleteBlock()

  const [modal, setModal] = useState<ModalState | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const versions = versionsQuery.data ?? []
  const active = versions.find((v) => v.is_active) ?? null
  const selected = versions.find((v) => v.id === selectedId) ?? active

  // Follow the active version until the user tunes to one of their own, and recover
  // if the selected version disappears. Without the membership check a stale
  // `selectedId` would quietly fall back to the active version while the list still
  // highlighted a row that no longer exists.
  useEffect(() => {
    if (selectedId !== null && !versions.some((v) => v.id === selectedId)) setSelectedId(null)
  }, [selectedId, versions])

  const grouped = useMemo(() => {
    const map: Record<ColumnKey, RoutineBlock[]> = {
      everyday: [],
      weekday: [],
      saturday: [],
      sunday: [],
      custom: [],
    }
    for (const block of selected?.blocks ?? []) {
      map[classifyDays(block.days)].push(block)
    }
    for (const key of Object.keys(map) as ColumnKey[]) {
      map[key] = [...map[key]].sort((a, b) => a.start_time.localeCompare(b.start_time))
    }
    return map
  }, [selected])

  const closeModal = () => {
    setModal(null)
    createBlock.reset()
    updateBlock.reset()
    createRoutine.reset()
  }

  const handleSubmit = (body: Partial<RoutineBlock>) => {
    if (!modal || !selected) return
    if (modal.mode === 'create') {
      // Blocks land on whichever version is on screen, not on the active one: the
      // "+" the user clicked belongs to the version they are looking at.
      createBlock.mutate({ routineId: selected.id, body }, { onSuccess: closeModal })
    } else if (modal.mode === 'edit') {
      updateBlock.mutate({ id: modal.block.id, body }, { onSuccess: closeModal })
    }
  }

  const formError = (mutation: typeof createBlock | typeof updateBlock) =>
    mutation.error instanceof ApiError ? mutation.error.detail : null

  if (versionsQuery.isLoading) {
    return <p className="p-5 text-sm text-ink-faint">Loading routine…</p>
  }
  if (versionsQuery.isError) {
    return <p className="p-5 text-sm text-ink-faint">Couldn't load the routine.</p>
  }

  if (versions.length === 0) {
    return (
      <div className="p-5">
        <div className="rounded-[12px] border border-line bg-surface p-5">
          <p className="mb-3 text-sm text-ink-muted">
            No routine yet. Create one to start generating weeks automatically.
          </p>
          <button
            type="button"
            onClick={() => setModal({ mode: 'newRoutine' })}
            className="rounded-[8px] bg-[var(--pale)] px-3 py-1.5 text-sm font-medium text-ink transition-opacity hover:opacity-80"
          >
            New routine
          </button>
        </div>
        <Modal open={modal !== null} onClose={closeModal} title="New routine">
          {modal?.mode === 'newRoutine' && (
            <NewRoutineForm
              submitting={createRoutine.isPending}
              error={createRoutine.error instanceof ApiError ? createRoutine.error.detail : null}
              canCopy={false}
              onCancel={closeModal}
              onSubmit={(body) => createRoutine.mutate(body, { onSuccess: closeModal })}
            />
          )}
        </Modal>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-5">
      <Screen
        version={selected}
        grouped={grouped}
        tagMap={tagMap}
        noneActive={!active}
        activating={updateRoutine.isPending}
        onActivate={() =>
          selected && updateRoutine.mutate({ id: selected.id, body: { is_active: true } })
        }
        onAdd={(presetDays) => setModal({ mode: 'create', initialDays: presetDays })}
        onEdit={(block) => setModal({ mode: 'edit', block })}
        onDelete={(block) => deleteBlock.mutate(block.id)}
      />

      <section className="mt-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">Versions</h2>
          <button
            type="button"
            onClick={() => setModal({ mode: 'newRoutine' })}
            className="shrink-0 rounded-[8px] bg-[var(--pale)] px-3 py-1.5 text-xs font-medium text-ink transition-opacity hover:opacity-80"
          >
            New routine
          </button>
        </div>

        {updateRoutine.isError && (
          <p className="mb-2 text-xs text-[var(--over)]">Couldn't save that change.</p>
        )}

        <ul className="overflow-hidden rounded-[12px] border border-line bg-surface">
          {versions.map((version) => (
            <VersionRow
              key={version.id}
              version={version}
              isShowing={selected?.id === version.id}
              onSelect={() => setSelectedId(version.id)}
              onRename={(name) => updateRoutine.mutate({ id: version.id, body: { name } })}
              onNote={(note) => updateRoutine.mutate({ id: version.id, body: { note } })}
              onActivate={() => updateRoutine.mutate({ id: version.id, body: { is_active: true } })}
            />
          ))}
        </ul>
      </section>

      <Modal
        open={modal !== null}
        onClose={closeModal}
        title={
          modal?.mode === 'edit'
            ? 'Edit block'
            : modal?.mode === 'newRoutine'
              ? 'New routine'
              : 'New block'
        }
      >
        {modal?.mode === 'newRoutine' && (
          <NewRoutineForm
            submitting={createRoutine.isPending}
            error={createRoutine.error instanceof ApiError ? createRoutine.error.detail : null}
            canCopy={!!selected && selected.blocks.length > 0}
            onCancel={closeModal}
            onSubmit={(body) => createRoutine.mutate(body, { onSuccess: closeModal })}
          />
        )}
        {(modal?.mode === 'create' || modal?.mode === 'edit') && (
          <BlockForm
            block={modal.mode === 'edit' ? modal.block : undefined}
            initialDays={modal.mode === 'create' ? modal.initialDays : undefined}
            submitting={createBlock.isPending || updateBlock.isPending}
            error={modal.mode === 'edit' ? formError(updateBlock) : formError(createBlock)}
            onCancel={closeModal}
            onSubmit={handleSubmit}
          />
        )}
      </Modal>
    </div>
  )
}

/**
 * The set on which one version of the routine is playing.
 *
 * A bezel around a recessed screen, the version's name on the front panel, and a
 * lamp lit only while what you are watching is also what generates your weeks.
 *
 * The frame earns its pixels rather than decorating: this page now has two
 * independent states — which version is *on screen* and which version is *active* —
 * and showing an old version in the same flat panel that used to mean "this is your
 * routine" is exactly how someone edits history believing they are editing today.
 */
function Screen({
  version,
  grouped,
  tagMap,
  noneActive,
  activating,
  onActivate,
  onAdd,
  onEdit,
  onDelete,
}: {
  version: Routine | null
  grouped: Record<ColumnKey, RoutineBlock[]>
  tagMap: Map<number, Tag>
  noneActive: boolean
  activating: boolean
  onActivate: () => void
  onAdd: (presetDays: number[]) => void
  onEdit: (block: RoutineBlock) => void
  onDelete: (block: RoutineBlock) => void
}) {
  const live = !!version?.is_active
  const all = Object.values(grouped).flat()
  const total = all.reduce((sum, b) => sum + blockMinutes(b), 0)

  return (
    <div
      className="rounded-[16px] border border-line p-2 sm:p-2.5"
      style={{ background: 'var(--pale)', boxShadow: 'var(--shadow-card)' }}
    >
      {/* Front panel */}
      <div className="mb-2 flex items-center gap-2 px-1.5 pt-0.5">
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full"
          style={{
            background: live ? 'var(--sage)' : 'var(--line-strong)',
            boxShadow: live ? '0 0 6px var(--sage)' : undefined,
          }}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[15px] leading-tight text-ink">
            {version?.name ?? 'No version selected'}
          </div>
          <div className="truncate text-[11px] text-ink-faint">
            Routine week · {formatMinutes(total)} · {all.length} block{all.length === 1 ? '' : 's'}
            {version?.note ? ` · ${version.note}` : ''}
          </div>
        </div>

        {live ? (
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink"
            style={{ background: 'var(--surface-raised)' }}
          >
            On air
          </span>
        ) : (
          <button
            type="button"
            disabled={activating || !version}
            onClick={onActivate}
            className="shrink-0 rounded-full bg-[var(--surface)] px-2.5 py-1 text-[11px] font-medium text-ink transition-opacity hover:opacity-80 disabled:opacity-50"
          >
            {activating ? 'Switching…' : 'Set active'}
          </button>
        )}
      </div>

      {/* Screen */}
      <div className="rounded-[11px] border border-line bg-surface p-2 sm:p-2.5">
        {noneActive && (
          <p
            className="mb-2 rounded-[8px] px-2.5 py-1.5 text-[11px] text-ink-muted"
            style={{ background: 'var(--pale)' }}
          >
            No version is active, so new weeks would generate nothing. Set one active.
          </p>
        )}
        {!live && !noneActive && (
          <p
            className="mb-2 rounded-[8px] px-2.5 py-1.5 text-[11px] text-ink-muted"
            style={{ background: 'var(--pale)' }}
          >
            Showing an older version — edits here change this version, not the one filling in
            your weeks.
          </p>
        )}

        <div className="flex flex-col">
          {GROUP_DEFS.map((group) => (
            <GroupRow
              key={group.key}
              title={group.title}
              blocks={grouped[group.key]}
              tagMap={tagMap}
              onAdd={() => onAdd(group.presetDays)}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/** One day-group as a row: a fixed label, then its blocks flowing in time order.
 *  Rows rather than columns because the window is ~670px wide — see GROUP_DEFS. */
function GroupRow({
  title,
  blocks,
  tagMap,
  onAdd,
  onEdit,
  onDelete,
}: {
  title: string
  blocks: RoutineBlock[]
  tagMap: Map<number, Tag>
  onAdd: () => void
  onEdit: (block: RoutineBlock) => void
  onDelete: (block: RoutineBlock) => void
}) {
  const totalMinutes = blocks.reduce((sum, b) => sum + blockMinutes(b), 0)

  return (
    <div className="flex items-start gap-2 border-b border-line py-1.5 last:border-b-0">
      <div className="w-[74px] shrink-0 pt-1">
        <div className="truncate text-[11px] font-semibold leading-tight text-ink">{title}</div>
        <div className="text-[10px] leading-tight text-ink-faint">
          {totalMinutes > 0 ? formatMinutes(totalMinutes) : '—'}
        </div>
      </div>

      {/* `min-w-0` lets this shrink below its content's natural width so the pills
       *  wrap instead of stretching the row and overflowing the window. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {blocks.map((block) => (
          <BlockPill
            key={block.id}
            block={block}
            tagMap={tagMap}
            onEdit={() => onEdit(block)}
            onDelete={() => onDelete(block)}
          />
        ))}
        <button
          type="button"
          aria-label={`Add block to ${title}`}
          onClick={onAdd}
          className="shrink-0 rounded-[7px] border border-dashed border-line px-2 py-1 text-[11px] leading-none text-ink-faint transition-colors hover:border-[var(--line-strong)] hover:text-ink"
        >
          +
        </button>
      </div>
    </div>
  )
}

function BlockPill({
  block,
  tagMap,
  onEdit,
  onDelete,
}: {
  block: RoutineBlock
  tagMap: Map<number, Tag>
  onEdit: () => void
  onDelete: () => void
}) {
  const crossesMidnight = block.end_time <= block.start_time
  const custom = classifyDays(block.days) === 'custom'
  const tag = tagMap.get(block.tag_ids[0])
  const detail = [
    `${block.start_time.slice(0, 5)}–${block.end_time.slice(0, 5)}`,
    block.task_name,
    custom ? formatDaySet(block.days) : null,
    crossesMidnight ? 'crosses midnight' : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <span
      className="group flex max-w-full items-center gap-1.5 rounded-[7px] border border-line py-1 pl-1.5 pr-1"
      style={{ background: 'var(--surface-raised)' }}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: tag?.color ?? 'var(--line-strong)' }}
      />
      {/* The whole pill is the edit target; `title` carries everything that had to be
       *  dropped to fit — day set, midnight wrap, and the full name when truncated. */}
      <button
        type="button"
        onClick={onEdit}
        title={detail}
        className="flex min-w-0 items-baseline gap-1.5 text-left"
      >
        <span className="shrink-0 text-[10px] tabular-nums leading-none text-ink-faint">
          {block.start_time.slice(0, 5)}
        </span>
        <span className="max-w-[132px] truncate text-[11.5px] leading-none text-ink">
          {block.task_name}
        </span>
      </button>
      <button
        type="button"
        aria-label={`Delete ${block.task_name}`}
        onClick={onDelete}
        // Always occupies its space so nothing shifts on hover; only the colour comes
        // up. Hiding it outright would put delete out of reach on touch.
        className="shrink-0 rounded-[4px] px-1 text-[11px] leading-none opacity-45 transition-opacity hover:opacity-100 group-hover:opacity-80"
        style={{ color: 'var(--over)' }}
      >
        ×
      </button>
    </span>
  )
}

function VersionRow({
  version,
  isShowing,
  onSelect,
  onRename,
  onNote,
  onActivate,
}: {
  version: Routine
  isShowing: boolean
  onSelect: () => void
  onRename: (name: string) => void
  onNote: (note: string) => void
  onActivate: () => void
}) {
  // Local drafts so typing does not fire a mutation per keystroke; committed on blur,
  // and only when the value actually changed.
  const [name, setName] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const totalMinutes = version.blocks.reduce((sum, b) => sum + blockMinutes(b), 0)

  return (
    <li
      // Showing and active are different things and have to look different: one is
      // what you are watching, the other is what fills in your weeks. The left bar
      // marks the former, the pill marks the latter, and a version can be either,
      // both, or neither.
      className="flex items-center gap-2 border-b border-line py-2 pl-2 pr-2.5 last:border-b-0"
      style={{
        background: isShowing ? 'var(--pale)' : undefined,
        boxShadow: isShowing ? 'inset 3px 0 0 0 var(--sage)' : undefined,
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-label={`Show ${version.name} on screen`}
        aria-pressed={isShowing}
        className="w-14 shrink-0 rounded-[6px] px-1 py-1 text-[11px] text-ink-muted transition-colors hover:bg-[var(--surface-raised)] hover:text-ink"
      >
        {isShowing ? 'Showing' : 'Show'}
      </button>

      <div className="min-w-0 flex-1">
        <input
          value={name ?? version.name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const next = (name ?? '').trim()
            if (name !== null && next && next !== version.name) onRename(next)
            setName(null)
          }}
          aria-label={`Name of version ${version.id}`}
          className="w-full truncate border-none bg-transparent text-[13px] font-medium leading-tight text-ink outline-none focus:ring-0"
        />
        <input
          value={note ?? version.note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            const next = (note ?? '').trim()
            if (note !== null && next !== version.note) onNote(next)
            setNote(null)
          }}
          placeholder="Add a note"
          aria-label={`Note on version ${version.id}`}
          className="w-full truncate border-none bg-transparent text-[11px] leading-tight text-ink-muted outline-none focus:ring-0"
        />
      </div>

      <div className="w-[104px] shrink-0 text-right text-[10px] leading-tight text-ink-faint">
        <div>
          {version.blocks.length} block{version.blocks.length === 1 ? '' : 's'} ·{' '}
          {formatMinutes(totalMinutes)}
        </div>
        <div>{formatUpdated(version.updated_at)}</div>
      </div>

      <div className="w-[60px] shrink-0 text-right">
        {version.is_active ? (
          <span
            className="rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-ink"
            style={{ background: 'var(--surface-raised)' }}
          >
            Active
          </span>
        ) : (
          <button
            type="button"
            onClick={onActivate}
            className="rounded-[6px] px-1.5 py-1 text-[11px] text-ink-muted transition-colors hover:bg-[var(--surface-raised)] hover:text-ink"
          >
            Activate
          </button>
        )}
      </div>
    </li>
  )
}

function NewRoutineForm({
  submitting,
  error,
  canCopy,
  onCancel,
  onSubmit,
}: {
  submitting: boolean
  error: string | null
  /** Only offer to copy when there is actually something to copy from. */
  canCopy: boolean
  onCancel: () => void
  onSubmit: (body: { name: string; note: string; copy_blocks_from_active: boolean }) => void
}) {
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  // Defaults to copying: a new version almost always means "the current week, with
  // a change". Starting empty is how an active routine ends up with no blocks and
  // quietly generates nothing, which is a failure with no error message.
  const [copy, setCopy] = useState(true)

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return
        onSubmit({ name: name.trim(), note: note.trim(), copy_blocks_from_active: canCopy && copy })
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-xs text-ink-muted">Name</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Winter weeks"
          className="rounded-[8px] border border-line bg-transparent px-2 py-1.5 text-sm outline-none focus:border-ink-faint"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-ink-muted">Note</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why this version exists"
          className="rounded-[8px] border border-line bg-transparent px-2 py-1.5 text-sm outline-none focus:border-ink-faint"
        />
      </label>

      {canCopy && (
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
          Start from the current version's blocks
        </label>
      )}

      <p className="text-xs text-ink-faint">
        The new version becomes active, so it is what fills in new weeks from now on. The current
        one is kept below and you can switch back to it.
      </p>

      {error && <p className="text-xs text-[var(--over)]">{error}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm text-ink-muted">
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          className="rounded-[8px] bg-[var(--pale)] px-3 py-1.5 text-sm font-medium text-ink transition-opacity hover:opacity-80 disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create'}
        </button>
      </div>
    </form>
  )
}
