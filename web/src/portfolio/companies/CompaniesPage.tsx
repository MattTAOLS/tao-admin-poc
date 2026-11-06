/** /admin/companies, /investor/companies, /manager/companies: the Companies list (docs/phase2/designs/companies.html D5
 * screens B and C). One row per lending company over the deals the caller may see (the API applies partner_filter).
 * Search, filters and the following toggle live in the URL; every column sorts; Export CSV writes the rows shown.
 * Partners get the same columns minus Notes. */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Card, DataTable, Field, Input, KpiRow, KpiTile, Select, StatePanel, type Column } from '@/design/components'
import { usePageHeader } from '@/shell/header'
import { usePublished } from '../data'
import { useShell } from '../nav'
import { Num } from '../Num'
import { LoadGate, PageSkeleton, SHELL_TITLE } from '../shared'
import { AdverseCell, DelinquencyCell, FollowStar, NameCell, NewsCell, StatusCell } from './cells'
import type { CompanyRow } from './types'
import {
  ADVERSE_FILTER_LABEL, STATUS_FILTER_LABEL, anyFilter, applyFilters, companiesCsv, companyLinks, downloadText, latestMonth,
  longMonth, programsOf, readFilters, statusRank, useCaller, useCompaniesEnabled, writeFilters, type Filters,
} from './util'
import './companies.css'

export default function CompaniesPage() {
  const shell = useShell()
  const { tao } = useCaller()
  usePageHeader({
    title: 'Companies',
    subtitle: tao
      ? 'The lending companies behind each deal: report performance, covenant status, news and adverse media.'
      : 'Lending companies in the programs shared with your organisation.',
    crumbs: [{ label: SHELL_TITLE[shell] }, { label: 'Companies' }],
  })
  const enabled = useCompaniesEnabled()
  if (enabled === false) return <StatePanel kind="not-found" message="Company profiles are not switched on for your organisation yet." />
  if (enabled === null) return <PageSkeleton />
  return <CompaniesList />
}

function CompaniesList() {
  const load = usePublished<CompanyRow[]>('/companies')
  if (load.state === 'no-access') return <StatePanel kind="not-found" message="Company profiles are not available to you." />
  return <LoadGate load={load}>{rows => <CompaniesView initial={rows} />}</LoadGate>
}

export function CompaniesView({ initial }: { initial: CompanyRow[] }) {
  const shell = useShell()
  const L = companyLinks(shell)
  const nav = useNavigate()
  const { tao, signedIn } = useCaller()
  const [rows, setRows] = useState(initial)
  useEffect(() => setRows(initial), [initial])
  const [search, setSearch] = useSearchParams()
  const f = readFilters(search)
  const set = (patch: Partial<Filters>) => setSearch(writeFilters({ ...f, ...patch }), { replace: true })

  const shown = useMemo(() => applyFilters(rows, f).sort((a, b) => a.name.localeCompare(b.name)), [rows, f.q, f.program, f.industry, f.status, f.adverse, f.following]) // eslint-disable-line react-hooks/exhaustive-deps
  const programs = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of rows) for (const d of r.deals) m.set(d.program_slug, d.program_name)
    return [...m].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }))
  }, [rows])
  const industries = useMemo(() => [...new Set(rows.map(r => r.industry).filter((x): x is string => !!x))].sort(), [rows])
  const dealTotal = rows.reduce((n, r) => n + r.deals.length, 0)
  const breach = rows.filter(r => r.status === 'BREACH').length
  const watch = rows.filter(r => r.status === 'WATCH').length
  const toReview = rows.reduce((n, r) => n + (r.adverse?.to_review ?? 0), 0)

  const setFollowing = (slug: string, following: boolean) => setRows(rs => rs.map(r => (r.slug === slug ? { ...r, following } : r)))

  const cols: Column<CompanyRow>[] = [
    { key: 'following', header: <span aria-hidden="true">★</span>, ariaLabel: 'Following', width: 40, sortValue: r => (r.following ? 0 : 1),
      render: r => <FollowStar slug={r.slug} name={r.name} following={r.following} signedIn={signedIn} onChange={v => setFollowing(r.slug, v)} /> },
    { key: 'company', header: 'Company', emphasis: true, sortValue: r => r.name, render: r => <NameCell r={r} href={L.profile(r.slug)} /> },
    { key: 'programs', header: 'Program(s)', sortValue: r => programsOf(r).join(', '), render: r => programsOf(r).join(', ') },
    { key: 'industry', header: 'Industry', sortValue: r => r.industry, render: r => r.industry ?? <span className="pf-muted">Not set</span> },
    { key: 'month', header: 'Latest month', sortValue: r => latestMonth(r), render: r => <span className="pf-nowrap">{longMonth(latestMonth(r))}</span> },
    { key: 'status', header: 'Status', sortValue: r => -statusRank(r.status) * 1000 - r.breach * 10 - r.watch, render: r => <StatusCell r={r} /> },
    { key: 'balance', header: 'Balance', numeric: true, sortValue: r => r.balance, render: r => <Num v={r.balance} kind="money" /> },
    { key: 'delinquency', header: 'Delinquency', numeric: true, sortValue: r => r.delinquency.max, render: r => <DelinquencyCell d={r.delinquency} /> },
    { key: 'news', header: 'News 7 days', numeric: true, sortValue: r => r.news_7d, render: r => <NewsCell n={r.news_7d} /> },
    { key: 'adverse', header: 'Adverse media', sortValue: r => (r.adverse.state === 'to_review' ? 0 : r.adverse.state === 'clear' ? 1 : 2) * 1000 - r.adverse.to_review,
      render: r => <AdverseCell a={r.adverse} /> },
    ...(tao ? [{ key: 'notes', header: 'Notes', numeric: true, sortValue: (r: CompanyRow) => r.notes ?? 0, render: (r: CompanyRow) => <Num v={r.notes ?? 0} kind="count" /> }] : []),
  ]

  const filterWords = [
    f.q && `“${f.q}”`,
    f.program && (programs.find(p => p.value === f.program)?.label ?? f.program),
    f.industry,
    f.status && `Status: ${STATUS_FILTER_LABEL[f.status]}`,
    f.adverse && `Adverse media: ${ADVERSE_FILTER_LABEL[f.adverse]}`,
    f.following && 'Following',
  ].filter(Boolean).join(' · ')

  const exportCsv = () => {
    const stamp = new Date().toISOString().slice(0, 10)
    downloadText(`companies-${stamp}.csv`, companiesCsv(shown, tao))
  }

  return (
    <div className="pf-stack">
      <KpiRow>
        <KpiTile label="Companies" value={<Num v={rows.length} kind="count" />} context={`${dealTotal} deals in ${programs.length} program${programs.length === 1 ? '' : 's'}`} />
        <KpiTile label="Breach" tone={breach ? 'bad' : 'ok'} value={<Num v={breach} kind="count" />} context="companies with a deal in breach" />
        <KpiTile label="Watch" tone={watch ? 'warn' : 'ok'} value={<Num v={watch} kind="count" />} context="worst status is watch" />
        {tao && <KpiTile label="Adverse media to review" tone={toReview ? 'warn' : 'ok'} value={<Num v={toReview} kind="count" />} context="open items across companies" />}
      </KpiRow>

      <Card padding="pad">
        <div className="pf-stack">
          <div className="co-filters" role="search" aria-label="Filter companies">
            <Field label="Search" className="co-search">
              <Input type="search" value={f.q} placeholder="Company or deal name" onChange={e => set({ q: e.target.value })} />
            </Field>
            <Field label="Program">
              <Select value={f.program} onChange={e => set({ program: e.target.value })}
                options={[{ value: '', label: tao ? 'All programs' : 'All shared programs' }, ...programs]} />
            </Field>
            <Field label="Industry">
              <Select value={f.industry} onChange={e => set({ industry: e.target.value })}
                options={[{ value: '', label: 'All industries' }, ...industries.map(i => ({ value: i, label: i }))]} />
            </Field>
            <Field label="Status">
              <Select value={f.status} onChange={e => set({ status: e.target.value as Filters['status'] })}
                options={[{ value: '', label: 'Any status' }, ...Object.entries(STATUS_FILTER_LABEL).map(([value, label]) => ({ value, label }))]} />
            </Field>
            <Field label="Adverse media">
              <Select value={f.adverse} onChange={e => set({ adverse: e.target.value as Filters['adverse'] })}
                options={[{ value: '', label: 'Any' }, ...Object.entries(ADVERSE_FILTER_LABEL).filter(([k]) => tao || k !== 'to_review').map(([value, label]) => ({ value, label }))]} />
            </Field>
            <label className="pf-check" title={signedIn ? undefined : 'Sign in as a user to follow companies'}>
              <input type="checkbox" checked={f.following} disabled={!signedIn && !f.following} onChange={e => set({ following: e.target.checked })} />
              Only companies I follow
            </label>
            <span className="pf-spacer" />
            <Button size="sm" onClick={exportCsv} disabled={!shown.length}>Export CSV</Button>
          </div>
          {!signedIn && <p className="co-hint">Following needs a signed-in user. Use “Sign in as (POC)” in the sidebar to follow companies.</p>}
        </div>
      </Card>

      <Card title="All companies" padding="flush"
        subtitle={<span className="co-count" aria-live="polite">
          <span>{shown.length} of {rows.length} companies{filterWords ? ` · ${filterWords}` : ''}</span>
          {anyFilter(f) && <button type="button" className="co-clear" onClick={() => setSearch(new URLSearchParams(), { replace: true })}>Clear filters</button>}
        </span>}>
        <DataTable caption="Lending companies" captionHidden columns={cols} rows={shown} rowKey={r => r.slug} rowLabel={r => r.name}
          onRowClick={r => nav(L.profile(r.slug))}
          empty={anyFilter(f)
            ? { title: 'No companies match', message: 'Change or clear the filters.' }
            : { title: 'No companies yet', message: 'Companies appear here once a deal of theirs is published to you.' }} />
      </Card>
    </div>
  )
}
