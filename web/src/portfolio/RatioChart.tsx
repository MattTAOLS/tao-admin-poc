import { useId, useMemo, useState } from 'react'
import { Field, Select } from '@/design/components'
import { HISTORY_LABELS, historyKind, monthIndex } from './fmt'
import { Num, fmtNum } from './Num'
import type { RatioHistoryRow } from './types'

const W = 560, H = 180, PAD_L = 56, PAD_R = 12, PAD_T = 12, PAD_B = 28

/** Ratio history: one series at a time over the latest 13 months, an inline SVG drawn with tokens. The values are
 * the published ratio_history entries; the visually hidden table carries the same numbers for screen readers. */
export function RatioChart({ history }: { history: RatioHistoryRow[] }) {
  const id = useId()
  const rows = useMemo(() => {
    const withMonth = history.map((r, src): RatioHistoryRow & { src: number } => ({ ...r, src })).filter(r => typeof r.month === 'string')
    const sorted = withMonth.sort((a, b) => monthIndex(a.month) - monthIndex(b.month))
    return sorted.slice(-13)
  }, [history])
  const keys = useMemo(() => {
    const ks = new Set<string>()
    for (const r of rows) for (const [k, v] of Object.entries(r)) if (k !== 'month' && k !== 'src' && typeof v === 'number') ks.add(k)
    const order = Object.keys(HISTORY_LABELS)
    return [...ks].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
  }, [rows])
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  const key = chosen && keys.includes(chosen) ? chosen : keys[0]
  if (!key || rows.length === 0) return <p className="pf-muted">No ratio history in this report.</p>

  const kind = historyKind(key)
  const pts = rows.map((r, i) => ({ i, src: r.src, month: r.month as string, v: typeof r[key] === 'number' ? (r[key] as number) : null }))
  const vals = pts.filter(p => p.v !== null).map(p => p.v as number)
  let lo = Math.min(...vals), hi = Math.max(...vals)
  if (lo === hi) { lo -= Math.abs(lo) * 0.1 || 1; hi += Math.abs(hi) * 0.1 || 1 }
  const x = (i: number) => PAD_L + (rows.length === 1 ? 0 : (i * (W - PAD_L - PAD_R)) / (rows.length - 1))
  const y = (v: number) => PAD_T + (H - PAD_T - PAD_B) * (1 - (v - lo) / (hi - lo))
  const segs: string[] = []
  let cur = ''
  for (const p of pts) {
    if (p.v === null) { if (cur) segs.push(cur); cur = ''; continue }
    cur += `${cur ? ' L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`
  }
  if (cur) segs.push(cur)
  const label = HISTORY_LABELS[key] ?? key
  const last = [...pts].reverse().find(p => p.v !== null)

  return (
    <div className="pf-chart">
      <div className="pf-toolbar">
        <Field label="Series">
          <Select value={key} onChange={e => setChosen(e.target.value)} options={keys.map(k => ({ value: k, label: HISTORY_LABELS[k] ?? k }))} />
        </Field>
        {last && <span className="pf-muted">Latest {last.month}: <b className="pf-num">{fmtNum(last.v, kind)}</b></span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="pf-chart__svg" role="img" aria-labelledby={`${id}-t`}>
        <title id={`${id}-t`}>{`${label}, ${rows[0].month} to ${rows[rows.length - 1].month}`}</title>
        {[lo, (lo + hi) / 2, hi].map((v, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} className="pf-chart__grid" />
            <text x={PAD_L - 6} y={y(v) + 4} textAnchor="end" className="pf-chart__axis">{fmtNum(v, kind)}</text>
          </g>
        ))}
        {pts.map(p => (p.i % 2 === 0 || p.i === rows.length - 1) && (
          <text key={p.month} x={x(p.i)} y={H - 8} textAnchor={p.i === rows.length - 1 ? "end" : p.i === 0 ? "start" : "middle"} className="pf-chart__axis">{p.month}</text>
        ))}
        {segs.map((d, i) => <path key={i} d={d} className="pf-chart__line" />)}
        {pts.map(p => p.v !== null && <circle key={p.month} cx={x(p.i)} cy={y(p.v)} r={2.5} className="pf-chart__dot"><title>{`${p.month}: ${fmtNum(p.v, kind)}`}</title></circle>)}
      </svg>
      {/* The div is hidden, not the table: a table ignores width: 1px and would widen the page (audit M18). */}
      <div className="ds-visually-hidden" data-testid="chart-table">
        <table>
          <caption>{label} by month</caption>
          <thead><tr><th scope="col">Month</th><th scope="col">{label}</th></tr></thead>
          <tbody>{pts.map(p => <tr key={p.month}><td>{p.month}</td><td><Num v={p.v} kind={kind} field={`ratio_history.${p.src}.${key}`} /></td></tr>)}</tbody>
        </table>
      </div>
    </div>
  )
}
