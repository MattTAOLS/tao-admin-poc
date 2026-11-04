// @vitest-environment jsdom
/** A program month lists every deal (contracts/openapi.yaml PublishedProgram.deals_behind). Fixture: the real F-PIL 2.0
 * objects from docs/dashboard-json with one deliberate change, Moneda Capital Corp.'s publication month: Stride and
 * Xpedite are published for 2026-08, Moneda only for 2026-07. The fake API 404s a deal for any month it was not
 * published in, as the real deal endpoint does. */
import '@/design/test-utils'
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { App } from '@/shell/App'
import { KEY } from '@/shell/roles'
import { headerStore } from '@/shell/header'
import { BehindNote } from '../shared'
import type { DealBehind, Portfolio, ProgramAggregate } from '../types'
import { OWNERS, apiDeal, apiPortfolio, apiProgram } from './fixtures'

const MONEDA = 'f-pil-2-0-moneda-capital-corp'
const STRIDE = 'f-pil-2-0-stride-capital'
const XPEDITE = 'f-pil-2-0-xpedite-leasing'
const BEHIND: DealBehind[] = [{ deal_slug: MONEDA, deal_name: 'F-PIL 2.0 - Moneda Capital Corp.', as_of: '2026-07' }]
let behind: DealBehind[] | undefined = BEHIND
let calls: string[] = []

/** The month each deal is published in (the deliberate change: Moneda 2026-07). */
const own = (slug: string) => behind?.find(b => b.deal_slug === slug)?.as_of ?? (slug.startsWith('f-pil') ? '2026-08' : '2026-07')

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}
function withBehind<T extends { program?: { slug: string } }>(p: T): T {
  if (behind === undefined) return p
  return { ...p, deals_behind: p.program?.slug === 'f-pil-2-0' ? behind : [] }
}
function fakeFetch(input: RequestInfo | URL, init?: RequestInit) {
  const u = new URL(String(input), 'http://x')
  calls.push(u.pathname + u.search)
  const partner = ((init?.headers ?? {}) as Record<string, string>)['X-Partner'] ?? null
  const path = u.pathname.replace(/^.*\/api\/v1/, '')
  const period = u.searchParams.get('period')
  let m: RegExpMatchArray | null
  if (path === '/published/portfolio') {
    const pf = apiPortfolio(partner)
    const body: Portfolio = { ...pf, programs: pf.programs.map(withBehind) }
    return respond(200, body)
  }
  if ((m = path.match(/^\/published\/programs\/([^/]+)\/deals\/([^/]+)$/))) {
    const month = own(m[2])
    if (!OWNERS[m[1]] || (period && period !== month)) return respond(404, { code: 'not_found', message: `nothing published for this deal in ${period}` })
    return respond(200, { ...apiDeal(m[2]), published_period: month, available_periods: [month] })
  }
  if ((m = path.match(/^\/published\/programs\/([^/]+)$/))) {
    if (!OWNERS[m[1]]) return respond(404, { code: 'not_found', message: 'no published program' })
    const body: ProgramAggregate = withBehind(apiProgram(m[1]))
    return respond(200, body)
  }
  if (path === '/uploads') return respond(200, [])
  return respond(404, { code: 'not_found', message: path })
}

function Where() { const l = useLocation(); return <output data-testid="where">{l.pathname + l.search}</output> }
function renderAt(path: string, role: string) {
  localStorage.setItem(KEY, role)
  return render(<MemoryRouter initialEntries={[path]}><App /><Where /></MemoryRouter>)
}
const h1 = () => screen.getByRole('heading', { level: 1 })
const NOTE = 'Moneda Capital Corp. is as of Jul 2026; its Aug 2026 report is not published yet.'

beforeAll(async () => { await Promise.all([import('../PortfolioPage'), import('../ProgramPage'), import('../ProgramDashboardPage'), import('../DealRoute')]) })
beforeEach(() => { behind = BEHIND; calls = []; localStorage.clear(); headerStore.clear(); vi.stubGlobal('fetch', vi.fn(fakeFetch)) })
afterEach(() => { vi.unstubAllGlobals() })

describe('a deal behind the program month', () => {
  it('Program Executive Summary: label on the deal card, note under the totals, links at each deal’s own month', async () => {
    renderAt('/admin/portfolio/f-pil-2-0', 'tao_admin')
    await waitFor(() => expect(h1().textContent).toBe('F-PIL 2.0 Executive Summary'))
    const cards = screen.getAllByRole('article')
    expect(within(cards[0]).getByText('As of Jul 2026')).toBeTruthy()
    expect(within(cards[1]).queryByText(/As of/)).toBeNull()
    expect(within(cards[2]).queryByText(/As of/)).toBeNull()
    expect(screen.getByRole('note').textContent).toBe(NOTE)
    expect(screen.getByRole('link', { name: 'Open deal F-PIL 2.0 - Moneda Capital Corp.' }).getAttribute('href')).toBe(`/admin/portfolio/f-pil-2-0/deals/${MONEDA}?period=2026-07`)
    expect(screen.getByRole('link', { name: 'Open deal F-PIL 2.0 - Stride Capital' }).getAttribute('href')).toBe(`/admin/portfolio/f-pil-2-0/deals/${STRIDE}?period=2026-08`)
    // Following the link opens the deal (the fake API 404s Moneda for 2026-08).
    await userEvent.click(screen.getByRole('link', { name: 'Open deal F-PIL 2.0 - Moneda Capital Corp.' }))
    await waitFor(() => expect(h1().textContent).toBe('F-PIL 2.0 - Moneda Capital Corp.'))
    expect(screen.queryByRole('heading', { name: 'You don’t have access' })).toBeNull()
  })

  it('Program Dashboard: label in the deal and covenant tables, note, deal links at the deal’s month', async () => {
    renderAt('/investor/portfolio/f-pil-2-0/dashboard', 'investor_viewer')
    const deals = await screen.findByRole('table', { name: 'Deal metrics' })
    const link = within(deals).getByRole('link', { name: 'Open deal F-PIL 2.0 - Moneda Capital Corp.' })
    expect(link.getAttribute('href')).toBe(`/investor/portfolio/f-pil-2-0/deals/${MONEDA}?period=2026-07`)
    expect(within(link.closest('tr')!).getByText('As of Jul 2026')).toBeTruthy()
    expect(within(deals).getAllByText('As of Jul 2026')).toHaveLength(1)
    expect(within(deals).getByRole('link', { name: 'Open deal F-PIL 2.0 - Xpedite Leasing' }).getAttribute('href')).toBe(`/investor/portfolio/f-pil-2-0/deals/${XPEDITE}?period=2026-08`)
    const cov = screen.getByRole('table', { name: 'Covenant status and review' })
    expect(within(cov).getAllByText('As of Jul 2026')).toHaveLength(9) // Moneda's 9 covenant rows
    expect(screen.getByRole('note').textContent).toBe(NOTE)
  })

  it('Portfolio Executive Summary: note on the program card, label on the flagged row, Go to deal at the deal’s month', async () => {
    renderAt('/manager/portfolio', 'manager_viewer')
    const card = (await screen.findByRole('heading', { level: 2, name: 'F-PIL 2.0' })).closest('section')!
    expect(within(card).getByRole('note').textContent).toBe(NOTE)
    const move = screen.getByRole('heading', { level: 2, name: 'MOVE Trust' }).closest('section')!
    expect(within(move).queryByRole('note')).toBeNull()
    const flagged = screen.getByRole('table', { name: 'Flagged deals' })
    const row = within(flagged).getByText('Moneda Capital Corp.').closest('tr')!
    expect(within(row).getByText('As of Jul 2026')).toBeTruthy()
    expect(within(row).getByRole('link', { name: 'Open F-PIL 2.0 - Moneda Capital Corp.' }).getAttribute('href')).toBe(`/manager/portfolio/f-pil-2-0/deals/${MONEDA}?period=2026-07`)
    expect(screen.getByRole('option', { name: 'Moneda Capital Corp. (as of Jul 2026)' })).toBeTruthy()
    await userEvent.selectOptions(screen.getByLabelText('Go to deal'), `f-pil-2-0|${MONEDA}`)
    expect(screen.getByTestId('where').textContent).toBe(`/manager/portfolio/f-pil-2-0/deals/${MONEDA}?period=2026-07`)
    await waitFor(() => expect(h1().textContent).toBe('F-PIL 2.0 - Moneda Capital Corp.'))
  })

  it('Deal page: label and note on the behind deal, prev / next open each neighbour at its own month', async () => {
    renderAt(`/investor/portfolio/f-pil-2-0/deals/${MONEDA}?period=2026-07`, 'investor_viewer')
    const next = await screen.findByRole('link', { name: 'Next deal: F-PIL 2.0 - Stride Capital' })
    expect(next.getAttribute('href')).toBe(`/investor/portfolio/f-pil-2-0/deals/${STRIDE}?period=2026-08`)
    expect(screen.getByText('As of Jul 2026')).toBeTruthy()
    expect(screen.getByRole('note').textContent).toBe(NOTE)
    // Moneda is at its newest month, so the program is read at its latest month, not at 2026-07.
    expect(calls).toContain('/api/v1/published/programs/f-pil-2-0')
    await userEvent.click(next)
    await waitFor(() => expect(h1().textContent).toBe('F-PIL 2.0 - Stride Capital'))
    await screen.findByRole('link', { name: 'Previous deal: F-PIL 2.0 - Moneda Capital Corp.' })
    expect(screen.queryByText(/As of/)).toBeNull()
    expect(screen.queryByRole('note')).toBeNull()
    expect(screen.getByRole('link', { name: 'Previous deal: F-PIL 2.0 - Moneda Capital Corp.' }).getAttribute('href')).toBe(`/investor/portfolio/f-pil-2-0/deals/${MONEDA}?period=2026-07`)
  })
})

describe('every deal current', () => {
  for (const [label, value] of [['empty', [] as DealBehind[]], ['absent', undefined]] as const) {
    it(`deals_behind ${label}: no label, no note, links at the program month`, async () => {
      behind = value
      const { unmount } = renderAt('/admin/portfolio/f-pil-2-0', 'tao_admin')
      await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(3))
      expect(screen.queryByText(/As of/)).toBeNull()
      expect(screen.queryByRole('note')).toBeNull()
      expect(screen.getByRole('link', { name: 'Open deal F-PIL 2.0 - Moneda Capital Corp.' }).getAttribute('href')).toBe(`/admin/portfolio/f-pil-2-0/deals/${MONEDA}?period=2026-08`)
      unmount(); headerStore.clear()
      renderAt('/investor/portfolio/f-pil-2-0/dashboard', 'investor_viewer')
      await screen.findByRole('table', { name: 'Deal metrics' })
      expect(screen.queryByText(/As of/)).toBeNull()
      expect(screen.queryByRole('note')).toBeNull()
    })
  }
})

describe('BehindNote', () => {
  it('lists several deals compactly', () => {
    const p = apiProgram('f-pil-2-0')
    const two = [{ deal_slug: MONEDA, as_of: '2026-07' }, { deal_slug: XPEDITE, deal_name: 'F-PIL 2.0 - Xpedite Leasing', as_of: '2026-06' }]
    const { unmount } = render(<BehindNote p={{ ...p, deals_behind: two }} />)
    expect(screen.getByRole('note').textContent).toBe('Moneda Capital Corp. (Jul 2026) and Xpedite Leasing (Jun 2026) are behind; their Aug 2026 reports are not published yet.')
    unmount()
    const four = [...two, { deal_slug: STRIDE, as_of: '2026-07' }, { deal_slug: 'x', deal_name: 'Other', as_of: '2026-05' }]
    render(<BehindNote p={{ ...p, deals_behind: four }} />)
    expect(screen.getByRole('note').textContent).toBe('Moneda Capital Corp. (Jul 2026), Xpedite Leasing (Jun 2026), Stride Capital (Jul 2026) and 1 more are behind; their Aug 2026 reports are not published yet.')
  })
})
