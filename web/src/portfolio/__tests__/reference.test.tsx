// @vitest-environment jsdom
/** Done-when check: for every published deal, the numbers on screen equal the reference dashboard.json within
 * $1 / 0.01 pp. Each view is rendered with the reference object; every element carrying data-field is read back
 * from its displayed text and compared with the value at that path in the file. */
import '@/design/test-utils'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DealView } from '../DealPage'
import { ProgramDashboardView } from '../ProgramDashboard'
import { ProgramSummaryView } from '../ProgramSummary'
import { PortfolioView } from '../PortfolioSummary'
import { parseNum } from '../Num'
import { displayStatus, type NumKind } from '../fmt'
import { correctionKind, correctionLabel } from '../Corrections'
import { DEAL_FILES, apiPortfolio, apiProgram, at, deals, programs } from './fixtures'

const TOL: Record<NumKind, number> = { money: 1, 'signed-money': 1, pct: 0.0001, ratio: 0.005, count: 0.5, 'signed-count': 0.5 }

type Checked = { path: string; shown: string; expected: number; diff: number }
function checkFields(root: HTMLElement, source: unknown) {
  const bad: string[] = []
  const seen = new Set<string>()
  const checked: Checked[] = []
  root.querySelectorAll<HTMLElement>('[data-field]').forEach(el => {
    const path = el.dataset.field!, kind = el.dataset.kind as NumKind
    const expected = at(source, path)
    const shown = el.textContent ?? ''
    const got = parseNum(shown, kind)
    seen.add(path)
    if (expected === null || expected === undefined) { if (got !== null) bad.push(`${path}: shows ${shown}, file has none`); return }
    if (typeof expected !== 'number') { bad.push(`${path}: not a number in the file`); return }
    if (got === null) { bad.push(`${path}: shows a dash, file has ${expected}`); return }
    const diff = Math.abs(got - expected)
    checked.push({ path, shown, expected, diff })
    if (diff > TOL[kind] + 1e-9) bad.push(`${path}: shows ${shown} (${got}), file ${expected}, off by ${diff}`)
  })
  return { bad, seen, checked }
}

const wrap = (ui: React.ReactNode, at = '/investor/portfolio') => render(<MemoryRouter initialEntries={[at]}>{ui}</MemoryRouter>)

describe('deal page numbers equal the reference dashboard.json', () => {
  it('covers all 12 reference deals', () => { expect(DEAL_FILES).toHaveLength(12) })

  for (const slug of Object.keys(deals)) {
    it(slug, () => {
      const d = deals[slug]
      const { container } = wrap(<DealView d={d} />)
      const { bad, seen, checked } = checkFields(container, d)
      expect(bad).toEqual([])
      // Everything the brief lists for the deal page is on screen.
      const required = [
        'tranche_balance.opening', 'tranche_balance.closing', 'tranche_balance.change_abs', 'tranche_balance.change_pct',
        'tranche_balance.principal', 'tranche_balance.principal_prepayments', 'tranche_balance.losses', 'tranche_balance.recoveries',
        'contracts.opening', 'contracts.closing', 'contracts.change_abs',
        'covenant_summary.BREACH', 'covenant_summary.WATCH', 'covenant_summary.OK',
        ...d.aging_history.flatMap((_, i) => ['current_0_30', 'days_31_60', 'days_61_90', 'written_off', 'closing_balance'].map(k => `aging_history.${i}.${k}`)),
        ...d.period_history.map((_, i) => `period_history.${i}.closing_balance`),
        ...d.cnl_by_period.map((_, i) => `cnl_by_period.${i}.cnl_ratio_pct`),
        ...d.financial_ratios.map((_, i) => `financial_ratios.${i}.value`),
        ...d.covenants.flatMap((c, i) => [c.current_value !== null ? `covenants.${i}.current_value` : '', c.threshold !== null ? `covenants.${i}.threshold` : '', c.utilization_pct !== null ? `covenants.${i}.utilization_pct` : ''].filter(Boolean)),
        ...(d.program ? ['program.program_utilization_pct', 'program.program_limit', 'program.program_amount'] : []),
        ...(d.data_corrections ?? []).flatMap((_, i) => [`data_corrections.${i}.old_value`, `data_corrections.${i}.new_value`]),
      ]
      expect(required.filter(p => !seen.has(p))).toEqual([])
      expect(checked.length).toBeGreaterThan(40)
      // The ratio chart shows the latest 13 months of one series when the deal has a history.
      const chartCells = [...seen].filter(p => p.startsWith('ratio_history.'))
      expect(chartCells.length).toBe(Math.min(13, d.ratio_history.filter(r => typeof r.month === 'string').length))
    })
  }
})

describe('program pages equal the reference program dashboard.json', () => {
  for (const slug of Object.keys(programs)) {
    it(`${slug} dashboard: tiles, deal metrics and every covenant row`, () => {
      const p = apiProgram(slug)
      const { container } = wrap(<ProgramDashboardView p={p} />)
      const { bad, seen } = checkFields(container, p)
      expect(bad).toEqual([])
      const required = ['portfolio_totals.closing_tranche_balance', 'portfolio_totals.tranche_balance_change_abs', 'portfolio_totals.program_utilization_pct',
        'portfolio_totals.total_program_amount', 'portfolio_totals.total_program_limit', 'portfolio_totals.closing_contracts',
        'covenant_totals.BREACH', 'covenant_totals.WATCH', 'covenant_totals.OK',
        ...p.deals.flatMap((d, di) => [`deals.${di}.tranche_balance.closing`, ...d.covenants.map((c, ci) => c.current_value !== null ? `deals.${di}.covenants.${ci}.current_value` : '').filter(Boolean)])]
      expect(required.filter(x => !seen.has(x))).toEqual([])
      // Deal × covenant: one row per covenant of every deal.
      const n = p.deals.reduce((s, d) => s + d.covenants.length, 0)
      expect(container.querySelectorAll('table[class~="ds-table"]')[1].querySelectorAll('tbody tr').length).toBe(n)
    })
    it(`${slug} executive summary`, () => {
      const p = apiProgram(slug)
      const { container } = wrap(<ProgramSummaryView p={p} />)
      const { bad, seen } = checkFields(container, p)
      expect(bad).toEqual([])
      expect(p.deals.every((_, i) => seen.has(`deals.${i}.tranche_balance.closing`))).toBe(true)
    })
  }
  it('portfolio summary tiles per program', () => {
    const pf = apiPortfolio(null)
    const { container } = wrap(<PortfolioView data={pf} />)
    pf.programs.forEach((p, i) => {
      const card = container.querySelectorAll<HTMLElement>('section.ds-card')[i]
      const { bad, seen } = checkFields(card, p)
      expect(bad).toEqual([])
      expect(seen.has('portfolio_totals.closing_tranche_balance') && seen.has('portfolio_totals.program_utilization_pct') && seen.has('covenant_totals.BREACH')).toBe(true)
    })
  })
})

describe('data corrections', () => {
  it('six reference deals carry data_corrections and each shows a Data corrections section', () => {
    const withCorr = Object.values(deals).filter(d => (d.data_corrections ?? []).length > 0)
    expect(withCorr).toHaveLength(6)
    for (const d of withCorr) {
      const { container, unmount } = wrap(<DealView d={d} />)
      const table = container.querySelector('table caption')
      const corr = [...container.querySelectorAll('table')].find(t => t.querySelector('caption')?.textContent === 'Data corrections')!
      expect(table && corr).toBeTruthy()
      const rows = corr.querySelectorAll('tbody tr')
      expect(rows).toHaveLength(d.data_corrections!.length)
      const c = d.data_corrections![0]
      expect(rows[0].textContent).toContain('Balance history · Interest')
      expect(rows[0].textContent).toContain(c.applied as string)
      expect(rows[0].textContent).toContain(String(c.reason).slice(0, 40))
      unmount()
    }
  })
  it('deals without data_corrections have no section', () => {
    const d = deals['f-pil-2-0-moneda-capital-corp']
    const { container } = wrap(<DealView d={d} />)
    expect([...container.querySelectorAll('caption')].some(c => c.textContent === 'Data corrections')).toBe(false)
  })
  it('labels and units for API-written corrections (pointer fields)', () => {
    expect(correctionLabel({ record: 'period_history', field: '3/closing_balance' })).toBe('Balance history · Closing balance')
    expect(correctionLabel({ record: 'tranche_balance', field: 'closing' })).toBe('Balance · Closing')
    expect(correctionLabel({ record: 'covenants', field: '2/current_value' })).toBe('Covenant · Value')
    expect(correctionLabel({ record: 'something_new', field: 'odd_field' })).toBe('Something new · Odd field')
    expect(correctionKind({ record: 'cnl_by_period', field: '0/cnl_ratio_pct' })).toBe('pct')
    expect(correctionKind({ record: 'contracts', field: 'closing' })).toBe('count')
    expect(correctionKind({ record: 'period_history', field: '1/closing_contracts' })).toBe('count')
    expect(correctionKind({ record: 'tranche_balance', field: 'closing' })).toBe('money')
  })
  it('an API correction shows rule, choice and the values as written', () => {
    const d = { ...deals['f-pil-2-0-moneda-capital-corp'], data_corrections: [
      { period: '2026-08', record: 'tranche_balance', field: 'closing', old_value: 15019971.52, new_value: 15019970.52, applied: '2026-11-03', reason: 'Report total off by $1', rule_id: 'R05', choice: 'use_ours', finding_id: 'f1' },
    ] }
    const { container } = wrap(<DealView d={d} />)
    const corr = [...container.querySelectorAll('table')].find(t => t.querySelector('caption')?.textContent === 'Data corrections')!
    expect(corr.textContent).toContain('R05 · kept our recomputation')
    expect(corr.textContent).toContain('$15,019,972')
    expect(corr.textContent).toContain('$15,019,971')
    expect(checkFields(container, d).bad).toEqual([])
  })
})

describe('watch threshold re-classification', () => {
  it('reproduces every published covenant status at the published buffer when recomputed', () => {
    // displayStatus short-circuits at the published buffer; recompute with a hair of difference to exercise the rule.
    const mismatches: string[] = []
    for (const d of Object.values(deals)) for (const c of d.covenants) {
      const s = displayStatus(c, d.watch_buffer_pct + 1e-12, d.watch_buffer_pct + 1)
      if (s !== c.status) mismatches.push(`${d.deal_slug} ${c.legal_ref}: ${c.status} vs ${s}`)
    }
    expect(mismatches).toEqual([])
  })
})
