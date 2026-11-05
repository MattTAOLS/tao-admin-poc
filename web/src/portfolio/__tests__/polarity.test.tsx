// @vitest-environment jsdom
/** Trend colours (phase 2 wave A item 5): colour = good or bad for the metric, arrow = direction. Covenant rows are
 * real rows from docs/dashboard-json; the published trend word is coloured, never recomputed. */
import '@/design/test-utils'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Trend } from '../Covenants'
import { DealView } from '../DealPage'
import { ProgramDashboardView } from '../ProgramDashboard'
import { PortfolioView } from '../PortfolioSummary'
import { METRIC_POLARITY, covenantTrendTone, deltaTone, kindPolarity } from '../polarity'
import type { Covenant } from '../types'
import { apiDeal, apiPortfolio, apiProgram, deals, programs } from './fixtures'

const cov = (deal: string, ref: string) => {
  const c = deals[deal].covenants.find(x => x.legal_ref === ref)
  if (!c) throw new Error(`${deal} ${ref} not in the reference data`)
  return c
}
const trendCell = (c: Covenant) => {
  const { container } = render(<Trend trend={c.trend} kind={c.kind} />)
  return container.firstElementChild as HTMLElement
}

describe('covenant trend colour from kind', () => {
  it('Finloc delinquency in BREACH but falling is green', () => {
    const c = cov('move-trust-finloc-2000-inc', 'MSA 8.1 (b)')
    expect([c.kind, c.trend, c.status]).toEqual(['ceiling', 'falling', 'BREACH'])
    const el = trendCell(c)
    expect(el.className).toBe('pf-trend pf-trend--good')
    expect(el.getAttribute('title')).toBe('Falling: better for this covenant')
    expect(el.textContent).toBe('▼ Falling, better')
  })
  it("TPine's negative loss ratio rising is red", () => {
    const c = cov('move-trust-tpine-leasing-capital-corporation', 'MLA 7.1 (j)')
    expect(c.current_value).toBeLessThan(0)
    expect([c.kind, c.trend]).toEqual(['ceiling', 'rising'])
    const el = trendCell(c)
    expect(el.className).toBe('pf-trend pf-trend--bad')
    expect(el.getAttribute('title')).toBe('Rising: worse for this covenant')
    expect(el.textContent).toBe('▲ Rising, worse')
  })
  it('a ceiling covenant rising is red (Essex delinquency)', () => {
    const c = cov('move-trust-essex-lease-financial-corp', 'MSA 8.1 (d)')
    expect([c.kind, c.trend]).toEqual(['ceiling', 'rising'])
    expect(trendCell(c).className).toBe('pf-trend pf-trend--bad')
  })
  it('a floor covenant rising is green (Finloc interest coverage, in BREACH)', () => {
    const c = cov('move-trust-finloc-2000-inc', 'MSA 8.1 (e)')
    expect([c.kind, c.trend, c.status]).toEqual(['floor', 'rising', 'BREACH'])
    const el = trendCell(c)
    expect(el.className).toBe('pf-trend pf-trend--good')
    expect(el.textContent).toBe('▲ Rising, better')
  })
  it('a floor covenant falling is red', () => {
    expect(covenantTrendTone('floor', 'falling')).toBe('bad')
  })
  it('flat is grey, with no better or worse (Essex coverage published Flat)', () => {
    const c = cov('move-trust-essex-lease-financial-corp', 'MSA 8.1 (h)')
    expect([c.kind, c.trend]).toEqual(['floor', 'flat'])
    const el = trendCell(c)
    expect(el.className).toBe('pf-trend pf-trend--flat')
    expect(el.getAttribute('title')).toBe('Flat')
    expect(el.textContent).toBe('■ Flat')
  })
  it('n/a stays grey "n/a" (CNL rows)', () => {
    const c = cov('move-trust-finloc-2000-inc', 'MSA 8.1 (d)')
    expect(c.trend).toBe('n/a')
    const el = trendCell(c)
    expect(el.className).toBe('pf-muted')
    expect(el.textContent).toBe('n/a')
  })
  it('a binary test gets no colour even if a trend word were published', () => {
    expect(kindPolarity('binary')).toBe('neutral')
    const { container } = render(<Trend trend="rising" kind="binary" />)
    const el = container.firstElementChild as HTMLElement
    expect(el.className).toBe('pf-trend')
    expect(el.textContent).toBe('▲ Rising')
  })
  it('every covenant in the 12 reference deals is coloured from its kind and published trend word only', () => {
    for (const d of Object.values(deals)) for (const c of d.covenants) {
      const want = c.trend === 'flat' ? 'flat'
        : !['rising', 'falling'].includes(c.trend) ? null
        : c.kind === 'ceiling' ? (c.trend === 'falling' ? 'good' : 'bad')
        : c.kind === 'floor' ? (c.trend === 'rising' ? 'good' : 'bad') : 'plain'
      const el = trendCell(c)
      const got = el.className === 'pf-muted' ? null : el.className === 'pf-trend' ? 'plain' : el.className.replace('pf-trend pf-trend--', '')
      expect(`${d.deal_slug} ${c.legal_ref}: ${got}`).toBe(`${d.deal_slug} ${c.legal_ref}: ${want}`)
    }
  })
  it('the deal page and the Program Dashboard covenant tables both colour trends', () => {
    const { container: deal } = render(<MemoryRouter><DealView d={apiDeal('move-trust-finloc-2000-inc')} /></MemoryRouter>)
    expect(deal.querySelectorAll('.pf-trend--good').length).toBeGreaterThan(0)
    const { container: prog } = render(<MemoryRouter><ProgramDashboardView p={apiProgram('move-trust')} /></MemoryRouter>)
    expect(prog.querySelectorAll('.pf-trend--good').length).toBeGreaterThan(0)
    expect(prog.querySelectorAll('.pf-trend--bad').length).toBeGreaterThan(0)
  })
})

describe('KPI delta polarity map', () => {
  it('ratios: lower is better except coverage; balances are neutral', () => {
    expect(METRIC_POLARITY).toEqual({
      delinquency_ratio: 'lower', loss_ratio: 'lower', cnl_ratio: 'lower', coverage_ratio: 'higher', leverage_ratio: 'lower',
      tranche_balance: 'neutral', contracts: 'neutral', warehouse_advances: 'neutral',
    })
    expect(deltaTone('delinquency_ratio', 'up')).toBe('bad')
    expect(deltaTone('loss_ratio', 'down')).toBe('good')
    expect(deltaTone('cnl_ratio', 'up')).toBe('bad')
    expect(deltaTone('coverage_ratio', 'up')).toBe('good')
    expect(deltaTone('leverage_ratio', 'up')).toBe('bad')
    expect(deltaTone('tranche_balance', 'up')).toBe('neutral')
    expect(deltaTone('tranche_balance', 'down')).toBe('neutral')
    expect(deltaTone('delinquency_ratio', 'flat')).toBe('neutral')
  })
  it('every KPI tile with a delta on the portfolio pages takes its tone from the map', () => {
    const roots = [
      ...Object.keys(deals).map(s => render(<MemoryRouter><DealView d={apiDeal(s)} /></MemoryRouter>).container),
      ...Object.keys(programs).map(s => render(<MemoryRouter><ProgramDashboardView p={apiProgram(s)} /></MemoryRouter>).container),
      render(<MemoryRouter><PortfolioView data={apiPortfolio(null)} /></MemoryRouter>).container,
    ]
    let n = 0
    for (const r of roots) r.querySelectorAll('.ds-kpi__delta').forEach(el => {
      n++
      // Balances, contracts and warehouse advances are the only deltas shown today: all neutral (grey).
      expect(el.className).toBe('ds-kpi__delta ds-kpi__delta--neutral')
    })
    expect(n).toBeGreaterThan(20)
  })
})
