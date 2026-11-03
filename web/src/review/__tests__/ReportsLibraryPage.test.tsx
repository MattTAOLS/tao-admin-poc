// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockApi, on, renderPage, setRole } from './helpers'
import ReportsLibraryPage, { partnerViewPath } from '../ReportsLibraryPage'
import published from './fixtures/published.json'
import deals from './fixtures/deals.json'
import programs from './fixtures/programs.json'

const base = [
  on('GET', /^\/uploads\?status=published/, () => ({ body: published })),
  on('GET', /^\/master\/deals/, () => ({ body: deals })),
  on('GET', /^\/master\/programs/, () => ({ body: programs })),
]

describe('Reports library', () => {
  it('lists published reports by deal, newest period first, with partner view and review links', async () => {
    mockApi(base)
    renderPage(<ReportsLibraryPage />)
    await screen.findAllByText('Moneda Capital Corp.')
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(published.length)
    // Moneda before Xpedite; within a deal the latest period first
    expect(within(rows[0]).getByText('Moneda Capital Corp.')).toBeTruthy()
    expect(within(rows[0]).getByText('Jul 2026')).toBeTruthy()
    expect(within(rows[2]).getByText('May 2026')).toBeTruthy()
    expect(within(rows[3]).getByText('Xpedite Leasing')).toBeTruthy()
    expect(within(rows[3]).getByText('Aug 2026')).toBeTruthy()
    const review = within(rows[0]).getByRole('link', { name: /Review record/ })
    expect(review.getAttribute('href')).toMatch(/^\/admin\/uploads\/queue\/[0-9a-f-]{36}$/)
    expect(within(rows[0]).getByRole('link', { name: /Partner view/ }).getAttribute('href')).toBe(partnerViewPath(published.find(p => p.id === review.getAttribute('href')!.split('/').pop())!))
  })

  it('filters by deal', async () => {
    mockApi(base)
    renderPage(<ReportsLibraryPage />)
    await screen.findAllByText('Moneda Capital Corp.')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Deal' }), 'f-pil-2-0-xpedite-leasing')
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(published.filter(p => p.deal_slug === 'f-pil-2-0-xpedite-leasing').length)
  })

  it('regenerates the dashboard for one program through the pop-up', async () => {
    const calls = mockApi([...base, on('POST', /^\/published\/regenerate$/, () => ({ status: 202, body: { queued: true, programs: ['f-pil-2-0'], publications: 7 } }))])
    renderPage(<ReportsLibraryPage />)
    await screen.findAllByText('Moneda Capital Corp.')
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate dashboard…' }))
    const dlg = await screen.findByRole('dialog', { name: 'Regenerate dashboard' })
    await userEvent.selectOptions(within(dlg).getByRole('combobox', { name: 'Program' }), 'f-pil-2-0')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls.find(c => c.method === 'POST')!.body).toEqual({ program_slug: 'f-pil-2-0' })
    expect(await screen.findByText('F-PIL 2.0: rebuilt from 7 published reports.')).toBeTruthy()
  })

  it('analysts see the library without the regenerate action', async () => {
    setRole('tao_analyst')
    mockApi(base)
    renderPage(<ReportsLibraryPage />)
    await screen.findAllByText('Moneda Capital Corp.')
    expect(screen.queryByRole('button', { name: /Regenerate/ })).toBeNull()
  })

  it('partner roles get no access and no request', () => {
    setRole('investor_viewer')
    const calls = mockApi(base)
    renderPage(<ReportsLibraryPage />)
    expect(screen.getByText('You don’t have access')).toBeTruthy()
    expect(calls).toHaveLength(0)
  })

  it('links to the deepest registered portfolio route', () => {
    // Only /admin/portfolio is registered in the admin shell today.
    expect(partnerViewPath({ program_slug: 'f-pil-2-0', deal_slug: 'x', collection_period: '2026-08' })).toBe('/admin/portfolio')
  })
})
