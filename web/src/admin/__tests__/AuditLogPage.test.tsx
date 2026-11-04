// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderPage, fakeApi, httpError, never, header, AUDIT } from './helpers'

vi.mock('@/shell/api', () => ({ api: vi.fn() }))
import { api } from '@/shell/api'
import AuditLogPage from '../AuditLogPage'

const mockApi = vi.mocked(api)
const PATH = '/admin/settings/users/audit'
const route: [string, JSX.Element][] = [[PATH, <AuditLogPage />]]
const UID = AUDIT[0].upload_id!
const calls: string[] = []
const audit = fakeApi({ 'GET /audit': (p: string) => {
  calls.push(p)
  const q = new URLSearchParams(p.split('?')[1] ?? '')
  return AUDIT.filter(e => (!q.get('upload_id') || e.upload_id === q.get('upload_id')) && (!q.get('action') || e.action === q.get('action')))
} })
const bodyRows = () => within(screen.getByRole('table', { name: 'Audit log' })).getAllByRole('row').filter(r => r.querySelector('td') && !r.classList.contains('ds-table__detail'))

beforeEach(() => { mockApi.mockReset(); calls.length = 0 })

describe('Audit log', () => {
  it('lists entries newest first with action, actor and a one-line detail', async () => {
    mockApi.mockImplementation(audit)
    renderPage(PATH, route)
    await screen.findByRole('table', { name: 'Audit log' })
    expect(header().title).toBe('Audit log')
    await waitFor(() => expect(bodyRows()).toHaveLength(3))
    const [first, second, third] = bodyRows()
    expect(within(first).getByText('Extract')).toBeTruthy()
    expect(within(first).getByText('worker (system)')).toBeTruthy()
    expect(within(second).getByText('Moneda-202608 -SETTREP.pdf · 16 pages')).toBeTruthy()
    expect(within(third).getByText('Master data change')).toBeTruthy()
    expect(within(third).getByText('program f-pil-2-0')).toBeTruthy()
  })

  it('expands a row to show the full detail', async () => {
    mockApi.mockImplementation(audit)
    renderPage(PATH, route)
    await screen.findByRole('table', { name: 'Audit log' })
    await userEvent.click((await screen.findAllByRole('button', { name: /^Expand Upload at/ }))[0])
    expect(screen.getByText('file_name')).toBeTruthy()
    expect(screen.getAllByText(UID).length).toBeGreaterThan(0)
  })

  it('filters by action and by upload on the server, in the URL', async () => {
    mockApi.mockImplementation(audit)
    renderPage(PATH, route)
    await screen.findByRole('table', { name: 'Audit log' })
    await userEvent.selectOptions(screen.getByLabelText('Action'), 'master_change')
    await waitFor(() => expect(bodyRows()).toHaveLength(1))
    expect(screen.getByTestId('loc').textContent).toBe(PATH + '?action=master_change')
    expect(calls).toEqual(['/audit', '/audit?action=master_change'])

    await userEvent.selectOptions(screen.getByLabelText('Action'), '')
    await userEvent.type(screen.getByLabelText(/Upload id/), 'not-a-uuid')
    expect(screen.getByText('Paste a full upload id (a UUID).')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.clear(screen.getByLabelText(/Upload id/))
    await userEvent.click(screen.getByLabelText(/Upload id/))
    await userEvent.paste(UID)
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(calls.at(-1)).toBe(`/audit?upload_id=${UID}`))
    await waitFor(() => expect(bodyRows()).toHaveLength(2))
    expect(screen.getByRole('link', { name: 'Open the upload' }).getAttribute('href')).toBe(`/admin/uploads/queue/${UID}`)
  }, 15000)

  it('reads the upload filter from a deep link (from Upload history)', async () => {
    mockApi.mockImplementation(audit)
    renderPage(`${PATH}?upload_id=${UID}`, route)
    await screen.findByRole('table', { name: 'Audit log' })
    await waitFor(() => expect(bodyRows()).toHaveLength(2))
    expect(calls).toEqual([`/audit?upload_id=${UID}`])
    expect((screen.getByLabelText(/Upload id/) as HTMLInputElement).value).toBe(UID)
  })

  it('empty: no entries, and no matches with a clear button', async () => {
    mockApi.mockImplementation(fakeApi({ 'GET /audit': [] }))
    const a = renderPage(PATH, route)
    expect(await screen.findByText('No audit entries yet')).toBeTruthy()
    a.unmount()
    mockApi.mockImplementation(audit)
    renderPage(`${PATH}?action=publish`, route)
    expect(await screen.findByText('No entries match these filters')).toBeTruthy()
    await userEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0])
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe(PATH))
  })

  it('loading, error and no-access (tao_analyst gets 403 from /audit)', async () => {
    mockApi.mockImplementation(never)
    const a = renderPage(PATH, route)
    expect(a.container.querySelector('.ds-table-wrap[aria-busy="true"]')).toBeTruthy()
    a.unmount()
    mockApi.mockImplementation(fakeApi({ 'GET /audit': httpError(500, 'boom') }))
    const b = renderPage(PATH, route)
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy()
    b.unmount()
    mockApi.mockImplementation(fakeApi({ 'GET /audit': httpError(403, 'admin_only', 'tao_admin only') }))
    renderPage(PATH, route, 'tao_analyst')
    expect(await screen.findByRole('heading', { name: 'You don’t have access' })).toBeTruthy()
  })
})
