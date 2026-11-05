import { useId, useState } from 'react'
import { Button, DataTable, StatusPill, formatPeriod, type Column } from '@/design/components'
import type { NumKind } from './fmt'
import { Num } from './Num'
import type { DataCorrection } from './types'
import { versionDate } from './Versions'

const RECORD: Record<string, string> = {
  period_history: 'Balance history', tranche_balance: 'Balance', tranche_amount: 'Amount', contracts: 'Contracts',
  aging_history: 'Aging', cnl_by_period: 'CNL by vintage', covenants: 'Covenant', financial_ratios: 'Ratio',
  ratio_history: 'Ratio history', program: 'Facility', warehouse: 'Warehouse', total_enhancement: 'Enhancement',
}
const FIELD: Record<string, string> = {
  opening_balance: 'Opening balance', closing_balance: 'Closing balance', opening: 'Opening', closing: 'Closing',
  opening_amount: 'Opening amount', closing_amount: 'Closing amount', principal: 'Principal', principal_prepayments: 'Prepayments',
  losses: 'Losses', interest: 'Interest', recoveries: 'Recoveries', charge_off: 'Charge-off',
  opening_contracts: 'Opening contracts', closing_contracts: 'Closing contracts', current_0_30: 'Current (0–30)',
  days_31_60: '31–60 days', days_61_90: '61–90 days', written_off: 'Written off', cumulative_net_losses: 'Cumulative net losses',
  cnl_ratio_pct: 'CNL ratio', current_value: 'Value', threshold: 'Threshold', utilization_pct: 'Utilization', value: 'Value',
  program_amount: 'Drawn', program_limit: 'Facility limit', program_utilization_pct: 'Utilization', unused_facility: 'Unused facility',
  closing_advances_outstanding: 'Warehouse advances (closing)', opening_advances_outstanding: 'Warehouse advances (opening)',
  total_enhancement_amount: 'Total enhancement', total_enhancement_pct: 'Enhancement %',
}
const humanize = (k: string) => (k.charAt(0).toUpperCase() + k.slice(1)).replace(/_/g, ' ')

/** "Balance history · Interest" from record "period_history" and field "interest" or "3/closing_balance". */
export function correctionLabel(c: Pick<DataCorrection, 'record' | 'field'>) {
  const leaf = String(c.field ?? '').split('/').filter(s => !/^\d+$/.test(s)).pop() ?? ''
  const rec = RECORD[c.record] ?? humanize(String(c.record ?? ''))
  return leaf ? `${rec} · ${FIELD[leaf] ?? humanize(leaf)}` : rec
}

/** Display unit of a corrected value, from its field name. */
export function correctionKind(c: Pick<DataCorrection, 'record' | 'field'>): NumKind {
  const leaf = String(c.field ?? '').split('/').pop() ?? ''
  if (/_pct$|ratio_pct|utilization/.test(leaf)) return 'pct'
  if (/contracts$/.test(leaf) || c.record === 'contracts') return 'count'
  if (/_ratio$/.test(leaf)) return 'ratio'
  return 'money'
}

const CHOICE: Record<string, string> = { use_ours: 'our recomputation', use_report: 'the report value' }

/** A TAO Admin's own value edit (ValueEdit, choice `manual`), in review or as a post-publish correction. */
export const isManual = (c: Pick<DataCorrection, 'choice'>) => c.choice === 'manual'

/** The day a correction was applied: `applied` as recorded, else the edit's timestamp. */
export function correctionDate(c: Pick<DataCorrection, 'applied' | 'at'>): string {
  if (typeof c.applied === 'string' && c.applied) return c.applied
  return c.at ? versionDate(c.at) : '—'
}

type Entry = { c: DataCorrection; i: number }
export type CorrectionGroup = { key: string; primary: Entry; copies: Entry[] }

/** One finding's choice is written to every copy of the value (e.g. tranche_balance/closing and
 * period_history/<i>/closing_balance), so the API appends one entry per pointer. Group them: by finding_id, or, when
 * it is absent (the reference deals), by period + reason + old and new value. Order follows the first entry. */
export function groupCorrections(rows: DataCorrection[]): CorrectionGroup[] {
  const groups = new Map<string, CorrectionGroup>()
  rows.forEach((c, i) => {
    const key = c.finding_id ? `f:${c.finding_id}` : c.edit_id ? `e:${c.edit_id}` : `v:${c.period}|${c.reason ?? ''}|${JSON.stringify(c.old_value)}|${JSON.stringify(c.new_value)}`
    const g = groups.get(key)
    if (g) g.copies.push({ c, i }); else groups.set(key, { key, primary: { c, i }, copies: [] })
  })
  return [...groups.values()]
}

function CopiesToggle({ g }: { g: CorrectionGroup }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const n = g.copies.length
  const same = (e: Entry) => e.c.old_value === g.primary.c.old_value && e.c.new_value === g.primary.c.new_value
  return (
    <>
      <Button size="sm" aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)} className="pf-copies">+{n} {n === 1 ? 'copy' : 'copies'}</Button>
      {open && (
        <ul id={id} className="pf-copylist" aria-label="Same correction written to">
          {g.copies.map(e => (
            <li key={e.i}>{correctionLabel(e.c)}{!same(e) && <> · <Value e={e} k="old_value" /> → <Value e={e} k="new_value" /></>}</li>
          ))}
        </ul>
      )}
    </>
  )
}

function Value({ e, k }: { e: Entry; k: 'old_value' | 'new_value' }) {
  const v = e.c[k]
  return typeof v === 'number'
    ? <Num v={v} kind={correctionKind(e.c)} field={`data_corrections.${e.i}.${k}`} />
    : <span className="pf-num">{v === null || v === undefined ? '—' : String(v)}</span>
}

/** Data corrections recorded on the published deal (deal.data_corrections), as published; nothing is recomputed. */
export function CorrectionsTable({ rows }: { rows: DataCorrection[] }) {
  const data = groupCorrections(rows)
  const cols: Column<CorrectionGroup>[] = [
    { key: 'period', header: 'Period', render: g => <span className="pf-nowrap">{formatPeriod(g.primary.c.period)}</span> },
    { key: 'field', header: 'Field', emphasis: true, render: g => <>{correctionLabel(g.primary.c)}{g.copies.length > 0 && <> <CopiesToggle g={g} /></>}</> },
    { key: 'old', header: 'Was', numeric: true, render: g => <Value e={g.primary} k="old_value" /> },
    { key: 'new', header: 'Now', numeric: true, render: g => <Value e={g.primary} k="new_value" /> },
    { key: 'reason', header: 'Reason', render: ({ primary: { c } }) => <>
      <div>{c.reason || '—'}</div>
      {isManual(c)
        ? <div className="pf-manual"><StatusPill tone="blue" size="sm">Corrected by TAO</StatusPill>{typeof c.version === 'number' && <span className="pf-muted pf-small">version {c.version}</span>}</div>
        : (c.rule_id || c.choice) && <div className="pf-muted pf-small">{[c.rule_id, c.choice && `kept ${CHOICE[c.choice] ?? c.choice}`].filter(Boolean).join(' · ')}</div>}
    </> },
    { key: 'applied', header: 'Applied', render: ({ primary: { c } }) => <span className="pf-nowrap">{correctionDate(c)}</span> },
  ]
  return <DataTable columns={cols} rows={data} rowKey={g => g.key} caption="Data corrections" captionHidden density="compact" />
}
