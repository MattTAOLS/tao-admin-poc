import { Fragment, useState, type ReactNode } from 'react'
import { Card, CovenantPill, DataTable, formatPeriod, type Column } from '@/design/components'
import type { Extraction } from '../lib/types'
import { getPointer, provenance } from '../lib/provenance'
import { byFormat, count, covenantValue, money, pct, ratio, text, yesNo } from '../lib/format'
import type { ViewerTarget } from './PageImage'

type Open = (t: ViewerTarget) => void
type Fmt = (v: unknown) => ReactNode

/** Page link(s) for a value or a row, or "from published <period>" for months carried from an earlier publication. */
export function SourceRef({ ex, pointer, label, onOpen }: { ex: Extraction; pointer: string; label: string; onOpen: Open }) {
  const p = provenance(ex, pointer)
  if (p.kind === 'carried') return <span className="rv-carried">{p.label}</span>
  if (p.kind === 'none') return <span className="rv-carried">no source</span>
  return (
    <span className="rv-src">
      {p.pages.map(({ page, source, pointer: ptr }) => (
        <button key={page} type="button" className="rv-srclink" title={source.raw_text}
          aria-label={`${label}: open source page ${page}`}
          onClick={() => onOpen({ page, boxes: ptr === pointer && Array.isArray(source.bbox) && source.bbox.length === 4 ? [source.bbox] : [], tone: 'source', caption: label, raw: ptr === pointer ? source.raw_text : undefined })}>
          p. {page}
        </button>
      ))}
    </span>
  )
}

type KvItem = { label: string; ptr: string; fmt: Fmt } | { group: string }

function Kv({ ex, items, onOpen }: { ex: Extraction; items: KvItem[]; onOpen: Open }) {
  const present = items.filter(i => 'group' in i || getPointer(ex.deal, i.ptr) !== undefined)
  // Drop a group heading with nothing under it.
  const rows = present.filter((i, n) => !('group' in i) || (present[n + 1] && !('group' in present[n + 1])))
  let group = ''
  return (
    <div className="rv-kv">
      {rows.map((i, n) => {
        if ('group' in i) { group = i.group; return <div key={'g' + n} className="rv-kv__group">{i.group}</div> }
        const name = group ? `${group}, ${i.label}` : i.label
        return (
          <div key={i.ptr} className="rv-kv__row">
            <span className="rv-kv__label">{i.label}</span>
            <span className="rv-kv__value">{i.fmt(getPointer(ex.deal, i.ptr))}</span>
            <SourceRef ex={ex} pointer={i.ptr} label={name} onOpen={onOpen} />
          </div>
        )
      })}
    </div>
  )
}

type Row = Record<string, unknown> & { __i: number }
type ColSpec = { key: string; header: string; fmt: Fmt; numeric?: boolean; className?: string; render?: (r: Row) => ReactNode }

function RowTable({ ex, base, title, cols, onOpen, rowName, reverse }: {
  ex: Extraction; base: string; title: string; cols: ColSpec[]; onOpen: Open; rowName: (r: Row) => string; reverse?: boolean
}) {
  const list = getPointer(ex.deal, base)
  if (!Array.isArray(list) || list.length === 0) return <p className="rv-muted">No {title.toLowerCase()} in this extraction.</p>
  let rows: Row[] = list.map((r, i) => ({ ...(r as Record<string, unknown>), __i: i }))
  if (reverse) rows = rows.reverse()
  const columns: Column<Row>[] = [
    ...cols.map(c => ({ key: c.key, header: c.header, numeric: c.numeric, render: (r: Row) => <span className={c.className}>{c.render ? c.render(r) : c.fmt(r[c.key])}</span> })),
    { key: '__src', header: 'Source', align: 'right' as const, render: (r: Row) => <SourceRef ex={ex} pointer={`${base}/${r.__i}`} label={`${title}, ${rowName(r)}`} onOpen={onOpen} /> },
  ]
  return <div className="rv-scroll"><DataTable<Row> caption={title} captionHidden columns={columns} rows={rows} rowKey={r => String(r.__i)} density="compact" /></div>
}

const period: Fmt = v => (typeof v === 'string' ? formatPeriod(v) : text(v))

export const SECTIONS = [
  { id: 'balances', label: 'Balances' },
  { id: 'history', label: 'Trend' },
  { id: 'contracts', label: 'Contracts' },
  { id: 'aging', label: 'Aging' },
  { id: 'losses', label: 'Losses' },
  { id: 'covenants', label: 'Covenants' },
  { id: 'ratios', label: 'Ratios' },
] as const
type SectionId = (typeof SECTIONS)[number]['id']

/** The extracted deal object as sections that follow the SetRep pages, with a source link on every value or row.
 * Shows what the extraction holds; computes nothing. */
export function ExtractedValues({ ex, onOpen }: { ex: Extraction; onOpen: Open }) {
  const [only, setOnly] = useState<SectionId | 'all'>('all')
  const pages = (getPointer(ex.deal, '/source_pages') ?? {}) as Record<string, number | null>
  const pg = (k: string) => (pages[k] ? `page ${pages[k]}` : undefined)
  const show = (id: SectionId) => only === 'all' || only === id

  const body: Record<SectionId, { title: string; sub?: string; node: ReactNode }> = {
    balances: {
      title: 'Balances', sub: pg('tranche_balance'),
      node: <Kv ex={ex} onOpen={onOpen} items={[
        { group: 'Tranche balance' },
        { label: 'Opening', ptr: '/tranche_balance/opening', fmt: money },
        { label: 'Principal', ptr: '/tranche_balance/principal', fmt: money },
        { label: 'Principal prepayments', ptr: '/tranche_balance/principal_prepayments', fmt: money },
        { label: 'Defaults / losses', ptr: '/tranche_balance/losses', fmt: money },
        { label: 'Recoveries', ptr: '/tranche_balance/recoveries', fmt: money },
        { label: 'Interest', ptr: '/tranche_balance/interest', fmt: money },
        { label: 'Closing', ptr: '/tranche_balance/closing', fmt: money },
        { label: 'Change', ptr: '/tranche_balance/change_abs', fmt: money },
        { label: 'Change %', ptr: '/tranche_balance/change_pct', fmt: pct },
        { group: 'Tranche amount' },
        { label: 'Opening', ptr: '/tranche_amount/opening', fmt: money },
        { label: 'Closing', ptr: '/tranche_amount/closing', fmt: money },
        { group: 'Facility' },
        { label: 'Facility limit', ptr: '/program/program_limit', fmt: money },
        { label: 'Maximum facility limit', ptr: '/program/maximum_program_limit', fmt: money },
        { label: 'Amount outstanding', ptr: '/program/program_amount', fmt: money },
        { label: 'Unused facility', ptr: '/program/unused_facility', fmt: money },
        { label: 'Utilization', ptr: '/program/program_utilization_pct', fmt: pct },
        { group: 'Warehouse' },
        { label: 'Warehouse limit', ptr: '/warehouse/maximum_warehouse_facility_limit', fmt: money },
        { label: 'Opening advances', ptr: '/warehouse/opening_advances_outstanding', fmt: money },
        { label: 'Closing advances', ptr: '/warehouse/closing_advances_outstanding', fmt: money },
        { group: 'Enhancement' },
        { label: 'Total enhancement', ptr: '/total_enhancement/total_enhancement_amount', fmt: money },
        { label: 'Total enhancement %', ptr: '/total_enhancement/total_enhancement_pct', fmt: pct },
      ]} />,
    },
    history: {
      title: 'Roll-forward by month', sub: 'Earlier months come from the last publication when this upload does not print them',
      node: <RowTable ex={ex} onOpen={onOpen} base="/period_history" title="Roll-forward by month" rowName={r => period(r.period) as string} reverse cols={[
        { key: 'period', header: 'Period', fmt: period },
        { key: 'opening_balance', header: 'Opening', fmt: money, numeric: true },
        { key: 'principal', header: 'Principal', fmt: money, numeric: true },
        { key: 'principal_prepayments', header: 'Prepayments', fmt: money, numeric: true },
        { key: 'losses', header: 'Losses', fmt: money, numeric: true },
        { key: 'charge_off', header: 'Charge-off', fmt: money, numeric: true },
        { key: 'closing_balance', header: 'Closing', fmt: money, numeric: true },
        { key: 'closing_contracts', header: 'Contracts', fmt: count, numeric: true },
      ]} />,
    },
    contracts: {
      title: 'Contracts', sub: pg('outstanding_contracts'),
      node: <Kv ex={ex} onOpen={onOpen} items={[
        { label: 'Opening', ptr: '/contracts/opening', fmt: count },
        { label: 'Closing', ptr: '/contracts/closing', fmt: count },
        { label: 'Change', ptr: '/contracts/change_abs', fmt: count },
        { label: 'Change %', ptr: '/contracts/change_pct', fmt: pct },
        { label: 'Prior closing contracts', ptr: '/prior_closing_contracts', fmt: count },
        { label: 'Prior closing balance', ptr: '/prior_closing_tranche_balance', fmt: money },
      ]} />,
    },
    aging: {
      title: 'Aging', sub: pg('aging_summary'),
      node: <RowTable ex={ex} onOpen={onOpen} base="/aging_history" title="Aging" rowName={r => period(r.period) as string} cols={[
        { key: 'period', header: 'Period', fmt: period },
        { key: 'current_0_30', header: '0–30 days', fmt: money, numeric: true },
        { key: 'days_31_60', header: '31–60', fmt: money, numeric: true },
        { key: 'days_61_90', header: '61–90', fmt: money, numeric: true },
        { key: 'written_off', header: 'Written off', fmt: money, numeric: true },
        { key: 'closing_balance', header: 'Closing', fmt: money, numeric: true },
        { key: 'cumulative_net_losses', header: 'CNL', fmt: money, numeric: true },
        { key: 'reconciles', header: 'Reconciles', fmt: yesNo },
      ]} />,
    },
    losses: {
      title: 'Cumulative net losses by vintage', sub: pg('cumulative_losses'),
      node: <RowTable ex={ex} onOpen={onOpen} base="/cnl_by_period" title="Cumulative net losses by vintage" rowName={r => text(r.period) as string} cols={[
        { key: 'period', header: 'Vintage', fmt: text },
        { key: 'advance_range', header: 'Advances', fmt: text },
        { key: 'original_finance_contract_npv', header: 'Original NPV', fmt: money, numeric: true },
        { key: 'gross_losses', header: 'Gross losses', fmt: money, numeric: true },
        { key: 'actual_recoveries', header: 'Recoveries', fmt: money, numeric: true },
        { key: 'estimated_recoveries', header: 'Est. recoveries', fmt: money, numeric: true },
        { key: 'cumulative_net_losses', header: 'CNL', fmt: money, numeric: true },
        { key: 'cnl_ratio_pct', header: 'CNL ratio', fmt: pct, numeric: true },
        { key: 'cnl_limit', header: 'Limit', fmt: pct, numeric: true },
        { key: 'cnl_within_limit', header: 'Within', fmt: yesNo },
      ]} />,
    },
    covenants: {
      title: 'Covenants', sub: pg('quantitative_tests'),
      node: <CovenantTable ex={ex} onOpen={onOpen} />,
    },
    ratios: {
      title: 'Financial ratios', sub: pg('financial_ratios'),
      node: (
        <>
          <RowTable ex={ex} onOpen={onOpen} base="/financial_ratios" title="Financial ratios" rowName={r => text(r.label) as string} cols={[
            { key: 'group', header: 'Group', fmt: text },
            { key: 'label', header: 'Ratio', fmt: text },
            { key: 'value', header: 'Value', fmt: text, numeric: true, render: r => byFormat(r.value, r.format) },
            { key: 'vintage', header: 'Vintage', fmt: text },
          ]} />
          <div className="rv-gap" />
          <RowTable ex={ex} onOpen={onOpen} base="/ratio_history" title="Ratio history" rowName={r => text(r.month) as string} reverse cols={[
            { key: 'month', header: 'Month', fmt: text },
            { key: 'delinquency_ratio_pct', header: 'Delinquency', fmt: pct, numeric: true },
            { key: 'rolling_3month_loss_ratio_pct', header: 'Rolling 3-mo loss', fmt: pct, numeric: true },
            { key: 'rolling_12month_loss_ratio_pct', header: 'Rolling 12-mo loss', fmt: pct, numeric: true },
            { key: 'interest_coverage_ratio', header: 'ICR', fmt: ratio, numeric: true },
            { key: 'debt_equity_ratio', header: 'Leverage', fmt: ratio, numeric: true },
            { key: 'total_equity', header: 'Total equity', fmt: money, numeric: true },
          ]} />
        </>
      ),
    },
  }

  return (
    <Card title="Extracted values" subtitle="What the extraction read, by SetRep section. Every value links to its page."
      actions={
        <div className="rv-sections" role="group" aria-label="Show section">
          <button type="button" className="rv-chip" aria-pressed={only === 'all'} onClick={() => setOnly('all')}>All</button>
          {SECTIONS.map(s => <button key={s.id} type="button" className="rv-chip" aria-pressed={only === s.id} onClick={() => setOnly(s.id)}>{s.label}</button>)}
        </div>
      }>
      {SECTIONS.filter(s => show(s.id)).map((s, i) => (
        <Fragment key={s.id}>
          <section aria-labelledby={`rv-sec-${s.id}`} className="rv-section" >
            <h3 id={`rv-sec-${s.id}`} className="rv-section__title">{body[s.id].title}{body[s.id].sub && <span className="rv-muted"> · {body[s.id].sub}</span>}</h3>
            {body[s.id].node}
          </section>
        </Fragment>
      ))}
    </Card>
  )
}

function CovenantTable({ ex, onOpen }: { ex: Extraction; onOpen: Open }) {
  const list = getPointer(ex.deal, '/covenants')
  if (!Array.isArray(list) || list.length === 0) return <p className="rv-muted">No covenants in this extraction.</p>
  type C = Record<string, unknown> & { __i: number }
  const rows: C[] = list.map((c, i) => ({ ...(c as Record<string, unknown>), __i: i }))
  const columns: Column<C>[] = [
    { key: 'legal_ref', header: 'Ref', render: c => text(c.legal_ref), emphasis: true },
    { key: 'description', header: 'Test', render: c => <span className="rv-desc">{text(c.description)}</span> },
    { key: 'kind', header: 'Kind', render: c => text(c.kind) },
    { key: 'current_value', header: 'Value', numeric: true, render: c => covenantValue(c.current_value, c.threshold) },
    { key: 'threshold', header: 'Threshold', numeric: true, render: c => covenantValue(c.threshold, c.threshold) },
    { key: 'utilization_pct', header: 'Utilization', numeric: true, render: c => pct(c.utilization_pct) },
    { key: 'status', header: 'Status', render: c => (c.status ? <CovenantPill status={String(c.status)} size="sm" /> : '—') },
    { key: 'reported_triggered', header: 'Report says', render: c => text(c.reported_triggered) },
    { key: '__src', header: 'Source', align: 'right', render: c => <SourceRef ex={ex} pointer={`/covenants/${c.__i}`} label={`Covenant ${text(c.legal_ref)}`} onOpen={onOpen} /> },
  ]
  return <div className="rv-scroll"><DataTable<C> caption="Covenants" captionHidden columns={columns} rows={rows} rowKey={c => String(c.__i)} density="compact" /></div>
}
