import { useNavigate } from 'react-router-dom'
import { Button, Card, DataTable, KpiRow, KpiTile, StatePanel, formatNumber, formatPeriod, icons, type Column } from '@/design/components'
import { usePageHeader } from '@/shell/header'
import { adminApi, type PortfolioProgram, type PublishedPortfolio } from './data'
import { useResource, useRole } from './hooks'
import { LoadError, QueueTiles, TextLink } from './ui'
import { UploadsTable } from './UploadsTable'

export type PortfolioKpis = { programs: number; deals: number; breach: number; watch: number }
/** Counts from the published portfolio only. A deal is flagged when its worst covenant status is BREACH or WATCH. */
export function portfolioKpis(p: PublishedPortfolio | undefined): PortfolioKpis {
  const programs = p?.programs ?? []
  let deals = 0, breach = 0, watch = 0
  for (const pr of programs) {
    deals += pr.deal_count ?? pr.deals?.length ?? 0
    for (const d of pr.deals ?? []) {
      const s = String(d.worst_status ?? '').toUpperCase()
      if (s === 'BREACH') breach++
      else if (s === 'WATCH') watch++
    }
  }
  return { programs: programs.length, deals, breach, watch }
}

const covenantCol = (key: 'BREACH' | 'WATCH' | 'OK' | 'AVAILABLE', header: string): Column<PortfolioProgram> =>
  ({ key, header, numeric: true, render: p => formatNumber(p.covenant_totals?.[key]), sortValue: p => p.covenant_totals?.[key] })

/** TAO Admin home: published portfolio KPIs, the intake queue, covenant status by program, the latest uploads. */
export default function DashboardPage() {
  const nav = useNavigate()
  const role = useRole()
  usePageHeader({ title: 'Dashboard', subtitle: 'Published portfolio and the intake queue.',
    actions: <Button variant="primary" icon={<icons.IconUpload width={16} height={16} />} onClick={() => nav('/admin/uploads/new')}>Upload report</Button> })
  const portfolio = useResource(() => adminApi.portfolio(), [role])
  const queue = useResource(() => Promise.all([adminApi.uploads(), adminApi.deals(), adminApi.programs()]), [role])

  const k = portfolioKpis(portfolio.data)
  const pLoading = portfolio.loading && !portfolio.data
  const programs = portfolio.data?.programs ?? []
  const flagged = k.breach + k.watch
  const [uploads, deals, masterPrograms] = queue.data ?? [undefined, [], []]
  const recent = (uploads ?? []).slice().sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at)).slice(0, 5)

  const columns: Column<PortfolioProgram>[] = [
    { key: 'name', header: 'Program', emphasis: true, render: p => p.program?.name ?? p.program?.slug ?? '—', sortValue: p => p.program?.name },
    { key: 'period', header: 'Latest period', render: p => formatPeriod(p.period), sortValue: p => p.period },
    { key: 'deals', header: 'Deals', numeric: true, render: p => formatNumber(p.deal_count ?? p.deals?.length), sortValue: p => p.deal_count },
    covenantCol('BREACH', 'Breach'), covenantCol('WATCH', 'Watch'), covenantCol('OK', 'OK'), covenantCol('AVAILABLE', 'Available'),
  ]

  return (
    <div className="adm-stack">
      {portfolio.error ? <LoadError error={portfolio.error} onRetry={portfolio.reload} /> : !pLoading && programs.length === 0 ? (
        <StatePanel kind="empty" title="Nothing published yet" message="Programs, deals and covenant status appear here once a TAO Admin approves and publishes a settlement report." />
      ) : (
        <>
          <KpiRow>
            <KpiTile label="Programs" value={formatNumber(k.programs)} context="with published data" loading={pLoading} />
            <KpiTile label="Deals" value={formatNumber(k.deals)} context="in the latest published period" loading={pLoading} />
            <KpiTile label="Flagged deals" value={formatNumber(flagged)} tone={k.breach ? 'bad' : k.watch ? 'warn' : undefined}
              context={flagged ? `${formatNumber(k.breach)} breach · ${formatNumber(k.watch)} watch` : 'no deal on watch or in breach'} loading={pLoading} />
          </KpiRow>
          <Card title="Covenant status by program" subtitle="Covenant tests in each program’s latest published period." padding="flush">
            <DataTable columns={columns} rows={programs} rowKey={(p, i) => p.program?.slug ?? String(i)} caption="Covenant status by program" captionHidden loading={pLoading} skeletonRows={2} />
          </Card>
        </>
      )}
      <h2 className="adm-section-title">Intake queue</h2>
      {queue.error ? <LoadError error={queue.error} onRetry={queue.reload} /> : (
        <>
          <KpiRow><QueueTiles uploads={uploads} loading={queue.loading && !uploads} /></KpiRow>
          <Card title="Latest uploads" subtitle="Click a row to open it." padding="flush" actions={<TextLink to="/admin/uploads/history">Upload history →</TextLink>}>
            <UploadsTable uploads={recent} deals={deals} programs={masterPrograms} loading={queue.loading && !uploads} caption="Latest uploads" compact
              showAudit={role === 'tao_admin'} empty={{ title: 'No uploads yet', message: 'Upload a settlement report to start the queue.' }} />
          </Card>
        </>
      )}
    </div>
  )
}
