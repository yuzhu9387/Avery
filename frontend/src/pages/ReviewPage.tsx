import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { ApiError } from '../api/client'
import type { Metrics, Report } from '../api/types'
import { GroupChart } from '../components/GroupChart'
import { RatioBars } from '../components/RatioBars'
import { TagChip } from '../components/TagChip'
import { NARRATIVE_PLACEHOLDER, useReports, useRunReport } from '../hooks/useReports'
import { useTagMap } from '../hooks/useTags'
import { formatMinutes, monthKey, parseLocal } from '../lib/datetime'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function lastMonthKey(): string {
  const now = new Date()
  return monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1))
}

/** `period_start` is "YYYY-MM-DD"; only the year/month matter for the header. */
function monthLabel(periodStart: string): string {
  const [y, m] = periodStart.split('-').map(Number)
  return `${MONTH_NAMES[m - 1]} ${y}`
}

/** `created_at` arrives as a naive local timestamp — same convention as everywhere
 *  else in this app, so it's parsed with `parseLocal` rather than `Date.parse`. */
function formatGeneratedAt(createdAt: string): string {
  return parseLocal(createdAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export default function ReviewPage() {
  const [month, setMonth] = useState(lastMonthKey)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const reportsQuery = useReports(month)
  const runReport = useRunReport()
  const tagMap = useTagMap()

  // Reports are append-only and newest-first from the backend, so switching months
  // (or landing a fresh run) should fall back to the latest rather than pin a report
  // id that belongs to a different month or no longer exists.
  useEffect(() => {
    setSelectedId(null)
  }, [month])

  const reports = reportsQuery.data ?? []
  const selected = reports.find((r) => r.id === selectedId) ?? reports[0] ?? null
  const priorRuns = selected ? reports.filter((r) => r.id !== selected.id) : []

  const runDisabled = runReport.isPending

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 font-display text-xl">Review</h1>
      <p className="mb-6 text-sm text-ink-faint">
        The monthly verdict: whether your actual time matched the rule you committed to.
      </p>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-xs font-medium text-ink-muted">Month</span>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-[8px] border border-line bg-surface px-2 py-1.5 text-sm text-ink"
          />
        </label>
        <button
          type="button"
          disabled={runDisabled}
          onClick={() =>
            runReport.mutate(month, {
              onSuccess: (report) => setSelectedId(report.id),
            })
          }
          className="rounded-[8px] bg-[var(--pale)] px-3 py-1.5 text-sm font-medium text-ink transition-opacity hover:opacity-80 disabled:opacity-50"
        >
          {runReport.isPending ? 'Running…' : 'Run review'}
        </button>
        {runReport.isError && (
          <span className="text-xs text-[var(--over)]">
            {runReport.error instanceof ApiError ? runReport.error.detail : 'Could not run this review.'}
          </span>
        )}
      </div>

      {reportsQuery.isLoading && <p className="text-sm text-ink-faint">Loading reports…</p>}
      {reportsQuery.isError && <p className="text-sm text-ink-faint">Couldn't load reports for this month.</p>}

      {reportsQuery.isSuccess && reports.length === 0 && (
        <p className="text-sm text-ink-faint">
          No reports for this month yet — run one above.
        </p>
      )}

      {selected && <ReportView report={selected} tagMap={tagMap} />}

      {priorRuns.length > 0 && (
        <section className="mt-8 border-t border-line pt-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Prior runs this month</h2>
          <ul className="rounded-[12px] border border-line bg-surface">
            {priorRuns.map((r) => (
              <li key={r.id} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm text-ink hover:bg-[var(--pale)]/30"
                >
                  <span>{r.rule.name}</span>
                  <span className="text-xs text-ink-faint">generated {formatGeneratedAt(r.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function ReportView({ report, tagMap }: { report: Report; tagMap: ReturnType<typeof useTagMap> }) {
  const { metrics } = report

  return (
    <section className="rounded-[12px] border border-line bg-surface p-5">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-3">
        <h2 className="text-lg text-ink">{monthLabel(report.period_start)}</h2>
        <div className="text-xs text-ink-faint">
          Rule: <span className="font-medium text-ink-muted">{report.rule.name}</span> · effective{' '}
          {report.rule.effective_from} · generated {formatGeneratedAt(report.created_at)}
        </div>
      </header>

      {report.narrative === NARRATIVE_PLACEHOLDER ? (
        <p className="mb-5 text-sm text-ink-faint">The written summary is coming with the agent.</p>
      ) : (
        <p className="mb-5 text-sm text-ink">{report.narrative}</p>
      )}

      {!metrics.has_data ? (
        <p className="rounded-[8px] bg-[var(--pale)]/50 px-3 py-4 text-center text-sm text-ink-faint">
          Nothing logged this month.
        </p>
      ) : (
        <>
          <RatioBars groups={metrics.groups} tolerance={report.rule.tolerance} />
          <div className="mt-5">
            <GroupChart groups={metrics.groups} tolerance={report.rule.tolerance} />
          </div>
          <Totals metrics={metrics} />
          <Warnings metrics={metrics} tagMap={tagMap} />
        </>
      )}
    </section>
  )
}

function Totals({ metrics }: { metrics: Metrics }) {
  const rows: { label: string; minutes: number }[] = [
    { label: 'Tracked', minutes: metrics.total_minutes },
    { label: 'Excluded', minutes: metrics.excluded_minutes },
    { label: 'Unassigned', minutes: metrics.unassigned_minutes },
    { label: 'Untagged', minutes: metrics.untagged_minutes },
  ]

  return (
    <div className="mt-6 grid grid-cols-2 gap-3 border-t border-line pt-4 sm:grid-cols-4">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="text-[11px] uppercase tracking-wide text-ink-faint">{row.label}</div>
          <div className="text-sm font-medium text-ink">{formatMinutes(row.minutes)}</div>
        </div>
      ))}
    </div>
  )
}

function Warnings({ metrics, tagMap }: { metrics: Metrics; tagMap: ReturnType<typeof useTagMap> }) {
  const hasWarnings = metrics.unassigned_minutes > 0 || metrics.untagged_minutes > 0 || metrics.overlaps.length > 0
  if (!hasWarnings) return null

  return (
    <div className="mt-5 flex flex-col gap-2 border-t border-line pt-4">
      {metrics.unassigned_minutes > 0 && (
        <div className="rounded-[8px] bg-[var(--pale)]/40 px-3 py-2 text-xs text-ink-muted">
          <span className="font-medium text-ink">
            {formatMinutes(metrics.unassigned_minutes)} excluded from the percentages
          </span>{' '}
          because these tags belong to no group, so they never entered the denominator:{' '}
          <span className="mt-1 inline-flex flex-wrap gap-1 align-middle">
            {metrics.unassigned_tag_ids.map((id) => (
              <TagChip key={id} tag={tagMap.get(id)} size="xs" />
            ))}
          </span>{' '}
          <Link to="/rules" className="underline hover:opacity-80">
            Assign them to a group on the Rules page
          </Link>{' '}
          to fix it.
        </div>
      )}
      {metrics.untagged_minutes > 0 && (
        <div className="rounded-[8px] bg-[var(--pale)]/40 px-3 py-2 text-xs text-ink-muted">
          <span className="font-medium text-ink">{formatMinutes(metrics.untagged_minutes)}</span> of events have no
          tag at all — invisible to this rule.
        </div>
      )}
      {metrics.overlaps.length > 0 && (
        <div className="rounded-[8px] bg-[var(--pale)]/40 px-3 py-2 text-xs text-ink-muted">
          <span className="font-medium text-ink">
            {metrics.overlaps.length} pair{metrics.overlaps.length === 1 ? '' : 's'} of events overlap
          </span>
          , and both events in each pair were counted — the totals above are inflated by the overlap.
        </div>
      )}
    </div>
  )
}
