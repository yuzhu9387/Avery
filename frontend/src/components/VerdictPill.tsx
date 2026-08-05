import type { Verdict } from '../api/types'

const STYLE: Record<Verdict, { bg: string; label: string }> = {
  pass: { bg: 'var(--pass)', label: 'on target' },
  over: { bg: 'var(--over)', label: 'over' },
  under: { bg: 'var(--under)', label: 'under' },
}

export function VerdictPill({ verdict }: { verdict: Verdict }) {
  const s = STYLE[verdict]
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
      style={{ background: s.bg }}
    >
      {s.label}
    </span>
  )
}
