import { useNavigate } from 'react-router-dom'
import { Card, DataTable, formatNumber, type Column } from '@/design/components'
import { usePageHeader } from '@/shell/header'
import { adminApi, type Deal } from './data'
import { useResource, useRole } from './hooks'
import { limitsByCurrency, partnerRows, type PartnerRow } from './master'
import { LoadError } from './ui'

export const dealCounts = (deals: Deal[]) => deals.reduce<Record<string, number>>((m, d) => ({ ...m, [d.program_slug]: (m[d.program_slug] ?? 0) + 1 }), {})

/** Partners: one row per partner that owns a program. */
export default function PartnersPage() {
  const nav = useNavigate()
  const role = useRole()
  usePageHeader({ title: 'Partners', subtitle: 'Partners and the programs they hold. Open one to see its programs, deals and covenants.' })
  const res = useResource(() => Promise.all([adminApi.programs(), adminApi.deals()]), [role])
  if (res.error) return <LoadError error={res.error} onRetry={res.reload} />
  const [programs, deals] = res.data ?? [[], []]
  const rows = partnerRows(programs, dealCounts(deals))
  const open = (r: PartnerRow) => nav(`/admin/partners/${encodeURIComponent(r.slug)}`)
  const columns: Column<PartnerRow>[] = [
    { key: 'name', header: 'Partner', emphasis: true, render: r => r.name, sortValue: r => r.name },
    { key: 'programs', header: 'Programs', render: r => r.programs.map(p => p.name).join(', ') },
    { key: 'pcount', header: 'Program count', numeric: true, render: r => formatNumber(r.programs.length), sortValue: r => r.programs.length },
    { key: 'deals', header: 'Deals', numeric: true, render: r => formatNumber(r.dealCount), sortValue: r => r.dealCount },
    { key: 'limit', header: 'Total program limit', numeric: true, render: r => limitsByCurrency(r.programs) },
  ]
  return (
    <Card title="Partners" padding="flush" subtitle="Select a row to open the partner.">
      <DataTable columns={columns} rows={rows} rowKey={r => r.slug} caption="Partners" captionHidden loading={res.loading && !res.data}
        onRowClick={open} rowLabel={r => r.name}
        empty={{ title: 'No partners yet', message: 'A partner appears here once a program is set up for it.' }} />
    </Card>
  )
}
