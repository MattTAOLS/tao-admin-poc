import { useNavigate } from 'react-router-dom'
import { Card, CovenantPill, DataTable, Field, Select, StatePanel, formatPeriod, type Column, Button } from '@/design/components'
import { usePageHeader } from '@/shell/header'
import { paths, usePublished } from './data'
import { commonDealNamePrefix, shortName } from './fmt'
import { links, useShell } from './nav'
import { Num } from './Num'
import { AsOfPill, BehindNote, LoadGate, ProgramTiles, SHELL_TITLE, behindOf, dealMonth, isFlagged, programName, programSlug } from './shared'
import type { DealIndex, Portfolio, PortfolioProgram } from './types'
import { CompaniesSection } from './companies/CompaniesSection'

type FlagRow = DealIndex & { program: string; programName: string; prefix: string; p: PortfolioProgram }

/** Portfolio Executive Summary: one card per program the caller may see, flagged deals, Go to deal. */
export function PortfolioSummary() {
  const shell = useShell()
  usePageHeader({ title: 'Portfolio Executive Summary', crumbs: [{ label: SHELL_TITLE[shell] }, { label: 'Portfolio Executive Summary' }] })
  const load = usePublished<Portfolio>(paths.portfolio())
  return <LoadGate load={load}>{data => <PortfolioView data={data} />}</LoadGate>
}

export function PortfolioView({ data }: { data: Portfolio }) {
  const shell = useShell()
  const L = links(shell)
  const nav = useNavigate()
  const programs = data.programs ?? []
  if (programs.length === 0) {
    return <StatePanel kind="empty" title="Nothing published yet" message="No program has a published report for your organisation yet. Published deals appear here after TAO approves them." />
  }
  const flagged: FlagRow[] = programs.flatMap(p => {
    const prefix = commonDealNamePrefix(p.deals.map(d => d.deal_name))
    return p.deals.filter(d => isFlagged(String(d.worst_status))).map(d => ({ ...d, program: programSlug(p), programName: programName(p), prefix, p }))
  })
  const options = programs.map(p => {
    const prefix = commonDealNamePrefix(p.deals.map(d => d.deal_name))
    return { group: programName(p), options: [...p.deals].sort((a, b) => a.deal_name.localeCompare(b.deal_name)).map(d => {
      const b = behindOf(p, d.deal_slug)
      return { value: `${programSlug(p)}|${d.deal_slug}`, label: shortName(d.deal_name, prefix) + (b ? ` (as of ${formatPeriod(b.as_of)})` : '') }
    }) }
  })
  // Each deal opens at its own published month (a deal that is behind has nothing at the program month).
  const goTo = (slug: string, deal: string) => {
    const p = programs.find(x => programSlug(x) === slug)
    nav(L.deal(slug, deal, p ? dealMonth(p, deal) : undefined))
  }
  const cols: Column<FlagRow>[] = [
    { key: 'deal', header: 'Deal', emphasis: true, render: r => <>{shortName(r.deal_name, r.prefix)}<AsOfPill p={r.p} dealSlug={r.deal_slug} /></>, sortValue: r => r.deal_name },
    { key: 'program', header: 'Program', render: r => r.programName },
    { key: 'status', header: 'Status', render: r => <CovenantPill status={String(r.worst_status)} size="sm" /> },
    { key: 'tests', header: 'Breach / watch', numeric: true, render: r => <>{r.covenant_summary?.BREACH ?? 0} / {r.covenant_summary?.WATCH ?? 0}</> },
    { key: 'balance', header: 'Balance', numeric: true, render: r => <Num v={r.closing_tranche_balance} kind="money" />, sortValue: r => r.closing_tranche_balance },
    { key: 'go', header: 'Open', ariaLabel: 'Open deal', render: r => <Button as="link" to={L.deal(r.program, r.deal_slug, dealMonth(r.p, r.deal_slug))} aria-label={`Open ${r.deal_name}`} size="sm">Open</Button> },
  ]
  return (
    <div className="pf-stack">
      <div className="pf-toolbar">
        <Field label="Go to deal">
          <Select placeholder="Choose a deal" value="" options={options} onChange={e => { const [p, d] = e.target.value.split('|'); if (p && d) goTo(p, d) }} />
        </Field>
      </div>
      {programs.map(p => {
        const slug = programSlug(p)
        return (
          <Card key={slug} title={programName(p)} subtitle={<>Collection period {formatPeriod(p.period)} · {p.deal_count} deals</>}
            actions={<><Button as="link" to={L.program(slug)} size="sm">Executive summary</Button><Button as="link" to={L.dashboard(slug)} variant="primary" size="sm">Dashboard</Button></>}>
            <div className="pf-stack"><ProgramTiles p={p} compact /><BehindNote p={p} /></div>
          </Card>
        )
      })}
      <CompaniesSection />
      <Card title="Flagged deals" subtitle="Deals at WATCH or BREACH in their latest published period" padding="flush">
        <DataTable columns={cols} rows={flagged} rowKey={r => r.program + '/' + r.deal_slug} rowLabel={r => r.deal_name}
          caption="Flagged deals" captionHidden empty={{ title: 'No flagged deals', message: 'Every deal is OK in its latest published period.' }} />
      </Card>
    </div>
  )
}
