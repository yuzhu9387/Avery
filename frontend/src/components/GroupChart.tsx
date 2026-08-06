import { Bar, BarChart, Cell, LabelList, ReferenceArea, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts'

import type { GroupResult, Verdict } from '../api/types'

const VERDICT_VAR: Record<Verdict, string> = {
  pass: 'var(--pass)',
  over: 'var(--over)',
  under: 'var(--under)',
}

// Half-width of each bar's "slot" in index units. The x-axis below is numeric (bar
// index, not the category key) specifically so a ReferenceArea/ReferenceLine can be
// scoped to *one* bar's width via fractional offsets — a plain categorical axis only
// gives ReferenceLine a single center point, with no way to span a bar's width.
const HALF_SLOT = 0.36

/**
 * Each group's actual share as a bar, coloured by verdict, with its permitted band
 * (target ± tolerance) drawn as a ReferenceArea and the target itself as a
 * ReferenceLine — both scoped to that one bar so three groups with three different
 * targets don't smear lines across each other's bars.
 */
export function GroupChart({ groups, tolerance }: { groups: GroupResult[]; tolerance: number }) {
  const data = groups.map((g, idx) => {
    const pct = (v: number) => Math.round(v * 1000) / 10
    return {
      idx,
      key: g.key,
      actual: pct(g.share_actual),
      target: pct(g.share_target),
      lo: pct(g.share_target * (1 - tolerance)),
      hi: pct(g.share_target * (1 + tolerance)),
      verdict: g.verdict,
    }
  })

  const ceiling = Math.max(...data.map((d) => Math.max(d.actual, d.hi)), 1)

  return (
    <div style={{ width: '100%', height: 200 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 20, right: 16, left: 8, bottom: 4 }}>
          <XAxis
            type="number"
            dataKey="idx"
            domain={[-0.5, data.length - 0.5]}
            ticks={data.map((d) => d.idx)}
            tickFormatter={(v: number) => data[v]?.key ?? ''}
            tickLine={false}
            axisLine={{ stroke: 'var(--line)' }}
            tick={{ fill: 'var(--ink-faint)', fontSize: 11 }}
          />
          <YAxis hide domain={[0, ceiling * 1.2]} />

          {data.map((d) => (
            <ReferenceArea
              key={`band-${d.key}`}
              x1={d.idx - HALF_SLOT}
              x2={d.idx + HALF_SLOT}
              y1={d.lo}
              y2={d.hi}
              fill="var(--pale)"
              fillOpacity={0.8}
              stroke="none"
              ifOverflow="visible"
            />
          ))}

          {data.map((d) => (
            <ReferenceLine
              key={`target-${d.key}`}
              segment={[
                { x: d.idx - HALF_SLOT, y: d.target },
                { x: d.idx + HALF_SLOT, y: d.target },
              ]}
              stroke="var(--ink)"
              strokeWidth={1.5}
              ifOverflow="visible"
            />
          ))}

          <Bar dataKey="actual" barSize={40} radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.key} fill={VERDICT_VAR[d.verdict]} />
            ))}
            <LabelList
              dataKey="actual"
              position="top"
              formatter={(value: string | number | boolean | null | undefined) => `${Number(value ?? 0).toFixed(0)}%`}
              fill="var(--ink-muted)"
              fontSize={11}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
