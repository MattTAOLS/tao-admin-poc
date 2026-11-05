// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderPage, fakeApi, httpError, never, header, DEALS, PROGRAMS, upload } from './helpers'
import type { AuditEntry } from '../data'

vi.mock('@/shell/api', () => ({ api: vi.fn(), apiBlob: vi.fn() }))
import { api, apiBlob } from '@/shell/api'
import AuditLogPage, { torontoMonth, monthName, changes } from '../AuditLogPage'
import { auditScope, AUDIT_ACTIONS } from '../data'
import { addMonths } from '../ui'

const mockApi = vi.mocked(api)
const mockBlob = vi.mocked(apiBlob)
const PATH = '/admin/settings/users/audit'
const route: [string, JSX.Element][] = [[PATH, <AuditLogPage />]]

// Entries dated in the current and earlier months (Toronto), so the page's "this month" is always populated.
const CUR = torontoMonth(new Date())
const PREV = addMonths(CUR, -1)
const OLD = addMonths(CUR, -2)
const at = (m: string, day: number, h = 15) => `${m}-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00Z`
const MONEDA = 'aaaaaaaa-0000-4000-8000-000000000001'
const DYNAMIC = 'aaaaaaaa-0000-4000-8000-000000000002'
const UPLOADS = [
  upload({ id: MONEDA, status: 'needs_review', collection_period: '2026-08', reporting_period: '2026-07' }),
  // MOVE Trust: collection period = the file month (lag 0).
  upload({ id: DYNAMIC, status: 'published', deal_slug: 'move-trust-dynamic-capital', program_slug: 'move-trust', collection_period: '2026-07', reporting_period: '2026-07',
    file_name: 'Dynamic - 202607 - SETTREP.pdf', published_at: at(CUR, 2) }),
]
const e = (o: Partial<AuditEntry> & Pick<AuditEntry, 'id' | 'at' | 'action'>): AuditEntry =>
  ({ actor_role: 'tao_admin', actor_label: 'tao_admin', upload_id: null, finding_id: null, reason: null, detail: {}, ...o })
const ENTRIES: AuditEntry[] = [
  e({ id: 'c1', at: at(CUR, 3, 16), action: 'publish', upload_id: DYNAMIC, detail: { deal_slug: 'move-trust-dynamic-capital', collection_period: '2026-07', replaced_upload_id: null } }),
  e({ id: 'c2', at: at(CUR, 3, 15), action: 'override', upload_id: MONEDA, finding_id: 'f0000000-0000-4000-8000-000000000001', reason: 'Servicer confirmed the closing', detail: { choice: 'use_ours', rule_id: 'R05' } }),
  e({ id: 'c3', at: at(CUR, 2, 15), action: 'extract', actor_role: 'system', actor_label: 'worker', upload_id: MONEDA, detail: { status: 'needs_review' } }),
  e({ id: 'c4', at: at(CUR, 2, 14), action: 'upload', actor_role: 'tao_analyst', actor_label: 'tao_analyst', upload_id: MONEDA, detail: { file_name: 'Moneda-202608 -SETTREP.pdf', page_count: 16, collection_period: '2026-08' } }),
  e({ id: 'c5', at: at(CUR, 2, 13), action: 'master_change', detail: { entity: 'program', key: 'f-pil-2-0', before: { limit: 150000000, currency: 'CAD' }, after: { limit: 175000000, currency: 'CAD' } } }),
  e({ id: 'c6', at: at(CUR, 1, 13), action: 'regenerate', detail: { program_slug: 'move-trust', publications: 9, trigger: 'manual' } }),
  e({ id: 'p1', at: at(PREV, 9), action: 'reject', upload_id: MONEDA, reason: 'Wrong deal chosen at upload' }),
  ...Array.from({ length: 54 }, (_, i) => e({ id: `p${i + 2}`, at: at(PREV, 10, 0) .replace('T00', `T${String(i % 24).padStart(2, '0')}`).replace(`-10T`, `-${String(10 + Math.floor(i / 24)).padStart(2, '0')}T`), action: 'extract', actor_role: 'system', actor_label: 'worker', upload_id: MONEDA, detail: { status: 'needs_review' } })),
  e({ id: 'o1', at: at(OLD, 12), action: 'master_change', detail: { entity: 'deal', key: 'move-trust-dynamic-capital', before: { servicer: 'Dynamic' }, after: { servicer: 'Dynamic Capital' } } }),
]

const calls: string[] = []
function auditApi(over: Record<string, unknown> = {}) {
  return fakeApi({
    'GET /master/deals': DEALS, 'GET /master/programs': PROGRAMS, 'GET /uploads': UPLOADS,
    'GET /audit': (p: string) => {
      calls.push(p)
      const q = new URLSearchParams(p.split('?')[1] ?? '')
      const text = q.get('q')?.toLowerCase()
      const rows = ENTRIES
        .filter(x => !q.get('scope') || auditScope(x) === q.get('scope'))
        .filter(x => !q.get('month') || torontoMonth(x.at) === q.get('month'))
        .filter(x => !q.get('upload_id') || x.upload_id === q.get('upload_id'))
        .filter(x => !q.get('action') || x.action === q.get('action'))
        .filter(x => !q.get('actor_role') || x.actor_role === q.get('actor_role'))
        .filter(x => !q.get('deal_slug') || JSON.stringify(x).includes(q.get('deal_slug')!) || UPLOADS.some(u => u.id === x.upload_id && u.deal_slug === q.get('deal_slug')))
        .filter(x => !text || JSON.stringify(x).toLowerCase().includes(text) || UPLOADS.some(u => u.id === x.upload_id && (u.deal_slug + u.file_name).toLowerCase().includes(text)))
        .sort((a, b) => b.at.localeCompare(a.at))
      const off = Number(q.get('offset') ?? 0), lim = Number(q.get('limit') ?? 100)
      return rows.slice(off, off + lim)
    },
    'GET /audit/months': (p: string) => {
      calls.push(p)
      const scope = new URLSearchParams(p.split('?')[1]).get('scope')
      const m = new Map<string, number>()
      for (const x of ENTRIES) if (auditScope(x) === scope) m.set(torontoMonth(x.at), (m.get(torontoMonth(x.at)) ?? 0) + 1)
      return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([month, count]) => ({ month, count }))
    },
    ...over,
  })
}
const log = () => screen.findByRole('table', { name: 'Audit log' })
const bodyRows = (t: HTMLElement) => within(t).getAllByRole('row').filter(r => r.querySelector('td') && !r.classList.contains('ds-table__detail'))
const loc = () => screen.getByTestId('loc').textContent

beforeEach(() => { mockApi.mockReset(); mockBlob.mockReset(); calls.length = 0 })

describe('helpers', () => {
  it('puts months in Toronto time: 23:30 on 31 October Toronto stays in October', () => {
    expect(torontoMonth('2026-11-01T03:30:00Z')).toBe('2026-10')
    expect(torontoMonth('2026-11-01T05:30:00Z')).toBe('2026-11')
    expect(monthName('2026-11')).toBe('November 2026')
  })
  it('derives the tab from the action, like the API, and knows the export action', () => {
    expect(AUDIT_ACTIONS).toContain('export')
    expect(auditScope({ action: 'extract', upload_id: 'x' })).toBe('reports')
    expect(auditScope({ action: 'regenerate', upload_id: null })).toBe('reports')
    expect(auditScope({ action: 'master_change', upload_id: null })).toBe('platform')
    expect(auditScope({ action: 'export', upload_id: null })).toBe('platform')
  })
  it('lists only the fields a change touched', () => {
    expect(changes({ before: { a: 1, b: 2 }, after: { a: 1, b: 3 } })).toEqual([{ field: 'b', before: 2, after: 3 }])
    expect(changes({ status: 'x' })).toEqual([])
  })
})

describe('Audit log (TAO Admin)', () => {
  it('opens the Reports tab on the current month, with tab counts and the deal and period as the report link', async () => {
    mockApi.mockImplementation(auditApi())
    renderPage(PATH, route)
    expect(header().title).toBe('Audit log')
    const t = await log()
    await waitFor(() => expect(bodyRows(t)).toHaveLength(5))
    expect(calls).toContain(`/audit?scope=reports&month=${CUR}&limit=100`)
    expect(screen.getByRole('heading', { name: monthName(CUR) })).toBeTruthy()
    const tabs = screen.getByRole('navigation', { name: 'Audit log sections' })
    expect(within(tabs).getByRole('button', { name: /Reports/ }).getAttribute('aria-current')).toBe('page')
    await waitFor(() => expect(within(tabs).getByRole('button', { name: /Reports/ }).textContent).toBe('Reports5'))
    expect(within(tabs).getByRole('button', { name: /Platform/ }).textContent).toBe('Platform1')

    const [publish, override, extract, uploadRow, regen] = bodyRows(t)
    expect(within(publish).getByRole('cell', { name: 'Publish' })).toBeTruthy()
    expect(publish.textContent).toContain('tao_admin')
    // MOVE Trust published upload: deal page at its own collection period (lag 0).
    const pubLink = await within(publish).findByRole('link', { name: 'Dynamic Capital, MOVE Trust · Jul 2026' })
    expect(pubLink.getAttribute('href')).toBe('/admin/portfolio/move-trust/deals/move-trust-dynamic-capital?period=2026-07')
    // F-PIL upload in review: the Review page; the period is the settlement month.
    expect(within(override).getByRole('link', { name: 'Moneda Capital Corp., F-PIL 2.0 · Aug 2026' }).getAttribute('href')).toBe(`/admin/uploads/queue/${MONEDA}`)
    expect(within(override).getByText('Servicer confirmed the closing')).toBeTruthy()
    expect(within(override).getByText('R05 · use_ours')).toBeTruthy()
    expect(within(extract).getByText('worker')).toBeTruthy()
    expect(within(uploadRow).getByText('TAO Analyst')).toBeTruthy()
    expect(within(regen).getByText('MOVE Trust')).toBeTruthy()
    expect(within(regen).getByText('Program')).toBeTruthy()
  })

  it('expands an entry on row click to show before → after, the reason and the ids', async () => {
    mockApi.mockImplementation(auditApi())
    renderPage(`${PATH}?tab=platform`, route)
    const t = await log()
    await waitFor(() => expect(bodyRows(t)).toHaveLength(1))
    expect(calls).toContain(`/audit?scope=platform&month=${CUR}&limit=100`)
    expect(within(t).getByRole('columnheader', { name: 'Subject' })).toBeTruthy()
    expect(within(bodyRows(t)[0]).getByText('F-PIL 2.0')).toBeTruthy()
    await userEvent.click(within(bodyRows(t)[0]).getByRole('cell', { name: 'Master data change' }))
    const ba = screen.getByRole('table', { name: 'Before and after' })
    expect(within(ba).getAllByRole('row').map(r => r.textContent)).toEqual(['FieldBeforeAfter', 'limit150000000175000000'])
    expect(screen.getByText('c5')).toBeTruthy()

    // Reports: an override shows its reason, the upload and the trail link.
    await userEvent.click(screen.getByRole('button', { name: /Reports/ }))
    expect(loc()).toBe(PATH)
    const r = await log()
    await waitFor(() => expect(bodyRows(r)).toHaveLength(5))
    await userEvent.click(within(r).getByRole('button', { name: /^Expand Override at/ }))
    expect(screen.getByText(/Collection period/).nextElementSibling!.textContent).toBe('Aug 2026 (reporting period Jul 2026)')
    expect(screen.getAllByText(MONEDA).length).toBeGreaterThan(0)
    expect(screen.getByText('f0000000-0000-4000-8000-000000000001')).toBeTruthy()
    await userEvent.click(screen.getByRole('link', { name: 'All entries for this upload' }))
    expect(loc()).toBe(`${PATH}?upload_id=${MONEDA}`)
  })

  it('lists earlier months under History with counts; a month opens in place (first 50, then Show all)', async () => {
    mockApi.mockImplementation(auditApi())
    renderPage(PATH, route)
    await log()
    const hist = await screen.findByRole('button', { name: new RegExp(`^${monthName(PREV)} 55 entries`) })
    expect(screen.queryByRole('button', { name: new RegExp(`^${monthName(OLD)}`) })).toBeNull() // OLD only has a platform entry
    expect(hist.getAttribute('aria-expanded')).toBe('false')
    await userEvent.click(hist)
    const t = await screen.findByRole('table', { name: `Reports entries, ${monthName(PREV)}` })
    await waitFor(() => expect(bodyRows(t)).toHaveLength(50))
    expect(calls).toContain(`/audit?scope=reports&month=${PREV}&limit=50`)
    expect(screen.getByText(/Showing the newest 50 of 55/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: `Show all ${monthName(PREV).split(' ')[0]} entries` }))
    await waitFor(() => expect(bodyRows(t)).toHaveLength(55))
    expect(calls).toContain(`/audit?scope=reports&month=${PREV}&limit=500&offset=0`)
  }, 60000)

  it('keeps the action, user and deal filters in the URL and sends them to the API', async () => {
    mockApi.mockImplementation(auditApi())
    renderPage(PATH, route)
    const t = await log()
    await waitFor(() => expect(bodyRows(t)).toHaveLength(5))
    await userEvent.selectOptions(screen.getByLabelText('Action'), 'override')
    await waitFor(() => expect(bodyRows(t)).toHaveLength(1))
    expect(loc()).toBe(`${PATH}?action=override`)
    expect(calls).toContain(`/audit?scope=reports&month=${CUR}&action=override&limit=100`)
    await userEvent.selectOptions(screen.getByLabelText('Action'), '')
    await userEvent.selectOptions(screen.getByLabelText('User'), 'tao_analyst')
    await waitFor(() => expect(bodyRows(t)).toHaveLength(1))
    await userEvent.selectOptions(screen.getByLabelText('Deal'), 'f-pil-2-0-moneda-capital-corp')
    expect(loc()).toBe(`${PATH}?actor=tao_analyst&deal=f-pil-2-0-moneda-capital-corp`)
    await waitFor(() => expect(calls).toContain(`/audit?scope=reports&month=${CUR}&actor_role=tao_analyst&deal_slug=f-pil-2-0-moneda-capital-corp&limit=100`))
    // Reads filters back from a deep link.
    expect((screen.getByLabelText('User') as HTMLSelectElement).value).toBe('tao_analyst')
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(loc()).toBe(PATH)
    // The action list groups both tabs, with the new export action under Platform.
    const groups = [...screen.getByLabelText('Action').querySelectorAll('optgroup')].map(g => g.label)
    expect(groups).toEqual(['Reports', 'Platform'])
    expect(within(screen.getByLabelText('Action')).getByRole('option', { name: 'Export' })).toBeTruthy()
  }, 20000)

  it('searches every month and both tabs: results grouped by month with a tab chip and highlighted matches', async () => {
    mockApi.mockImplementation(auditApi())
    renderPage(PATH, route)
    await log()
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search every month and both tabs' }), 'dynamic')
    await waitFor(() => expect(loc()).toBe(`${PATH}?q=dynamic`))
    expect(calls).toContain('/audit?scope=reports&q=dynamic&limit=500')
    expect(calls).toContain('/audit?scope=platform&q=dynamic&limit=500')
    const status = await screen.findByText(/2 results in 2 months · both tabs/)
    expect(status).toBeTruthy()
    const cur = screen.getByRole('table', { name: `Results in ${monthName(CUR)}` })
    expect(within(cur).getByText('Reports')).toBeTruthy()
    expect(within(cur).getAllByText('Dynamic', { selector: 'mark' }).length).toBeGreaterThan(0)
    const old = screen.getByRole('table', { name: `Results in ${monthName(OLD)}` })
    expect(within(old).getByText('Platform')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(loc()).toBe(PATH)
    expect(await log()).toBeTruthy()
  }, 20000)

  it('opens one upload’s trail across all months from ?upload_id= (the Audit link on an upload)', async () => {
    mockApi.mockImplementation(auditApi())
    renderPage(`${PATH}?upload_id=${MONEDA}`, route)
    const t = await log()
    await waitFor(() => expect(bodyRows(t)).toHaveLength(58))
    expect(calls).toContain(`/audit?scope=reports&upload_id=${MONEDA}&limit=500&offset=0`)
    expect(screen.getByRole('link', { name: 'Open the upload' }).getAttribute('href')).toBe(`/admin/uploads/queue/${MONEDA}`)
    await userEvent.click(screen.getByRole('button', { name: 'Back to this month' }))
    expect(loc()).toBe(PATH)
  }, 20000)

  it('exports the open month of the open tab as CSV', async () => {
    mockApi.mockImplementation(auditApi())
    mockBlob.mockResolvedValue(new Blob(['when,tab\n'], { type: 'text/csv' }))
    const create = vi.fn(() => 'blob:x'); const revoke = vi.fn()
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { expect(this.download).toBe(`audit-reports-${CUR}.csv`) })
    renderPage(PATH, route)
    await log()
    await userEvent.click(screen.getByRole('button', { name: `Export CSV, Reports, ${monthName(CUR)}` }))
    await waitFor(() => expect(mockBlob).toHaveBeenCalledWith(`/audit/export.csv?scope=reports&month=${CUR}`))
    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(await screen.findByText('Export downloaded')).toBeTruthy()
    click.mockRestore()
  })
})

describe('Audit log (TAO Analyst: Reports tab only)', () => {
  it('shows only the Reports tab, never asks for platform data, and searches Reports only', async () => {
    mockApi.mockImplementation(auditApi())
    renderPage(`${PATH}?tab=platform`, route, 'tao_analyst')
    const t = await log()
    await waitFor(() => expect(bodyRows(t)).toHaveLength(5))
    const tabs = screen.getByRole('navigation', { name: 'Audit log sections' })
    expect(within(tabs).queryByRole('button', { name: /Platform/ })).toBeNull()
    expect(within(tabs).getByRole('button', { name: /Reports/ })).toBeTruthy()
    expect([...screen.getByLabelText('Action').querySelectorAll('optgroup')].map(g => g.label)).toEqual(['Reports'])
    expect(header().subtitle).toBe('Everything that happens to a report. This month first; earlier months under History.')
    expect(screen.getByText('The Platform tab (master data and exports) is for TAO Admin.')).toBeTruthy()
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search every month' }), 'dynamic')
    await screen.findByText(/results? in \d+ months? · Reports tab/)
    expect(calls.some(c => c.includes('scope=platform'))).toBe(false)
    expect(calls.filter(c => c.startsWith('/audit') && !c.includes('scope=reports'))).toEqual([])
  }, 20000)

  it('opens an upload trail with scope=reports', async () => {
    mockApi.mockImplementation(auditApi())
    renderPage(`${PATH}?upload_id=${DYNAMIC}`, route, 'tao_analyst')
    const t = await log()
    await waitFor(() => expect(bodyRows(t)).toHaveLength(1))
    expect(calls).toContain(`/audit?scope=reports&upload_id=${DYNAMIC}&limit=500&offset=0`)
    expect(calls.some(c => c.includes('scope=platform'))).toBe(false)
  })
})

describe('Audit log states', () => {
  it('loading, empty, error and no access', async () => {
    mockApi.mockImplementation(never)
    const a = renderPage(PATH, route)
    expect(a.container.querySelector('.ds-table-wrap[aria-busy="true"]')).toBeTruthy()
    a.unmount()

    mockApi.mockImplementation(auditApi({ 'GET /audit': [], 'GET /audit/months': [] }))
    const b = renderPage(PATH, route)
    expect(await screen.findByText(`No Reports entries in ${monthName(CUR)}`)).toBeTruthy()
    expect(screen.getByText('No earlier months yet.')).toBeTruthy()
    b.unmount()

    mockApi.mockImplementation(auditApi({ 'GET /audit': [] }))
    const c = renderPage(`${PATH}?action=publish`, route)
    expect(await screen.findByText('No entries match these filters')).toBeTruthy()
    c.unmount()

    mockApi.mockImplementation(auditApi({ 'GET /audit': httpError(500, 'boom') }))
    const d = renderPage(PATH, route)
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy()
    d.unmount()

    mockApi.mockImplementation(auditApi({ 'GET /audit': httpError(403, 'admin_only'), 'GET /audit/months': httpError(403, 'admin_only') }))
    renderPage(PATH, route, 'investor_admin')
    expect((await screen.findAllByRole('heading', { name: 'You don’t have access' })).length).toBeGreaterThan(0)
  }, 20000)

  it('a row click on the Report link follows the link and does not expand the row', async () => {
    mockApi.mockImplementation(auditApi())
    renderPage(PATH, route)
    const t = await log()
    await waitFor(() => expect(bodyRows(t)).toHaveLength(5))
    fireEvent.click(await within(bodyRows(t)[0]).findByRole('link', { name: /^Dynamic Capital/ }))
    expect(loc()).toBe('/admin/portfolio/move-trust/deals/move-trust-dynamic-capital?period=2026-07')
  })
})
