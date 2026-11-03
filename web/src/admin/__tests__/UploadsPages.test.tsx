// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderPage, fakeApi, httpError, never, header, DEALS, PROGRAMS, upload } from './helpers'

vi.mock('@/shell/api', () => ({ api: vi.fn() }))
import { api } from '@/shell/api'
import UploadsPage from '../UploadsPage'
import UploadHistoryPage from '../UploadHistoryPage'
import { queueCounts } from '../ui'

const mockApi = vi.mocked(api)
const master = { 'GET /master/deals': DEALS, 'GET /master/programs': PROGRAMS }
const thisMonth = new Date().toISOString()
const UPLOADS = [
  upload({ id: 'u1', status: 'received', uploaded_at: '2026-11-03T15:00:00Z' }),
  upload({ id: 'u2', status: 'extracting', deal_slug: 'f-pil-2-0-stride-capital', file_name: 'Stride Capital - 202608 - SETTREP.pdf', uploaded_at: '2026-11-03T14:00:00Z' }),
  upload({ id: 'u3', status: 'needs_review', collection_period: '2026-07', reporting_period: '2026-06', finding_counts: { block: 1, review: 0, note: 2 }, uploaded_at: '2026-11-02T10:00:00Z' }),
  upload({ id: 'u4', status: 'published', collection_period: '2026-06', reporting_period: '2026-05', published_at: thisMonth, uploaded_at: '2026-11-01T10:00:00Z' }),
  upload({ id: 'u5', status: 'published', collection_period: '2026-05', reporting_period: '2026-04', published_at: '2025-01-15T10:00:00Z', uploaded_at: '2025-01-15T09:00:00Z' }),
]
const uploadsRoute: [string, JSX.Element][] = [['/admin/uploads', <UploadsPage />]]
const historyRoute: [string, JSX.Element][] = [['/admin/uploads/history', <UploadHistoryPage />]]

beforeEach(() => { mockApi.mockReset() })

describe('queueCounts', () => {
  it('counts each queue state and only this month’s publications', () => {
    expect(queueCounts(UPLOADS)).toEqual({ received: 1, extracting: 1, needs_review: 1, published_this_month: 1 })
  })
})

describe('Uploads', () => {
  it('shows tiles and the recent list, newest first, with a review link for needs_review', async () => {
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /uploads': UPLOADS }))
    renderPage('/admin/uploads', uploadsRoute)
    expect(header().title).toBe('Uploads')
    const table = await screen.findByRole('table', { name: 'Recent uploads' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(5)
    expect(within(rows[0]).getByText('Received')).toBeTruthy()
    expect(within(rows[1]).getByText('Stride Capital')).toBeTruthy()
    expect(within(rows[2]).getByRole('link', { name: /Review Moneda Capital Corp\. Jul 2026/ }).getAttribute('href')).toBe('/admin/uploads/queue/u3')
    const tile = (label: string) => screen.getByText(label, { selector: '.ds-kpi__label' }).closest('.ds-kpi')!
    expect(within(tile('Needs review') as HTMLElement).getByText('1')).toBeTruthy()
    expect(within(tile('Published this month') as HTMLElement).getByText('1')).toBeTruthy()
  })
  it('loading: skeleton tiles and table', () => {
    mockApi.mockImplementation(never)
    const { container } = renderPage('/admin/uploads', uploadsRoute)
    expect(container.querySelectorAll('.ds-kpi[aria-busy="true"]')).toHaveLength(4)
    expect(container.querySelector('.ds-table-wrap[aria-busy="true"]')).toBeTruthy()
  })
  it('empty: says so and offers the upload', async () => {
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /uploads': [] }))
    renderPage('/admin/uploads', uploadsRoute)
    expect(await screen.findByText('No uploads yet')).toBeTruthy()
    expect(screen.getAllByText('0', { selector: '.ds-kpi__value' })).toHaveLength(4)
  })
  it('error: retry panel', async () => {
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /uploads': httpError(500, 'boom') }))
    renderPage('/admin/uploads', uploadsRoute)
    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
  it('no access: a partner-role 403', async () => {
    mockApi.mockImplementation(fakeApi({ 'GET /uploads': httpError(403, 'tao_only'), ...Object.fromEntries(Object.keys(master).map(k => [k, httpError(403, 'tao_only')])) }))
    renderPage('/admin/uploads', uploadsRoute)
    expect(await screen.findByRole('heading', { name: 'You don’t have access' })).toBeTruthy()
  })
  it('analysts see no audit links (the audit log is tao_admin only)', async () => {
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /uploads': UPLOADS }))
    renderPage('/admin/uploads', uploadsRoute, 'tao_analyst')
    await screen.findByRole('table', { name: 'Recent uploads' })
    expect(screen.queryAllByRole('link', { name: /Audit trail/ })).toHaveLength(0)
  })
})

describe('Upload history', () => {
  it('filters by deal and status on the server and by period on the client, in the URL', async () => {
    const calls: string[] = []
    mockApi.mockImplementation(fakeApi({
      ...master,
      'GET /uploads': (p: string) => {
        calls.push(p)
        const q = new URLSearchParams(p.split('?')[1] ?? '')
        return UPLOADS.filter(u => (!q.get('deal_slug') || u.deal_slug === q.get('deal_slug')) && (!q.get('status') || u.status === q.get('status')))
      },
    }))
    renderPage('/admin/uploads/history', historyRoute)
    const table = await screen.findByRole('table', { name: 'Upload history' })
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(6))
    expect(header().title).toBe('Upload history')

    await userEvent.selectOptions(screen.getByLabelText('Deal'), 'f-pil-2-0-moneda-capital-corp')
    await waitFor(() => expect(calls.at(-1)).toBe('/uploads?deal_slug=f-pil-2-0-moneda-capital-corp'))
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(5))
    expect(screen.getByTestId('loc').textContent).toBe('/admin/uploads/history?deal=f-pil-2-0-moneda-capital-corp')

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'published')
    await waitFor(() => expect(calls.at(-1)).toBe('/uploads?deal_slug=f-pil-2-0-moneda-capital-corp&status=published'))
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(3))

    fireEvent.change(screen.getByLabelText(/Collection period/), { target: { value: '2026-06' } })
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2))
    expect(screen.getByText('1 upload match the filters')).toBeTruthy()
    const row = within(table).getAllByRole('row')[1]
    expect(within(row).getByText('Jun 2026')).toBeTruthy()
    expect(within(row).getByText('May 2026')).toBeTruthy()
    expect(within(row).getByText('Published')).toBeTruthy()

    fireEvent.change(screen.getByLabelText(/Collection period/), { target: { value: '2025-01' } })
    expect(await screen.findByText('No uploads match these filters')).toBeTruthy()
    await userEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0])
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/admin/uploads/history'))
  })
  it('shows finding counts right-aligned and who/when', async () => {
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /uploads': [UPLOADS[2]] }))
    renderPage('/admin/uploads/history', historyRoute)
    const table = await screen.findByRole('table', { name: 'Upload history' })
    const cells = within(within(table).getAllByRole('row')[1]).getAllByRole('cell')
    const blockCell = cells[5]
    expect(blockCell.textContent).toBe('1')
    expect(blockCell.className).toContain('ds-num')
    expect(within(table).getByText('tao_admin')).toBeTruthy()
    expect(table.querySelector('time')!.getAttribute('datetime')).toBe('2026-11-02T10:00:00Z')
    expect(within(table).getByRole('link', { name: /Audit trail/ }).getAttribute('href')).toBe('/admin/settings/users/audit?upload_id=u3')
  })
  it('reads filters from the URL on first load', async () => {
    const calls: string[] = []
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /uploads': (p: string) => { calls.push(p); return [] } }))
    renderPage('/admin/uploads/history?status=needs_review', historyRoute)
    expect(await screen.findByText('No uploads match these filters')).toBeTruthy()
    expect(calls).toEqual(['/uploads?status=needs_review'])
    expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('needs_review')
  })
  it('empty, loading, error and no-access states', async () => {
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /uploads': [] }))
    const a = renderPage('/admin/uploads/history', historyRoute)
    expect(await screen.findByText('No uploads yet')).toBeTruthy()
    a.unmount()

    mockApi.mockImplementation(never)
    const b = renderPage('/admin/uploads/history', historyRoute)
    expect(b.container.querySelector('.ds-table-wrap[aria-busy="true"]')).toBeTruthy()
    b.unmount()

    mockApi.mockImplementation(fakeApi({ ...master, 'GET /uploads': httpError(503, 'down', 'service unavailable') }))
    const c = renderPage('/admin/uploads/history', historyRoute)
    expect(await screen.findByText('The request failed: service unavailable')).toBeTruthy()
    c.unmount()

    mockApi.mockImplementation(fakeApi({ 'GET /master/deals': httpError(403, 'tao_only'), 'GET /master/programs': httpError(403, 'tao_only'), 'GET /uploads': httpError(403, 'tao_only') }))
    renderPage('/admin/uploads/history', historyRoute)
    expect(await screen.findByRole('heading', { name: 'You don’t have access' })).toBeTruthy()
  })
})
