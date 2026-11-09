/** Small inline-SVG charts for the company profile, drawn with tokens only. Every chart carries a visually hidden table
 * with the same numbers for screen readers, and each point has a hover title. No figure is computed here: the lines are
 * the series the API sends (MetricSeries, LossPeer, period_history). */
import { useId, useState, type ReactNode } from 'react'
import { Button, Dialog } from '@/design/components'
import { fmtNum } from '../Num'
import type { NumKind } from '../fmt'
import type { Month, SeriesPoint } from './types'
import { shortMonth } from './util'

export type Line = { id: string; label: string; cls: 'deal' | 'median' | 'mean' | 'alt' | 'peer'; points: SeriesPoint[]; dots?: boolean }
const PL = 58, PR = 14, PT = 12, PB = 30
/** Drawing sizes. card: a chart in the two-up grid. wide: a chart that has a section to itself, drawn shorter so it does
 * not grow taller as the page widens (CSS caps it at its drawn width). full: the full-screen view. */
type Size = 'card' | 'wide' | 'full'
const DIMS: Record<Size, { W: number; H: number }> = { card: { W: 560, H: 200 }, wide: { W: 1000, H: 260 }, full: { W: 1100, H: 440 } }

/** The chart with a Full screen button above it. The full-screen view draws the same chart again at a larger size in a
 * dialog, so the axis text and the legend stay readable. */
function ChartFrame({ title, wide, render }: { title: string; wide?: boolean; render: (size: Size) => ReactNode }) {
  const [full, setFull] = useState(false)
  const size: Size = wide ? 'wide' : 'card'
  return (
    <div className={`co-plot co-plot--${size}`}>
      <div className="co-plot__bar">
        <Button type="button" variant="ghost" size="sm" icon={<FullIcon />} onClick={() => setFull(true)} aria-label={`Full screen: ${title}`}>Full screen</Button>
      </div>
      {render(size)}
      <Dialog open={full} onClose={() => setFull(false)} title={title} size="lg">
        <div className="co-plot co-plot--full">{full && render('full')}</div>
      </Dialog>
    </div>
  )
}

const FullIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 9V4h5" /><path d="M20 9V4h-5" /><path d="M4 15v5h5" /><path d="M20 15v5h-5" />
  </svg>
)

export function unitKind(unit: string): NumKind {
  return unit === 'fraction' ? 'pct' : unit === 'currency' ? 'money' : 'ratio'
}

type LineProps = { title: string; months: Month[]; lines: Line[]; limit?: { value: number; label: string } | null; kind: NumKind; wide?: boolean }

export function LineChart(props: LineProps) {
  const { title, months, lines, limit } = props
  const has = lines.some(l => months.some(m => l.points.some(p => p.month === m && p.value !== null))) || !!limit
  if (!has || !months.length) return <p className="pf-muted">No values reported for this period.</p>
  return <ChartFrame title={title} wide={props.wide} render={size => <LineDrawing {...props} size={size} />} />
}

function LineDrawing({ title, months, lines, limit, kind, size }: LineProps & { size: Size }) {
  const id = useId()
  const { W, H } = DIMS[size]
  const val = (l: Line, m: Month) => l.points.find(p => p.month === m)?.value ?? null
  const all = lines.flatMap(l => months.map(m => val(l, m))).filter((v): v is number => v !== null)
  if (limit) all.push(limit.value)
  if (!all.length || !months.length) return <p className="pf-muted">No values reported for this period.</p>
  let lo = Math.min(...all), hi = Math.max(...all)
  if (kind === 'pct' || kind === 'money') lo = Math.min(lo, 0)
  if (lo === hi) { lo -= Math.abs(lo) * 0.1 || 1; hi += Math.abs(hi) * 0.1 || 1 }
  const pad = (hi - lo) * 0.06; hi += pad; if (lo !== 0) lo -= pad
  const x = (i: number) => PL + (months.length === 1 ? 0 : (i * (W - PL - PR)) / (months.length - 1))
  const y = (v: number) => PT + (H - PT - PB) * (1 - (v - lo) / (hi - lo))
  const path = (l: Line) => {
    const segs: string[] = []; let cur = ''
    months.forEach((m, i) => {
      const v = val(l, m)
      if (v === null) { if (cur) segs.push(cur); cur = ''; return }
      cur += `${cur ? ' L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
    })
    if (cur) segs.push(cur)
    return segs
  }
  const ticks = [lo, lo + (hi - lo) / 2, hi]
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-t`}>
        <title id={`${id}-t`}>{`${title}, ${shortMonth(months[0])} to ${shortMonth(months[months.length - 1])}`}</title>
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} className="pf-chart__grid" />
            <text x={PL - 6} y={y(v) + 4} textAnchor="end" className="pf-chart__axis">{fmtNum(v, kind)}</text>
          </g>
        ))}
        {months.map((m, i) => (i % 2 === 0 || i === months.length - 1) && (
          <text key={m} x={x(i)} y={H - 10} textAnchor={i === 0 ? 'start' : i === months.length - 1 ? 'end' : 'middle'} className="pf-chart__axis">{shortMonth(m)}</text>
        ))}
        {limit && <line x1={PL} x2={W - PR} y1={y(limit.value)} y2={y(limit.value)} className="co-limit"><title>{`${limit.label} ${fmtNum(limit.value, kind)}`}</title></line>}
        {lines.map(l => path(l).map((d, i) => <path key={l.id + i} d={d} className={`co-line co-line--${l.cls}`} data-line={l.id} />))}
        {lines.filter(l => l.dots).map(l => months.map((m, i) => {
          const v = val(l, m)
          return v === null ? null : <circle key={l.id + m} cx={x(i)} cy={y(v)} r={2.5} className="co-dot"><title>{`${l.label}, ${shortMonth(m)}: ${fmtNum(v, kind)}`}</title></circle>
        }))}
      </svg>
      <ul className="co-legend">
        {lines.map(l => <li key={l.id}><span className={`co-key co-key--${l.cls}`} aria-hidden="true" />{l.label}</li>)}
        {limit && <li><span className="co-key co-key--limit" aria-hidden="true" />{limit.label} {fmtNum(limit.value, kind)}</li>}
      </ul>
      <table className="ds-visually-hidden">
        <caption>{title} by month</caption>
        <thead><tr><th scope="col">Month</th>{lines.map(l => <th key={l.id} scope="col">{l.label}</th>)}</tr></thead>
        <tbody>{months.map(m => <tr key={m}><th scope="row">{shortMonth(m)}</th>{lines.map(l => <td key={l.id}>{fmtNum(val(l, m), kind)}</td>)}</tr>)}</tbody>
      </table>
    </>
  )
}

/** Closing balance bars over a fixed run of months; months with no loaded report are grey slots. */
type BarProps = { title: string; months: Month[]; values: Map<Month, number>; limit?: number | null; wide?: boolean }

export function BalanceBars(props: BarProps) {
  return <ChartFrame title={props.title} wide={props.wide} render={size => <BarDrawing {...props} size={size} />} />
}

function BarDrawing({ title, months, values, limit, size }: BarProps & { size: Size }) {
  const id = useId()
  const { W, H } = DIMS[size]
  const vals = [...values.values()]
  if (limit) vals.push(limit)
  const hi = Math.max(1, ...vals) * 1.06
  const step = (W - PL - PR) / Math.max(1, months.length)
  const bw = Math.max(4, step * 0.6)
  const y = (v: number) => PT + (H - PT - PB) * (1 - v / hi)
  const base = y(0)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-t`}>
      <title id={`${id}-t`}>{`${title}: ${values.size} of ${months.length} months loaded`}</title>
      {[0, hi / 2, hi].map((v, i) => (
        <g key={i}>
          <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} className="pf-chart__grid" />
          <text x={PL - 6} y={y(v) + 4} textAnchor="end" className="pf-chart__axis">{fmtNum(v, 'money')}</text>
        </g>
      ))}
      {limit ? <line x1={PL} x2={W - PR} y1={y(limit)} y2={y(limit)} className="co-limit"><title>{`Program limit ${fmtNum(limit, 'money')}`}</title></line> : null}
      {months.map((m, i) => {
        const cx = PL + step * i + step / 2
        const v = values.get(m)
        return (
          <g key={m}>
            {v === undefined
              ? <rect x={cx - bw / 2} y={base - 4} width={bw} height={4} className="co-bar--empty" data-empty={m}><title>{`${shortMonth(m)}: not loaded`}</title></rect>
              : <rect x={cx - bw / 2} y={y(v)} width={bw} height={Math.max(0, base - y(v))} className="co-bar" data-month={m}><title>{`${shortMonth(m)}: ${fmtNum(v, 'money')}`}</title></rect>}
            {(i % 2 === 0 || i === months.length - 1) && <text x={cx} y={H - 10} textAnchor="middle" className="pf-chart__axis">{shortMonth(m)}</text>}
          </g>
        )
      })}
    </svg>
  )
}
