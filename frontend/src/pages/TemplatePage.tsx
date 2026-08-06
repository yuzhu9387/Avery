import { useMemo, useState } from 'react'

import { ApiError } from '../api/client'
import type { PreviewResult, TemplateBlock } from '../api/types'
import { BlockForm } from '../components/BlockForm'
import { Modal } from '../components/Modal'
import { TagChip } from '../components/TagChip'
import type { ColumnKey } from '../hooks/useTemplate'
import {
  classifyDays,
  formatDaySet,
  useActiveTemplate,
  useCreateBlock,
  useCreateTemplate,
  useDeleteBlock,
  usePreviewWeek,
  useUpdateBlock,
  useUpdateTemplate,
} from '../hooks/useTemplate'
import { useTagMap } from '../hooks/useTags'
import { addDays, formatDate, formatMinutes, formatTimeRange, mondayOf, parseLocal } from '../lib/datetime'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const COLUMN_DEFS: { key: ColumnKey; title: string; presetDays?: number[] }[] = [
  { key: 'everyday', title: 'Every day', presetDays: [1, 2, 3, 4, 5, 6, 7] },
  { key: 'weekday', title: 'Mon–Fri', presetDays: [1, 2, 3, 4, 5] },
  { key: 'saturday', title: 'Saturday', presetDays: [6] },
  { key: 'sunday', title: 'Sunday', presetDays: [7] },
  { key: 'custom', title: 'Custom' },
]

/** `end_time <= start_time` is how an overnight block (e.g. 23:00–07:00 rest)
 *  is stored, not a validation error — so its duration wraps past midnight
 *  rather than coming out negative. */
function blockMinutes(block: TemplateBlock): number {
  const [sh, sm] = block.start_time.split(':').map(Number)
  const [eh, em] = block.end_time.split(':').map(Number)
  const start = sh * 60 + sm
  let end = eh * 60 + em
  if (end <= start) end += 24 * 60
  return end - start
}

type ModalState =
  | { mode: 'create'; initialDays: number[] }
  | { mode: 'edit'; block: TemplateBlock }

export default function TemplatePage() {
  const templateQuery = useActiveTemplate()
  const tagMap = useTagMap()

  const updateTemplate = useUpdateTemplate()
  const createTemplate = useCreateTemplate()
  const createBlock = useCreateBlock()
  const updateBlock = useUpdateBlock()
  const deleteBlock = useDeleteBlock()

  const previewDay = formatDate(addDays(mondayOf(new Date()), 7))
  const preview = usePreviewWeek(previewDay)
  const [previewRequested, setPreviewRequested] = useState(false)
  // `usePreviewWeek` is `enabled: false`, so invalidating ['template'] after a block
  // mutation marks it stale WITHOUT refetching (React Query v5 never refetches an
  // inactive query) — the panel would otherwise keep rendering `preview.data` from
  // before the edit. Holding the rendered result here, set only from an explicit
  // `refetch()`, and clearing it wherever a block mutation succeeds, means the panel
  // can never disagree with what the template actually contains.
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null)

  const clearPreview = () => {
    setPreviewRequested(false)
    setPreviewResult(null)
  }

  const [modal, setModal] = useState<ModalState | null>(null)
  const [name, setName] = useState<string | null>(null)

  const template = templateQuery.data
  const displayName = name ?? template?.name ?? ''

  const grouped = useMemo(() => {
    const map: Record<ColumnKey, TemplateBlock[]> = {
      everyday: [],
      weekday: [],
      saturday: [],
      sunday: [],
      custom: [],
    }
    for (const block of template?.blocks ?? []) {
      map[classifyDays(block.days)].push(block)
    }
    for (const key of Object.keys(map) as ColumnKey[]) {
      map[key] = [...map[key]].sort((a, b) => a.start_time.localeCompare(b.start_time))
    }
    return map
  }, [template])

  // A 404 on /templates/active means "none configured yet" — a fresh database, or the
  // active template was deleted — not "something broke". That state is recoverable
  // in-app, so it gets an empty state and a way out instead of a dead-end error.
  const noActiveTemplate = templateQuery.error instanceof ApiError && templateQuery.error.status === 404

  if (templateQuery.isLoading) return <p className="p-6 text-sm text-ink-faint">Loading template…</p>

  if (noActiveTemplate) {
    return (
      <div className="mx-auto max-w-6xl p-6">
        <div className="rounded-[12px] border border-line bg-surface p-5">
          <p className="mb-3 text-sm text-ink-muted">
            No active template yet. Create one to start generating weeks automatically.
          </p>
          {createTemplate.isError && (
            <p className="mb-3 text-xs text-[var(--over)]">Couldn't create the template.</p>
          )}
          <button
            type="button"
            disabled={createTemplate.isPending}
            onClick={() => createTemplate.mutate({ name: 'Default week', is_active: true })}
            className="rounded-[8px] bg-[var(--pale)] px-3 py-1.5 text-sm font-medium text-ink transition-opacity hover:opacity-80 disabled:opacity-50"
          >
            {createTemplate.isPending ? 'Creating…' : 'Create a template'}
          </button>
        </div>
      </div>
    )
  }

  if (templateQuery.isError || !template) {
    return <p className="p-6 text-sm text-ink-faint">Couldn't load the template.</p>
  }

  const commitName = () => {
    if (name !== null && name.trim() && name.trim() !== template.name) {
      updateTemplate.mutate({ id: template.id, body: { name: name.trim() } })
    }
  }

  const closeModal = () => {
    setModal(null)
    createBlock.reset()
    updateBlock.reset()
  }

  const handleSubmit = (body: Partial<TemplateBlock>) => {
    if (!modal) return
    if (modal.mode === 'create') {
      createBlock.mutate(
        { templateId: template.id, body },
        { onSuccess: () => { closeModal(); clearPreview() } },
      )
    } else {
      updateBlock.mutate(
        { id: modal.block.id, body },
        { onSuccess: () => { closeModal(); clearPreview() } },
      )
    }
  }

  const handleDelete = (block: TemplateBlock) => {
    deleteBlock.mutate(block.id, { onSuccess: clearPreview })
  }

  const formError = (mutation: typeof createBlock | typeof updateBlock) =>
    mutation.error instanceof ApiError ? mutation.error.detail : null

  const runPreview = () => {
    setPreviewRequested(true)
    preview.refetch().then((result) => {
      if (result.data) setPreviewResult(result.data)
    })
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <input
          value={displayName}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          className="w-full flex-1 border-none bg-transparent font-display text-2xl outline-none focus:ring-0"
          aria-label="Template name"
        />
        <label className="flex shrink-0 items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={template.is_active}
            onChange={(e) =>
              updateTemplate.mutate({ id: template.id, body: { is_active: e.target.checked } })
            }
          />
          Active
        </label>
        <button
          type="button"
          onClick={() => setModal({ mode: 'create', initialDays: [1, 2, 3, 4, 5] })}
          className="shrink-0 rounded-[8px] bg-[var(--pale)] px-3 py-1.5 text-sm font-medium text-ink transition-opacity hover:opacity-80"
        >
          New block
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {COLUMN_DEFS.map((col) => (
          <Column
            key={col.key}
            title={col.title}
            blocks={grouped[col.key]}
            tagMap={tagMap}
            onAdd={col.presetDays ? () => setModal({ mode: 'create', initialDays: col.presetDays! }) : undefined}
            onEdit={(block) => setModal({ mode: 'edit', block })}
            onDelete={handleDelete}
          />
        ))}
      </div>

      <section className="mt-10 border-t border-line pt-6">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">Preview next week</h2>
            <p className="text-xs text-ink-faint">
              A read-only look at {previewDay} — this writes nothing to your calendar.
            </p>
          </div>
          <button
            type="button"
            disabled={preview.isFetching}
            onClick={runPreview}
            className="shrink-0 rounded-[8px] px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-[var(--pale)]/50 hover:text-ink disabled:opacity-50"
          >
            {preview.isFetching ? 'Loading…' : 'Preview next week'}
          </button>
        </div>

        {previewRequested && preview.isError && (
          <p className="text-sm text-ink-faint">Couldn't load the preview.</p>
        )}

        {previewRequested && previewResult && (
          <>
            {previewResult.events.length === 0 ? (
              <p className="text-sm text-ink-faint">
                Next week is already filled in — every day already has events, so materializing
                would skip all of them.
              </p>
            ) : (
              <>
                <p className="mb-2 text-xs text-ink-faint">
                  {previewResult.events.length} event{previewResult.events.length === 1 ? '' : 's'}{' '}
                  would appear.
                </p>
                <ul className="rounded-[12px] border border-line bg-surface">
                  {previewResult.events.map((row, i) => {
                    const start = parseLocal(row.start_at)
                    return (
                      <li
                        key={`${row.template_block_id}-${i}`}
                        className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0"
                      >
                        <span className="w-28 shrink-0 text-xs text-ink-faint">
                          {WEEKDAY_LABELS[start.getDay()]} {formatTimeRange(row.start_at, row.end_at)}
                        </span>
                        <span className="flex-1 text-sm text-ink">{row.task_name}</span>
                        <div className="flex flex-wrap gap-1">
                          {row.tag_ids.map((id) => (
                            <TagChip key={id} tag={tagMap.get(id)} size="xs" />
                          ))}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </>
        )}
      </section>

      <Modal
        open={modal !== null}
        onClose={closeModal}
        title={modal?.mode === 'edit' ? 'Edit block' : 'New block'}
      >
        {modal && (
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

function Column({
  title,
  blocks,
  tagMap,
  onAdd,
  onEdit,
  onDelete,
}: {
  title: string
  blocks: TemplateBlock[]
  tagMap: ReturnType<typeof useTagMap>
  onAdd?: () => void
  onEdit: (block: TemplateBlock) => void
  onDelete: (block: TemplateBlock) => void
}) {
  const totalMinutes = blocks.reduce((sum, b) => sum + blockMinutes(b), 0)

  return (
    <section className="rounded-[12px] border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <p className="text-xs text-ink-faint">{formatMinutes(totalMinutes)} scheduled</p>
        </div>
        {onAdd && (
          <button
            type="button"
            aria-label={`Add block to ${title}`}
            onClick={onAdd}
            className="rounded-[8px] px-2 py-1 text-xs text-ink-muted hover:bg-[var(--pale)]/50 hover:text-ink"
          >
            +
          </button>
        )}
      </div>
      {blocks.length === 0 ? (
        <p className="px-3 py-3 text-xs text-ink-faint">No blocks.</p>
      ) : (
        <ul>
          {blocks.map((block) => (
            <BlockRow
              key={block.id}
              block={block}
              tagMap={tagMap}
              onEdit={() => onEdit(block)}
              onDelete={() => onDelete(block)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function BlockRow({
  block,
  tagMap,
  onEdit,
  onDelete,
}: {
  block: TemplateBlock
  tagMap: ReturnType<typeof useTagMap>
  onEdit: () => void
  onDelete: () => void
}) {
  const crossesMidnight = block.end_time <= block.start_time
  const custom = classifyDays(block.days) === 'custom'

  return (
    <li className="flex items-start gap-2 border-b border-line px-3 py-2 last:border-b-0">
      <button type="button" onClick={onEdit} className="flex-1 text-left">
        <div className="text-xs text-ink-faint">
          {block.start_time.slice(0, 5)}–{block.end_time.slice(0, 5)}
          {crossesMidnight && ' · crosses midnight'}
        </div>
        <div className="text-sm text-ink">{block.task_name}</div>
        {custom && <div className="text-xs text-ink-faint">{formatDaySet(block.days)}</div>}
      </button>
      <div className="flex flex-wrap gap-1 pt-0.5">
        {block.tag_ids.map((id) => (
          <TagChip key={id} tag={tagMap.get(id)} size="xs" />
        ))}
      </div>
      <button
        type="button"
        aria-label={`Delete ${block.task_name}`}
        onClick={onDelete}
        className="pt-0.5 text-xs text-[var(--over)] hover:opacity-80"
      >
        Delete
      </button>
    </li>
  )
}
