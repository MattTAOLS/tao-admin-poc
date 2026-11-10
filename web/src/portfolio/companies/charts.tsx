/** Small inline-SVG charts for the company profile, drawn with tokens only. Every chart carries a visually hidden table
 * with the same numbers for screen readers, and each point has a hover title. No figure is computed here: the lines are
 * the series the API sends (MetricSeries, LossPeer, period_history). */
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { Button, Dialog } from '@/design/components'
import { fmtNum } from '../Num'
import type { NumKind } from '../fmt'
import type { Month, SeriesPoint } from './types'
import { shortMonth } from './util'

export type Line = { id: string; label: string; cls: 'deal' | 'median' | 'mean' | 'alt' | 'peer'; points: SeriesPoint[]; dots?: boolean }
const PL = 58, PR = 14, PT = 12, PB = 30
type Dims = { W: number; H: number }
/** A chart on the page: every company chart uses the same drawing size, so the three-column grid lines up. */
const CARD: Dims = { W: 560, H: 200 }
/** Full screen before the dialog has been measured (and in tests, where nothing has a size). */
const FULL_FALLBACK: Dims = { W: 1100, H: 440 }
/** Room under the drawing in full screen for the legend. */
const FULL_LEGEND = 72

/** The chart with a Full screen button above it. Full screen opens a dialog that fills the window and redraws the same
 * chart at the measured size of that space, so the lines get bigger while the axis text and the legend stay readable. */
function ChartFrame({ title, render }: { title: string; render: (dims: Dims, full: boolean) => ReactNode }) {
  const [full, setFull] = useState(false)
  return (
    <div className="co-plot">
      <div className="co-plot__bar">
        <Button type="button" variant="ghost" size="sm" icon={<FullIcon />} onClick={() => setFull(true)} aria-label={`Full screen: ${title}`}>Full screen</Button>
      </div>
      {render(CARD, false)}
      <Dialog open={full} onClose={() => setFull(false)} title={title} size="lg">
        {full && <FullArea render={render} />}
      </Dialog>
    </div>
  )
}

function FullArea({ render }: { render: (dims: Dims, full: boolean) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState<Dims | null>(null)
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current
      const w = el?.clientWidth ?? 0, h = el?.clientHeight ?? 0
      setDims(w > 0 && h > FULL_LEGEND + 120 ? { W: Math.round(w), H: Math.round(h - FULL_LEGEND) } : FULL_FALLBACK)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  return <div ref={ref} className="co-plot co-plot--full">{dims && render(dims, true)}</div>
}

const FullIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 9V4h5" /><path d="M20 9V4h-5" /><path d="M4 15v5h5" /><path d="M20 15v5h-5" />
  </svg>
)

/** Hover and keyboard readout shared by both charts. The pointer picks the nearest month (indexAt maps a viewBox x to
 * a month index); with the chart focused, Left/Right/Home/End move along the months and Escape clears. The readout is
 * visual only (aria-hidden): screen readers get the visually hidden table with the same numbers. */
function useReadout(count: number, W: number, indexAt: (vx: number) => number) {
  const [at, setAt] = useState<number | null>(null)
  const ref = useRef<SVGSVGElement>(null)
  const clamp = (i: number) => Math.max(0, Math.min(count - 1, i))
  const props = {
    ref,
    tabIndex: 0,
    onMouseMove: (e: MouseEvent<SVGSVGElement>) => {
      const r = ref.current?.getBoundingClientRect()
      if (!r || !r.width) return
      setAt(clamp(indexAt(((e.clientX - r.left) * W) / r.width)))
    },
    onMouseLeave: () => setAt(null),
    onBlur: () => setAt(null),
    onKeyDown: (e: KeyboardEvent<SVGSVGElement>) => {
      const k = e.key
      if (k === 'Escape') { setAt(null); return }
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(k)) return
      e.preventDefault()
      setAt(a => k === 'Home' ? 0 : k === 'End' ? count - 1 : clamp((a ?? (k === 'ArrowLeft' ? count : -1)) + (k === 'ArrowRight' ? 1 : -1)))
    },
  }
  return { at, props }
}

type TipRow = { key: string; cls: string; label: string; value: string }

/** Where the readout box goes, all in the same pixel frame: `guide` is the hovered month's x, `tip` the box width,
 * `min`..`max` the space it may use (the chart's card, cut to the window). Right of the guide when it fits, else left
 * of it, else clamped inside the space on the roomier side. Returns the box's left edge. */
export function tipPlacement({ guide, tip, min, max, gap = 14 }: { guide: number; tip: number; min: number; max: number; gap?: number }): { side: 'left' | 'right'; left: number } {
  const right = guide + gap, left = guide - gap - tip
  if (right + tip <= max) return { side: 'right', left: right }
  if (left >= min) return { side: 'left', left }
  const side = max - guide >= guide - min ? 'right' : 'left'
  return { side, left: Math.max(min, Math.min(max - tip, side === 'right' ? right : left)) }
}
const TIP_MARGIN = 8

/** The readout box beside the hovered month. It is measured against the chart's card and the window and placed by
 * tipPlacement, so it is never cut off at the window edge (audit L20). Before it has a size (first paint, tests) it
 * flips to the left of the guide in the right half of the chart. */
function Tip({ x, W, month, rows }: { x: number; W: number; month: string; rows: TipRow[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ side: 'left' | 'right'; left: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current, wrap = el?.parentElement
    if (!el || !wrap) return
    const w = wrap.getBoundingClientRect(), tip = el.offsetWidth
    if (!w.width || !tip) { setPos(null); return }
    const box = (wrap.closest('.ds-dialog, .ds-card') ?? wrap).getBoundingClientRect()
    const vw = document.documentElement.clientWidth || window.innerWidth
    const p = tipPlacement({ guide: w.left + (x / W) * w.width, tip, min: Math.max(box.left, 0) + TIP_MARGIN, max: Math.min(box.right, vw) - TIP_MARGIN })
    setPos({ side: p.side, left: p.left - w.left })
  }, [x, W, month, rows.length])
  const side = pos ? pos.side : x > W / 2 ? 'left' : 'right'
  return (
    <div ref={ref} className={`co-tip${side === 'left' ? ' co-tip--left' : ''}${pos ? ' co-tip--placed' : ''}`} style={{ left: pos ? `${pos.left}px` : `${(x / W) * 100}%` }}
      aria-hidden="true" data-testid="chart-tip">
      <b>{month}</b>
      <ul>
        {rows.map(r => <li key={r.key}><span className={`co-key co-key--${r.cls}`} /><span>{r.label}</span><span className="co-tip__num">{r.value}</span></li>)}
      </ul>
    </div>
  )
}

export function unitKind(unit: string): NumKind {
  return unit === 'fraction' ? 'pct' : unit === 'currency' ? 'money' : 'ratio'
}

type LineProps = { title: string; months: Month[]; lines: Line[]; limit?: { value: number; label: string } | null; kind: NumKind }

export function LineChart(props: LineProps) {
  const { title, months, lines, limit } = props
  const has = lines.some(l => months.some(m => l.points.some(p => p.month === m && p.value !== null))) || !!limit
  if (!has || !months.length) return <p className="pf-muted">No values reported for this period.</p>
  return <ChartFrame title={title} render={dims => <LineDrawing {...props} dims={dims} />} />
}

function LineDrawing({ title, months, lines, limit, kind, dims }: LineProps & { dims: Dims }) {
  const id = useId()
  const { W, H } = dims
  const span = months.length === 1 ? 1 : (W - PL - PR) / (months.length - 1)
  const { at, props: hover } = useReadout(months.length, W, vx => Math.round((vx - PL) / span))
  const atMonth = at === null ? null : months[at]
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
      <div className="co-svgwrap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-t`} {...hover}>
        <title id={`${id}-t`}>{`${title}, ${shortMonth(months[0])} to ${shortMonth(months[months.length - 1])}`}</title>
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} className="pf-chart__grid" />
            <text x={PL - 6} y={y(v) + 4} textAnchor="end" className="pf-chart__axis">{fmtNum(v, kind)}</text>
          </g>
        ))}
        {months.map((m, i) => (W >= 900 || i % 2 === 0 || i === months.length - 1) && (
          <text key={m} x={x(i)} y={H - 10} textAnchor={i === 0 ? 'start' : i === months.length - 1 ? 'end' : 'middle'} className="pf-chart__axis">{shortMonth(m)}</text>
        ))}
        {limit && <line x1={PL} x2={W - PR} y1={y(limit.value)} y2={y(limit.value)} className="co-limit" />}
        {lines.map(l => path(l).map((d, i) => <path key={l.id + i} d={d} className={`co-line co-line--${l.cls}`} data-line={l.id} />))}
        {lines.filter(l => l.dots).map(l => months.map((m, i) => {
          const v = val(l, m)
          return v === null ? null : <circle key={l.id + m} cx={x(i)} cy={y(v)} r={2.5} className="co-dot" />
        }))}
        {at !== null && atMonth !== null && (
          <g className="co-hover" aria-hidden="true">
            <line x1={x(at)} x2={x(at)} y1={PT} y2={H - PB} className="co-hover__guide" />
            {lines.map(l => {
              const v = val(l, atMonth)
              return v === null ? null : <circle key={l.id} cx={x(at)} cy={y(v)} r={4.5} className={`co-hover__dot co-hover__dot--${l.cls}`} data-hover={l.id} />
            })}
          </g>
        )}
      </svg>
      {at !== null && atMonth !== null && (
        <Tip x={x(at)} W={W} month={shortMonth(atMonth)} rows={[
          ...lines.map(l => ({ key: l.id, cls: l.cls, label: l.label, value: fmtNum(val(l, atMonth), kind) })),
          ...(limit ? [{ key: 'limit', cls: 'limit', label: limit.label, value: fmtNum(limit.value, kind) }] : []),
        ]} />
      )}
      </div>
      <ul className="co-legend">
        {lines.map(l => <li key={l.id}><span className={`co-key co-key--${l.cls}`} aria-hidden="true" />{l.label}</li>)}
        {limit && <li><span className="co-key co-key--limit" aria-hidden="true" />{limit.label} {fmtNum(limit.value, kind)}</li>}
      </ul>
      {/* The div is hidden, not the table: a table ignores width: 1px and would widen the page (audit M18). */}
      <div className="ds-visually-hidden" data-testid="chart-table">
        <table>
          <caption>{title} by month</caption>
          <thead><tr><th scope="col">Month</th>{lines.map(l => <th key={l.id} scope="col">{l.label}</th>)}</tr></thead>
          <tbody>{months.map(m => <tr key={m}><th scope="row">{shortMonth(m)}</th>{lines.map(l => <td key={l.id}>{fmtNum(val(l, m), kind)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </>
  )
}

/** Closing balance bars over a fixed run of months; months with no loaded report are grey slots. */
type BarProps = { title: string; months: Month[]; values: Map<Month, number>; limit?: number | null }

export function BalanceBars(props: BarProps) {
  return <ChartFrame title={props.title} render={dims => <BarDrawing {...props} dims={dims} />} />
}

function BarDrawing({ title, months, values, limit, dims }: BarProps & { dims: Dims }) {
  const id = useId()
  const { W, H } = dims
  const vals = [...values.values()]
  if (limit) vals.push(limit)
  const hi = Math.max(1, ...vals) * 1.06
  const step = (W - PL - PR) / Math.max(1, months.length)
  const bw = Math.max(4, step * 0.6)
  const y = (v: number) => PT + (H - PT - PB) * (1 - v / hi)
  const base = y(0)
  const { at, props: hover } = useReadout(months.length, W, vx => Math.floor((vx - PL) / step))
  const atMonth = at === null ? null : months[at]
  const cxAt = (i: number) => PL + step * i + step / 2
  return (
    <div className="co-svgwrap">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-t`} {...hover}>
      <title id={`${id}-t`}>{`${title}: ${values.size} of ${months.length} months loaded`}</title>
      {[0, hi / 2, hi].map((v, i) => (
        <g key={i}>
          <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} className="pf-chart__grid" />
          <text x={PL - 6} y={y(v) + 4} textAnchor="end" className="pf-chart__axis">{fmtNum(v, 'money')}</text>
        </g>
      ))}
      {limit ? <line x1={PL} x2={W - PR} y1={y(limit)} y2={y(limit)} className="co-limit" /> : null}
      {months.map((m, i) => {
        const cx = cxAt(i)
        const v = values.get(m)
        const on = at === i ? ' is-hover' : ''
        return (
          <g key={m}>
            {v === undefined
              ? <rect x={cx - bw / 2} y={base - 4} width={bw} height={4} className={`co-bar--empty${on}`} data-empty={m} />
              : <rect x={cx - bw / 2} y={y(v)} width={bw} height={Math.max(0, base - y(v))} className={`co-bar${on}`} data-month={m} />}
            {(W >= 900 || i % 2 === 0 || i === months.length - 1) && <text x={cx} y={H - 10} textAnchor="middle" className="pf-chart__axis">{shortMonth(m)}</text>}
          </g>
        )
      })}
    </svg>
    {at !== null && atMonth !== null && (
      <Tip x={cxAt(at)} W={W} month={shortMonth(atMonth)} rows={[
        { key: 'bal', cls: 'deal', label: 'Closing balance', value: values.has(atMonth) ? fmtNum(values.get(atMonth)!, 'money') : 'Not loaded' },
        ...(limit ? [{ key: 'limit', cls: 'limit', label: 'Program limit', value: fmtNum(limit, 'money') }] : []),
      ]} />
    )}
    </div>
  )
}
