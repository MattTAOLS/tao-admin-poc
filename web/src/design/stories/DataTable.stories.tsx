import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { DataTable, Card, Button, CovenantPill, formatCurrency, formatPercent, formatNumber, type Column } from '../components'
import { programMove, num, type DealDash, type Covenant } from './fixtures'

const meta: Meta = { title: 'Design System/DataTable', tags: ['autodocs'] }
export default meta
type S = StoryObj

const deals = programMove.deals
const total = deals.reduce((a, d) => a + d.tranche_balance.closing, 0)
const dealCols: Column<DealDash>[] = [
  { key: 'deal', header: 'Deal', emphasis: true, render: d => d.deal_name, sortValue: d => d.deal_name, footer: 'Total' },
  { key: 'status', header: 'Status', render: d => <CovenantPill status={d.worst_status} size="sm" />, sortValue: d => ({ BREACH: 0, WATCH: 1, OK: 2 } as Record<string, number>)[d.worst_status] ?? 3 },
  { key: 'opening', header: 'Opening', numeric: true, render: d => formatCurrency(d.tranche_balance.opening), sortValue: d => d.tranche_balance.opening },
  { key: 'closing', header: 'Closing', numeric: true, render: d => formatCurrency(d.tranche_balance.closing), sortValue: d => d.tranche_balance.closing, footer: formatCurrency(total) },
  { key: 'chg', header: 'Change', numeric: true, render: d => formatPercent(d.tranche_balance.change_pct), sortValue: d => d.tranche_balance.change_pct },
]

const covCols: Column<Covenant>[] = [
  { key: 'ref', header: 'Legal ref', emphasis: true, render: c => c.legal_ref },
  { key: 'desc', header: 'Covenant', render: c => c.description },
  { key: 'status', header: 'Status', render: c => <CovenantPill status={c.status} size="sm" /> },
  { key: 'value', header: 'Value', numeric: true, render: c => formatPercent(num(c.current_value)) },
  { key: 'thr', header: 'Threshold', numeric: true, render: c => formatPercent(num(c.threshold)) },
  { key: 'util', header: 'Utilization', numeric: true, render: c => formatPercent(num(c.utilization_pct), { decimals: 1 }) },
]
const detail = (d: DealDash) => d.covenants.length ? (
  <DataTable density="compact" columns={covCols} rows={d.covenants} rowKey={(c, i) => c.legal_ref + i} caption={`Covenants · ${d.deal_name}`} captionHidden />
) : null

/** MOVE Trust deals (period 2026-07) from the real program object. Sort any column; footer totals. */
export const Default: S = {
  render: () => <Card title="MOVE Trust deals" padding="flush"><DataTable columns={dealCols} rows={deals} rowKey={d => d.deal_slug} caption="MOVE Trust deals" captionHidden /></Card>,
}

/** Expand a row for its covenant detail (panel motion), with Expand all / Collapse all as the Program Dashboard needs. */
export const Expandable: S = {
  render: function Render() {
    const [keys, setKeys] = useState<Set<string>>(new Set())
    return (
      <Card title="Covenant Status & Review" padding="flush" actions={<>
        <Button size="sm" onClick={() => setKeys(new Set(deals.map(d => d.deal_slug)))}>Expand all</Button>
        <Button size="sm" onClick={() => setKeys(new Set())}>Collapse all</Button></>}>
        <DataTable columns={dealCols} rows={deals} rowKey={d => d.deal_slug} rowLabel={d => d.deal_name} renderExpanded={detail} expandedKeys={keys} onExpandedChange={setKeys} />
      </Card>
    )
  },
}

/** Rows are focusable and open on Enter; the selected row is lavender. */
export const ClickableRows: S = {
  render: function Render() {
    const [sel, setSel] = useState<string | null>(deals[0].deal_slug)
    return <Card padding="flush" title="Click or press Enter on a row"><DataTable columns={dealCols} rows={deals} rowKey={d => d.deal_slug} onRowClick={d => setSel(d.deal_slug)} selectedKey={sel} /></Card>
  },
}

/** Fixed height: scrolls inside the card and the header sticks. */
export const StickyHeaderScroll: S = {
  render: () => {
    const rows = deals.flatMap(d => d.covenants.map((c, i) => ({ ...c, key: d.deal_slug + i, deal: d.deal_name })))
    const cols: Column<(typeof rows)[number]>[] = [{ key: 'deal', header: 'Deal', emphasis: true, render: r => r.deal }, ...(covCols as Column<(typeof rows)[number]>[])]
    return <Card title={`All covenants (${formatNumber(rows.length)})`} padding="flush"><DataTable columns={cols} rows={rows} rowKey={r => r.key} maxHeight={360} density="compact" caption="All covenants" captionHidden /></Card>
  },
}

export const Loading: S = { render: () => <Card padding="flush" title="Loading"><DataTable columns={dealCols} rows={[]} rowKey={d => d.deal_slug} loading /></Card> }

export const Empty: S = {
  render: () => <Card padding="flush" title="Upload history"><DataTable columns={dealCols} rows={[]} rowKey={d => d.deal_slug}
    empty={{ title: 'No uploads yet', message: 'Upload a SetRep to start the review.', action: <Button variant="primary">Upload report</Button> }} /></Card>,
}

export const Compact: S = { render: () => <Card padding="flush" title="Compact density"><DataTable density="compact" columns={covCols} rows={deals[0].covenants} rowKey={(c, i) => c.legal_ref + i} /></Card> }
