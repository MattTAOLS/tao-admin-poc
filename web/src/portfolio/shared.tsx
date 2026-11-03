import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button, KpiRow, KpiTile, SkeletonBlock, StatePanel, type Crumb } from '@/design/components'
import type { Load } from './data'
import { commonDealNamePrefix, terms } from './fmt'
import { Num } from './Num'
import type { ShellId } from './nav'
import type { PortfolioProgram, ProgramAggregate } from './types'
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

/** A router link with the Design System's button look (Button renders a <button>, not a link). */
export function LinkButton({ to, children, variant = 'ghost', size = 'sm', ariaLabel }: { to: string; children: ReactNode; variant?: 'ghost' | 'primary'; size?: 'sm' | 'md'; ariaLabel?: string }) {
  return <Link to={to} aria-label={ariaLabel} className={['ds-btn', `ds-btn--${variant}`, size === 'sm' && 'ds-btn--sm'].filter(Boolean).join(' ')}>{children}</Link>
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
  return (
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
      <KpiTile label="Covenant tests" tone={c.BREACH ? 'bad' : c.WATCH ? 'warn' : 'ok'}
        value={<><Num v={c.BREACH} kind="count" field={f('covenant_totals.BREACH')} /> <span className="pf-kpiword">breach</span> · <Num v={c.WATCH} kind="count" field={f('covenant_totals.WATCH')} /> <span className="pf-kpiword">watch</span></>}
        context={<><Num v={c.OK} kind="count" field={f('covenant_totals.OK')} /> OK · <Num v={c.AVAILABLE} kind="count" field={f('covenant_totals.AVAILABLE')} /> available</>} />
      <KpiTile label="Deals flagged" tone={flagged ? 'warn' : 'ok'} value={<><Num v={flagged} kind="count" /> <span className="pf-kpiword">of {p.deal_count}</span></>}
        context={flagged ? 'at WATCH or BREACH' : 'All deals OK'} />
    </KpiRow>
  )
}

export function crumbs(shell: ShellId, portfolioHref: string, ...rest: Crumb[]): Crumb[] {
  return [{ label: SHELL_TITLE[shell] }, { label: 'Portfolio Executive Summary', href: portfolioHref }, ...rest]
}
