import type { GroupResult, Verdict } from '../api/types'
import { VerdictPill } from './VerdictPill'
import { formatMinutes } from '../lib/datetime'

// Mirrors VerdictPill's copy — kept local because the compact rail renders the
// verdict as a dot (title + sr-only text) rather than the pill itself.
const VERDICT_LABEL: Record<Verdict, string> = {
  pass: 'on target',
  over: 'over',
  under: 'under',
}

const VERDICT_COLOR: Record<Verdict, string> = {
  pass: 'var(--pass)',
  over: 'var(--over)',
  under: 'var(--under)',
}

export function RatioBars({
  groups,
  tolerance,
  compact = false,
}: {
  groups: GroupResult[]
  tolerance: number
  compact?: boolean
}) {
  // The widest share across groups sets the scale, so a 60% band and a 10% band are
  // both legible instead of the small one collapsing to a sliver.
  const scale = Math.max(...groups.map((g) => Math.max(g.share_actual, g.share_target * (1 + tolerance))), 0.01)

  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => {
        const lo = g.share_target * (1 - tolerance)
        const hi = g.share_target * (1 + tolerance)
        return (
          <div key={g.key}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-xs text-ink-muted truncate min-w-0">{g.label}</span>
              <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs">
                <span className="tabular-nums">{(g.share_actual * 100).toFixed(1)}%</span>
                {compact ? (
                  // The rail is narrow enough that the name needs the room the pill would
                  // take; the verdict is still legible from the bar's colour below, so here
                  // it shrinks to a dot (title + sr-only text keep it non-colour-only).
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: VERDICT_COLOR[g.verdict] }}
                    title={VERDICT_LABEL[g.verdict]}
                  >
                    <span className="sr-only">{VERDICT_LABEL[g.verdict]}</span>
                  </span>
                ) : (
                  <VerdictPill verdict={g.verdict} />
                )}
              </span>
            </div>
            <div className="relative h-2.5 rounded-full" style={{ background: 'var(--line)' }}>
              {/* the permitted band */}
              <div
                className="absolute inset-y-0 rounded-full"
                style={{
                  left: `${(lo / scale) * 100}%`,
                  width: `${((hi - lo) / scale) * 100}%`,
                  background: 'var(--pale)',
                }}
              />
              {/* the actual share */}
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${(g.share_actual / scale) * 100}%`,
                  background: VERDICT_COLOR[g.verdict],
                  opacity: 0.85,
                }}
              />
              {/* the target */}
              <div
                className="absolute inset-y-[-3px] w-px"
                style={{ left: `${(g.share_target / scale) * 100}%`, background: 'var(--ink)' }}
              />
            </div>
            {!compact && (
              <div className="mt-1 text-[11px] text-ink-faint">
                {formatMinutes(g.minutes)} · target {(g.share_target * 100).toFixed(0)}% · band{' '}
                {(lo * 100).toFixed(0)}–{(hi * 100).toFixed(0)}%
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
