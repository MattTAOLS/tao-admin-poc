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
  it('links a failed upload to its details page, for analysts too', async () => {
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /uploads': [upload({ id: 'u9', status: 'extraction_failed' })] }))
    renderPage('/admin/uploads', uploadsRoute, 'tao_analyst')
    const link = await screen.findByRole('link', { name: /Details of the failed upload/ })
    expect(link.getAttribute('href')).toBe('/admin/uploads/queue/u9')
  })
})

describe('Upload history', () => {
  it('filters by deal, status and collection period on the server, in the URL', async () => {
    const calls: string[] = []
    mockApi.mockImplementation(fakeApi({
      ...master,
      'GET /uploads': (p: string) => {
        calls.push(p)
        const q = new URLSearchParams(p.split('?')[1] ?? '')
        return UPLOADS.filter(u => (!q.get('deal_slug') || u.deal_slug === q.get('deal_slug')) && (!q.get('status') || u.status === q.get('status'))
          && (!q.get('collection_period') || u.collection_period === q.get('collection_period')))
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

    // A partial period is not sent.
    fireEvent.change(screen.getByLabelText(/Collection period/), { target: { value: '2026-0' } })
    expect(calls.at(-1)).toBe('/uploads?deal_slug=f-pil-2-0-moneda-capital-corp&status=published')
    fireEvent.change(screen.getByLabelText(/Collection period/), { target: { value: '2026-06' } })
    await waitFor(() => expect(calls.at(-1)).toBe('/uploads?deal_slug=f-pil-2-0-moneda-capital-corp&status=published&collection_period=2026-06'))
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
  it('tags a re-issue and the upload it replaced, both linking to that deal and period', async () => {
    const old = upload({ id: 'old1', status: 'published', reporting_period: '2026-07', published_at: '2026-11-03T15:20:00Z', uploaded_at: '2026-11-03T15:10:00Z', replaced_by_upload_id: 'new1' })
    const reissue = upload({ id: 'new1', status: 'published', reporting_period: '2026-07', published_at: '2026-11-03T16:20:00Z', uploaded_at: '2026-11-03T16:00:00Z', replaces_upload_id: 'old1' })
    const plain = upload({ id: 'p1', status: 'needs_review', deal_slug: 'f-pil-2-0-stride-capital' })
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /uploads': [old, reissue, plain] }))
    renderPage('/admin/uploads/history', historyRoute)
    const table = await screen.findByRole('table', { name: 'Upload history' })
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(4))
    const re = within(table).getByRole('link', { name: /^Re-issue: replaces the upload of .*published/ })
    expect(re.textContent).toBe('Re-issue')
    expect(re.getAttribute('href')).toBe('/admin/uploads/history?deal=f-pil-2-0-moneda-capital-corp&period=2026-08')
    const by = within(table).getByRole('link', { name: /^Replaced by re-issue uploaded/ })
    expect(by.textContent).toBe('Replaced by re-issue')
    expect(within(table).getAllByText(/Re-issue|Replaced by re-issue/)).toHaveLength(2)
    // The tags sit in the rows they describe.
    expect(re.closest('tr')!.querySelector('time')!.getAttribute('datetime')).toBe('2026-11-03T16:00:00Z')
    expect(by.closest('tr')!.querySelector('time')!.getAttribute('datetime')).toBe('2026-11-03T15:10:00Z')
  })
  it('shows the re-issue tag on the Uploads recent list too', async () => {
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /uploads': [upload({ id: 'n2', status: 'needs_review', replaces_upload_id: 'gone' })] }))
    renderPage('/admin/uploads', uploadsRoute)
    const table = await screen.findByRole('table', { name: 'Recent uploads' })
    // The replaced upload is not in the list: the label still says what it is.
    expect(await within(table).findByRole('link', { name: 'Re-issue: replaces the upload' })).toBeTruthy()
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

describe('Whole-row open (D4): Uploads and Upload history share the table', () => {
  const ROWS = [
    upload({ id: 'r1', status: 'needs_review', collection_period: '2026-08', uploaded_at: '2026-11-05T10:00:00Z' }),
    upload({ id: 'r2', status: 'approved', deal_slug: 'f-pil-2-0-stride-capital', uploaded_at: '2026-11-05T09:00:00Z' }),
    // MOVE Trust: the collection period is the file month (lag 0), so a 202607 file opens the deal at 2026-07.
    upload({ id: 'r3', status: 'published', deal_slug: 'move-trust-dynamic-capital', program_slug: 'move-trust', collection_period: '2026-07', reporting_period: '2026-07',
      file_name: 'Dynamic - 202607 - SETTREP.pdf', published_at: '2026-11-04T10:00:00Z', uploaded_at: '2026-11-05T08:00:00Z' }),
    upload({ id: 'r4', status: 'extraction_failed', uploaded_at: '2026-11-05T07:00:00Z' }),
    upload({ id: 'r5', status: 'rejected', uploaded_at: '2026-11-05T06:00:00Z' }),
    upload({ id: 'r6', status: 'extracting', uploaded_at: '2026-11-05T05:00:00Z' }),
    // F-PIL: the collection period is the settlement month (2026-08 for a July reporting period).
    upload({ id: 'r7', status: 'published', collection_period: '2026-08', reporting_period: '2026-07', published_at: '2026-10-28T10:00:00Z', uploaded_at: '2026-11-05T04:00:00Z' }),
  ]
  const dealLink = (table: HTMLElement, i: number) => within(within(table).getAllByRole('row')[i + 1]).getAllByRole('link')[0]

  it('the deal name is a real link to the right place for every status', async () => {
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /uploads': ROWS }))
    renderPage('/admin/uploads/history', historyRoute)
    const table = await screen.findByRole('table', { name: 'Upload history' })
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(8))
    const hrefs = ROWS.map((_, i) => dealLink(table, i).getAttribute('href'))
    expect(hrefs).toEqual([
      '/admin/uploads/queue/r1', '/admin/uploads/queue/r2',
      '/admin/portfolio/move-trust/deals/move-trust-dynamic-capital?period=2026-07',
      '/admin/uploads/queue/r4', '/admin/uploads/queue/r5', '/admin/uploads/queue/r6',
      '/admin/portfolio/f-pil-2-0/deals/f-pil-2-0-moneda-capital-corp?period=2026-08',
    ])
    expect(dealLink(table, 0).getAttribute('aria-label')).toBe('Review Moneda Capital Corp. Aug 2026')
    expect(dealLink(table, 2).getAttribute('aria-label')).toBe('Open the published deal Dynamic Capital Jul 2026')
    expect(dealLink(table, 3).getAttribute('aria-label')).toBe('Details of the failed upload Moneda Capital Corp. Aug 2026')
    expect(dealLink(table, 4).getAttribute('aria-label')).toBe('Details of the rejected upload Moneda Capital Corp. Aug 2026')
    // The Open column names the destination.
    const open = within(table).getAllByRole('row').slice(1).map(r => r.querySelector('.adm-open')!.textContent)
    expect(open).toEqual(['Review ›', 'Review ›', 'Open deal ›', 'Details ›', 'Details ›', 'Details ›', 'Open deal ›'])
  })

  it('a click anywhere on the row, or Enter on the focused row, opens it', async () => {
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /uploads': ROWS }))
    renderPage('/admin/uploads/history', historyRoute)
    const table = await screen.findByRole('table', { name: 'Upload history' })
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(8))
    await userEvent.click(within(within(table).getAllByRole('row')[3]).getAllByRole('cell')[2])
    expect(screen.getByTestId('loc').textContent).toBe('/admin/portfolio/move-trust/deals/move-trust-dynamic-capital?period=2026-07')
  })

  it('Enter on a focused row opens it (keyboard)', async () => {
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /uploads': ROWS }))
    renderPage('/admin/uploads', uploadsRoute)
    const table = await screen.findByRole('table', { name: 'Recent uploads' })
    const row = within(table).getAllByRole('row')[4]
    row.focus()
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(screen.getByTestId('loc').textContent).toBe('/admin/uploads/queue/r4')
  })

  it('the Audit link goes to its own target, not the row', async () => {
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /uploads': ROWS }))
    renderPage('/admin/uploads/history', historyRoute)
    const table = await screen.findByRole('table', { name: 'Upload history' })
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(8))
    await userEvent.click(within(table).getAllByRole('link', { name: /^Audit trail for Dynamic Capital/ })[0])
    expect(screen.getByTestId('loc').textContent).toBe('/admin/settings/users/audit?upload_id=r3')
  })

  it('the re-issue tag keeps its own target', async () => {
    const re = upload({ id: 'r8', status: 'needs_review', replaces_upload_id: 'r7', uploaded_at: '2026-11-05T11:00:00Z' })
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /uploads': [re] }))
    renderPage('/admin/uploads/history', historyRoute)
    const table = await screen.findByRole('table', { name: 'Upload history' })
    await userEvent.click(await within(table).findByRole('link', { name: /^Re-issue: replaces/ }))
    expect(screen.getByTestId('loc').textContent).toBe('/admin/uploads/history?deal=f-pil-2-0-moneda-capital-corp&period=2026-08')
  })

  it('analysts open rows the same way, without the Audit link', async () => {
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /uploads': ROWS }))
    renderPage('/admin/uploads', uploadsRoute, 'tao_analyst')
    const table = await screen.findByRole('table', { name: 'Recent uploads' })
    expect(within(table).queryAllByRole('link', { name: /Audit trail/ })).toHaveLength(0)
    await userEvent.click(within(within(table).getAllByRole('row')[1]).getAllByRole('cell')[1])
    expect(screen.getByTestId('loc').textContent).toBe('/admin/uploads/queue/r1')
  })
})
