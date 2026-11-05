// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderPage, fakeApi, httpError, never, header, upload, DEALS, PROGRAMS, PARTNERS, COVENANTS } from './helpers'
import type { CovenantDefinition } from '../data'

vi.mock('@/shell/api', () => ({ api: vi.fn() }))
import { api } from '@/shell/api'
import PartnersPage from '../PartnersPage'
import PartnerDetailsPage from '../PartnerDetailsPage'
import ProgramRecordPage from '../ProgramRecordPage'
import { formatThreshold, thresholdText, versionStates, parseNumber, partnerRows, covenantHistory, lastChangeText, fieldChanges } from '../master'

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
const MONEDA_REVIEW = 'bbbbbbbb-0000-4000-8000-000000000001'
const MONEDA_REVIEW_2 = 'bbbbbbbb-0000-4000-8000-000000000002'
// History fixtures (include_history=true). 9.1 (h) is the seed row with one deliberate correction (watch buffer); 9.1 (i)
// is the design's D2 sample: the seed row plus Amendment 3 as a new version from 2027-01-01.
const H_OLD: CovenantDefinition = { ...COVENANTS[1], origin: 'seed', superseded_at: '2026-11-04T14:00:00Z' }
const H_NEW: CovenantDefinition = { ...COVENANTS[1], id: '7d1f0a8e-0000-4000-8000-000000000003', watch_buffer_pct: 0.15, origin: 'ui', superseded_at: null,
  supersedes_id: H_OLD.id, changed_by: 'tao_admin', change_reason: 'Watch buffer keyed as 10%; the SLFA says 15%.' }
const I_SEED: CovenantDefinition = { id: '7d1f0a8e-0000-4000-8000-000000000004', deal_slug: 'f-pil-2-0-moneda-capital-corp', legal_ref: 'SLFA 9.1 (i)', description: 'Leverage Ratio',
  kind: 'ceiling', threshold: 10, unit: 'ratio', threshold_rule: null, watch_buffer_pct: 0.1, effective_from: '2022-12-09', source: 'as above', origin: 'seed', superseded_at: null }
const I_V2: CovenantDefinition = { ...I_SEED, id: '7d1f0a8e-0000-4000-8000-000000000005', threshold: 9, effective_from: '2027-01-01', source: 'Amendment 3 dated 2026-10-30',
  origin: 'ui', changed_by: 'tao_admin', changed_at: '2026-11-05T15:58:00Z', change_reason: 'Amendment 3 lowers the leverage covenant from January 2027.' }
const HISTORY = [H_OLD, H_NEW, I_SEED, I_V2]

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
  it('builds a covenant history newest first: correction against the row it replaced, new version against the earlier version, seed last', () => {
    const h = covenantHistory([H_OLD, H_NEW])
    expect(h.map(x => [x.kind, x.who, x.at])).toEqual([['correct', 'TAO Admin', '2026-11-04T14:00:00Z'], ['seed', 'System', undefined]])
    expect(h[0].changes).toEqual([{ field: 'Watch buffer', before: '10%', after: '15%' }])
    expect(h[1].reason).toBe('Loaded from seed/covenant_definitions.json')
    const i = covenantHistory([I_SEED, I_V2])
    expect(i.map(x => x.kind)).toEqual(['new_version', 'seed'])
    expect(i[0].changes).toEqual([{ field: 'Threshold', before: '≤ 10.00×', after: '≤ 9.00×' }, { field: 'Source', before: 'as above', after: 'Amendment 3 dated 2026-10-30' }])
    // A ui row with no earlier version was added; a seed row replaced by a later seed run says so.
    const added = covenantHistory([{ ...I_V2, effective_from: '2022-12-09' }])
    expect(added[0].kind).toBe('add')
    expect(added[0].created).toBe('Ceiling, ≤ 9.00×, ratio, watch buffer 10%')
    expect(covenantHistory([{ ...I_SEED, superseded_at: '2026-10-01T00:00:00Z' }])[0].replacedAt).toBe('2026-10-01T00:00:00Z')
    expect(fieldChanges(I_SEED, { ...I_SEED, kind: 'floor', unit: null })).toEqual([
      { field: 'Direction', before: 'Ceiling', after: 'Floor' }, { field: 'Threshold', before: '≤ 10.00×', after: '≥ 10.00×' }, { field: 'Unit', before: 'ratio', after: 'not set' }])
  })
  it('last change: Seed load, or date and who (a correction dates from the row it replaced)', () => {
    expect(lastChangeText(COVENANTS[0], [])).toBe('Seed load')
    expect(lastChangeText(I_SEED, [])).toBe('Seed load')
    expect(lastChangeText(H_NEW, HISTORY)).toMatch(/^Nov \d+, 2026 · TAO Admin$/)
    expect(lastChangeText(I_V2, HISTORY)).toMatch(/^Nov \d+, 2026 · TAO Admin$/)
    expect(lastChangeText({ ...I_V2, changed_at: null }, HISTORY)).toBe('TAO Admin')
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
    const row = (await within(table).findAllByText('Investor'))[0].closest('tr')!
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
    const mgr = (await within(table).findAllByText('Manager'))[0].closest('tr')!
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
    const row = (await within(table).findAllByText('F-PIL 2.0'))[0].closest('tr')!
    expect(within(row).getAllByRole('cell').map(c => c.textContent)).toEqual(['F-PIL 2.0', 'CAD', '$150,000,000', '$5,000,000', '2', 'Investor, Manager'])
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(screen.getByTestId('loc').textContent).toBe(FPIL)
  })
  it('lists every program whose partner_slugs include the partner (manager sees both)', async () => {
    mockApi.mockImplementation(fakeApi(master))
    renderPage('/admin/partners/manager', routes)
    const table = await screen.findByRole('table', { name: 'Manager programs' })
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(3))
    await waitFor(() => expect(header().subtitle).toBe('Manager partner · active'))
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
  it('shows limits, deals with template id, and covenant definitions with bands, unit, effective date and last change', async () => {
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
    expect(within(c).getByText('Fraction')).toBeTruthy()
    expect(within(c).getByText('Ceiling')).toBeTruthy()
    expect(within(c).getByText('In force')).toBeTruthy()
    expect(within(c).getByText('10%')).toBeTruthy()
    expect(within(c).getByText('Seed load')).toBeTruthy()
    // The long source moved into the history panel.
    expect(within(c).queryByText(/UNVERIFIED/)).toBeNull()
    // Covenants of deals outside the program never show.
    expect(within(cov).getAllByRole('row')).toHaveLength(3)
    // The page asks for the history rows too.
    expect(mockApi.mock.calls.some(([p]) => p === '/master/covenants?include_history=true')).toBe(true)
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

  it('one Edit per row asks for new version or correction; a new version needs a later date and a reason of 10 characters', async () => {
    let body: Record<string, unknown> | undefined
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /uploads': [],
      'PUT /master/covenants': (_p: string, init?: RequestInit) => { body = JSON.parse(init!.body as string); return { definition: body, superseded_id: null, rerun_upload_ids: [MONEDA_REVIEW, MONEDA_REVIEW_2] } } }))
    renderPage(FPIL, routes)
    // One Edit button per covenant row: no separate New version button any more.
    await screen.findByRole('table', { name: 'Covenant definitions' })
    expect(screen.queryByRole('button', { name: /New version of/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Edit SLFA 9.1 (h) from 2023-12-09 for Moneda Capital Corp.' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('≥ 1.10× from 2023-12-09')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeTruthy()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByText('Choose how this change applies.')).toBeTruthy()
    expect(within(dialog).getByText('Required, at least 10 characters.')).toBeTruthy()
    await userEvent.click(within(dialog).getByRole('radio', { name: /New version from a date/ }))
    expect(within(dialog).getByRole('button', { name: 'Save new version' })).toBeTruthy()
    // Not later than the current version: refused before saving.
    fireEvent.change(within(dialog).getByLabelText(/Effective from/), { target: { value: '2023-12-09' } })
    await userEvent.type(within(dialog).getByLabelText(/^Reason/), 'too short')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save new version' }))
    expect(within(dialog).getByText('Must be later than 2023-12-09.', { selector: '.ds-field__error' })).toBeTruthy()
    expect(within(dialog).getByText('Required, at least 10 characters.')).toBeTruthy()
    expect(body).toBeUndefined()
    fireEvent.change(within(dialog).getByLabelText(/Effective from/), { target: { value: '2026-12-01' } })
    const th = within(dialog).getByLabelText(/^Threshold\*?$/)
    await userEvent.clear(th); await userEvent.type(th, '1.25')
    const src = within(dialog).getByLabelText(/Source/)
    await userEvent.clear(src); await userEvent.type(src, 'Amendment 1 2026-12-01')
    await userEvent.type(within(dialog).getByLabelText(/^Reason/), ' and now long enough')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save new version' }))
    await waitFor(() => expect(body).toBeTruthy())
    expect(body).toEqual({ deal_slug: 'f-pil-2-0-moneda-capital-corp', legal_ref: 'SLFA 9.1 (h)', description: 'Interest Coverage Ratio', kind: 'floor',
      unit: 'ratio', threshold: 1.25, threshold_rule: null, watch_buffer_pct: 0.1, effective_from: '2026-12-01', source: 'Amendment 1 2026-12-01',
      mode: 'new_version', reason: 'too short and now long enough' })
    // After saving: the re-run count from rerun_upload_ids.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getAllByText(/Re-ran the rules on 2 reports in review/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/SLFA 9.1 \(h\) saved as a new version/).length).toBeGreaterThan(0)
  })

  it('correct the current version keeps the id and the effective date (banded rule)', async () => {
    let body: Record<string, unknown> | undefined
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /uploads': [],
      'PUT /master/covenants': (_p: string, init?: RequestInit) => { body = JSON.parse(init!.body as string); return { definition: body, superseded_id: COVENANTS[0].id, rerun_upload_ids: [] } } }))
    renderPage(FPIL, routes)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit SLFA 9.1 (c) from 2022-12-09 for Moneda Capital Corp.' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('radio', { name: /Correct the current version/ }))
    const eff = within(dialog).getByLabelText(/Effective from/) as HTMLInputElement
    expect(eff.value).toBe('2022-12-09')
    expect(eff.disabled).toBe(true)
    const t2 = within(dialog).getByLabelText('Band 2 threshold')
    await userEvent.clear(t2); await userEvent.type(t2, '0.045')
    await userEvent.type(within(dialog).getByLabelText(/^Reason/), 'Band 2 was keyed as 4.00%, the SLFA says 4.50%.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save correction' }))
    await waitFor(() => expect(body).toBeTruthy())
    expect(body!.id).toBe(COVENANTS[0].id)
    expect(body!.mode).toBe('correct')
    expect(body!.effective_from).toBe('2022-12-09')
    expect(body!.threshold).toBeNull()
    expect(body!.threshold_rule).toEqual({ on: '/tranche_balance/closing', bands: [{ lte: 10000000, threshold: 0.06 }, { gt: 10000000, threshold: 0.045 }] })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getAllByText(/No report of this deal was in review, so nothing was re-run/).length).toBeGreaterThan(0)
  })

  it('the impact box lists this deal’s open reviews, says they are re-run and that published periods are not touched', async () => {
    mockApi.mockImplementation(fakeApi({ ...master,
      'GET /uploads': (p: string) => {
        expect(p).toBe('/uploads?status=needs_review&deal_slug=f-pil-2-0-moneda-capital-corp')
        return [upload({ id: MONEDA_REVIEW, status: 'needs_review', collection_period: '2026-08' }), upload({ id: MONEDA_REVIEW_2, status: 'needs_review', collection_period: '2026-07' })]
      } }))
    renderPage(FPIL, routes)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit SLFA 9.1 (h) from 2023-12-09 for Moneda Capital Corp.' }))
    const dialog = screen.getByRole('dialog')
    const box = within(dialog).getByRole('region', { name: 'What this change does' })
    expect(within(box).getByText('Choose how this change applies to see what it does.')).toBeTruthy()
    expect(within(box).getByText(/Published periods are not touched/)).toBeTruthy()
    await userEvent.click(within(dialog).getByRole('radio', { name: /New version from a date/ }))
    fireEvent.change(within(dialog).getByLabelText(/Effective from/), { target: { value: '2026-08-01' } })
    expect(within(box).getByText(/Adds a new version of SLFA 9.1 \(h\): ≥ 1.10× from 2026-08-01\. The version from 2023-12-09 \(≥ 1.10×\) stays in force until then; R14 uses the new version for collection periods from Aug 2026\./)).toBeTruthy()
    expect(await within(box).findByText(/Moneda Capital Corp\. Jul 2026 \(keeps the current version\); Moneda Capital Corp\. Aug 2026 \(uses the new version\)\. They are re-run when you save/)).toBeTruthy()
    await userEvent.click(within(dialog).getByRole('radio', { name: /Correct the current version/ }))
    expect(within(box).getByText(/Replaces the values of the version from 2023-12-09/)).toBeTruthy()
    expect(within(box).getByText(/Moneda Capital Corp\. Jul 2026; Moneda Capital Corp\. Aug 2026\. They are re-run/)).toBeTruthy()
  })

  it('Add covenant sends mode add with legal reference and description; unit and reason are required', async () => {
    let body: Record<string, unknown> | undefined
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /uploads': [],
      'PUT /master/covenants': (_p: string, init?: RequestInit) => { body = JSON.parse(init!.body as string); return { definition: body, rerun_upload_ids: [] } } }))
    renderPage(FPIL, routes)
    await screen.findByRole('table', { name: 'Covenant definitions' })
    await userEvent.selectOptions(screen.getByLabelText('Deal'), 'f-pil-2-0-moneda-capital-corp')
    await userEvent.click(screen.getByRole('button', { name: 'Add covenant' }))
    const dialog = screen.getByRole('dialog', { name: 'Add covenant' })
    expect((within(dialog).getByLabelText(/^Deal/) as HTMLSelectElement).value).toBe('f-pil-2-0-moneda-capital-corp')
    expect(within(dialog).queryByRole('radio')).toBeNull()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add covenant' }))
    expect(within(dialog).getByText('Choose the unit the threshold is in.')).toBeTruthy()
    expect(within(dialog).getByText('Required, e.g. SLFA 9.1 (c).')).toBeTruthy()
    expect(body).toBeUndefined()
    await userEvent.type(within(dialog).getByLabelText(/Legal reference/), 'SLFA 9.1 (e)')
    await userEvent.type(within(dialog).getByLabelText(/Description/), 'Delinquency Ratio')
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Unit/), 'fraction')
    await userEvent.type(within(dialog).getByLabelText(/^Threshold\*?$/), '0.035')
    fireEvent.change(within(dialog).getByLabelText(/Effective from/), { target: { value: '2022-12-09' } })
    await userEvent.type(within(dialog).getByLabelText(/^Reason/), 'SLFA 2022-12-09, section 9.1 (e), page 14.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add covenant' }))
    await waitFor(() => expect(body).toBeTruthy())
    expect(body).toEqual({ deal_slug: 'f-pil-2-0-moneda-capital-corp', legal_ref: 'SLFA 9.1 (e)', description: 'Delinquency Ratio', kind: 'ceiling', unit: 'fraction',
      threshold: 0.035, threshold_rule: null, watch_buffer_pct: 0.1, effective_from: '2022-12-09', source: null, mode: 'add', reason: 'SLFA 2022-12-09, section 9.1 (e), page 14.' })
  })

  it.each([
    ['not_current', 'This version has already been replaced by another change. Close the dialog, and edit the version the table shows now.', 'correct'],
    ['effective_not_later', 'A new version must start after the current version’s effective date. Pick a later date, or choose Correct the current version.', 'new_version'],
  ])('shows 409 %s as a plain message', async (code, message, choice) => {
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /uploads': [], 'PUT /master/covenants': httpError(409, code) }))
    renderPage(FPIL, routes)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit SLFA 9.1 (h) from 2023-12-09 for Moneda Capital Corp.' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('radio', { name: choice === 'correct' ? /Correct the current version/ : /New version from a date/ }))
    if (choice === 'new_version') fireEvent.change(within(dialog).getByLabelText(/Effective from/), { target: { value: '2026-12-01' } })
    await userEvent.type(within(dialog).getByLabelText(/^Reason/), 'A reason long enough.')
    await userEvent.click(within(dialog).getByRole('button', { name: choice === 'correct' ? 'Save correction' : 'Save new version' }))
    expect(await within(dialog).findByText(message)).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('shows 409 exists as a plain message when adding', async () => {
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /uploads': [], 'PUT /master/covenants': httpError(409, 'exists') }))
    renderPage(FPIL, routes)
    await userEvent.click(await screen.findByRole('button', { name: 'Add covenant' }))
    const dialog = screen.getByRole('dialog', { name: 'Add covenant' })
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Deal/), 'f-pil-2-0-moneda-capital-corp')
    await userEvent.type(within(dialog).getByLabelText(/Legal reference/), 'SLFA 9.1 (h)')
    await userEvent.type(within(dialog).getByLabelText(/Description/), 'Interest Coverage Ratio')
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Unit/), 'ratio')
    await userEvent.type(within(dialog).getByLabelText(/^Threshold\*?$/), '1.1')
    fireEvent.change(within(dialog).getByLabelText(/Effective from/), { target: { value: '2023-12-09' } })
    await userEvent.type(within(dialog).getByLabelText(/^Reason/), 'Typed in again by mistake.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add covenant' }))
    expect(await within(dialog).findByText('This deal already has a covenant with this legal reference. Edit that covenant instead of adding it again.')).toBeTruthy()
  })

  it('History opens a panel per covenant: who, when, old → new, effective date, kind and reason; superseded rows leave the table', async () => {
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /master/covenants': [...COVENANTS.slice(0, 1), ...HISTORY] }))
    renderPage(FPIL, routes)
    const cov = await screen.findByRole('table', { name: 'Covenant definitions' })
    // 9.1 (c), 9.1 (h) corrected (one current row), 9.1 (i) two versions: the corrected-away 9.1 (h) row is not listed.
    expect(within(cov).getAllByText('SLFA 9.1 (h)')).toHaveLength(1)
    expect(within(cov).getAllByText('SLFA 9.1 (i)')).toHaveLength(2)
    // One History button per covenant, on its newest row.
    expect(screen.getAllByRole('button', { name: /^History of / })).toHaveLength(3)
    const iRows = within(cov).getAllByText('SLFA 9.1 (i)').map(x => x.closest('tr')!)
    expect(within(iRows[0]).getByText('Scheduled')).toBeTruthy()
    expect(within(iRows[0]).getByText(/^Nov \d+, 2026 · TAO Admin$/)).toBeTruthy()
    expect(within(iRows[1]).getByText('Seed load')).toBeTruthy()
    const hRow = within(cov).getByText('SLFA 9.1 (h)').closest('tr')!
    expect(within(hRow).getByText(/^Nov \d+, 2026 · TAO Admin$/)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'History of SLFA 9.1 (i) for Moneda Capital Corp.' }))
    const hist = screen.getByRole('table', { name: 'Version history · Moneda Capital Corp. · SLFA 9.1 (i) Leverage Ratio' })
    const rows = within(hist).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('TAO Admin')).toBeTruthy()
    expect(within(rows[0]).getByText('New version')).toBeTruthy()
    expect(within(rows[0]).getByText('2027-01-01')).toBeTruthy()
    expect(within(rows[0]).getByText('Amendment 3 lowers the leverage covenant from January 2027.')).toBeTruthy()
    expect(rows[0].textContent).toContain('Threshold ≤ 10.00×→≤ 9.00×')
    expect(rows[0].textContent).toContain('Source as above→Amendment 3 dated 2026-10-30')
    expect(within(rows[1]).getByText('Seed load')).toBeTruthy()
    expect(within(rows[1]).getByText('System')).toBeTruthy()
    expect(within(rows[1]).getByText('Created')).toBeTruthy()
    expect(rows[1].textContent).toContain('Created: Ceiling, ≤ 10.00×, ratio, watch buffer 10%')
    expect(within(rows[1]).getByText('Loaded from seed/covenant_definitions.json')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'History of SLFA 9.1 (h) for Moneda Capital Corp.' }))
    const hh = screen.getByRole('table', { name: 'Version history · Moneda Capital Corp. · SLFA 9.1 (h) Interest Coverage Ratio' })
    const hrows = within(hh).getAllByRole('row').slice(1)
    expect(within(hrows[0]).getByText('Correction')).toBeTruthy()
    expect(hrows[0].textContent).toContain('Watch buffer 10%→15%')
    expect(within(hrows[0]).getByText('Watch buffer keyed as 10%; the SLFA says 15%.')).toBeTruthy()
    expect(within(hrows[1]).queryByText(/replaced/)).toBeNull()
    // Source text is in the history panel.
    expect(hrows[1].textContent).toContain('Source: as above (applies after first anniversary)')
  })

  it('analysts read only: History but no Edit or Add covenant', async () => {
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /master/covenants': [...COVENANTS.slice(0, 1), ...HISTORY] }))
    renderPage(FPIL, routes, 'tao_analyst')
    await screen.findByRole('table', { name: 'Covenant definitions' })
    expect(screen.getByText('Read only. Only TAO Admin can change master data.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /New version|Add covenant|Add definition/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'History of SLFA 9.1 (i) for Moneda Capital Corp.' }))
    expect(screen.getByRole('table', { name: /Version history · Moneda Capital Corp\. · SLFA 9\.1 \(i\)/ })).toBeTruthy()
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
