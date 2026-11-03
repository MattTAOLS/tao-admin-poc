// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderPage, fakeApi, httpError, never, header, DEALS, PROGRAMS, PORTFOLIO, upload } from './helpers'

vi.mock('@/shell/api', () => ({ api: vi.fn() }))
import { api } from '@/shell/api'
import DashboardPage, { portfolioKpis } from '../DashboardPage'

const mockApi = vi.mocked(api)
const route: [string, JSX.Element][] = [['/admin', <DashboardPage />]]
const queue = { 'GET /uploads': [upload({ status: 'needs_review' })], 'GET /master/deals': DEALS, 'GET /master/programs': PROGRAMS }
const tile = (label: string) => screen.getByText(label, { selector: '.ds-kpi__label' }).closest('.ds-kpi') as HTMLElement

beforeEach(() => { mockApi.mockReset() })

describe('portfolioKpis', () => {
  it('counts programs, deals and flagged deals from the real program files', () => {
    // F-PIL 2.0 2026-08: Moneda and Xpedite WATCH; MOVE Trust 2026-07: Finloc and TPine BREACH, Essex WATCH.
    expect(portfolioKpis(PORTFOLIO)).toEqual({ programs: 2, deals: 12, breach: 2, watch: 3 })
  })
  it('is all zeros for no data', () => {
    expect(portfolioKpis(undefined)).toEqual({ programs: 0, deals: 0, breach: 0, watch: 0 })
  })
})

describe('Dashboard', () => {
  it('shows portfolio KPIs, covenant totals by program and the queue', async () => {
    mockApi.mockImplementation(fakeApi({ 'GET /published/portfolio': PORTFOLIO, ...queue }))
    renderPage('/admin', route)
    expect(header().title).toBe('Dashboard')
    const table = await screen.findByRole('table', { name: 'Covenant status by program' })
    expect(within(tile('Programs')).getByText('2')).toBeTruthy()
    expect(within(tile('Deals')).getByText('12')).toBeTruthy()
    expect(within(tile('Flagged deals')).getByText('5')).toBeTruthy()
    expect(within(tile('Flagged deals')).getByText('2 breach · 3 watch')).toBeTruthy()
    const move = within(table).getByText('MOVE Trust').closest('tr')!
    expect(within(move).getAllByRole('cell').map(c => c.textContent)).toEqual(['MOVE Trust', 'Jul 2026', '9', '8', '1', '83', '6'])
    expect(await screen.findByRole('table', { name: 'Latest uploads' })).toBeTruthy()
    expect(within(tile('Needs review')).getByText('1')).toBeTruthy()
  })
  it('shows the empty state when nothing is published, and still shows the queue', async () => {
    mockApi.mockImplementation(fakeApi({ 'GET /published/portfolio': { partner: null, programs: [] }, ...queue }))
    renderPage('/admin', route)
    expect(await screen.findByRole('heading', { name: 'Nothing published yet' })).toBeTruthy()
    expect(screen.queryByText('Programs', { selector: '.ds-kpi__label' })).toBeNull()
    expect(await screen.findByRole('table', { name: 'Latest uploads' })).toBeTruthy()
  })
  it('loading: skeleton tiles', () => {
    mockApi.mockImplementation(never)
    const { container } = renderPage('/admin', route)
    expect(container.querySelectorAll('.ds-kpi[aria-busy="true"]').length).toBe(7)
  })
  it('error: each section fails on its own with a retry', async () => {
    mockApi.mockImplementation(fakeApi({ 'GET /published/portfolio': httpError(500, 'boom'), ...queue }))
    renderPage('/admin', route)
    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeTruthy()
    expect(await screen.findByRole('table', { name: 'Latest uploads' })).toBeTruthy()
  })
  it('no access when the API refuses the role', async () => {
    const no = httpError(403, 'tao_only')
    mockApi.mockImplementation(fakeApi({ 'GET /published/portfolio': no, 'GET /uploads': no, 'GET /master/deals': no, 'GET /master/programs': no }))
    renderPage('/admin', route)
    expect((await screen.findAllByRole('heading', { name: 'You don’t have access' })).length).toBe(2)
  })
})
