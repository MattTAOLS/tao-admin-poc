import type { Meta, StoryObj } from '@storybook/react'
import { KpiTile, KpiRow, StatusPill, formatCurrency, formatPercent, formatNumber, formatPeriod } from '../components'
import { programMove, programFpil, num } from './fixtures'

const meta: Meta<typeof KpiTile> = { title: 'Design System/KpiTile', component: KpiTile, tags: ['autodocs'], decorators: [S => <div style={{ maxWidth: 320 }}><S /></div>] }
export default meta
type S = StoryObj<typeof KpiTile>

const t = programMove.portfolio_totals
const chg = num(t.tranche_balance_change_abs) ?? 0

/** MOVE Trust tranche balance, period 2026-07, from docs/dashboard-json/program-move-trust.dashboard.json. */
export const WithDelta: S = {
  args: {
    label: 'Tranche balance', value: formatCurrency(num(t.closing_tranche_balance), { compact: true }),
    delta: { value: formatPercent(num(t.tranche_balance_change_pct)), direction: chg > 0 ? 'up' : chg < 0 ? 'down' : 'flat' },
    context: `${formatCurrency(chg, { compact: true })} vs prior period`,
  },
}
/** Delta tone: the arrow shows the direction, the colour shows whether the move is good or bad for the metric.
 * Finloc 2000 Inc. delinquency ratio 10.47% → 8.83% (move-trust-finloc-2000-inc.dashboard.json, MSA 8.1 (b)):
 * falling, so green, even though the covenant is in BREACH. A balance takes the neutral tone (grey). */
export const DeltaToneGood: S = {
  args: { label: 'Delinquency ratio', value: formatPercent(0.0883), delta: { value: '−1.64 pp', direction: 'down', tone: 'good' }, context: 'vs last period' },
}
/** Essex Lease Financial Corp. delinquency ratio 1.14% → 1.31% (move-trust-essex-lease-financial-corp.dashboard.json,
 * MSA 8.1 (d)): rising on a lower-is-better metric, so red, while the covenant is still OK. */
export const DeltaToneBad: S = {
  args: { label: 'Delinquency ratio', value: formatPercent(0.0131), delta: { value: '+0.17 pp', direction: 'up', tone: 'bad' }, context: 'vs last period' },
}
export const DeltaToneNeutral: S = {
  args: {
    label: 'Tranche balance', value: formatCurrency(num(t.closing_tranche_balance), { compact: true }),
    delta: { value: formatPercent(num(t.tranche_balance_change_pct)), direction: chg > 0 ? 'up' : chg < 0 ? 'down' : 'flat', tone: 'neutral' },
    context: 'balances have no good or bad direction',
  },
}
export const WithUnit: S = { args: { label: 'Deals', value: formatNumber(programMove.deal_count), unit: 'deals', context: `MOVE Trust · ${formatPeriod(programMove.period)}` } }
export const ToneBad: S = { args: { label: 'Covenants in breach', value: String(programMove.covenant_totals.BREACH), tone: 'bad', context: `${programMove.covenant_totals.WATCH} on watch · ${programMove.covenant_totals.OK} OK` } }
export const WithAdornment: S = { args: { label: 'Utilization', value: formatPercent(num(t.program_utilization_pct), { decimals: 1 }), adornment: <StatusPill tone="blue" size="sm">weighted</StatusPill>, context: 'drawn ÷ limit, weighted by facility size' } }
export const Empty: S = { args: { label: 'Published this month', context: 'No data from the API yet' } }
export const Loading: S = { args: { label: 'Tranche balance', loading: true } }

/** A row of tiles for both programs, as the Portfolio Executive Summary would lay them out. */
export const Row: S = {
  decorators: [S => <div style={{ maxWidth: 'none' }}><S /></div>],
  render: () => (
    <KpiRow>
      {[programMove, programFpil].map(p => (
        <KpiTile key={p.period + p.deal_count} label={`${p.deal_count} deals · ${formatPeriod(p.period)}`}
          value={formatCurrency(num(p.portfolio_totals.closing_tranche_balance), { compact: true })}
          delta={{ value: formatPercent(num(p.portfolio_totals.tranche_balance_change_pct)), direction: (num(p.portfolio_totals.tranche_balance_change_abs) ?? 0) < 0 ? 'down' : 'up' }}
          context="tranche balance" />
      ))}
      <KpiTile label="Breach" value={String(programMove.covenant_totals.BREACH + programFpil.covenant_totals.BREACH)} tone="bad" context="covenants across programs" />
      <KpiTile label="Watch" value={String(programMove.covenant_totals.WATCH + programFpil.covenant_totals.WATCH)} tone="warn" context="covenants across programs" />
      <KpiTile label="Loading" loading />
    </KpiRow>
  ),
}
