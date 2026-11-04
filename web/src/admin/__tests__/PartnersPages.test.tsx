// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderPage, fakeApi, httpError, never, header, DEALS, PROGRAMS, PARTNERS, COVENANTS } from './helpers'

vi.mock('@/shell/api', () => ({ api: vi.fn() }))
import { api } from '@/shell/api'
import PartnersPage from '../PartnersPage'
import PartnerDetailsPage from '../PartnerDetailsPage'
import ProgramRecordPage from '../ProgramRecordPage'
import { formatThreshold, thresholdText, versionStates, parseNumber, partnerRows } from '../master'

const mockApi = vi.mocked(api)
const routes: [string, JSX.Element][] = [
  ['/admin/partners', <PartnersPage />],
  ['/admin/partners/:partnerId', <PartnerDetailsPage />],
  ['/admin/partners/:partnerId/programs/:programId', <ProgramRecordPage />],
]
const master = { 'GET /master/partners': PARTNERS, 'GET /master/programs': PROGRAMS, 'GET /master/deals': (p: string) => {
  const slug = new URLSearchParams(p.split('?')[1] ?? '').get('program_slug')
  return DEALS.filter(d => !slug || d.program_slug === slug)
}, 'GET /master/covenants': COVENANTS }
const FPIL = '/admin/partners/investor/programs/f-pil-2-0'
const forbidden = () => httpError(403, 'tao_only')

beforeEach(() => { mockApi.mockReset() })

describe('master helpers', () => {
  it('formats thresholds and banded rules', () => {
    expect(formatThreshold(0.035, 'fraction')).toBe('3.50%')
    expect(formatThreshold(10, 'ratio')).toBe('10.00×')
    expect(formatThreshold(2500000, 'currency')).toBe('$2,500,000')
    // unit wins over the guess: a ratio below 1 is not a percentage, a fraction is never currency
    expect(formatThreshold(0.85, 'ratio')).toBe('0.85×')
    expect(formatThreshold(1.5, 'fraction')).toBe('150.00%')
    // unit null or absent: the guess
    expect(formatThreshold(0.035, null)).toBe('3.50%')
    expect(formatThreshold(1.1)).toBe('1.10×')
    expect(formatThreshold(2500000)).toBe('$2,500,000')
    expect(thresholdText(COVENANTS[0])).toBe('≤ 6.00% if ≤ $10,000,000; ≤ 4.00% if > $10,000,000')
    expect(thresholdText(COVENANTS[1])).toBe('≥ 1.10×')
  })
  it('marks the version in force, superseded and scheduled', () => {
    const v1 = { ...COVENANTS[1], id: 'v1', effective_from: '2023-12-09' }
    const v2 = { ...COVENANTS[1], id: 'v2', effective_from: '2025-03-01' }
    const v3 = { ...COVENANTS[1], id: 'v3', effective_from: '2027-01-01' }
    const s = versionStates([v1, v2, v3], '2026-11-03')
    expect([s.get(v1), s.get(v2), s.get(v3)]).toEqual(['superseded', 'in_force', 'scheduled'])
  })
  it('parses numbers with grouping', () => {
    expect(parseNumber('1,000,000')).toBe(1000000)
    expect(parseNumber(' ')).toBeUndefined()
    expect(parseNumber('abc')).toBeNaN()
  })
  it('lists every partner, with each program counted for every partner in partner_slugs', () => {
    const rows = partnerRows(PARTNERS, PROGRAMS, { 'f-pil-2-0': 2, 'move-trust': 1 })
    expect(rows.map(r => [r.slug, r.programs.length, r.dealCount])).toEqual([['investor', 2, 3], ['manager', 2, 3]])
    // Deliberate change to the seed: F-PIL visible to the investor only, MOVE Trust to nobody else -> manager has none.
    const only = PROGRAMS.map(p => ({ ...p, partner_slugs: ['investor'] }))
    expect(partnerRows(PARTNERS, only, {}).map(r => [r.slug, r.programs.length])).toEqual([['investor', 2], ['manager', 0]])
    // An older API without partner_slugs falls back to partner_slug.
    const old = PROGRAMS.map(({ partner_slugs: _drop, ...p }) => p)
    expect(partnerRows(PARTNERS, old, {}).map(r => r.programs.length)).toEqual([2, 0])
  })
})

describe('Partners', () => {
  it('lists partners and opens one', async () => {
    mockApi.mockImplementation(fakeApi(master))
    renderPage('/admin/partners', routes)
    const table = await screen.findByRole('table', { name: 'Partners' })
    const row = within(table).getAllByText('Investor')[0].closest('tr')!
    expect(within(row).getAllByRole('cell').map(c => c.textContent)).toEqual(['Investor', 'Investor', 'Active', 'F-PIL 2.0, MOVE Trust', '2', '3', '$2,066,709,163 CAD'])
    const mgr = within(table).getAllByText('Manager')[0].closest('tr')!
    expect(within(mgr).getAllByRole('cell').map(c => c.textContent)).toEqual(['Manager', 'Manager', 'Active', 'F-PIL 2.0, MOVE Trust', '2', '3', '$2,066,709,163 CAD'])
    await userEvent.click(row)
    expect(screen.getByTestId('loc').textContent).toBe('/admin/partners/investor')
  })
  it('shows a partner without programs', async () => {
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /master/programs': PROGRAMS.map(p => ({ ...p, partner_slug: 'investor', partner_slugs: ['investor'] })) }))
    renderPage('/admin/partners', routes)
    const table = await screen.findByRole('table', { name: 'Partners' })
    const mgr = within(table).getAllByText('Manager')[0].closest('tr')!
    expect(within(mgr).getByText('None yet')).toBeTruthy()
    expect(within(mgr).getAllByRole('cell').at(-1)!.textContent).toBe('—')
  })
  it('empty, loading, error, no-access', async () => {
    mockApi.mockImplementation(fakeApi({ 'GET /master/partners': [], 'GET /master/programs': [], 'GET /master/deals': [] }))
    const a = renderPage('/admin/partners', routes); expect(await screen.findByText('No partners yet')).toBeTruthy(); a.unmount()
    mockApi.mockImplementation(never)
    const b = renderPage('/admin/partners', routes); expect(b.container.querySelector('[aria-busy="true"]')).toBeTruthy(); b.unmount()
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /master/partners': httpError(500, 'x') }))
    const c = renderPage('/admin/partners', routes); expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeTruthy(); c.unmount()
    mockApi.mockImplementation(fakeApi({ 'GET /master/partners': forbidden(), 'GET /master/programs': forbidden(), 'GET /master/deals': forbidden() }))
    renderPage('/admin/partners', routes); expect(await screen.findByRole('heading', { name: 'You don’t have access' })).toBeTruthy()
  })
})

describe('Partner details', () => {
  it('shows the partner’s programs with limits and opens a program', async () => {
    mockApi.mockImplementation(fakeApi(master))
    renderPage('/admin/partners/investor', routes)
    const table = await screen.findByRole('table', { name: 'Investor programs' })
    expect(header().title).toBe('Investor')
    expect(header().crumbs?.map(c => c.label)).toEqual(['TAO Admin', 'Partners', 'Investor'])
    const row = within(table).getAllByText('F-PIL 2.0')[0].closest('tr')!
    expect(within(row).getAllByRole('cell').map(c => c.textContent)).toEqual(['F-PIL 2.0', 'CAD', '$150,000,000', '$5,000,000', '2', 'Investor, Manager'])
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(screen.getByTestId('loc').textContent).toBe(FPIL)
  })
  it('lists every program whose partner_slugs include the partner (manager sees both)', async () => {
    mockApi.mockImplementation(fakeApi(master))
    renderPage('/admin/partners/manager', routes)
    const table = await screen.findByRole('table', { name: 'Manager programs' })
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(header().subtitle).toBe('Manager partner · active')
  })
  it('a partner with no programs shows the empty table, not not-found', async () => {
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /master/programs': PROGRAMS.map(p => ({ ...p, partner_slugs: ['investor'] })) }))
    renderPage('/admin/partners/manager', routes)
    expect(await screen.findByText('No programs visible to this partner')).toBeTruthy()
  })
  it('unknown partner is not found', async () => {
    mockApi.mockImplementation(fakeApi(master))
    renderPage('/admin/partners/nobody', routes)
    expect(await screen.findByRole('heading', { name: 'No such partner' })).toBeTruthy()
  })
  it('loading, error, no-access', async () => {
    mockApi.mockImplementation(never)
    const b = renderPage('/admin/partners/investor', routes); expect(b.container.querySelectorAll('.ds-kpi[aria-busy="true"]')).toHaveLength(3); b.unmount()
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /master/programs': httpError(500, 'x') }))
    const c = renderPage('/admin/partners/investor', routes); expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy(); c.unmount()
    mockApi.mockImplementation(fakeApi({ 'GET /master/partners': forbidden(), 'GET /master/programs': forbidden(), 'GET /master/deals': forbidden() }))
    renderPage('/admin/partners/investor', routes); expect(await screen.findByRole('heading', { name: 'You don’t have access' })).toBeTruthy()
  })
})

describe('Program / facility record', () => {
  it('shows limits, deals with template id, and covenant definitions with bands, effective date and source', async () => {
    mockApi.mockImplementation(fakeApi(master))
    renderPage(FPIL, routes)
    const deals = await screen.findByRole('table', { name: 'F-PIL 2.0 deals' })
    expect(header().title).toBe('F-PIL 2.0')
    expect(screen.getByText('$150,000,000')).toBeTruthy()
    expect(screen.getByText('$5,000,000')).toBeTruthy()
    expect(screen.getByText('Visible to').nextElementSibling!.textContent).toBe('Investor, Manager')
    expect(within(deals).getAllByText('fpil-2.0-settrep-v1')).toHaveLength(2)
    const cov = screen.getByRole('table', { name: 'Covenant definitions' })
    const c = within(cov).getByText('SLFA 9.1 (c)').closest('tr')!
    expect(within(c).getByText('≤ 6.00% if ≤ $10,000,000; ≤ 4.00% if > $10,000,000')).toBeTruthy()
    expect(within(c).getByText('2022-12-09')).toBeTruthy()
    expect(within(c).getByText(/UNVERIFIED/)).toBeTruthy()
    expect(within(c).getByText('In force')).toBeTruthy()
    expect(within(c).getByText('10%')).toBeTruthy()
    // Covenants of deals outside the program never show.
    expect(within(cov).getAllByRole('row')).toHaveLength(3)
  })

  it('filters covenants by deal', async () => {
    mockApi.mockImplementation(fakeApi(master))
    renderPage(FPIL, routes)
    await screen.findByRole('table', { name: 'Covenant definitions' })
    await userEvent.selectOptions(screen.getByLabelText('Deal'), 'f-pil-2-0-stride-capital')
    expect(screen.getByText('None for this deal yet.')).toBeTruthy()
  })

  it('tao_admin edits limits through PUT /master/programs and reloads', async () => {
    let body: unknown
    let programs = PROGRAMS
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /master/programs': () => programs,
      'PUT /master/programs': (_p: string, init?: RequestInit) => { body = JSON.parse(init!.body as string); programs = [body as typeof PROGRAMS[0], PROGRAMS[1]]; return body } }))
    renderPage(FPIL, routes)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit limits and visibility for F-PIL 2.0' }))
    const dialog = screen.getByRole('dialog')
    const limit = within(dialog).getByLabelText(/Program limit/)
    await userEvent.clear(limit)
    await userEvent.type(limit, '175,000,000')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(body).toEqual({ slug: 'f-pil-2-0', name: 'F-PIL 2.0', partner_slug: 'investor', partner_slugs: ['investor', 'manager'], currency: 'CAD', limit: 175000000, warehouse_limit: 5000000 })
    expect(await screen.findByText('$175,000,000')).toBeTruthy()
    expect(screen.getByText('F-PIL 2.0 saved')).toBeTruthy()
  })

  it('edits visibility with a checkbox per partner; at least one is required; the first checked becomes partner_slug', async () => {
    let body: Record<string, unknown> | undefined
    mockApi.mockImplementation(fakeApi({ ...master, 'PUT /master/programs': (_p: string, init?: RequestInit) => (body = JSON.parse(init!.body as string)) }))
    renderPage(FPIL, routes)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit limits and visibility for F-PIL 2.0' }))
    const dialog = screen.getByRole('dialog')
    const inv = within(dialog).getByRole('checkbox', { name: 'Investor' }) as HTMLInputElement
    const mgr = within(dialog).getByRole('checkbox', { name: 'Manager' }) as HTMLInputElement
    expect([inv.checked, mgr.checked]).toEqual([true, true])
    await userEvent.click(inv); await userEvent.click(mgr)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByText('Choose at least one partner.')).toBeTruthy()
    expect(body).toBeUndefined()
    await userEvent.click(mgr)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(body).toBeTruthy())
    expect(body!.partner_slugs).toEqual(['manager'])
    expect(body!.partner_slug).toBe('manager')
  })

  it('validates the program form and shows API errors in the dialog', async () => {
    mockApi.mockImplementation(fakeApi({ ...master, 'PUT /master/programs': httpError(422, 'unknown_partner', 'no partner investor') }))
    renderPage(FPIL, routes)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit limits and visibility for F-PIL 2.0' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.clear(within(dialog).getByLabelText(/Program limit/))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByText('Required.')).toBeTruthy()
    await userEvent.type(within(dialog).getByLabelText(/Program limit/), '150000000')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByText('no partner investor')).toBeTruthy()
  })

  it('tao_admin edits a deal template id through PUT /master/deals', async () => {
    let body: unknown
    mockApi.mockImplementation(fakeApi({ ...master, 'PUT /master/deals': (_p: string, init?: RequestInit) => (body = JSON.parse(init!.body as string)) }))
    renderPage(FPIL, routes)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Stride Capital' }))
    const dialog = screen.getByRole('dialog')
    const t = within(dialog).getByLabelText(/Template id/)
    await userEvent.clear(t); await userEvent.type(t, 'fpil-2.0-settrep-stride-v1')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(body).toEqual({ ...DEALS[1], template_id: 'fpil-2.0-settrep-stride-v1' }))
  })

  it('adds a new covenant version (no id, new effective date) through PUT /master/covenants', async () => {
    let body: Record<string, unknown> | undefined
    mockApi.mockImplementation(fakeApi({ ...master, 'PUT /master/covenants': (_p: string, init?: RequestInit) => (body = JSON.parse(init!.body as string)) }))
    renderPage(FPIL, routes)
    await userEvent.click(await screen.findByRole('button', { name: 'New version of SLFA 9.1 (h) for Moneda Capital Corp.' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByText('Required (YYYY-MM-DD).')).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText(/Effective from/), { target: { value: '2026-12-01' } })
    const th = within(dialog).getByLabelText(/^Threshold\*?$/)
    await userEvent.clear(th); await userEvent.type(th, '1.25')
    await userEvent.type(within(dialog).getByLabelText(/Source/), 'Amendment 1 2026-12-01')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(body).toBeTruthy())
    expect(body).toEqual({ deal_slug: 'f-pil-2-0-moneda-capital-corp', legal_ref: 'SLFA 9.1 (h)', description: 'Interest Coverage Ratio', kind: 'floor',
      unit: 'ratio', threshold: 1.25, threshold_rule: null, watch_buffer_pct: 0.1, effective_from: '2026-12-01', source: 'Amendment 1 2026-12-01' })
  })

  it('edits a banded rule in place (keeps the id)', async () => {
    let body: Record<string, unknown> | undefined
    mockApi.mockImplementation(fakeApi({ ...master, 'PUT /master/covenants': (_p: string, init?: RequestInit) => (body = JSON.parse(init!.body as string)) }))
    renderPage(FPIL, routes)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit SLFA 9.1 (c) for Moneda Capital Corp.' }))
    const dialog = screen.getByRole('dialog')
    const t2 = within(dialog).getByLabelText('Band 2 threshold')
    await userEvent.clear(t2); await userEvent.type(t2, '0.045')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(body).toBeTruthy())
    expect(body!.id).toBe(COVENANTS[0].id)
    expect(body!.threshold).toBeNull()
    expect(body!.threshold_rule).toEqual({ on: '/tranche_balance/closing', bands: [{ lte: 10000000, threshold: 0.06 }, { gt: 10000000, threshold: 0.045 }] })
  })

  it('sends the unit chosen in the covenant dialog', async () => {
    let body: Record<string, unknown> | undefined
    mockApi.mockImplementation(fakeApi({ ...master, 'PUT /master/covenants': (_p: string, init?: RequestInit) => (body = JSON.parse(init!.body as string)) }))
    renderPage(FPIL, routes)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit SLFA 9.1 (h) for Moneda Capital Corp.' }))
    const dialog = screen.getByRole('dialog')
    expect((within(dialog).getByLabelText(/^Unit/) as HTMLSelectElement).value).toBe('ratio')
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Unit/), '')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(body).toBeTruthy())
    expect(body!.unit).toBeNull()
  })

  it('analysts read only: no edit controls', async () => {
    mockApi.mockImplementation(fakeApi(master))
    renderPage(FPIL, routes, 'tao_analyst')
    await screen.findByRole('table', { name: 'Covenant definitions' })
    expect(screen.getByText('Read only. Only TAO Admin can change master data.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /New version|Add definition/ })).toBeNull()
  })

  it('unknown program, loading, error, no-access', async () => {
    mockApi.mockImplementation(fakeApi(master))
    const a = renderPage('/admin/partners/manager/programs/nope', routes)
    expect(await screen.findByRole('heading', { name: 'No such program' })).toBeTruthy(); a.unmount()
    mockApi.mockImplementation(never)
    const b = renderPage(FPIL, routes); expect(screen.getByText('Loading program')).toBeTruthy(); b.unmount()
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /master/covenants': httpError(500, 'x') }))
    const c = renderPage(FPIL, routes); expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy(); c.unmount()
    mockApi.mockImplementation(fakeApi({ 'GET /master/partners': forbidden(), 'GET /master/programs': forbidden(), 'GET /master/deals': forbidden(), 'GET /master/covenants': forbidden() }))
    renderPage(FPIL, routes); expect(await screen.findByRole('heading', { name: 'You don’t have access' })).toBeTruthy()
  })
})
