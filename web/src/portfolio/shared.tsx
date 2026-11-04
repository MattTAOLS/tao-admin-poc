import type { ReactNode } from 'react'
import { Button, KpiRow, KpiTile, SkeletonBlock, StatePanel, StatusPill, formatPeriod, type Crumb } from '@/design/components'
import type { Load } from './data'
import { commonDealNamePrefix, shortName, terms } from './fmt'
import { Num } from './Num'
import type { ShellId } from './nav'
import type { DealBehind, PortfolioProgram, ProgramAggregate } from './types'
import './portfolio.css'

export const SHELL_TITLE: Record<ShellId, string> = { admin: 'TAO Admin', investor: 'Investor Portal', manager: 'Manager Portal' }

/** Loading skeleton, no access, error with retry; renders children only with data. */
export function LoadGate<T>({ load, children }: { load: Load<T>; children: (data: T) => ReactNode }) {
  if (load.state === 'loading') return <PageSkeleton />
  if (load.state === 'no-access') return <StatePanel kind="no-access" message="This program or deal belongs to another partner, or has not been published to you." />
  if (load.state === 'error') return <StatePanel kind="error" message={load.message} actions={<Button variant="primary" onClick={load.retry}>Retry</Button>} />
  return <>{children(load.data)}</>
}

export function PageSkeleton() {
  return (
    <div className="pf-stack" aria-busy="true">
      <KpiRow>{[0, 1, 2, 3].map(i => <KpiTile key={i} label={<SkeletonBlock width="50%" height={10} />} loading />)}</KpiRow>
      <div className="ds-card ds-card--pad"><SkeletonBlock lines={6} /></div>
      <span className="ds-visually-hidden">Loading</span>
    </div>
  )
}

type AnyProgram = ProgramAggregate | PortfolioProgram

export function programSlug(p: AnyProgram): string {
  if (p.program?.slug) return p.program.slug
  // Contract-only fallback: the deal slugs share the program slug as a prefix ("f-pil-2-0-moneda-…").
  const slugs = p.deals.map(d => d.deal_slug)
  let pre = slugs[0] ?? ''
  for (const s of slugs.slice(1)) { let i = 0; while (i < pre.length && pre[i] === s[i]) i++; pre = pre.slice(0, i) }
  return pre.replace(/-+$/, '')
}
export function programName(p: AnyProgram): string {
  return p.program?.name || commonDealNamePrefix(p.deals.map(d => d.deal_name)) || programSlug(p)
}

export const isFlagged = (status: string) => status === 'WATCH' || status === 'BREACH'
const dirOf = (v: number | null | undefined) => (v ?? 0) > 0 ? 'up' as const : (v ?? 0) < 0 ? 'down' as const : 'flat' as const

/** The program KPI tiles: balance with change, contracts, utilization (weighted by facility size, as published),
 * warehouse advances when the program has them, covenant counts, deals flagged. Fields are relative to the program
 * object, prefixed with `field` for the reference test. */
export function ProgramTiles({ p, compact = false, field = '' }: { p: AnyProgram; compact?: boolean; field?: string }) {
  const t = p.portfolio_totals
  const label = terms(p.terminology ?? undefined)
  const c = p.covenant_totals
  const flagged = p.deals.filter(d => isFlagged(String(d.worst_status))).length
  const f = (s: string) => field + s
  const hasWarehouse = !!(t.deals_with_warehouse && t.deals_with_warehouse.length) && t.total_warehouse_closing_advances !== null && t.total_warehouse_closing_advances !== undefined
  const covTile = (
    <KpiTile label="Covenant tests" tone={c.BREACH ? 'bad' : c.WATCH ? 'warn' : 'ok'}
      value={<><Num v={c.BREACH} kind="count" field={f('covenant_totals.BREACH')} /> <span className="pf-kpiword">breach</span> · <Num v={c.WATCH} kind="count" field={f('covenant_totals.WATCH')} /> <span className="pf-kpiword">watch</span></>}
      context={<><Num v={c.OK} kind="count" field={f('covenant_totals.OK')} /> OK · <Num v={c.AVAILABLE} kind="count" field={f('covenant_totals.AVAILABLE')} /> available</>} />
  )
  const flaggedTile = (
    <KpiTile label="Deals flagged" tone={flagged ? 'warn' : 'ok'} value={<><Num v={flagged} kind="count" /> <span className="pf-kpiword">of {p.deal_count}</span></>}
      context={flagged ? 'at WATCH or BREACH' : 'All deals OK'} />
  )
  // Compact (portfolio cards): one row of four. Full (program pages): money tiles, then status tiles, so a
  // nine-digit balance never runs out of room in its tile.
  const moneyRow = (
    <KpiRow>
      <KpiTile label={`Total ${label.balance}`} value={<Num v={t.closing_tranche_balance} kind="money" field={f('portfolio_totals.closing_tranche_balance')} />}
        delta={t.tranche_balance_change_abs === null || t.tranche_balance_change_abs === undefined ? undefined : {
          direction: dirOf(t.tranche_balance_change_abs), label: 'Change vs last period',
          value: <><Num v={t.tranche_balance_change_abs} kind="signed-money" field={f('portfolio_totals.tranche_balance_change_abs')} /> (<Num v={t.tranche_balance_change_pct} kind="pct" field={f('portfolio_totals.tranche_balance_change_pct')} />)</>,
        }} context="vs last period" />
      {!compact && (
        <KpiTile label="Outstanding contracts" value={<Num v={t.closing_contracts} kind="count" field={f('portfolio_totals.closing_contracts')} />}
          delta={t.contracts_change_abs === null || t.contracts_change_abs === undefined ? undefined : {
            direction: dirOf(t.contracts_change_abs), label: 'Change vs last period',
            value: <><Num v={t.contracts_change_abs} kind="signed-count" field={f('portfolio_totals.contracts_change_abs')} /> (<Num v={t.contracts_change_pct} kind="pct" field={f('portfolio_totals.contracts_change_pct')} />)</>,
          }} context="vs last period" />
      )}
      <KpiTile label="Program utilization" value={<Num v={t.program_utilization_pct} kind="pct" field={f('portfolio_totals.program_utilization_pct')} />}
        context={<><Num v={t.total_program_amount} kind="money" field={f('portfolio_totals.total_program_amount')} /> of <Num v={t.total_program_limit} kind="money" field={f('portfolio_totals.total_program_limit')} />, weighted by facility size</>} />
      {!compact && hasWarehouse && (
        <KpiTile label="Warehouse advances" value={<Num v={t.total_warehouse_closing_advances} kind="money" field={f('portfolio_totals.total_warehouse_closing_advances')} />}
          delta={t.warehouse_advances_change_abs === null || t.warehouse_advances_change_abs === undefined ? undefined : {
            direction: dirOf(t.warehouse_advances_change_abs), label: 'Change vs last period',
            value: <Num v={t.warehouse_advances_change_abs} kind="signed-money" field={f('portfolio_totals.warehouse_advances_change_abs')} />,
          }} context="vs last period" />
      )}
      {compact && covTile}
      {compact && flaggedTile}
    </KpiRow>
  )
  if (compact) return moneyRow
  return <div className="pf-stack">{moneyRow}<KpiRow className="pf-kpi-status">{covTile}{flaggedTile}</KpiRow></div>
}

export function crumbs(shell: ShellId, portfolioHref: string, ...rest: Crumb[]): Crumb[] {
  return [{ label: SHELL_TITLE[shell] }, { label: 'Portfolio Executive Summary', href: portfolioHref }, ...rest]
}

/** A program month lists every deal: a deal whose newest publication is older than the month is in the aggregate at
 * its own month and listed in `deals_behind`. Absent or empty `deals_behind` means every deal is at `period`. */
export function behindOf(p: AnyProgram, dealSlug: string): DealBehind | undefined {
  return (p.deals_behind ?? []).find(b => b.deal_slug === dealSlug)
}

/** The month to open a deal at from a program view: its own publication month, never the program month when they
 * differ, because the deal endpoint has nothing for a month the deal was not published in. */
export function dealMonth(p: AnyProgram, dealSlug: string): string | undefined {
  return behindOf(p, dealSlug)?.as_of ?? p.period
}

/** "As of Jul 2026" on a deal row or card that is behind the program month; nothing when the deal is current. */
export function AsOfPill({ p, dealSlug }: { p: AnyProgram; dealSlug: string }) {
  const b = behindOf(p, dealSlug)
  if (!b) return null
  return <StatusPill tone="blue" size="sm" className="pf-asof" title={`Latest published report: ${formatPeriod(b.as_of)}`}>As of {formatPeriod(b.as_of)}</StatusPill>
}

/** One line under the program totals naming the deals that are behind, e.g. "Moneda Capital Corp. is as of Jul 2026;
 * its Aug 2026 report is not published yet." Renders nothing when every deal is current. */
export function BehindNote({ p }: { p: AnyProgram }) {
  const list = p.deals_behind ?? []
  if (!list.length) return null
  const prefix = commonDealNamePrefix(p.deals.map(d => d.deal_name))
  const name = (b: DealBehind) => shortName(b.deal_name || p.deals.find(d => d.deal_slug === b.deal_slug)?.deal_name || b.deal_slug, prefix)
  const month = formatPeriod(p.period)
  let text: string
  if (list.length === 1) {
    text = `${name(list[0])} is as of ${formatPeriod(list[0].as_of)}; its ${month} report is not published yet.`
  } else {
    const SHOW = 3
    const parts = list.slice(0, SHOW).map(b => `${name(b)} (${formatPeriod(b.as_of)})`)
    const more = list.length - SHOW
    const joined = more > 0 ? `${parts.join(', ')} and ${more} more` : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
    text = `${joined} are behind; their ${month} reports are not published yet.`
  }
  return <p className="pf-behind" role="note">{text}</p>
}
