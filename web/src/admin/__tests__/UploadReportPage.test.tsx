// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, within, act, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderPage, fakeApi, httpError, never, header, DEALS, PROGRAMS, upload } from './helpers'

vi.mock('@/shell/api', () => ({ api: vi.fn() }))
import { api } from '@/shell/api'
import UploadReportPage from '../UploadReportPage'

const mockApi = vi.mocked(api)
const route: [string, JSX.Element][] = [['/admin/uploads/new', <UploadReportPage />]]
const pdf = () => new File(['%PDF-1.7'], 'Moneda-202608 -SETTREP.pdf', { type: 'application/pdf' })
const master = { 'GET /master/deals': DEALS, 'GET /master/programs': PROGRAMS }

async function fillAndChoose(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(await screen.findByLabelText(/^Deal/), 'f-pil-2-0-moneda-capital-corp')
  fireEvent.change(screen.getByLabelText(/^Collection period/), { target: { value: '2026-08' } })
  await user.upload(screen.getByTestId('filedrop-input'), pdf())
}

beforeEach(() => { mockApi.mockReset() })
afterEach(() => { vi.useRealTimers() })

describe('Upload report', () => {
  it('shows a loading skeleton while deals load', () => {
    mockApi.mockImplementation(never)
    renderPage('/admin/uploads/new', route)
    expect(screen.getByText('Loading deals')).toBeTruthy()
    expect(header().title).toBe('Upload report')
  })

  it('shows an error with retry when deals fail to load, and recovers', async () => {
    let fail = true
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /master/deals': () => fail ? httpError(500, 'boom', 'database down') : DEALS }))
    renderPage('/admin/uploads/new', route)
    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeTruthy()
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByLabelText(/^Deal/)).toBeTruthy()
  })

  it('shows no access when the API refuses the role', async () => {
    mockApi.mockImplementation(fakeApi({ 'GET /master/deals': httpError(403, 'tao_only'), 'GET /master/programs': httpError(403, 'tao_only') }))
    renderPage('/admin/uploads/new', route, 'tao_analyst')
    expect(await screen.findByRole('heading', { name: 'You don’t have access' })).toBeTruthy()
  })

  it('shows an empty state when no deals are set up', async () => {
    mockApi.mockImplementation(fakeApi({ 'GET /master/deals': [], 'GET /master/programs': PROGRAMS }))
    renderPage('/admin/uploads/new', route)
    expect(await screen.findByText(/No deals are set up yet/)).toBeTruthy()
  })

  it('groups deals by program and keeps the file drop disabled until deal and period are chosen', async () => {
    mockApi.mockImplementation(fakeApi(master))
    renderPage('/admin/uploads/new', route)
    const select = await screen.findByLabelText(/^Deal/)
    const groups = within(select).getAllByRole('group')
    expect(groups.map(g => g.getAttribute('label'))).toEqual(['F-PIL 2.0', 'MOVE Trust'])
    expect(within(groups[0]).getAllByRole('option').map(o => o.textContent)).toEqual(['Moneda Capital Corp.', 'Stride Capital'])
    const drop = screen.getByRole('button', { name: 'Choose the settlement report PDF' })
    expect(drop.getAttribute('aria-disabled')).toBe('true')
    await userEvent.selectOptions(select, 'f-pil-2-0-moneda-capital-corp')
    expect(drop.getAttribute('aria-disabled')).toBe('true')
    fireEvent.change(screen.getByLabelText(/^Collection period/), { target: { value: '2026-08' } })
    expect(drop.getAttribute('aria-disabled')).toBeNull()
    expect((screen.getByRole('button', { name: 'Upload report' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('flags a malformed period', async () => {
    mockApi.mockImplementation(fakeApi(master))
    renderPage('/admin/uploads/new', route)
    const input = await screen.findByLabelText(/^Collection period/)
    fireEvent.change(input, { target: { value: '2026-8' } })
    fireEvent.blur(input)
    expect(screen.getByText('Use YYYY-MM, e.g. 2026-08.')).toBeTruthy()
  })

  it('rejects a non-PDF file before upload', async () => {
    mockApi.mockImplementation(fakeApi(master))
    const user = userEvent.setup({ applyAccept: false })
    renderPage('/admin/uploads/new', route)
    await user.selectOptions(await screen.findByLabelText(/^Deal/), 'f-pil-2-0-moneda-capital-corp')
    fireEvent.change(screen.getByLabelText(/^Collection period/), { target: { value: '2026-08' } })
    await user.upload(screen.getByTestId('filedrop-input'), new File(['x'], 'report.xlsx', { type: 'application/vnd.ms-excel' }))
    expect(screen.getByText(/Wrong file type/)).toBeTruthy()
  })

  it('posts multipart form data, shows both dates and polls received → extracting → needs_review every 2 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const states = [
      upload({ status: 'extracting' }),
      upload({ status: 'needs_review', reporting_period: '2026-07', finding_counts: { block: 1, review: 2, note: 0 }, latest_extraction_id: 'e1' }),
    ]
    let polls = 0
    let posted: FormData | undefined
    mockApi.mockImplementation(fakeApi({
      ...master,
      'POST /uploads': (_p: string, init?: RequestInit) => { posted = init!.body as FormData; return upload() },
      [`GET /uploads/${upload().id}`]: () => states[Math.min(polls++, states.length - 1)],
    }))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage('/admin/uploads/new', route)
    await fillAndChoose(user)
    await user.click(screen.getByRole('button', { name: 'Upload report' }))

    expect(posted!.get('deal_slug')).toBe('f-pil-2-0-moneda-capital-corp')
    expect(posted!.get('collection_period')).toBe('2026-08')
    expect((posted!.get('file') as File).name).toBe('Moneda-202608 -SETTREP.pdf')

    const card = (await screen.findByRole('heading', { name: 'Moneda-202608 -SETTREP.pdf' })).closest('section')!
    expect(within(card).getByText('Received', { selector: '.ds-pill' })).toBeTruthy()
    expect(screen.getByText('Aug 2026')).toBeTruthy()
    expect(screen.getByText('Read from the report once extraction finishes')).toBeTruthy()
    expect(polls).toBe(0)

    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(polls).toBe(1)
    expect(screen.getByText('Extracting', { selector: '.ds-pill' })).toBeTruthy()

    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(polls).toBe(2)
    expect(screen.getByText('Needs review', { selector: '.ds-pill' })).toBeTruthy()
    expect(screen.getByText('Jul 2026')).toBeTruthy()
    expect(screen.getByText('1 block')).toBeTruthy()
    const link = screen.getByRole('link', { name: /Review 3 findings/ })
    expect(link.getAttribute('href')).toBe(`/admin/uploads/queue/${upload().id}`)

    // Polling stops once the upload reaches review.
    await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
    expect(polls).toBe(2)
    expect(screen.queryByText(/R04/)).toBeNull()
  })

  it('warns when the reporting period is not the month before the collection period (R04)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockApi.mockImplementation(fakeApi({
      ...master,
      'POST /uploads': upload(),
      [`GET /uploads/${upload().id}`]: upload({ status: 'needs_review', reporting_period: '2026-08' }),
    }))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage('/admin/uploads/new', route)
    await fillAndChoose(user)
    await user.click(screen.getByRole('button', { name: 'Upload report' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(screen.getByText(/Rule R04 checks this/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open in approval queue →' })).toBeTruthy()
  })

  it('explains a 409 when the period is already published', async () => {
    mockApi.mockImplementation(fakeApi({ ...master, 'POST /uploads': httpError(409, 'already_published') }))
    const user = userEvent.setup()
    renderPage('/admin/uploads/new', route)
    await fillAndChoose(user)
    await user.click(screen.getByRole('button', { name: 'Upload report' }))
    expect(await screen.findByText(/already published/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Upload report' })).toBeTruthy()
  })

  it('shows extraction failure and lets the user start again', async () => {
    mockApi.mockImplementation(fakeApi({ ...master, 'POST /uploads': upload({ status: 'extraction_failed' }) }))
    const user = userEvent.setup()
    renderPage('/admin/uploads/new', route)
    await fillAndChoose(user)
    await user.click(screen.getByRole('button', { name: 'Upload report' }))
    expect(await screen.findByText(/Extraction failed\. Check the audit log/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Upload another report' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Upload report' })).toBeTruthy())
  })
})
