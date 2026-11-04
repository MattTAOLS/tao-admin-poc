// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, within, act, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderPage, fakeApi, httpError, never, header, DEALS, PROGRAMS, upload, AUDIT } from './helpers'

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
    const drop = screen.getByRole('button', { name: 'Drop the settlement report PDF here, or click to choose' })
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
    expect(screen.getByText(/should be the month before the collection period/)).toBeTruthy()
    expect(screen.getByText(/Rule R04 checks this/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open in approval queue →' })).toBeTruthy()
  })

  it('expects the same month on a MOVE Trust deal (reporting lag 0 in rules.yaml)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const move = { deal_slug: 'move-trust-dynamic-capital', program_slug: 'move-trust', collection_period: '2026-04' }
    mockApi.mockImplementation(fakeApi({
      ...master,
      'POST /uploads': upload(move),
      [`GET /uploads/${upload().id}`]: upload({ ...move, status: 'needs_review', reporting_period: '2026-04' }),
    }))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage('/admin/uploads/new', route)
    await user.selectOptions(await screen.findByLabelText(/^Deal/), 'move-trust-dynamic-capital')
    fireEvent.change(screen.getByLabelText(/^Collection period/), { target: { value: '2026-04' } })
    await user.upload(screen.getByTestId('filedrop-input'), pdf())
    await user.click(screen.getByRole('button', { name: 'Upload report' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(screen.getByText('Needs review', { selector: '[aria-current="step"]' })).toBeTruthy()
    expect(screen.queryByText(/Rule R04 checks this/)).toBeNull()
  })

  // The published Moneda Aug upload the re-issue replaces (demo profile admin publishes it).
  const PUBLISHED = upload({ id: '9a1b2c3d-0000-4000-8000-00000000aaaa', status: 'published', reporting_period: '2026-07', published_at: '2026-11-03T15:20:00Z' })
  const reissue = upload({ id: '9a1b2c3d-0000-4000-8000-00000000bbbb', replaces_upload_id: PUBLISHED.id })

  it('409 already_published: explains, confirms, and resends with replace=true', async () => {
    const posts: FormData[] = []
    let lookups = 0
    mockApi.mockImplementation(fakeApi({
      ...master,
      // The lookup finds nothing at first (as if the list loaded before the publication); the 409 triggers a reload.
      'GET /uploads': () => (lookups++ === 0 ? [] : [PUBLISHED]),
      'POST /uploads': (_p: string, init?: RequestInit) => {
        const fd = init!.body as FormData; posts.push(fd)
        return fd.get('replace') === 'true' ? reissue : httpError(409, 'already_published', 'already published (R12)')
      },
      [`GET /uploads/${reissue.id}`]: reissue,
    }))
    const user = userEvent.setup()
    renderPage('/admin/uploads/new', route)
    await fillAndChoose(user)
    await user.click(screen.getByRole('button', { name: 'Upload report' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Already published' })
    expect(posts[0].get('replace')).toBeNull()
    await waitFor(() => expect(within(dialog).getByText(/Moneda Capital Corp\. Aug 2026 is already published \(on .*2026.*\)\. Upload this file as a corrected re-issue\? It goes through review again and replaces the published report when approved\./)).toBeTruthy())
    await user.click(within(dialog).getByRole('button', { name: 'Upload as corrected re-issue' }))
    await waitFor(() => expect(posts).toHaveLength(2))
    expect(posts[1].get('replace')).toBe('true')
    expect(posts[1].get('deal_slug')).toBe('f-pil-2-0-moneda-capital-corp')
    expect(posts[1].get('collection_period')).toBe('2026-08')
    expect(await screen.findByText('Corrected re-issue')).toBeTruthy()
    expect(screen.getByText(/Replaces the report published .*once approved/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Both uploads' }).getAttribute('href')).toBe('/admin/uploads/history?deal=f-pil-2-0-moneda-capital-corp&period=2026-08')
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('409 already_published: cancel closes the dialog and sends nothing more', async () => {
    let n = 0
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /uploads': [PUBLISHED], 'POST /uploads': () => { n++; return httpError(409, 'already_published') } }))
    const user = userEvent.setup()
    renderPage('/admin/uploads/new', route)
    await user.selectOptions(await screen.findByLabelText(/^Deal/), 'f-pil-2-0-moneda-capital-corp')
    fireEvent.change(screen.getByLabelText(/^Collection period/), { target: { value: '2026-08' } })
    await screen.findByRole('checkbox', { name: /This is a corrected re-issue/ })
    await user.upload(screen.getByTestId('filedrop-input'), pdf())
    await user.click(screen.getByRole('button', { name: 'Upload report' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(n).toBe(1)
  })

  it('offers a corrected re-issue checkbox when the chosen deal and period are already published', async () => {
    const calls: string[] = []
    let posted: FormData | undefined
    mockApi.mockImplementation(fakeApi({
      ...master,
      'GET /uploads': (p: string) => { calls.push(p); return p.includes('collection_period=2026-08') ? [PUBLISHED] : [] },
      'POST /uploads': (_p: string, init?: RequestInit) => { posted = init!.body as FormData; return reissue },
      [`GET /uploads/${reissue.id}`]: reissue,
    }))
    const user = userEvent.setup()
    renderPage('/admin/uploads/new', route)
    await user.selectOptions(await screen.findByLabelText(/^Deal/), 'f-pil-2-0-moneda-capital-corp')
    fireEvent.change(screen.getByLabelText(/^Collection period/), { target: { value: '2026-07' } })
    await waitFor(() => expect(calls).toContain('/uploads?deal_slug=f-pil-2-0-moneda-capital-corp&collection_period=2026-07&status=published'))
    expect(screen.queryByRole('checkbox', { name: /corrected re-issue/ })).toBeNull()
    fireEvent.change(screen.getByLabelText(/^Collection period/), { target: { value: '2026-08' } })
    const box = await screen.findByRole('checkbox', { name: /This is a corrected re-issue/ })
    expect(screen.getByText(/Moneda Capital Corp\. Aug 2026 is already published \(on/)).toBeTruthy()
    await user.click(box)
    await user.upload(screen.getByTestId('filedrop-input'), pdf())
    await user.click(screen.getByRole('button', { name: 'Upload corrected re-issue' }))
    await waitFor(() => expect(posted).toBeTruthy())
    expect(posted!.get('replace')).toBe('true')
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('nothing_to_replace: a plain sentence', async () => {
    mockApi.mockImplementation(fakeApi({ ...master, 'GET /uploads': [PUBLISHED], 'POST /uploads': httpError(422, 'nothing_to_replace', 'no publication') }))
    const user = userEvent.setup()
    renderPage('/admin/uploads/new', route)
    await user.selectOptions(await screen.findByLabelText(/^Deal/), 'f-pil-2-0-moneda-capital-corp')
    fireEvent.change(screen.getByLabelText(/^Collection period/), { target: { value: '2026-08' } })
    await user.click(await screen.findByRole('checkbox', { name: /This is a corrected re-issue/ }))
    await user.upload(screen.getByTestId('filedrop-input'), pdf())
    await user.click(screen.getByRole('button', { name: 'Upload corrected re-issue' }))
    expect(await screen.findByText('Nothing is published for this deal and collection period yet, so there is nothing to replace. Upload it as a normal report.')).toBeTruthy()
  })

  it('shows the failure reason from the audit entry to TAO Admin', async () => {
    const reason = 'page 1 has no text layer; cover block not found'
    mockApi.mockImplementation(fakeApi({ ...master, 'POST /uploads': upload({ status: 'extraction_failed' }),
      'GET /audit': [{ ...AUDIT[0], reason, detail: { status: 'extraction_failed' } }] }))
    const user = userEvent.setup()
    renderPage('/admin/uploads/new', route)
    await fillAndChoose(user)
    await user.click(screen.getByRole('button', { name: 'Upload report' }))
    expect(await screen.findByText(`Extraction failed: ${reason}.`, { exact: false })).toBeTruthy()
  })

  it('shows extraction failure and lets the user start again', async () => {
    mockApi.mockImplementation(fakeApi({ ...master, 'POST /uploads': upload({ status: 'extraction_failed' }) }))
    const user = userEvent.setup()
    renderPage('/admin/uploads/new', route)
    await fillAndChoose(user)
    await user.click(screen.getByRole('button', { name: 'Upload report' }))
    expect(await screen.findByText(/Extraction failed: the report could not be read/)).toBeTruthy()
    expect(screen.queryByText(/audit log/)).toBeNull()
    expect(screen.getByRole('link', { name: 'Upload details →' }).getAttribute('href')).toBe(`/admin/uploads/queue/${upload().id}`)
    await user.click(screen.getByRole('button', { name: 'Upload another report' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Upload report' })).toBeTruthy())
  })
})
