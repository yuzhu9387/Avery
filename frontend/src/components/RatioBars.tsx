import type { GroupResult } from '../api/types'
import { VerdictPill } from './VerdictPill'
import { formatMinutes } from '../lib/datetime'

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
              <span className="flex items-center gap-2 text-xs">
                <span className="tabular-nums">{(g.share_actual * 100).toFixed(1)}%</span>
                <VerdictPill verdict={g.verdict} />
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
                  background:
                    g.verdict === 'pass' ? 'var(--pass)' : g.verdict === 'over' ? 'var(--over)' : 'var(--under)',
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
