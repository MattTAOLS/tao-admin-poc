import { useNavigate } from 'react-router-dom'
import { Card, CovenantPill, DataTable, KpiRow, KpiTile, StatusPill, formatPeriod, type Column, Button } from '@/design/components'
import { usePageHeader } from '@/shell/header'
import { AdminStrip } from './AdminStrip'
import { CorrectionsTable } from './Corrections'
import { CovenantTable } from './Covenants'
import { paths, usePublished } from './data'
import { cnlBaseKey, cnlLossKey, cnlVintage, commonDealNamePrefix, dealPeriod, ratioKind, shortName, terms } from './fmt'
import { links, usePortfolioParams, useShell } from './nav'
import { Num } from './Num'
import { kpiDelta } from './polarity'
import { PeriodPicker } from './ProgramSummary'
import { RatioChart } from './RatioChart'
import { Top10Panel } from './Top10'
import { AsOfPill, LoadGate, behindOf, crumbs, dealMonth, programName } from './shared'
import type { AgingRow, CnlRow, Deal, FinancialRatio, PeriodRow, ProgramAggregate } from './types'

/** Deal page: Deal Metrics, covenants with legal reference, ratio history, prev / next deal, period picker. */
export function DealPage() {
  const shell = useShell()
  const L = links(shell)
  const nav = useNavigate()
  const { programId, dealId, period } = usePortfolioParams()
  const load = usePublished<Deal>(programId && dealId ? paths.deal(programId, dealId, period) : null)
  const deal = load.state === 'ok' ? load.data : undefined
  // The program gives prev / next within it. At the deal's newest publication: the program's latest month, so each
  // neighbour opens at its own newest month. At an older month: the program as of that month.
  const shown = deal ? dealPeriod(deal) : undefined
  const progPeriod = deal && shown && deal.available_periods?.length && shown !== deal.available_periods[0] ? shown : undefined
  const prog = usePublished<ProgramAggregate>(programId && deal ? paths.program(programId, progPeriod) : null)
  const siblings = prog.state === 'ok' ? [...prog.data.deals].sort((a, b) => a.deal_name.localeCompare(b.deal_name)) : []
  const prefix = commonDealNamePrefix(siblings.map(d => d.deal_name))
  const i = siblings.findIndex(d => d.deal_slug === dealId)
  const prev = i > 0 ? siblings[i - 1] : undefined
  const next = i >= 0 && i < siblings.length - 1 ? siblings[i + 1] : undefined
  // This deal is behind the program month (its newer report is not published yet).
  const behind = prog.state === 'ok' && dealId ? behindOf(prog.data, dealId) : undefined
  const behindHere = behind && behind.as_of === shown ? behind : undefined
  const pname = prog.state === 'ok' ? programName(prog.data) : programId ?? ''
  usePageHeader({
    title: deal ? deal.deal_name : 'Deal',
    status: deal ? <><CovenantPill status={deal.worst_status} />{behindHere && prog.state === 'ok' && <AsOfPill p={prog.data} dealSlug={behindHere.deal_slug} />}</> : undefined,
    subtitle: deal ? <>Collection period {deal.collection_period}{deal.settlement_date ? ` · settled ${deal.settlement_date}` : ''}{deal.prior_period ? ` · compared with ${formatPeriod(deal.prior_period)}` : ''}</> : undefined,
    crumbs: crumbs(shell, L.portfolio(), { label: pname, href: programId ? L.program(programId) : undefined }, { label: deal ? shortName(deal.deal_name, prefix) : dealId ?? '' }),
    actions: programId ? <>
      {prev && <Button as="link" to={L.deal(programId, prev.deal_slug, prog.state === 'ok' ? dealMonth(prog.data, prev.deal_slug) : undefined)} aria-label={`Previous deal: ${prev.deal_name}`} size="sm">‹ {shortName(prev.deal_name, prefix)}</Button>}
      {next && <Button as="link" to={L.deal(programId, next.deal_slug, prog.state === 'ok' ? dealMonth(prog.data, next.deal_slug) : undefined)} aria-label={`Next deal: ${next.deal_name}`} size="sm">{shortName(next.deal_name, prefix)} ›</Button>}
    </> : undefined,
  })
  return (
    <LoadGate load={load}>{d => (
      <div className="pf-stack">
        {shell === 'admin' && <AdminStrip deal={d} />}
        {behindHere && prog.state === 'ok' && (
          <p className="pf-behind" role="note">{shortName(d.deal_name, prefix)} is as of {formatPeriod(behindHere.as_of)}; its {formatPeriod(prog.data.period)} report is not published yet.</p>
        )}
        <div className="pf-toolbar">
          <PeriodPicker periods={d.available_periods} value={dealPeriod(d)} onChange={per => programId && dealId && nav(L.deal(programId, dealId, per))} />
        </div>
        <DealView d={d} />
      </div>
    )}</LoadGate>
  )
}

/** Everything on the deal page that shows a number. Pure: the reference test renders it with each dashboard.json. */
export function DealView({ d }: { d: Deal }) {
  const t = terms(d.terminology ?? undefined)
  const tb = d.tranche_balance, ct = d.contracts, pg = d.program, wh = d.warehouse
  const cur = dealPeriod(d)
  const agingIdx = Math.max(0, d.aging_history.findIndex(a => a.period === cur))
  const aging = d.aging_history[agingIdx] as AgingRow | undefined
  const chargeOff = tb.charge_off !== null && tb.charge_off !== undefined
  return (
    <>
      <section aria-labelledby="pf-dm" className="pf-stack">
        <h2 id="pf-dm" className="pf-section">Deal Metrics</h2>
        <KpiRow>
          <KpiTile label={t.balance} value={<Num v={tb.closing} kind="money" field="tranche_balance.closing" />}
            delta={{ ...kpiDelta('tranche_balance', tb.change_abs), label: 'Change vs last period', value: <><Num v={tb.change_abs} kind="signed-money" field="tranche_balance.change_abs" /> (<Num v={tb.change_pct} kind="pct" field="tranche_balance.change_pct" />)</> }} context="vs last period" />
          <KpiTile label="Outstanding contracts" value={<Num v={ct.closing} kind="count" field="contracts.closing" />}
            delta={{ ...kpiDelta('contracts', ct.change_abs), label: 'Change vs last period', value: <><Num v={ct.change_abs} kind="signed-count" field="contracts.change_abs" />{ct.change_pct !== null && <> (<Num v={ct.change_pct} kind="pct" field="contracts.change_pct" />)</>}</> }} context="vs last period" />
          {pg && <KpiTile label="Facility utilization" value={<Num v={pg.program_utilization_pct} kind="pct" field="program.program_utilization_pct" />}
            context={<><Num v={pg.program_amount} kind="money" field="program.program_amount" /> of <Num v={pg.program_limit} kind="money" field="program.program_limit" /></>} />}
          {d.total_enhancement && <KpiTile label="Total enhancement" value={<Num v={d.total_enhancement.total_enhancement_amount} kind="money" field="total_enhancement.total_enhancement_amount" />}
            context={<><Num v={d.total_enhancement.total_enhancement_pct} kind="pct" field="total_enhancement.total_enhancement_pct" /> of balance</>} />}
          <KpiTile label="Covenant tests" tone={d.covenant_summary.BREACH ? 'bad' : d.covenant_summary.WATCH ? 'warn' : 'ok'}
            value={<><Num v={d.covenant_summary.BREACH} kind="count" field="covenant_summary.BREACH" /> <span className="pf-kpiword">breach</span> · <Num v={d.covenant_summary.WATCH} kind="count" field="covenant_summary.WATCH" /> <span className="pf-kpiword">watch</span></>}
            context={<><Num v={d.covenant_summary.OK} kind="count" field="covenant_summary.OK" /> OK · <Num v={d.covenant_summary.AVAILABLE} kind="count" field="covenant_summary.AVAILABLE" /> available</>} />
        </KpiRow>

        <div className="pf-grid2">
          <Card title="Balances" subtitle={`${t.balance} roll-forward this period`}>
            <dl className="pf-dl pf-dl--num">
              <dt>Opening {t.balance.toLowerCase()}</dt><dd><Num v={tb.opening} kind="money" field="tranche_balance.opening" /></dd>
              <dt>Principal</dt><dd><Num v={tb.principal} kind="money" field="tranche_balance.principal" /></dd>
              <dt>Prepayments</dt><dd><Num v={tb.principal_prepayments} kind="money" field="tranche_balance.principal_prepayments" /></dd>
              <dt>Losses</dt><dd><Num v={tb.losses} kind="money" field="tranche_balance.losses" /></dd>
              {chargeOff && <><dt>Charge-off</dt><dd><Num v={tb.charge_off} kind="money" field="tranche_balance.charge_off" /></dd></>}
              <dt className="pf-strong">Closing {t.balance.toLowerCase()}</dt><dd className="pf-strong"><Num v={tb.closing} kind="money" field="tranche_balance.closing" /></dd>
              <dt>Interest collected</dt><dd><Num v={tb.interest} kind="money" field="tranche_balance.interest" /></dd>
              <dt>Recoveries</dt><dd><Num v={tb.recoveries} kind="money" field="tranche_balance.recoveries" /></dd>
              {d.tranche_amount && <><dt>{t.amount} (closing)</dt><dd><Num v={d.tranche_amount.closing} kind="money" field="tranche_amount.closing" /></dd></>}
            </dl>
          </Card>
          <Card title="Facility and contracts">
            <dl className="pf-dl pf-dl--num">
              <dt>Opening contracts</dt><dd><Num v={ct.opening} kind="count" field="contracts.opening" /></dd>
              <dt>Closing contracts</dt><dd><Num v={ct.closing} kind="count" field="contracts.closing" /></dd>
              {pg && <>
                <dt>Facility limit</dt><dd><Num v={pg.program_limit} kind="money" field="program.program_limit" /></dd>
                <dt>Drawn</dt><dd><Num v={pg.program_amount} kind="money" field="program.program_amount" /></dd>
                {pg.unused_facility !== null && <><dt>Unused facility</dt><dd><Num v={pg.unused_facility} kind="money" field="program.unused_facility" /></dd></>}
                {pg.maximum_program_limit !== null && <><dt>Maximum program limit</dt><dd><Num v={pg.maximum_program_limit} kind="money" field="program.maximum_program_limit" /></dd></>}
              </>}
              {wh && wh.maximum_warehouse_facility_limit !== null && <>
                <dt>Warehouse limit</dt><dd><Num v={wh.maximum_warehouse_facility_limit} kind="money" field="warehouse.maximum_warehouse_facility_limit" /></dd>
                <dt>Warehouse advances (closing)</dt><dd><Num v={wh.closing_advances_outstanding} kind="money" field="warehouse.closing_advances_outstanding" /></dd>
              </>}
            </dl>
          </Card>
        </div>

        <Card title="Balance history" subtitle="Published periods in this report" padding="flush">
          <PeriodTable rows={d.period_history} balanceLabel={t.balance} />
        </Card>

        <Card title="Aging" subtitle={aging ? `Buckets by period · ${aging.written_off_bucket_label} shown as written off` : undefined} padding="flush">
          <AgingTable rows={d.aging_history} current={agingIdx} />
        </Card>

        <Card title="Losses and CNL by vintage" padding="flush"
          subtitle={aging ? <>Losses this period <Num v={tb.losses} kind="money" field="tranche_balance.losses" /> · recoveries <Num v={tb.recoveries} kind="money" field="tranche_balance.recoveries" /> · cumulative net losses <Num v={aging.cumulative_net_losses} kind="money" field={`aging_history.${agingIdx}.cumulative_net_losses`} /></> : undefined}>
          <CnlTable rows={d.cnl_by_period} />
        </Card>

        <Card title="Borrower and portfolio ratios" padding="flush">
          <RatiosTable ratios={d.financial_ratios} />
        </Card>
        <Top10Panel d={d} />
        {d.data_corrections && d.data_corrections.length > 0 && (
          <Card title="Data corrections" subtitle="Values corrected after review, as recorded on the published deal" padding="flush">
            <CorrectionsTable rows={d.data_corrections} />
          </Card>
        )}
      </section>

      <Card title="Covenant tests" subtitle={`Published status at a ${Math.round(d.watch_buffer_pct * 100)}% watch buffer`} padding="flush">
        <CovenantTable covenants={d.covenants} />
      </Card>

      <Card title="Ratio history" subtitle="Latest 13 months, one series at a time">
        <RatioChart history={d.ratio_history} />
      </Card>
    </>
  )
}

function PeriodTable({ rows, balanceLabel }: { rows: PeriodRow[]; balanceLabel: string }) {
  const idx = rows.map((r, i) => ({ r, i })).reverse()
  type R = typeof idx[number]
  const m = (k: keyof PeriodRow, kind: 'money' | 'count' = 'money') => (x: R) => <Num v={x.r[k] as number} kind={kind} field={`period_history.${x.i}.${k}`} />
  const hasCO = rows.some(r => r.charge_off !== null && r.charge_off !== undefined)
  const cols: Column<R>[] = [
    { key: 'period', header: 'Period', emphasis: true, render: x => formatPeriod(x.r.period) },
    { key: 'opening', header: `Opening`, numeric: true, render: m('opening_balance') },
    { key: 'principal', header: 'Principal', numeric: true, render: m('principal') },
    { key: 'prepay', header: 'Prepayments', numeric: true, render: m('principal_prepayments') },
    { key: 'losses', header: 'Losses', numeric: true, render: m('losses') },
    ...(hasCO ? [{ key: 'co', header: 'Charge-off', numeric: true, render: m('charge_off') } as Column<R>] : []),
    { key: 'closing', header: `Closing ${balanceLabel.toLowerCase()}`, numeric: true, render: m('closing_balance') },
    { key: 'contracts', header: 'Contracts', numeric: true, render: m('closing_contracts', 'count') },
  ]
  return <DataTable columns={cols} rows={idx} rowKey={x => x.r.period} caption="Balance history" captionHidden density="compact" />
}

function AgingTable({ rows, current }: { rows: AgingRow[]; current: number }) {
  type R = { r: AgingRow; i: number }
  const data: R[] = rows.map((r, i) => ({ r, i }))
  const m = (k: keyof AgingRow) => (x: R) => <Num v={x.r[k] as number} kind="money" field={`aging_history.${x.i}.${k}`} />
  const cols: Column<R>[] = [
    { key: 'period', header: 'Period', emphasis: true, render: x => <>{formatPeriod(x.r.period)}{x.i === current && <span className="pf-muted pf-small"> current</span>}</> },
    { key: 'c', header: 'Current (0–30)', numeric: true, render: m('current_0_30') },
    { key: 'd31', header: '31–60 days', numeric: true, render: m('days_31_60') },
    { key: 'd61', header: '61–90 days', numeric: true, render: m('days_61_90') },
    { key: 'wo', header: 'Written off', numeric: true, render: m('written_off') },
    { key: 'cl', header: 'Closing balance', numeric: true, render: m('closing_balance') },
    { key: 'rec', header: 'Reconciles', render: x => x.r.reconciles ? <StatusPill tone="ok" size="sm">Yes</StatusPill> : <StatusPill tone="warn" size="sm">No</StatusPill> },
  ]
  return <DataTable columns={cols} rows={data} rowKey={x => x.r.period} selectedKey={rows[current]?.period ?? null} caption="Aging buckets" captionHidden density="compact" />
}

function CnlTable({ rows }: { rows: CnlRow[] }) {
  type R = { r: CnlRow; i: number }
  const data: R[] = rows.map((r, i) => ({ r, i }))
  const cols: Column<R>[] = [
    { key: 'v', header: 'Vintage', emphasis: true, render: x => <>{cnlVintage(x.r)}{x.r.advance_range ? <span className="pf-muted pf-small"> · advances {x.r.advance_range}</span> : null}</> },
    { key: 'base', header: 'Original balance', numeric: true, render: x => { const k = cnlBaseKey(x.r); return <Num v={k ? (x.r[k] as number) : null} kind="money" field={k ? `cnl_by_period.${x.i}.${k}` : undefined} /> } },
    { key: 'cnl', header: 'Cumulative net losses', numeric: true, render: x => { const k = cnlLossKey(x.r); return <Num v={k ? (x.r[k] as number) : null} kind="money" field={k ? `cnl_by_period.${x.i}.${k}` : undefined} /> } },
    { key: 'ratio', header: 'CNL ratio', numeric: true, render: x => <Num v={x.r.cnl_ratio_pct} kind="pct" field={`cnl_by_period.${x.i}.cnl_ratio_pct`} /> },
    { key: 'limit', header: 'Limit', numeric: true, render: x => <Num v={x.r.cnl_limit} kind="pct" field={`cnl_by_period.${x.i}.cnl_limit`} /> },
    { key: 'ok', header: 'Within limit', render: x => x.r.cnl_within_limit === null || x.r.cnl_within_limit === undefined
      ? <StatusPill tone="neutral" size="sm">No limit</StatusPill>
      : x.r.cnl_within_limit ? <StatusPill tone="ok" size="sm">Within</StatusPill> : <StatusPill tone="bad" size="sm">Over</StatusPill> },
  ]
  return <DataTable columns={cols} rows={data} rowKey={x => String(x.i)} caption="CNL by vintage" captionHidden density="compact"
    empty={{ title: 'No CNL table in this report' }} />
}

function RatiosTable({ ratios }: { ratios: FinancialRatio[] }) {
  type R = { r: FinancialRatio; i: number }
  const data: R[] = ratios.map((r, i) => ({ r, i }))
  const cols: Column<R>[] = [
    { key: 'g', header: 'Group', render: x => <span className="pf-muted">{x.r.group}</span> },
    { key: 'l', header: 'Ratio', emphasis: true, render: x => <>{x.r.label}{x.r.vintage ? <span className="pf-muted pf-small"> · {x.r.vintage}</span> : null}</> },
    { key: 'v', header: 'Value', numeric: true, render: x => <Num v={x.r.value} kind={ratioKind(x.r.format)} field={`financial_ratios.${x.i}.value`} /> },
  ]
  return <DataTable columns={cols} rows={data} rowKey={x => x.r.key + x.i} caption="Borrower and portfolio ratios" captionHidden density="compact" />
}
