import { useEffect, useState } from 'react'

import { ApiError } from '../api/client'
import type { Rule } from '../api/types'
import { Modal } from '../components/Modal'
import { RuleEditor } from '../components/RuleEditor'
import { VersionDeleteButton } from '../components/VersionDeleteButton'
import {
  computeBands,
  formatBands,
  useCreateRuleVersion,
  useDeleteRule,
  useRules,
  useUpdateRule,
} from '../hooks/useRules'
import { useTags } from '../hooks/useTags'

/** The seeded 6:3:1 rule's shape (`backend/app/services/seed.py::seed_all`), reproduced
 *  here so the empty state can recreate it after the active rule is deleted or on a
 *  database that never ran /api/seed. Tag *names*, not ids — ids are resolved at click
 *  time from whatever tags actually exist, never hardcoded, so a re-seed under a
 *  different tag ordering (or a renamed tag) can't silently post the wrong ids. */
const STARTER_TAG_NAMES = [
  'Rest', 'Work', 'Study', 'Commute', 'Kids/Family', 'Chores/Prep', 'Fitness', 'Personal',
] as const

function buildStarterRule(idOf: (name: string) => number) {
  return {
    name: '6:3:1 baseline',
    tolerance: 0.2,
    note: 'Initial commitment.',
    exclude_tag_ids: [idOf('Rest'), idOf('Personal')],
    groups: [
      {
        key: 'A',
        label: 'Work & Study',
        ratio: 6,
        tag_ids: [idOf('Work'), idOf('Study'), idOf('Commute')],
      },
      {
        key: 'B',
        label: 'Family care',
        ratio: 3,
        tag_ids: [idOf('Kids/Family'), idOf('Chores/Prep')],
      },
      { key: 'C', label: 'Fitness', ratio: 1, tag_ids: [idOf('Fitness')] },
    ],
  }
}

export default function RulesPage() {
  // One query for everything on this page, the same shape as RoutinePage: `RuleOut`
  // carries name/note/groups/tolerance/dates for every version, so "which version is
  // active" and "which version is on screen" both read from this single list rather
  // than two requests that can disagree while a mutation is in flight.
  const rulesQuery = useRules()
  const tagsQuery = useTags()

  const deleteRule = useDeleteRule()
  const updateRule = useUpdateRule()
  const createStarterRule = useCreateRuleVersion()

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [armedDeleteId, setArmedDeleteId] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState<{ id: number; message: string } | null>(null)
  const [starterError, setStarterError] = useState<string | null>(null)

  const versions = rulesQuery.data ?? []
  const active = versions.find((v) => v.effective_to === null) ?? null
  const selected = versions.find((v) => v.id === selectedId) ?? active ?? versions[0] ?? null

  // Follow the active version until the user picks one of their own, and recover if
  // the selected version disappears (e.g. it was just deleted) — same recovery as
  // RoutinePage's version list.
  useEffect(() => {
    if (selectedId !== null && !versions.some((v) => v.id === selectedId)) setSelectedId(null)
  }, [selectedId, versions])

  const handleDelete = (id: number) => {
    setDeleteError(null)
    deleteRule.mutate(id, {
      onSuccess: () => setArmedDeleteId(null),
      onError: (err) => {
        setArmedDeleteId(null)
        const message = err instanceof ApiError ? err.detail : 'Could not delete this version.'
        setDeleteError({ id, message })
      },
    })
  }

  const handleCreateStarter = () => {
    const byName = new Map((tagsQuery.data ?? []).map((t) => [t.name, t.id]))
    const missing = STARTER_TAG_NAMES.filter((name) => !byName.has(name))
    if (missing.length > 0) {
      setStarterError(
        `Can't create the starter rule — missing tag${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`,
      )
      return
    }
    setStarterError(null)
    createStarterRule.mutate(buildStarterRule((name) => byName.get(name)!), {
      onError: (err) => {
        setStarterError(err instanceof ApiError ? err.detail : 'Could not create the starter rule.')
      },
    })
  }

  const loaded = !rulesQuery.isLoading && !rulesQuery.isError

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 font-display text-xl">Rules</h1>
      <p className="mb-6 text-sm text-ink-faint">
        The commitment every week and every monthly report is measured against.
      </p>

      {rulesQuery.isLoading && <p className="text-sm text-ink-faint">Loading rules…</p>}
      {rulesQuery.isError && <p className="text-sm text-ink-faint">Couldn't load the rules.</p>}

      {loaded && versions.length === 0 && (
        <div className="rounded-[12px] border border-line bg-surface p-5">
          <p className="mb-3 text-sm text-ink-muted">
            No rule yet. Every week's ratios and the monthly review need one to
            measure against.
          </p>
          {starterError && <p className="mb-3 text-xs text-[var(--over)]">{starterError}</p>}
          <button
            type="button"
            disabled={createStarterRule.isPending || tagsQuery.isLoading}
            onClick={handleCreateStarter}
            className="rounded-[8px] bg-[var(--pale)] px-3 py-1.5 text-sm font-medium text-ink transition-opacity hover:opacity-80 disabled:opacity-50"
          >
            {createStarterRule.isPending ? 'Creating…' : 'Create the 6:3:1 starter rule'}
          </button>
        </div>
      )}

      {loaded && versions.length > 0 && (
        <Display
          version={selected}
          onRename={(name) => selected && updateRule.mutate({ id: selected.id, body: { name } })}
          onNote={(note) => selected && updateRule.mutate({ id: selected.id, body: { note } })}
        />
      )}
      {updateRule.isError && (
        <p className="mt-2 text-xs text-[var(--over)]">Couldn't save that change.</p>
      )}

      <section className="mt-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">Versions</h2>
          <button
            type="button"
            disabled={!selected}
            title={selected ? undefined : 'Create the starter rule first.'}
            onClick={() => setEditorOpen(true)}
            className="shrink-0 rounded-[8px] bg-[var(--pale)] px-3 py-1.5 text-xs font-medium text-ink transition-opacity hover:opacity-80 disabled:opacity-40"
          >
            New version
          </button>
        </div>

        {versions.length > 0 && (
          <ul className="overflow-hidden rounded-[12px] border border-line bg-surface">
            {versions.map((rule) => (
              <VersionRow
                key={rule.id}
                rule={rule}
                isShowing={selected?.id === rule.id}
                deleteArmed={armedDeleteId === rule.id}
                deleting={deleteRule.isPending && deleteRule.variables === rule.id}
                deleteError={deleteError?.id === rule.id ? deleteError.message : null}
                onSelect={() => setSelectedId(rule.id)}
                onArmDelete={() => {
                  setDeleteError(null)
                  setArmedDeleteId(rule.id)
                }}
                onConfirmDelete={() => handleDelete(rule.id)}
              />
            ))}
          </ul>
        )}
      </section>

      <Modal open={editorOpen} onClose={() => setEditorOpen(false)} title="New version">
        {/* Bases the new version's starting groups/tolerance/exclusions on whichever
         *  version is currently on screen (not necessarily the active one), so a new
         *  commitment can fork off any point in the history, not just the incumbent. */}
        {selected && <RuleEditor rule={selected} onSaved={() => setEditorOpen(false)} />}
      </Modal>
    </div>
  )
}

/** The displayed version, front-panel style — mirrors RoutinePage's `Screen`: name and
 *  description are editable in place (blur-commit, via `PATCH /rules/{id}`), everything
 *  else (ratios, groups, dates) is read-only here because a version's ratio math is
 *  immutable — a new commitment is a new version, saved from the "New version" editor
 *  below, never an edit to this one. */
function Display({
  version,
  onRename,
  onNote,
}: {
  version: Rule | null
  onRename: (name: string) => void
  onNote: (note: string) => void
}) {
  const [name, setName] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  if (!version) return null

  const isActive = version.effective_to === null
  const bands = computeBands(version.groups, version.tolerance)

  return (
    <div
      className="rounded-[16px] border border-line p-2 sm:p-2.5"
      style={{ background: 'var(--pale)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="mb-2 flex items-center gap-2 px-1.5 pt-0.5">
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full"
          style={{
            background: isActive ? 'var(--sage)' : 'var(--line-strong)',
            boxShadow: isActive ? '0 0 6px var(--sage)' : undefined,
          }}
        />
        <div className="min-w-0 flex-1">
          <input
            value={name ?? version.name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const next = (name ?? '').trim()
              if (name !== null && next && next !== version.name) onRename(next)
              setName(null)
            }}
            aria-label="Version name"
            className="w-full truncate border-none bg-transparent font-display text-[15px] leading-tight text-ink outline-none focus:ring-0"
          />
          <input
            value={note ?? version.note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => {
              const next = (note ?? '').trim()
              if (note !== null && next !== version.note) onNote(next)
              setNote(null)
            }}
            placeholder="Add a description"
            aria-label="Version description"
            className="w-full truncate border-none bg-transparent text-[11px] leading-tight text-ink-faint outline-none focus:ring-0"
          />
        </div>
        {isActive && (
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink"
            style={{ background: 'var(--surface-raised)' }}
          >
            On air
          </span>
        )}
      </div>

      <div className="rounded-[11px] border border-line bg-surface p-2.5 sm:p-3">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {version.groups.map((g) => (
            <span
              key={g.key}
              className="rounded-full px-2.5 py-1 text-xs text-ink"
              style={{ background: 'var(--pale)' }}
            >
              <span className="font-medium">{g.label}</span>
              <span className="text-ink-faint"> · {g.ratio}</span>
            </span>
          ))}
        </div>
        <p className="text-sm font-medium text-ink">{formatBands(bands)}</p>
        <p className="mt-1 text-xs text-ink-faint">
          {version.effective_from} – {version.effective_to ?? 'present'} · tolerance{' '}
          {Math.round(version.tolerance * 100)}%
        </p>
      </div>
    </div>
  )
}

function VersionRow({
  rule,
  isShowing,
  deleteArmed,
  deleting,
  deleteError,
  onSelect,
  onArmDelete,
  onConfirmDelete,
}: {
  rule: Rule
  isShowing: boolean
  deleteArmed: boolean
  deleting: boolean
  deleteError: string | null
  onSelect: () => void
  onArmDelete: () => void
  onConfirmDelete: () => void
}) {
  const active = rule.effective_to === null
  const ratios = rule.groups.map((g) => g.ratio).join(' : ')

  return (
    <li
      // The whole card is the click target (item 6/10) — no separate "show" control.
      // `role="button"` + keyboard handling rather than a real `<button>`: this card's
      // own delete control is interactive content, which a `<button>` can't nest.
      role="button"
      tabIndex={0}
      aria-pressed={isShowing}
      aria-label={`Show ${rule.name} on screen`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className="flex cursor-pointer flex-col gap-1 border-b border-line px-3 py-2.5 outline-none last:border-b-0 focus-visible:ring-2 focus-visible:ring-inset"
      style={{
        background: isShowing ? 'var(--pale)' : undefined,
        boxShadow: isShowing ? 'inset 3px 0 0 0 var(--sage)' : undefined,
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-ink">{rule.name}</span>
          {active && (
            <span
              className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
              style={{ background: 'var(--pass)' }}
            >
              active
            </span>
          )}
        </div>
        <VersionDeleteButton
          armed={deleteArmed}
          pending={deleting}
          label={rule.name}
          onArm={onArmDelete}
          onConfirm={onConfirmDelete}
        />
      </div>
      <div className="text-xs text-ink-faint">
        {rule.effective_from} – {rule.effective_to ?? 'present'} · {ratios}
      </div>
      {rule.note && <div className="truncate text-xs text-ink-muted">"{rule.note}"</div>}
      {deleteError && <div className="text-xs text-[var(--over)]">{deleteError}</div>}
    </li>
  )
}
