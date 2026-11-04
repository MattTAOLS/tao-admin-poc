import { useId, useState } from 'react'
import { Button, Card, DataTable, StatusPill, type Column } from '@/design/components'
import { Num } from './Num'
import type { Deal, Obligor } from './types'

const over = (o: Obligor) => (o.excess_concentration_amount ?? 0) > 0
const has = (v: unknown) => typeof v === 'number' && Number.isFinite(v)

/** Top 10 obligor concentration (reference renderer top10Panel): collapsed by default, nothing at all when the deal
 * carries no top10_obligors (F-PIL, Meridian). A deal reporting by currency (Finloc) gets CAD and USD columns next to
 * the published total, which is what the concentration percentage is measured on. */
export function Top10Panel({ d }: { d: Deal }) {
  const rows = d.top10_obligors ?? []
  const [open, setOpen] = useState(false)
  const id = useId()
  if (!rows.length) return null
  const split = rows.some(o => has(o.aggregate_cad_contract_amount) || has(o.aggregate_usd_contract_amount))
  const page = d.source_pages?.top10_obligor
  const flagged = rows.filter(over).length
  type R = { o: Obligor; i: number }
  const data: R[] = rows.map((o, i) => ({ o, i }))
  const f = (i: number, k: string) => `top10_obligors.${i}.${k}`
  const total = (x: R) => has(x.o.aggregate_contract_amount)
    ? <Num v={x.o.aggregate_contract_amount} kind="money" field={f(x.i, 'aggregate_contract_amount')} />
    : <Num v={split ? (x.o.aggregate_cad_contract_amount ?? 0) + (x.o.aggregate_usd_contract_amount ?? 0) : null} kind="money" />
  const cols: Column<R>[] = [
    { key: 'rank', header: 'Rank', numeric: true, render: x => <Num v={x.o.rank} kind="count" field={f(x.i, 'rank')} /> },
    { key: 'name', header: 'Obligor', emphasis: true, render: x => <span className="pf-nowrap">{x.o.obligor_name}{over(x.o) && <StatusPill tone="bad" size="sm" className="pf-asof">Over limit</StatusPill>}</span> },
    ...(split ? [
      { key: 'cad', header: 'CAD amount', numeric: true, render: (x: R) => <Num v={x.o.aggregate_cad_contract_amount} kind="money" field={f(x.i, 'aggregate_cad_contract_amount')} /> },
      { key: 'usd', header: 'USD amount', numeric: true, render: (x: R) => <Num v={x.o.aggregate_usd_contract_amount} kind="money" field={f(x.i, 'aggregate_usd_contract_amount')} /> },
    ] as Column<R>[] : []),
    { key: 'amount', header: split ? 'Total contract amount' : 'Contract amount', numeric: true, render: total },
    { key: 'pct', header: 'Concentration', numeric: true, render: x => <Num v={x.o.obligor_concentration_pct} kind="pct" field={f(x.i, 'obligor_concentration_pct')} /> },
    { key: 'limit', header: 'Limit', numeric: true, render: x => x.o.concentration_limit_desc
      ? <span className="pf-nowrap">{x.o.concentration_limit_desc}</span>
      : <Num v={x.o.concentration_limit_pct} kind="pct" field={has(x.o.concentration_limit_pct) ? f(x.i, 'concentration_limit_pct') : undefined} /> },
    { key: 'per', header: 'Limit per obligor', numeric: true, render: x => <Num v={x.o.concentration_limit_per_obligor} kind="money" field={f(x.i, 'concentration_limit_per_obligor')} /> },
    { key: 'excess', header: 'Excess', numeric: true, render: x => <Num v={x.o.excess_concentration_amount} kind="money" field={f(x.i, 'excess_concentration_amount')} className={over(x.o) ? 'pf-strong' : 'pf-muted'} /> },
  ]
  const sub = [
    flagged ? `${flagged} of ${rows.length} obligors over the concentration limit` : `${rows.length} largest obligors, all within the concentration limit`,
    split ? 'amounts by currency as reported; concentration is on the total' : null,
    page ? `source page ${page}` : null,
  ].filter(Boolean).join(' · ')
  return (
    <Card title="Top 10 obligor concentration" subtitle={sub} padding="flush"
      actions={<Button size="sm" aria-expanded={open} aria-controls={id} onClick={() => setOpen(v => !v)}>{open ? 'Hide' : 'Show'} obligors</Button>}>
      <div id={id} hidden={!open}>
        {open && <DataTable columns={cols} rows={data} rowKey={x => String(x.i)} caption="Top 10 obligor concentration" captionHidden density="compact" />}
      </div>
    </Card>
  )
}
