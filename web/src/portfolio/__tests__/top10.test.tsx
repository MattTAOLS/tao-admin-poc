// @vitest-environment jsdom
/** Top 10 obligor concentration on the deal page, from the real reference objects: Finloc (CAD / USD split, six
 * obligors over the 5% limit), TPine (limit given as text, one over), Dynamic Capital (all within), Moneda (none). */
import '@/design/test-utils'
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { App } from '@/shell/App'
import { KEY } from '@/shell/roles'
import { headerStore } from '@/shell/header'
import { DealView } from '../DealPage'
import { parseNum } from '../Num'
import type { NumKind } from '../fmt'
import { apiDeal, apiProgram, at, deals } from './fixtures'

const FINLOC = 'move-trust-finloc-2000-inc'
const TPINE = 'move-trust-tpine-leasing-capital-corporation'
const DYNAMIC = 'move-trust-dynamic-capital'
const MONEDA = 'f-pil-2-0-moneda-capital-corp'

const view = (slug: string) => render(<MemoryRouter><DealView d={apiDeal(slug)} /></MemoryRouter>)
const toggle = () => screen.getByRole('button', { name: /obligors$/ })
const table = () => screen.getByRole('table', { name: 'Top 10 obligor concentration' })
const bodyRows = () => within(table()).getAllByRole('row').filter(r => r.closest('tbody'))

describe('Top 10 obligor concentration', () => {
  it('is collapsed by default and expands', async () => {
    view(DYNAMIC)
    expect(screen.getByRole('heading', { name: 'Top 10 obligor concentration' })).toBeTruthy()
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('table', { name: 'Top 10 obligor concentration' })).toBeNull()
    expect(screen.getByText(/10 largest obligors, all within the concentration limit · source page 14/)).toBeTruthy()
    await userEvent.click(toggle())
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    expect(bodyRows()).toHaveLength(10)
    expect(within(table()).queryByText('Over limit')).toBeNull()
    await userEvent.click(toggle())
    expect(screen.queryByRole('table', { name: 'Top 10 obligor concentration' })).toBeNull()
  })

  it('flags an obligor over the limit with a dot and a word; a text limit is shown as published', async () => {
    view(TPINE)
    await userEvent.click(toggle())
    const flagged = bodyRows().filter(r => within(r).queryByText('Over limit'))
    const expected = deals[TPINE].top10_obligors!.filter(o => (o.excess_concentration_amount ?? 0) > 0)
    expect(flagged).toHaveLength(expected.length)
    expect(flagged[0].querySelector('.ds-pill--bad .ds-pill__dot')).toBeTruthy()
    expect(within(flagged[0]).getByText(expected[0].obligor_name)).toBeTruthy()
    expect(within(table()).getAllByText('max(3%, $800,000)')).toHaveLength(10)
  })

  it('Finloc: CAD, USD and total amounts equal the reference, six obligors over limit', async () => {
    view(FINLOC)
    expect(screen.getByText(/6 of 10 obligors over the concentration limit · amounts by currency as reported; concentration is on the total · source page 18/)).toBeTruthy()
    await userEvent.click(toggle())
    const heads = within(table()).getAllByRole('columnheader').map(h => h.textContent)
    expect(heads).toEqual(expect.arrayContaining(['CAD amount', 'USD amount', 'Total contract amount']))
    expect(within(table()).getAllByText('Over limit')).toHaveLength(6)
    expect(within(bodyRows()[0]).getAllByText('$6,769,167')).toHaveLength(2) // CAD and total
    expect(within(bodyRows()[0]).getByText('$4,349,823')).toBeTruthy() // excess
    // Every number in the table reads back to the reference object.
    const ref = deals[FINLOC]
    const cells = table().querySelectorAll<HTMLElement>('[data-field]')
    expect(cells.length).toBeGreaterThan(60)
    for (const el of cells) {
      const exp = at(ref, el.dataset.field!) as number
      const got = parseNum(el.textContent ?? '', el.dataset.kind as NumKind)
      expect(Math.abs((got ?? NaN) - exp), el.dataset.field).toBeLessThanOrEqual(el.dataset.kind === 'pct' ? 0.0001 : 1)
    }
  })

  it('renders nothing for a deal without top10_obligors (F-PIL)', () => {
    expect(deals[MONEDA].top10_obligors ?? []).toHaveLength(0)
    view(MONEDA)
    expect(screen.queryByText(/Top 10 obligor/)).toBeNull()
    expect(screen.queryByRole('button', { name: /obligors$/ })).toBeNull()
  })
})

describe('on the deal page routes', () => {
  function fakeFetch(input: RequestInfo | URL) {
    const path = new URL(String(input), 'http://x').pathname.replace(/^.*\/api\/v1/, '')
    let m: RegExpMatchArray | null
    const ok = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    if ((m = path.match(/^\/published\/programs\/[^/]+\/deals\/([^/]+)$/))) return ok(apiDeal(m[1]))
    if ((m = path.match(/^\/published\/programs\/([^/]+)$/))) return ok(apiProgram(m[1]))
    return ok([])
  }
  beforeAll(async () => { await import('../DealRoute') })
  beforeEach(() => { localStorage.clear(); headerStore.clear(); vi.stubGlobal('fetch', vi.fn(fakeFetch)) })
  afterEach(() => { vi.unstubAllGlobals() })

  for (const [path, role] of [[`/admin/portfolio/move-trust/deals/${FINLOC}`, 'tao_admin'], [`/investor/portfolio/move-trust/deals/${FINLOC}`, 'investor_viewer']]) {
    it(`${role}: the panel is on the deal page, collapsed`, async () => {
      localStorage.setItem(KEY, role)
      render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
      expect(await screen.findByRole('heading', { name: 'Top 10 obligor concentration' })).toBeTruthy()
      await waitFor(() => expect(toggle().getAttribute('aria-expanded')).toBe('false'))
    })
  }
})
