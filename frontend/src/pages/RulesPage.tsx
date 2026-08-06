import { useState } from 'react'

import { ApiError } from '../api/client'
import type { Rule } from '../api/types'
import { RuleEditor } from '../components/RuleEditor'
import { useActiveRule, useDeleteRule, useRules } from '../hooks/useRules'

export default function RulesPage() {
  const activeRuleQuery = useActiveRule()
  const rulesQuery = useRules()
  const deleteRule = useDeleteRule()

  const [deleteError, setDeleteError] = useState<{ id: number; message: string } | null>(null)

  const handleDelete = (id: number) => {
    setDeleteError(null)
    deleteRule.mutate(id, {
      onError: (err) => {
        const message = err instanceof ApiError ? err.detail : 'Could not delete this version.'
        setDeleteError({ id, message })
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
      {activeRuleQuery.isError && (
        <p className="text-sm text-ink-faint">Couldn't load the active rule.</p>
      )}
      {activeRuleQuery.data && <RuleEditor key={activeRuleQuery.data.id} rule={activeRuleQuery.data} />}

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
                onDelete={() => handleDelete(rule.id)}
              />
            ))}
          </ul>
        )}
      </section>
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
