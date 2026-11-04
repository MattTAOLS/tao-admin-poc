import { DataTable, formatPeriod, type Column } from '@/design/components'
import type { NumKind } from './fmt'
import { Num } from './Num'
import type { DataCorrection } from './types'

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

/** Data corrections recorded on the published deal (deal.data_corrections), as published; nothing is recomputed. */
export function CorrectionsTable({ rows }: { rows: DataCorrection[] }) {
  type R = { c: DataCorrection; i: number }
  const data: R[] = rows.map((c, i) => ({ c, i }))
  const val = (x: R, k: 'old_value' | 'new_value') => {
    const v = x.c[k]
    return typeof v === 'number' ? <Num v={v} kind={correctionKind(x.c)} field={`data_corrections.${x.i}.${k}`} /> : <span className="pf-num">{v === null || v === undefined ? '—' : String(v)}</span>
  }
  const cols: Column<R>[] = [
    { key: 'period', header: 'Period', render: x => <span className="pf-nowrap">{formatPeriod(x.c.period)}</span> },
    { key: 'field', header: 'Field', emphasis: true, render: x => correctionLabel(x.c) },
    { key: 'old', header: 'Was', numeric: true, render: x => val(x, 'old_value') },
    { key: 'new', header: 'Now', numeric: true, render: x => val(x, 'new_value') },
    { key: 'reason', header: 'Reason', render: x => <>
      <div>{x.c.reason || '—'}</div>
      {(x.c.rule_id || x.c.choice) && <div className="pf-muted pf-small">{[x.c.rule_id, x.c.choice && `kept ${CHOICE[x.c.choice] ?? x.c.choice}`].filter(Boolean).join(' · ')}</div>}
    </> },
    { key: 'applied', header: 'Applied', render: x => <span className="pf-nowrap">{typeof x.c.applied === 'string' ? x.c.applied : '—'}</span> },
  ]
  return <DataTable columns={cols} rows={data} rowKey={x => String(x.i)} caption="Data corrections" captionHidden density="compact" />
}
