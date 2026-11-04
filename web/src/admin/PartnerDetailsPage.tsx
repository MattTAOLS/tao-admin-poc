import { useNavigate, useParams } from 'react-router-dom'
import { Card, DataTable, KpiRow, KpiTile, StatePanel, Button, formatCurrency, formatNumber, type Column } from '@/design/components'
import { usePageHeader } from '@/shell/header'
import { adminApi, programPartners, type Program } from './data'
import { useResource, useRole } from './hooks'
import { limitsByCurrency, partnerLabel } from './master'
import { dealCounts } from './PartnersPage'
import { LoadError } from './ui'

/** Partner details: the partner's programs with limits and deal counts. */
export default function PartnerDetailsPage() {
  const { partnerId = '' } = useParams()
  const nav = useNavigate()
  const role = useRole()
  const res = useResource(() => Promise.all([adminApi.partners(), adminApi.programs(), adminApi.deals()]), [role])
  const partner = res.data?.[0].find(p => p.slug === partnerId)
  const name = partnerLabel(res.data?.[0] ?? [], partnerId)
  usePageHeader({ title: name, subtitle: partner ? `${partner.kind.charAt(0).toUpperCase() + partner.kind.slice(1)} partner · ${partner.status}` : 'Partner', crumbs: [{ label: 'TAO Admin' }, { label: 'Partners', href: '/admin/partners' }, { label: name }] })
  if (res.error) return <LoadError error={res.error} onRetry={res.reload} />
  const loading = res.loading && !res.data
  const [, all, deals] = res.data ?? [[], [], []]
  const programs = all.filter(p => programPartners(p).includes(partnerId))
  const counts = dealCounts(deals)
  if (!loading && !partner) {
    return <StatePanel kind="not-found" title="No such partner" message={`There is no partner “${partnerId}” in master data.`}
      actions={<Button onClick={() => nav('/admin/partners')}>Back to partners</Button>} />
  }
  const open = (p: Program) => nav(`/admin/partners/${encodeURIComponent(partnerId)}/programs/${encodeURIComponent(p.slug)}`)
  const columns: Column<Program>[] = [
    { key: 'name', header: 'Program', emphasis: true, render: p => p.name, sortValue: p => p.name },
    { key: 'currency', header: 'Currency', render: p => p.currency },
    { key: 'limit', header: 'Program limit', numeric: true, render: p => formatCurrency(p.limit, { decimals: 0 }), sortValue: p => p.limit },
    { key: 'warehouse', header: 'Warehouse limit', numeric: true, render: p => formatCurrency(p.warehouse_limit ?? null, { decimals: 0 }), sortValue: p => p.warehouse_limit },
    { key: 'deals', header: 'Deals', numeric: true, render: p => formatNumber(counts[p.slug] ?? 0), sortValue: p => counts[p.slug] ?? 0 },
    { key: 'shared', header: 'Visible to', render: p => programPartners(p).map(s => partnerLabel(res.data?.[0] ?? [], s)).join(', ') },
  ]
  const dealTotal = programs.reduce((n, p) => n + (counts[p.slug] ?? 0), 0)
  return (
    <div className="adm-stack">
      <KpiRow>
        <KpiTile label="Programs" value={formatNumber(programs.length)} loading={loading} />
        <KpiTile label="Deals" value={formatNumber(dealTotal)} loading={loading} />
        <KpiTile label="Total program limit" value={limitsByCurrency(programs) || undefined} loading={loading} />
      </KpiRow>
      <Card title="Programs" subtitle="Select a program to see its limits, deals and covenant definitions." padding="flush">
        <DataTable columns={columns} rows={programs} rowKey={p => p.slug} caption={`${name} programs`} captionHidden loading={loading}
          onRowClick={open} rowLabel={p => p.name} skeletonRows={2}
          empty={{ title: 'No programs visible to this partner', message: 'A TAO Admin adds the partner to a program’s visibility list on the program record.' }} />
      </Card>
    </div>
  )
}
