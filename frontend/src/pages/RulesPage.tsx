import { useState } from 'react'

import { ApiError } from '../api/client'
import type { Rule } from '../api/types'
import { Modal } from '../components/Modal'
import { RuleEditor } from '../components/RuleEditor'
import { useActiveRule, useCreateRuleVersion, useDeleteRule, useRules } from '../hooks/useRules'
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
        label: 'Work · Study · Commute',
        ratio: 6,
        tag_ids: [idOf('Work'), idOf('Study'), idOf('Commute')],
      },
      {
        key: 'B',
        label: 'Kids · Chores',
        ratio: 3,
        tag_ids: [idOf('Kids/Family'), idOf('Chores/Prep')],
      },
      { key: 'C', label: 'Fitness', ratio: 1, tag_ids: [idOf('Fitness')] },
    ],
  }
}

export default function RulesPage() {
  const activeRuleQuery = useActiveRule()
  const rulesQuery = useRules()
  const deleteRule = useDeleteRule()
  const createStarterRule = useCreateRuleVersion()
  const tagsQuery = useTags()

  const [deleteError, setDeleteError] = useState<{ id: number; message: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Rule | null>(null)
  const [starterError, setStarterError] = useState<string | null>(null)

  // A 404 on /rules/active means "none configured yet" — a legitimate, recoverable
  // state (a fresh database, or the active version was just deleted) — not "something
  // broke". Only a non-404 failure is the error case.
  const noActiveRule = activeRuleQuery.error instanceof ApiError && activeRuleQuery.error.status === 404
  const activeRuleFailed = activeRuleQuery.isError && !noActiveRule

  const handleDelete = (id: number) => {
    setDeleteError(null)
    deleteRule.mutate(id, {
      onSuccess: () => setConfirmDelete(null),
      onError: (err) => {
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

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 font-display text-xl">Rules</h1>
      <p className="mb-6 text-sm text-ink-faint">
        The commitment every week and every monthly report is measured against.
      </p>

      {activeRuleQuery.isLoading && <p className="text-sm text-ink-faint">Loading the active rule…</p>}
      {activeRuleFailed && (
        <p className="text-sm text-ink-faint">Couldn't load the active rule.</p>
      )}

      {noActiveRule && (
        <div className="rounded-[12px] border border-line bg-surface p-5">
          <p className="mb-3 text-sm text-ink-muted">
            No active rule yet. Every week's ratios and the monthly review need one to
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

      {/* React Query keeps the last successful `data` around even after a later
          refetch errors (stale-while-revalidate) — without the `!activeRuleQuery.isError`
          guard, deleting the active rule would render the empty state ABOVE a stale
          RuleEditor still showing the version that was just deleted. */}
      {!activeRuleQuery.isError && activeRuleQuery.data && (
        <RuleEditor key={activeRuleQuery.data.id} rule={activeRuleQuery.data} />
      )}

      <section className="mt-10 border-t border-line pt-6">
        <h2 className="mb-3 text-sm font-semibold text-ink">Version history</h2>

        {rulesQuery.isLoading && <p className="text-sm text-ink-faint">Loading versions…</p>}
        {rulesQuery.isError && <p className="text-sm text-ink-faint">Couldn't load the version history.</p>}

        {rulesQuery.data && rulesQuery.data.length > 0 && (
          <ul className="rounded-[12px] border border-line bg-surface">
            {rulesQuery.data.map((rule) => (
              <VersionRow
                key={rule.id}
                rule={rule}
                deleting={deleteRule.isPending && deleteRule.variables === rule.id}
                error={deleteError?.id === rule.id ? deleteError.message : null}
                onDelete={() => setConfirmDelete(rule)}
              />
            ))}
          </ul>
        )}
      </section>

      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Delete this rule version?"
      >
        <p className="mb-4 text-sm text-ink-muted">
          {confirmDelete?.effective_to === null
            ? 'This is the active version — it is what every week\'s ratios and the monthly ' +
              'review are measured against right now. Deleting it leaves nothing active until ' +
              'you create another.'
            : `Removes "${confirmDelete?.name}" from the timeline. This cannot be undone.`}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirmDelete(null)}
            className="rounded-[8px] px-3 py-1.5 text-sm text-ink-muted hover:bg-[var(--pale)]/50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={deleteRule.isPending}
            onClick={() => confirmDelete && handleDelete(confirmDelete.id)}
            className="rounded-[8px] bg-[var(--over)] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-50"
          >
            {deleteRule.isPending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </Modal>
    </div>
  )
}

function VersionRow({
  rule,
  deleting,
  error,
  onDelete,
}: {
  rule: Rule
  deleting: boolean
  error: string | null
  onDelete: () => void
}) {
  const active = rule.effective_to === null
  const ratios = rule.groups.map((g) => g.key).join(':')
  const ratioValues = rule.groups.map((g) => g.ratio).join(':')

  return (
    <li className="flex flex-col gap-1 border-b border-line px-3 py-2.5 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink">{rule.name}</span>
          {active && (
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
              style={{ background: 'var(--pass)' }}
            >
              active
            </span>
          )}
        </div>
        <button
          type="button"
          disabled={deleting}
          onClick={onDelete}
          className="text-xs text-[var(--over)] hover:opacity-80 disabled:opacity-40"
        >
          {deleting ? 'Deleting…' : 'Delete'}
        </button>
      </div>
      <div className="text-xs text-ink-faint">
        {rule.effective_from} – {rule.effective_to ?? 'present'} · {ratioValues} ({ratios}) ·
        tolerance {Math.round(rule.tolerance * 100)}%
      </div>
      {rule.note && <div className="text-xs text-ink-muted">"{rule.note}"</div>}
      {error && <div className="text-xs text-[var(--over)]">{error}</div>}
    </li>
  )
}
