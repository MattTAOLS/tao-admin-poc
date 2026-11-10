// @vitest-environment jsdom
/// <reference types="node" />
/** Audit M20: the loss and ratio tables in Extracted values show the columns the report actually carries.
 * F-PIL: the recorded Moneda Aug 2026 extraction (fixtures/extraction-moneda.json). MOVE Trust: the real deal objects
 * in docs/dashboard-json (read as they are, no number changed), wrapped in an extraction envelope; the one deliberate
 * change for the Finloc case is a source entry for a loss row and a ratio row, so their page links can be checked. */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import './helpers'
import { formatCurrency, formatPercent } from '@/design/components'
import { ExtractedValues } from '../components/ExtractedValues'
import { EditProvider, type EditMode, type EditTarget } from '../components/EditValue'
import { CommentsProvider } from '../components/Comments'
import type { Extraction, ThreadAnchor } from '../lib/types'
import { pointerLabel } from '../lib/corrections'
import monedaFx from './fixtures/extraction-moneda.json'

const DIR = resolve(__dirname, '../../../..', 'docs/dashboard-json')
const dealObject = (file: string) => JSON.parse(readFileSync(resolve(DIR, file), 'utf8')) as Record<string, unknown>
const DEAL_FILES = readdirSync(DIR).filter(f => f.endsWith('.dashboard.json') && !f.startsWith('program-'))

const LOSSES = 'Cumulative net losses by vintage'
const RATIOS = 'Ratio history'
const SRC = { bbox: null, pass: 1, confidence: 1 }

function moveExtraction(file: string, sources: Extraction['sources'] = {}): Extraction {
  return {
    id: 'ex-move', upload_id: 'up-move', deal: dealObject(file), sources,
    meta: { ...(monedaFx.meta as object), template_id: 'move-trust-settrep-v1', history: { carried: [], periods: [], extended_from: null } } as unknown as Extraction['meta'],
  }
}

function show(ex: Extraction, mode: EditMode = 'read') {
  const onOpen = vi.fn(), onEdit = vi.fn<(t: EditTarget) => void>(), open = vi.fn<(a: ThreadAnchor) => void>()
  render(
    <EditProvider value={{ mode, states: new Map(), onEdit }}>
      <CommentsProvider value={{ threads: [], enabled: true, open }}>
        <ExtractedValues ex={ex} onOpen={onOpen} />
      </CommentsProvider>
    </EditProvider>,
  )
  return { onOpen, onEdit, open }
}
const headers = (name: string) => within(screen.getByRole('table', { name })).getAllByRole('columnheader').map(h => h.textContent)
const bodyRows = (name: string) => within(screen.getByRole('table', { name })).getAllByRole('row').slice(1)
/** Data columns (all but Source and Comments) in which every cell is a dash. */
function emptyColumns(name: string): string[] {
  const hs = headers(name), rows = bodyRows(name)
  return hs.slice(0, -2).filter((_, i) => rows.every(r => (r.children[i].textContent ?? '').trim() === '—'))
}
/** Keys of a row list that hold a value in at least one row (nested objects are other tables' business). */
function valueKeys(rows: Record<string, unknown>[]): string[] {
  const keys = new Set<string>()
  for (const r of rows) for (const [k, v] of Object.entries(r)) if (v != null && v !== '' && typeof v !== 'object') keys.add(k)
  return [...keys]
}

describe('Extracted values: loss and ratio tables follow the report layout (audit M20)', () => {
  it('MOVE Trust (Finloc): semi-annual loss periods and the loss ratio history, every column filled', () => {
    show(moveExtraction('move-trust-finloc-2000-inc.dashboard.json'))
    expect(headers(LOSSES)).toEqual(['Semi-annual period', 'Tranches', 'Period original balance', 'Period CNL', 'CNL ratio', 'Reported ratio', 'Limit', 'Within', 'Source', 'Comments'])
    expect(emptyColumns(LOSSES)).toEqual([])
    const first = bodyRows(LOSSES)[0]
    expect(first.textContent).toContain('1-F, 1-V, 2-F, 2-V, 3-F')
    expect(first.textContent).toContain(formatCurrency(44605824.53))  // period_original_balance
    expect(first.textContent).toContain(formatCurrency(237619.2))     // period_cumulative_net_losses
    expect(first.textContent).toContain(formatPercent(0.005327))      // cnl_ratio_pct, a fraction shown as a percentage
    expect(first.textContent).toContain(formatPercent(0.025))

    expect(headers(RATIOS)).toEqual(['Month', 'Delinquency', 'Loss ratio', 'ICR', 'Leverage', 'Total equity', 'Source', 'Comments'])
    expect(emptyColumns(RATIOS)).toEqual([])
    const jun = bodyRows(RATIOS).find(r => r.children[0].textContent === 'Jun-26')!
    expect(jun.textContent).toContain(formatPercent(0.1047))
    expect(jun.textContent).toContain(formatPercent(0.0022))          // loss_ratio_pct
    expect(jun.children[3].textContent).toBe('0.93x')             // interest_coverage_ratio
    expect(jun.children[4].textContent).toBe('8.91x')             // debt_equity_ratio
    expect(jun.textContent).toContain(formatCurrency(37820511))
  })

  it('MOVE Trust (Finloc): Edit, the source page link and Comment work on the new columns', async () => {
    const { onOpen, onEdit, open } = show(moveExtraction('move-trust-finloc-2000-inc.dashboard.json', {
      '/cnl_by_period/0/period_cumulative_net_losses': { ...SRC, page: 20, raw_text: '237,619.20' },
      '/ratio_history/12/loss_ratio_pct': { ...SRC, page: 21, raw_text: '0.22%' },
    } as unknown as Extraction['sources']), 'edit')
    const row = `${LOSSES}, semi-annual period 1`
    await userEvent.click(screen.getByRole('button', { name: `Edit ${row}, Period CNL` }))
    expect(onEdit).toHaveBeenCalledWith({ pointer: '/cnl_by_period/0/period_cumulative_net_losses', label: `${row}, Period CNL` })
    await userEvent.click(screen.getByRole('button', { name: `Edit ${row}, Period original balance` }))
    expect(onEdit).toHaveBeenLastCalledWith({ pointer: '/cnl_by_period/0/period_original_balance', label: `${row}, Period original balance` })
    await userEvent.click(screen.getByRole('button', { name: `p. 20: ${row}, open source page` }))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ page: 20, caption: row }))
    await userEvent.click(screen.getByRole('button', { name: `Comment on ${row}` }))
    expect(open).toHaveBeenCalledWith({ pointer: '/cnl_by_period/0' })

    await userEvent.click(screen.getByRole('button', { name: `Edit ${RATIOS}, Jun-26, Loss ratio` }))
    expect(onEdit).toHaveBeenLastCalledWith({ pointer: '/ratio_history/12/loss_ratio_pct', label: `${RATIOS}, Jun-26, Loss ratio` })
    await userEvent.click(screen.getByRole('button', { name: `p. 21: ${RATIOS}, Jun-26, open source page` }))
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ page: 21 }))
  })

  it('F-PIL (Moneda): the vintage table as before, and the monthly delinquency ratio the report also prints', () => {
    show(monedaFx as unknown as Extraction)
    expect(headers(LOSSES)).toEqual(['Vintage', 'Advances', 'Original NPV', 'Gross losses', 'Recoveries', 'Est. recoveries', 'CNL', 'CNL ratio', 'Limit', 'Within', 'Source', 'Comments'])
    expect(emptyColumns(LOSSES)).toEqual([])
    expect(headers(RATIOS)).toEqual(['Month', 'Delinquency', 'Monthly delinquency', 'Rolling 3-mo loss', 'Rolling 12-mo loss', 'ICR', 'Leverage', 'Total equity', 'Source', 'Comments'])
    expect(emptyColumns(RATIOS)).toEqual([])
    expect(emptyColumns('Roll-forward by month')).toEqual([])
  })

  it('names a MOVE Trust loss row by its annual or semi-annual period in edit and correction lists', () => {
    const finloc = dealObject('move-trust-finloc-2000-inc.dashboard.json'), tpine = dealObject('move-trust-tpine-leasing-capital-corporation.dashboard.json')
    expect(pointerLabel(finloc, '/cnl_by_period/1/period_cumulative_net_losses')).toBe('CNL semi-annual period 2 · period cumulative net losses')
    expect(pointerLabel(tpine, '/cnl_by_period/0/cumulative_net_losses')).toBe('CNL Nov 2020 - Oct 2021 · cumulative net losses')
    expect(pointerLabel(monedaFx.deal, '/ratio_history/0/delinquency_ratio_pct')).toBe('Ratio history Jul-25 · delinquency ratio %')
  })

  it.each(DEAL_FILES)('%s: every loss and ratio value has a column, and no column is all dashes', file => {
    const deal = dealObject(file)
    show(moveExtraction(file))
    for (const [name, key] of [[LOSSES, 'cnl_by_period'], [RATIOS, 'ratio_history']] as const) {
      const rows = (deal[key] ?? []) as Record<string, unknown>[]
      if (rows.length === 0) { expect(screen.queryByRole('table', { name })).toBeNull(); continue }
      // cnl_limit_is_exception is a yes/no flag, listed only when a row says yes.
      const expected = valueKeys(rows).filter(k => k !== 'cnl_limit_is_exception' || rows.some(r => r.cnl_limit_is_exception === true))
      expect(headers(name).length - 2, `${name}: one column per key in ${expected.join(', ')}`).toBe(expected.length)
      expect(emptyColumns(name)).toEqual([])
    }
    expect(emptyColumns('Roll-forward by month')).toEqual([])
    expect(emptyColumns('Aging')).toEqual([])
    cleanup()
  })
})
