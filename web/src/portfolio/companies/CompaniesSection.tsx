/** The Companies section on the Portfolio Executive Summary (D5 screen A, note 1): one row per lending company, between
 * the program cards and Flagged deals. Shown for TAO and, while Me.features.companies is true, for partners. A row opens
 * the company profile. Renders nothing when the feature is off or /companies cannot be read. */
import { useNavigate } from 'react-router-dom'
import { Button, Card, DataTable, SkeletonBlock, type Column } from '@/design/components'
import { usePublished } from '../data'
import { useShell } from '../nav'
import { AdverseCell, DelinquencyCell, NameCell, NewsCell, NewsHeader, StatusCell } from './cells'
import type { CompanyRow } from './types'
import { companyLinks, latestMonth, longMonth, programsOf, statusRank, useCompaniesEnabled } from './util'

export function CompaniesSection() {
  const enabled = useCompaniesEnabled()
  if (!enabled) return null
  return <CompaniesSectionBody />
}

function CompaniesSectionBody() {
  const shell = useShell()
  const L = companyLinks(shell)
  const nav = useNavigate()
  const load = usePublished<CompanyRow[]>('/companies')
  if (load.state === 'no-access' || load.state === 'error') return null
  const rows = load.state === 'ok' ? [...load.data].sort((a, b) => a.name.localeCompare(b.name)) : []
  const programCount = new Set(rows.flatMap(r => r.deals.map(d => d.program_slug))).size
  const cols: Column<CompanyRow>[] = [
    { key: 'company', header: 'Company', emphasis: true, sortValue: r => r.name, render: r => <NameCell r={r} href={L.profile(r.slug)} /> },
    { key: 'programs', header: 'Program(s)', render: r => programsOf(r).join(', ') },
    { key: 'industry', header: 'Industry', render: r => r.industry ?? <span className="pf-muted">Not set</span> },
    { key: 'month', header: 'Latest month', sortValue: r => latestMonth(r), render: r => <span className="pf-nowrap">{longMonth(latestMonth(r))}</span> },
    { key: 'status', header: 'Covenant status', sortValue: r => -statusRank(r.status), render: r => <StatusCell r={r} counts={false} /> },
    { key: 'delinquency', header: 'Delinquency', numeric: true, sortValue: r => r.delinquency.max, render: r => <DelinquencyCell d={r.delinquency} /> },
    { key: 'news', header: <NewsHeader label="News this week" />, numeric: true, sortValue: r => r.news_7d, render: r => <NewsCell n={r.news_7d} /> },
    { key: 'adverse', header: 'Adverse media', render: r => <AdverseCell a={r.adverse} /> },
  ]
  return (
    <Card title="Companies" padding="flush"
      subtitle={load.state === 'ok'
        ? `${rows.length} lending compan${rows.length === 1 ? 'y' : 'ies'} across ${programCount} program${programCount === 1 ? '' : 's'} · each in its latest published month`
        : <SkeletonBlock width={240} height={10} />}
      actions={<Button as="link" to={L.list()} size="sm">All companies</Button>}>
      <DataTable caption="Lending companies" captionHidden columns={cols} rows={rows} rowKey={r => r.slug} rowLabel={r => r.name}
        loading={load.state === 'loading'} skeletonRows={4} onRowClick={r => nav(L.profile(r.slug))}
        empty={{ title: 'No companies yet', message: 'Companies appear here once a deal of theirs is published.' }} />
    </Card>
  )
}
