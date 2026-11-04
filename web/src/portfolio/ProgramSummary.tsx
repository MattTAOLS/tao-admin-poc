import { useNavigate } from 'react-router-dom'
import { Card, CovenantPill, Field, Select, formatPeriod, Button } from '@/design/components'
import { usePageHeader } from '@/shell/header'
import { paths, usePublished, type Load } from './data'
import { commonDealNamePrefix, shortName, terms } from './fmt'
import { links, usePortfolioParams, useShell } from './nav'
import { Num } from './Num'
import { AsOfPill, BehindNote, LoadGate, ProgramTiles, crumbs, dealMonth, programName, programSlug } from './shared'
import type { Portfolio, ProgramAggregate } from './types'

function useProgram() {
  const { programId, period } = usePortfolioParams()
  return { programId, period, load: usePublished<ProgramAggregate>(programId ? paths.program(programId, period) : null) }
}

/** Neighbouring programs in the caller's portfolio, for prev / next. */
function useNeighbours(slug: string | undefined) {
  const load: Load<Portfolio> = usePublished<Portfolio>(paths.portfolio())
  if (!slug || load.state !== 'ok') return { prev: undefined, next: undefined }
  const list = (load.data.programs ?? []).map(p => ({ slug: programSlug(p), name: programName(p) }))
  const i = list.findIndex(p => p.slug === slug)
  return { prev: i > 0 ? list[i - 1] : undefined, next: i >= 0 && i < list.length - 1 ? list[i + 1] : undefined }
}

/** Program Executive Summary: tiles, one card per deal with its status, prev / next program. */
export function ProgramSummary() {
  const shell = useShell()
  const L = links(shell)
  const { programId, load } = useProgram()
  const { prev, next } = useNeighbours(programId)
  const name = load.state === 'ok' ? programName(load.data) : programId ?? ''
  usePageHeader({
    title: load.state === 'ok' ? `${name} Executive Summary` : 'Program Executive Summary',
    subtitle: load.state === 'ok' ? <>Collection period {formatPeriod(load.data.period)} · {load.data.deal_count} deals</> : undefined,
    crumbs: crumbs(shell, L.portfolio(), { label: name }),
    actions: programId ? <>
      {prev && <Button as="link" to={L.program(prev.slug)} aria-label={`Previous program: ${prev.name}`} size="sm">‹ {prev.name}</Button>}
      {next && <Button as="link" to={L.program(next.slug)} aria-label={`Next program: ${next.name}`} size="sm">{next.name} ›</Button>}
      {load.state === 'ok' && <Button as="link" to={L.dashboard(programId)} variant="primary" size="md">Program dashboard</Button>}
    </> : undefined,
  })
  return <LoadGate load={load}>{p => <ProgramSummaryView p={p} />}</LoadGate>
}

export function PeriodPicker({ periods, value, onChange }: { periods: string[] | undefined; value: string | undefined; onChange: (p: string) => void }) {
  if (!periods || periods.length < 2) return null
  return (
    <Field label="Period">
      <Select value={value ?? periods[0]} onChange={e => onChange(e.target.value)} options={periods.map(p => ({ value: p, label: formatPeriod(p) }))} />
    </Field>
  )
}

export function ProgramSummaryView({ p }: { p: ProgramAggregate }) {
  const L = useLinksFor()
  const nav = useNavigate()
  const slug = programSlug(p)
  const prefix = commonDealNamePrefix(p.deals.map(d => d.deal_name))
  const deals = p.deals.map((d, i) => ({ d, i })).sort((a, b) => a.d.deal_name.localeCompare(b.d.deal_name))
  return (
    <div className="pf-stack">
      <div className="pf-toolbar">
        <PeriodPicker periods={p.available_periods} value={p.period} onChange={per => nav(L.program(slug, per))} />
      </div>
      <ProgramTiles p={p} />
      <BehindNote p={p} />
      {p.deals_with_escalations.length > 0 && (
        <Card title="Escalated this period" subtitle="A covenant moved to a worse status than last period">
          <ul className="pf-list">{p.deals_with_escalations.map(n => <li key={n}>{shortName(n, prefix)}</li>)}</ul>
        </Card>
      )}
      <div className="pf-dealgrid">
        {deals.map(({ d, i }) => {
          const t = terms(d.terminology ?? undefined)
          return (
            <Card key={d.deal_slug} as="article" headingLevel={3} title={shortName(d.deal_name, prefix)}
              actions={<span className="pf-cardpills"><AsOfPill p={p} dealSlug={d.deal_slug} /><CovenantPill status={d.worst_status} size="sm" /></span>}>
              <dl className="pf-dl">
                <dt>{t.balance}</dt><dd><Num v={d.tranche_balance.closing} kind="money" field={`deals.${i}.tranche_balance.closing`} /></dd>
                <dt>Change</dt><dd><Num v={d.tranche_balance.change_abs} kind="signed-money" field={`deals.${i}.tranche_balance.change_abs`} /> (<Num v={d.tranche_balance.change_pct} kind="pct" field={`deals.${i}.tranche_balance.change_pct`} />)</dd>
                <dt>Utilization</dt><dd><Num v={d.program?.program_utilization_pct} kind="pct" field={`deals.${i}.program.program_utilization_pct`} /></dd>
                <dt>Covenants</dt><dd>{d.covenant_summary.BREACH} breach · {d.covenant_summary.WATCH} watch · {d.covenant_summary.OK} OK</dd>
              </dl>
              <div className="pf-cardfoot"><Button as="link" to={L.deal(slug, d.deal_slug, dealMonth(p, d.deal_slug))} aria-label={`Open deal ${d.deal_name}`} size="sm">Open deal</Button></div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function useLinksFor() { return links(useShell()) }
