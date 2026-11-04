// @vitest-environment jsdom
/** States, access and navigation through the real shell (App), with fetch answering like the API does:
 * partner-filtered, another partner's program or deal → 404. */
import '@/design/test-utils'
import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { App } from '@/shell/App'
import { KEY } from '@/shell/roles'
import { headerStore } from '@/shell/header'
import { OWNERS, apiDeal, apiPortfolio, apiProgram, programOf } from './fixtures'

type Call = { url: string; headers: Record<string, string> }
let calls: Call[] = []
let mode: 'ok' | 'error' | 'hang' = 'ok'

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}
function fakeFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input)
  const headers = (init?.headers ?? {}) as Record<string, string>
  calls.push({ url, headers })
  if (mode === 'hang') return new Promise<Response>(() => {})
  if (mode === 'error') return respond(500, { code: 'boom', message: 'Database unavailable' })
  const partner = headers['X-Partner'] ?? null
  const path = new URL(url, 'http://x').pathname.replace(/^.*\/api\/v1/, '')
  let m: RegExpMatchArray | null
  if (path === '/published/portfolio') return respond(200, apiPortfolio(partner))
  if ((m = path.match(/^\/published\/programs\/([^/]+)\/deals\/([^/]+)$/))) {
    if (!OWNERS[m[1]] || (partner && !OWNERS[m[1]].includes(partner))) return respond(404, { code: 'not_found', message: 'no published program' })
    return respond(200, apiDeal(m[2]))
  }
  if ((m = path.match(/^\/published\/programs\/([^/]+)$/))) {
    if (!OWNERS[m[1]] || (partner && !OWNERS[m[1]].includes(partner))) return respond(404, { code: 'not_found', message: 'no published program' })
    return respond(200, apiProgram(m[1]))
  }
  if (path === '/uploads') {
    const deal = new URL(url, 'http://x').searchParams.get('deal_slug')!
    const d = apiDeal(deal)
    return respond(200, [
      { id: d.upload_id, deal_slug: deal, collection_period: d.published_period, status: 'published' },
      { id: 'aaaaaaaa-0000-0000-0000-000000000001', deal_slug: deal, collection_period: '2026-09', status: 'needs_review' },
    ])
  }
  return respond(404, { code: 'not_found', message: path })
}

function Where() { const l = useLocation(); return <output data-testid="where">{l.pathname + l.search}</output> }
function renderAt(path: string, role: string) {
  localStorage.setItem(KEY, role)
  return render(<MemoryRouter initialEntries={[path]}><App /><Where /></MemoryRouter>)
}
const h1 = () => screen.getByRole('heading', { level: 1 })

// Warm the lazy route modules so the first test does not race the 1 s findBy timeout.
beforeAll(async () => { await Promise.all([import('../PortfolioPage'), import('../ProgramPage'), import('../ProgramDashboardPage'), import('../DealRoute')]) })
beforeEach(() => { calls = []; mode = 'ok'; localStorage.clear(); headerStore.clear(); vi.stubGlobal('fetch', vi.fn(fakeFetch)) })
afterEach(() => { vi.unstubAllGlobals() })

const MONEDA = 'f-pil-2-0-moneda-capital-corp'

describe('Portfolio Executive Summary', () => {
  it('shows one card per program the investor sees, flagged deals and a Go to deal picker', async () => {
    renderAt('/investor/portfolio', 'investor_viewer')
    expect(await screen.findByRole('heading', { level: 2, name: 'F-PIL 2.0' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'MOVE Trust' })).toBeTruthy()
    expect(calls.every(c => c.headers['X-Partner'] === 'investor' && c.headers['X-Role'] === 'investor_viewer')).toBe(true)
    const flagged = screen.getByRole('table', { name: 'Flagged deals' })
    expect(within(flagged).getByText('Moneda Capital Corp.')).toBeTruthy()
    expect(within(flagged).getByText('Xpedite Leasing')).toBeTruthy()
    expect(within(flagged).queryByText('Stride Capital')).toBeNull() // OK deal
    expect(within(flagged).getByText('Finloc 2000 Inc.')).toBeTruthy() // MOVE Trust BREACH
    await userEvent.selectOptions(screen.getByLabelText('Go to deal'), `f-pil-2-0|${MONEDA}`)
    expect(screen.getByTestId('where').textContent).toBe(`/investor/portfolio/f-pil-2-0/deals/${MONEDA}`)
  })
  it('TAO sees both programs', async () => {
    renderAt('/admin/portfolio', 'tao_admin')
    expect(await screen.findByRole('heading', { level: 2, name: 'F-PIL 2.0' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'MOVE Trust' })).toBeTruthy()
  })
  it('shows an empty state when nothing is published to the partner', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond(200, { partner: 'manager', programs: [] })))
    renderAt('/manager/portfolio', 'manager_viewer')
    expect(await screen.findByRole('heading', { name: 'Nothing published yet' })).toBeTruthy()
  })
  it('shows skeletons while loading', async () => {
    mode = 'hang'
    renderAt('/investor/portfolio', 'investor_viewer')
    await waitFor(() => expect(document.querySelector('.pf-stack[aria-busy="true"]')).toBeTruthy())
  })
  it('shows an error with Retry', async () => {
    mode = 'error'
    renderAt('/investor/portfolio', 'investor_viewer')
    expect(await screen.findByText('Database unavailable')).toBeTruthy()
    mode = 'ok'
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'F-PIL 2.0' })).toBeTruthy()
  })
})

describe('access', () => {
  it('both partners see both programs', async () => {
    for (const [role, shell] of [['investor_viewer', 'investor'], ['manager_viewer', 'manager']]) {
      const { unmount } = renderAt(`/${shell}/portfolio`, role)
      expect(await screen.findByRole('heading', { level: 2, name: 'F-PIL 2.0' })).toBeTruthy()
      expect(screen.getByRole('heading', { level: 2, name: 'MOVE Trust' })).toBeTruthy()
      unmount(); headerStore.clear()
    }
    const { unmount } = renderAt('/manager/portfolio/f-pil-2-0', 'manager_viewer')
    await waitFor(() => expect(h1().textContent).toBe('F-PIL 2.0 Executive Summary'))
    unmount(); headerStore.clear()
    renderAt('/investor/portfolio/move-trust', 'investor_viewer')
    await waitFor(() => expect(h1().textContent).toBe('MOVE Trust Executive Summary'))
  })
  it('a program the partner may not see (API 404) shows "You don’t have access" on summary, dashboard and deal', async () => {
    for (const path of ['/manager/portfolio/other-program', '/manager/portfolio/other-program/dashboard', '/manager/portfolio/other-program/deals/other-deal']) {
      const { unmount } = renderAt(path, 'manager_viewer')
      expect(await screen.findByRole('heading', { name: 'You don’t have access' })).toBeTruthy()
      unmount(); headerStore.clear()
    }
  })
  it('a partner deal page never calls an intake route and shows no admin strip', async () => {
    renderAt(`/investor/portfolio/f-pil-2-0/deals/${MONEDA}`, 'investor_viewer')
    await waitFor(() => expect(h1().textContent).toBe('F-PIL 2.0 - Moneda Capital Corp.'))
    expect(calls.some(c => c.url.includes('/uploads'))).toBe(false)
    expect(screen.queryByRole('region', { name: 'Upload status' })).toBeNull()
  })
})

describe('Program Executive Summary', () => {
  it('tiles, a card per deal with status and a link, prev / next program', async () => {
    renderAt('/admin/portfolio/f-pil-2-0', 'tao_admin')
    await waitFor(() => expect(h1().textContent).toBe('F-PIL 2.0 Executive Summary'))
    const cards = screen.getAllByRole('article')
    expect(cards).toHaveLength(3)
    expect(within(cards[0]).getByRole('heading', { name: 'Moneda Capital Corp.' })).toBeTruthy()
    expect(within(cards[0]).getByText('WATCH')).toBeTruthy()
    expect(within(cards[1]).getByText('OK')).toBeTruthy()
    const next = await screen.findByRole('link', { name: 'Next program: MOVE Trust' })
    await userEvent.click(next)
    expect(screen.getByTestId('where').textContent).toBe('/admin/portfolio/move-trust')
    await waitFor(() => expect(h1().textContent).toBe('MOVE Trust Executive Summary'))
    expect(screen.getByRole('link', { name: 'Previous program: F-PIL 2.0' })).toBeTruthy()
  })
})

describe('Program Dashboard', () => {
  it('Covenant Status & Review: expand row, expand all, collapse all, flagged only', async () => {
    renderAt('/investor/portfolio/f-pil-2-0/dashboard', 'investor_viewer')
    const table = await screen.findByRole('table', { name: 'Covenant status and review' })
    const body = () => within(table).getAllByRole('row').filter(r => r.closest('tbody'))
    expect(body()).toHaveLength(25) // 9 + 8 + 8 covenants
    await userEvent.click(within(table).getByRole('button', { name: 'Expand Moneda Capital Corp. SLFA 9.1 (c)' }))
    expect(within(table).getByText('Has the Rolling Three Month Loss Ratio at any time exceeded:', { selector: '.pf-covdesc' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(table.querySelectorAll('.ds-table__detail')).toHaveLength(25)
    await userEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(table.querySelectorAll('.ds-table__detail')).toHaveLength(0)
    await userEvent.click(screen.getByLabelText('Flagged only'))
    expect(body()).toHaveLength(3) // covenant_totals.WATCH = 3
  })
  it('watch threshold changes the displayed status only, and resets to published', async () => {
    renderAt('/investor/portfolio/f-pil-2-0/dashboard', 'investor_viewer')
    const table = await screen.findByRole('table', { name: 'Covenant status and review' })
    const watchCount = () => within(table).queryAllByText('WATCH').length
    expect(watchCount()).toBe(3)
    await userEvent.click(screen.getByRole('button', { name: 'Watch threshold: 10%' }))
    const dlg = screen.getByRole('dialog', { name: 'Watch threshold' })
    await userEvent.selectOptions(within(dlg).getByLabelText('Watch buffer'), '25')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Apply' }))
    expect(watchCount()).toBeGreaterThan(3)
    expect(screen.getByText(/Display at a 25% watch buffer \(published at 10%\)/)).toBeTruthy()
    // Tiles keep the published totals.
    expect(document.querySelector('[data-field="covenant_totals.WATCH"]')!.textContent).toBe('3')
    await userEvent.click(screen.getByRole('button', { name: 'Watch threshold: 25%' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reset to published' }))
    expect(watchCount()).toBe(3)
  })
  it('Print / Save as PDF expands every row, prints, then restores', async () => {
    const print = vi.fn()
    vi.stubGlobal('print', print)
    renderAt('/investor/portfolio/f-pil-2-0/dashboard', 'investor_viewer')
    const table = await screen.findByRole('table', { name: 'Covenant status and review' })
    await userEvent.click(screen.getByRole('button', { name: 'Print / Save as PDF' }))
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1))
    expect(table.querySelectorAll('.ds-table__detail')).toHaveLength(25)
    window.dispatchEvent(new Event('afterprint'))
    await waitFor(() => expect(table.querySelectorAll('.ds-table__detail')).toHaveLength(0))
  })
})

describe('Deal page', () => {
  it('prev / next deal within the program', async () => {
    renderAt(`/investor/portfolio/f-pil-2-0/deals/${MONEDA}`, 'investor_viewer')
    const next = await screen.findByRole('link', { name: 'Next deal: F-PIL 2.0 - Stride Capital' })
    expect(screen.queryByRole('link', { name: /Previous deal/ })).toBeNull()
    await userEvent.click(next)
    await waitFor(() => expect(h1().textContent).toBe('F-PIL 2.0 - Stride Capital'))
    expect(screen.getByRole('link', { name: 'Previous deal: F-PIL 2.0 - Moneda Capital Corp.' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Next deal: F-PIL 2.0 - Xpedite Leasing' })).toBeTruthy()
  })
  it('covenant table carries legal ref and description; ratio chart switches series', async () => {
    renderAt(`/investor/portfolio/f-pil-2-0/deals/${MONEDA}`, 'investor_viewer')
    const cov = await screen.findByRole('table', { name: 'Covenant tests' })
    expect(within(cov).getByText('SLFA 9.1 (c)')).toBeTruthy()
    expect(within(cov).getByText('Has the Rolling Three Month Loss Ratio at any time exceeded:')).toBeTruthy()
    const chart = screen.getByRole('img', { name: /Delinquency ratio, Jul-25 to Jul-26/ })
    expect(chart.querySelectorAll('circle')).toHaveLength(13)
    await userEvent.selectOptions(screen.getByLabelText('Series'), 'interest_coverage_ratio')
    expect(screen.getByRole('img', { name: /Interest coverage ratio/ })).toBeTruthy()
  })
  it('period picker loads the chosen period', async () => {
    vi.stubGlobal('fetch', vi.fn((u: RequestInfo | URL, i?: RequestInit) => {
      const url = String(u)
      if (url.includes('/deals/')) {
        const d = apiDeal(MONEDA)
        const period = new URL(url, 'http://x').searchParams.get('period') ?? '2026-08'
        return respond(200, { ...d, published_period: period, available_periods: ['2026-08', '2026-07'] })
      }
      return fakeFetch(u, i)
    }))
    renderAt(`/investor/portfolio/f-pil-2-0/deals/${MONEDA}`, 'investor_viewer')
    const picker = await screen.findByLabelText('Period')
    await userEvent.selectOptions(picker, '2026-07')
    expect(screen.getByTestId('where').textContent).toBe(`/investor/portfolio/f-pil-2-0/deals/${MONEDA}?period=2026-07`)
    await waitFor(() => expect((screen.getByLabelText('Period') as HTMLSelectElement).value).toBe('2026-07'))
  })
  it('shows the Data corrections section from the published deal', async () => {
    renderAt('/manager/portfolio/move-trust/deals/move-trust-dynamic-capital', 'manager_viewer')
    const t = await screen.findByRole('table', { name: 'Data corrections' })
    expect(within(t).getByText('Balance history · Interest')).toBeTruthy()
    expect(within(t).getByText('2026-10-09')).toBeTruthy()
    expect(within(t).getByText('$1,372,329')).toBeTruthy()
    expect(within(t).getByText('$1,467,812')).toBeTruthy()
  })
  it('TAO Admin shell: upload strip with status, review link for the period, and a newer upload', async () => {
    renderAt(`/admin/portfolio/f-pil-2-0/deals/${MONEDA}`, 'tao_admin')
    const strip = await screen.findByRole('region', { name: 'Upload status' })
    expect(within(strip).getByText('Published')).toBeTruthy()
    const link = within(strip).getByRole('link', { name: 'Open review for Aug 2026' })
    expect(link.getAttribute('href')).toBe('/admin/uploads/queue/11111111-2222-3333-4444-555555555555')
    expect(within(strip).getByText('Needs review')).toBeTruthy()
    expect(programOf(MONEDA)).toBe('f-pil-2-0')
  })
})
