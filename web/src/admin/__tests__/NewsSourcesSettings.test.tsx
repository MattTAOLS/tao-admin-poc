// @vitest-environment jsdom
/// <reference types="node" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderPage, fakeApi, httpError, PARTNERS, PROGRAMS } from './helpers'
import './matchers'
import type { Deal } from '../data'

vi.mock('@/shell/api', () => ({ api: vi.fn(), apiBlob: vi.fn() }))
import { api } from '@/shell/api'
import SystemSettingsPage from '../SystemSettingsPage'
import type { NewsRun, Setting } from '../settings'
import { buildUpdate, draftOf, sourceStatus, type NewsSource, type NewsSources } from '../newsSources'

const mockApi = vi.mocked(api)
const root = resolve(__dirname, '../../../..')
const DEALS12: Deal[] = JSON.parse(readFileSync(resolve(root, 'seed/deals.json'), 'utf8'))
const PATH = '/admin/settings/system'
const route: [string, JSX.Element][] = [[PATH, <SystemSettingsPage />]]
const SETTINGS: Setting[] = [
  { key: 'partner_notifications_enabled', value: false, updated_at: null, updated_by: null },
  { key: 'reporting_calendar', value: {}, updated_at: null, updated_by: null },
  { key: 'notification_defaults', value: {}, updated_at: null, updated_by: null },
  { key: 'publish_note_templates', value: { new_report: 'Report for {deal_name} is ready.', correction: 'Corrected: {change_list}.' }, updated_at: null, updated_by: null },
  { key: 'company_feeds', value: { enabled: true, run_at: '06:00', time_zone: 'America/Toronto', sources: ['google_news', 'gdelt'] }, updated_at: '2026-11-06T13:00:00Z', updated_by: 'A. Patel' },
  { key: 'company_profiles_partner_enabled', value: false, updated_at: null, updated_by: null },
]
const NEVER = { at: null, ok: null, message: null }
const key = (name: string, label: string) => ({ name, label, secret: true, required: true })
/** Contract-shaped sources (NewsSource); the keys are placeholders, never real ones. */
const SOURCES: NewsSource[] = [
  { provider: 'event_registry', label: 'Event Registry (newsapi.ai)', available: true, note: 'Free plan: last 30 days only', enabled: false,
    fields: [key('api_key', 'API key'), { name: 'archive_months', label: 'Archive months', secret: false, required: false, kind: 'integer', help: '12 with an archive plan' }],
    secrets: { api_key: { set: true, last4: '9f3a' } }, config: { archive_months: 1 }, last_test: NEVER },
  { provider: 'newscatcher', label: 'NewsCatcher', available: true, note: null, enabled: true,
    fields: [key('api_key', 'API token'), { name: 'base_url', label: 'Base URL', secret: false, required: true, kind: 'url' }],
    secrets: { api_key: { set: true, last4: 'b71c' } }, config: { base_url: 'https://v3-api.newscatcherapi.com' },
    last_test: { at: '2026-11-09T14:00:00Z', ok: true, message: 'OK: 12 results for the test query' } },
  { provider: 'brave', label: 'Brave Search', available: true, note: '$5 per 1,000 requests', enabled: false,
    fields: [key('api_key', 'Subscription token'), { name: 'news', label: 'News search', secret: false, required: false, kind: 'boolean' }, { name: 'web', label: 'Web search', secret: false, required: false, kind: 'boolean' }],
    secrets: { api_key: { set: false, last4: null } }, config: { news: true, web: true }, last_test: NEVER },
  { provider: 'dow_jones', label: 'Dow Jones (Factiva)', available: false, note: 'Needs the client’s API documentation', enabled: false,
    fields: [key('user_key', 'User key')], secrets: { user_key: { set: false, last4: null } }, config: {}, last_test: NEVER },
  { provider: 'lexisnexis', label: 'LexisNexis (Nexis Data+)', available: false, note: 'Needs the client’s API documentation', enabled: false,
    fields: [key('client_id', 'Client ID'), key('client_secret', 'Client secret')],
    secrets: { client_id: { set: true, last4: '0c2d' }, client_secret: { set: false, last4: null } }, config: {}, last_test: NEVER },
]
const run = (o: Partial<NewsRun> & Pick<NewsRun, 'id'>): NewsRun => ({
  trigger: 'schedule', status: 'ok', queued_at: '2026-11-06T11:00:00Z', started_at: '2026-11-06T11:00:02Z', finished_at: '2026-11-06T11:01:10Z',
  companies: 10, items_added: 14, adverse_added: 1, errors: [], ...o,
})
const STATS = { calls: { google_news: 12, brave_news: 200, newscatcher: 9 }, capped: ['brave_news'], candidates: 40, kept: 12, excluded: 3, pending: 2,
  date_confirmed: 10, claude_input_tokens: 48210, claude_output_tokens: 3105 }
const RUNS: NewsRun[] = [
  run({ id: 'r1', trigger: 'recheck', items_added: 0, adverse_added: 0, stats: { candidates: 58, kept: 51, excluded: 7, pending: 0, date_confirmed: 44, claude_input_tokens: 70100, claude_output_tokens: 4020, calls: {}, capped: [] } }),
  run({ id: 'r2', stats: STATS }),
  run({ id: 'r3', stats: {} }),
]
const reply = (o: Partial<NewsSources> = {}): NewsSources => ({ secret_key_set: true, sources: SOURCES, ...o })
/** The PUT echo: what the API would return after storing the update (secrets as last4 only). */
const echo = (_p: string, i?: RequestInit) => {
  const provider = _p.split('/')[3]
  const s = structuredClone(SOURCES.find(x => x.provider === provider)!)
  const b = JSON.parse(String(i!.body))
  if (b.enabled !== undefined) s.enabled = b.enabled
  Object.assign(s.config, b.config ?? {})
  for (const [k, v] of Object.entries(b.secrets ?? {})) s.secrets[k] = v === null ? { set: false, last4: null } : { set: true, last4: String(v).slice(-4) }
  return s
}
function fake(over: Record<string, unknown> = {}) {
  return fakeApi({
    'GET /settings': SETTINGS, 'GET /master/programs': PROGRAMS, 'GET /master/deals': DEALS12, 'GET /master/partners': PARTNERS,
    'GET /news/runs': RUNS, 'GET /news/sources': reply(), 'PUT /settings/company_feeds': (_p: string, i?: RequestInit) => ({ key: 'company_feeds', value: JSON.parse(String(i!.body)).value, updated_at: null, updated_by: null }),
    ...over,
  })
}
const calls = (method: string, prefix: string) => mockApi.mock.calls.filter(([p, i]) => p.startsWith(prefix) && (i?.method ?? 'GET') === method)
const bodies = (method: string, prefix: string) => calls(method, prefix).map(([p, i]) => ({ path: p, body: JSON.parse(String(i!.body)) }))
const sec = () => screen.findByRole('region', { name: /6 · News sources/ })
const table = async () => within(await sec()).findByRole('table', { name: 'News sources' })
const rowOf = (t: HTMLElement, label: string) => within(t).getByRole('rowheader', { name: new RegExp(label.replace(/[()+]/g, '\\$&')) }).closest('tr')!
const openEdit = async (label: string) => {
  await userEvent.click(within(await sec()).getByRole('button', { name: `Edit ${label}` }))
  return screen.findByRole('dialog', { name: `Edit ${label}` })
}

beforeEach(() => { mockApi.mockReset() })
afterEach(() => { vi.useRealTimers() })

describe('news source helpers', () => {
  it('status: not available first, then a missing key, then on or off', () => {
    expect(SOURCES.map(s => sourceStatus(s).label)).toEqual(['Off', 'On', 'Key not set', 'Not available yet', 'Not available yet'])
  })
  it('an untouched draft sends nothing; integers go as numbers, empty text as null', () => {
    const s = SOURCES[0]
    expect(buildUpdate(s, draftOf(s))).toBeNull()
    expect(buildUpdate(s, { ...draftOf(s), config: { archive_months: '12' } })).toEqual({ config: { archive_months: 12 } })
    expect(buildUpdate(s, { ...draftOf(s), remove: ['api_key'] })).toEqual({ secrets: { api_key: null } })
    expect(buildUpdate(SOURCES[1], { ...draftOf(SOURCES[1]), config: { base_url: '' } })).toEqual({ config: { base_url: null } })
  })
})

describe('System settings: News sources', () => {
  it('one row per provider: label, note, status as dot and word, keys by last four, last test', async () => {
    mockApi.mockImplementation(fake())
    renderPage(PATH, route)
    const t = await table()
    const rows = within(t).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(5)
    expect(rows.map(r => r.querySelector('.ds-pill')!.textContent)).toEqual(['Off', 'On', 'Key not set', 'Not available yet', 'Not available yet'])
    expect(rows.every(r => r.querySelector('.ds-pill .ds-pill__dot'))).toBe(true)
    const er = rowOf(t, 'Event Registry (newsapi.ai)')
    expect(er).toHaveTextContent('Free plan: last 30 days only')
    expect(er).toHaveTextContent('API key: Set, ends in ••••9f3a')
    expect(er).toHaveTextContent('Never tested')
    const nc = rowOf(t, 'NewsCatcher')
    expect(within(nc).getByText('OK').closest('.ds-pill')).toBeTruthy()
    expect(nc).toHaveTextContent('OK: 12 results for the test query')
    expect(rowOf(t, 'Brave Search')).toHaveTextContent('Subscription token: Not set')
    const dj = rowOf(t, 'Dow Jones (Factiva)')
    expect(dj).toHaveTextContent('Needs the client’s API documentation')
    expect(within(dj).getByRole('button', { name: 'Test connection, Dow Jones (Factiva)' })).toBeDisabled()
    expect(rowOf(t, 'LexisNexis (Nexis Data+)')).toHaveTextContent(/Client ID: Set, ends in ••••0c2d.*Client secret: Not set/)
    expect(screen.queryByText(/NEWS_SECRET_KEY/)).toBeNull()
    expect(screen.getByRole('navigation', { name: 'Settings sections' })).toHaveTextContent('6 News sources')
  })

  it('a secret is write-only: the box starts empty, the typed key is never shown, and only it is sent', async () => {
    mockApi.mockImplementation(fake({ 'PUT /news/sources/event_registry': echo }))
    renderPage(PATH, route)
    await table()
    let dlg = await openEdit('Event Registry (newsapi.ai)')
    const box = within(dlg).getByLabelText(/API key/, { selector: 'input' }) as HTMLInputElement
    expect(box.type).toBe('password')
    expect(box.value).toBe('')
    expect(box.getAttribute('autocomplete')).toBe('new-password')
    expect(desc(box)).toHaveTextContent('Set, ends in ••••9f3a')
    expect(within(dlg).getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.type(box, 'er-NEW-KEY-77aa')
    expect(within(dlg).getByLabelText('Changes to save')).toHaveTextContent('API key: replaced')
    expect(document.body.textContent).not.toContain('er-NEW-KEY-77aa')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }))
    expect(await within(dlg).findByText('Give a reason of at least three characters.')).toBeInTheDocument()
    expect(calls('PUT', '/news/sources')).toHaveLength(0)
    await userEvent.type(within(dlg).getByLabelText(/Reason/), 'Client sent a new key')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(bodies('PUT', '/news/sources')).toEqual([{ path: '/news/sources/event_registry', body: { secrets: { api_key: 'er-NEW-KEY-77aa' }, reason: 'Client sent a new key' } }]))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Edit Event Registry/ })).toBeNull())
    expect(rowOf(await table(), 'Event Registry (newsapi.ai)')).toHaveTextContent('API key: Set, ends in ••••77aa')
    dlg = await openEdit('Event Registry (newsapi.ai)')
    expect((within(dlg).getByLabelText(/API key/, { selector: 'input' }) as HTMLInputElement).value).toBe('')
  })

  it('sends only what changed: the switch and one field, with the reason, and no secrets', async () => {
    mockApi.mockImplementation(fake({ 'PUT /news/sources/newscatcher': echo }))
    renderPage(PATH, route)
    await table()
    const dlg = await openEdit('NewsCatcher')
    const sw = within(dlg).getByRole('switch', { name: 'Use this source' })
    expect(sw).toBeChecked()
    await userEvent.click(sw)
    const url = within(dlg).getByLabelText(/Base URL/)
    expect(url).toHaveValue('https://v3-api.newscatcherapi.com')
    await userEvent.clear(url); await userEvent.type(url, 'not a url')
    expect(within(dlg).getByText('A full address starting with https://')).toBeInTheDocument()
    expect(within(dlg).getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.clear(url); await userEvent.type(url, 'https://v3-api.newscatcherapi.com/v3')
    expect(within(dlg).getByLabelText('Changes to save')).toHaveTextContent(/Switch: On → Off.*Base URL: https:\/\/v3-api\.newscatcherapi\.com → https:\/\/v3-api\.newscatcherapi\.com\/v3/)
    await userEvent.type(within(dlg).getByLabelText(/Reason/), 'Pause NewsCatcher, move to v3 path')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(bodies('PUT', '/news/sources')).toEqual([{ path: '/news/sources/newscatcher',
      body: { enabled: false, config: { base_url: 'https://v3-api.newscatcherapi.com/v3' }, reason: 'Pause NewsCatcher, move to v3 path' } }]))
    await waitFor(() => expect(rowOf(screen.getByRole('table', { name: 'News sources' }), 'NewsCatcher').querySelector('.ds-pill')!.textContent).toBe('Off'))
  })

  it('Remove marks a stored key for removal and sends it as null; Keep undoes it', async () => {
    mockApi.mockImplementation(fake({ 'PUT /news/sources/lexisnexis': echo }))
    renderPage(PATH, route)
    await table()
    const dlg = await openEdit('LexisNexis (Nexis Data+)')
    expect(within(dlg).queryByRole('button', { name: 'Remove Client secret' })).toBeNull()
    await userEvent.click(within(dlg).getByRole('button', { name: 'Remove Client ID' }))
    expect(desc(within(dlg).getByLabelText(/Client ID/, { selector: 'input' }))).toHaveTextContent('Will be removed when you save.')
    expect(within(dlg).getByLabelText('Changes to save')).toHaveTextContent('Client ID: removed')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Keep Client ID' }))
    expect(within(dlg).queryByLabelText('Changes to save')).toBeNull()
    await userEvent.click(within(dlg).getByRole('button', { name: 'Remove Client ID' }))
    await userEvent.type(within(dlg).getByLabelText(/Reason/), 'Client ended the contract')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(bodies('PUT', '/news/sources')).toEqual([{ path: '/news/sources/lexisnexis', body: { secrets: { client_id: null }, reason: 'Client ended the contract' } }]))
    await waitFor(() => expect(rowOf(screen.getByRole('table', { name: 'News sources' }), 'LexisNexis (Nexis Data+)')).toHaveTextContent('Client ID: Not set'))
  })

  it('not available: the switch is off and says why; a not_available 409 reads in plain words', async () => {
    mockApi.mockImplementation(fake({ 'PUT /news/sources/dow_jones': () => httpError(409, 'not_available', 'conflict') }))
    renderPage(PATH, route)
    await table()
    const dlg = await openEdit('Dow Jones (Factiva)')
    const sw = within(dlg).getByRole('switch', { name: 'Use this source' })
    expect(sw).toBeDisabled()
    expect(desc(sw)).toHaveTextContent(/cannot be switched on yet: its connection is built once the client supplies the provider’s API documentation/)
    await userEvent.type(within(dlg).getByLabelText(/User key/, { selector: 'input' }), 'dj-user-key-0001')
    await userEvent.type(within(dlg).getByLabelText(/Reason/), 'Store the client key')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }))
    expect(await within(dlg).findByRole('alert')).toHaveTextContent(/cannot be switched on or tested yet.*Its keys can still be stored/)
    expect(dlg).not.toHaveTextContent('not_available')
  })

  it('secret_key_set false: a banner says so and key boxes are disabled; a no_secret_key 409 shows the same words', async () => {
    mockApi.mockImplementation(fake({ 'GET /news/sources': reply({ secret_key_set: false }), 'PUT /news/sources/brave': () => httpError(409, 'no_secret_key', 'conflict') }))
    renderPage(PATH, route)
    const s = await sec()
    expect(await within(s).findByRole('alert')).toHaveTextContent('The server has no NEWS_SECRET_KEY, so keys cannot be stored. Ask IT to set it in .env (see docs/hosting.md).')
    const dlg = await openEdit('Brave Search')
    expect(within(dlg).getByLabelText(/Subscription token/, { selector: 'input' })).toBeDisabled()
    await userEvent.click(within(dlg).getByRole('switch', { name: 'Web search' }))
    await userEvent.type(within(dlg).getByLabelText(/Reason/), 'News only')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(bodies('PUT', '/news/sources')).toEqual([{ path: '/news/sources/brave', body: { config: { web: false }, reason: 'News only' } }]))
    await waitFor(() => expect(within(dlg).getAllByRole('alert')).toHaveLength(2))
    expect(within(dlg).getAllByRole('alert')[1]).toHaveTextContent(/^The server has no NEWS_SECRET_KEY, so keys cannot be stored/)
  })

  it('Test connection: missing_credentials reads in plain words', async () => {
    mockApi.mockImplementation(fake({ 'POST /news/sources/brave/test': () => httpError(409, 'missing_credentials', 'conflict') }))
    renderPage(PATH, route)
    const t = await table()
    await userEvent.click(within(t).getByRole('button', { name: 'Test connection, Brave Search' }))
    expect(await within(await sec()).findByText(/Brave Search: A required key is not set\. Enter every required key and save/)).toBeInTheDocument()
  })

  it('Test connection: 202, then polls every 2 s until last_test.at changes and shows Failed with the provider message', async () => {
    let list = reply()
    const failed = { at: '2026-11-10T15:00:05Z', ok: false, message: 'HTTP 401: invalid API key' }
    mockApi.mockImplementation(fake({ 'GET /news/sources': () => list, 'POST /news/sources/event_registry/test': () => SOURCES[0] }))
    renderPage(PATH, route)
    const t = await table()
    vi.useFakeTimers()
    const before = calls('GET', '/news/sources').length
    fireEvent.click(within(t).getByRole('button', { name: 'Test connection, Event Registry (newsapi.ai)' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(calls('POST', '/news/sources/event_registry/test')).toHaveLength(1)
    expect(rowOf(t, 'Event Registry (newsapi.ai)').querySelector('.ds-pill')!.textContent).toBe('Testing')
    expect(within(t).getByRole('button', { name: 'Test connection, NewsCatcher' })).toBeDisabled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1999) })
    expect(calls('GET', '/news/sources').length).toBe(before)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(calls('GET', '/news/sources').length).toBe(before + 1)
    list = reply({ sources: SOURCES.map(s => (s.provider === 'event_registry' ? { ...s, last_test: failed } : s)) })
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(calls('GET', '/news/sources').length).toBe(before + 2)
    const row = rowOf(t, 'Event Registry (newsapi.ai)')
    expect(row.querySelector('.ds-pill')!.textContent).toBe('Off')
    expect(within(row).getByText('Failed').closest('.ds-pill')!.querySelector('.ds-pill__dot')).toBeTruthy()
    expect(row).toHaveTextContent('HTTP 401: invalid API key')
    expect(within(screen.getByRole('region', { name: /6 · News sources/ })).getByText('Event Registry (newsapi.ai): Failed. HTTP 401: invalid API key')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(20000) })
    expect(calls('GET', '/news/sources').length).toBe(before + 2)
    expect(within(t).getByRole('button', { name: 'Test connection, NewsCatcher' })).not.toBeDisabled()
  })

  it('Test connection: OK with the message; gives up after 40 s when no result comes', async () => {
    let list = reply()
    mockApi.mockImplementation(fake({ 'GET /news/sources': () => list, 'POST /news/sources/newscatcher/test': () => SOURCES[1], 'POST /news/sources/event_registry/test': () => SOURCES[0] }))
    renderPage(PATH, route)
    const t = await table()
    vi.useFakeTimers()
    fireEvent.click(within(t).getByRole('button', { name: 'Test connection, NewsCatcher' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    list = reply({ sources: SOURCES.map(s => (s.provider === 'newscatcher' ? { ...s, last_test: { at: '2026-11-10T15:00:04Z', ok: true, message: 'OK: 9 results for the test query' } } : s)) })
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(screen.getByText('NewsCatcher: OK. OK: 9 results for the test query')).toBeInTheDocument()
    expect(rowOf(t, 'NewsCatcher')).toHaveTextContent('OK: 9 results for the test query')

    const before = calls('GET', '/news/sources').length
    fireEvent.click(within(t).getByRole('button', { name: 'Test connection, Event Registry (newsapi.ai)' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    await act(async () => { await vi.advanceTimersByTimeAsync(40000) })
    expect(calls('GET', '/news/sources').length).toBe(before + 20)
    expect(screen.getByText(/No test result after 40 seconds/)).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(calls('GET', '/news/sources').length).toBe(before + 20)
  })

  it('a load error stays inside the section', async () => {
    mockApi.mockImplementation(fake({ 'GET /news/sources': () => httpError(500, 'boom', 'database down') }))
    renderPage(PATH, route)
    const s = await sec()
    expect(await within(s).findByText(/The request failed: database down/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /5 · Companies and news/ })).toBeInTheDocument()
  })
})

describe('System settings: Re-check stories', () => {
  const companies = () => screen.findByRole('region', { name: /5 · Companies and news/ })
  it('explains itself, confirms first, and shows run_active in plain words', async () => {
    mockApi.mockImplementation(fake({ 'POST /news/recheck': () => httpError(409, 'run_active', 'conflict') }))
    renderPage(PATH, route)
    const s = await companies()
    await within(s).findByRole('table', { name: 'News runs, newest first' })
    expect(s).toHaveTextContent('Runs every stored story through the date and Claude checks. Stories about another company are excluded, with the reason shown to TAO; nothing is deleted.')
    await userEvent.click(within(s).getByRole('button', { name: 'Re-check stories' }))
    let dlg = await screen.findByRole('alertdialog', { name: 'Re-check stories?' })
    expect(dlg).toHaveTextContent(/nothing is deleted/)
    await userEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }))
    expect(calls('POST', '/news/recheck')).toHaveLength(0)
    await userEvent.click(within(s).getByRole('button', { name: 'Re-check stories' }))
    dlg = await screen.findByRole('alertdialog', { name: 'Re-check stories?' })
    await userEvent.click(within(dlg).getByRole('button', { name: 'Re-check stories' }))
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('A news run is already in progress.')
    expect(calls('POST', '/news/recheck')).toHaveLength(1)
  })

  it('202 adds the queued Re-check run and watches it until it finishes', async () => {
    let list = RUNS
    const q = run({ id: 'r9', trigger: 'recheck', status: 'queued', started_at: null, finished_at: null, companies: 0, items_added: 0, adverse_added: 0, stats: {} })
    mockApi.mockImplementation(fake({ 'GET /news/runs': () => list, 'POST /news/recheck': () => { list = [q, ...RUNS]; return q } }))
    renderPage(PATH, route)
    const s = await companies()
    const t = await within(s).findByRole('table', { name: 'News runs, newest first' })
    await userEvent.click(within(s).getByRole('button', { name: 'Re-check stories' }))
    const dlg = await screen.findByRole('alertdialog', { name: 'Re-check stories?' })
    vi.useFakeTimers()
    fireEvent.click(within(dlg).getByRole('button', { name: 'Re-check stories' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(within(t).getAllByRole('row')[1]).toHaveTextContent(/Re-check.*Queued/)
    expect(within(s).getByText(/Re-check queued/)).toBeInTheDocument()
    list = [{ ...q, status: 'ok', started_at: '2026-11-10T15:00:01Z', finished_at: '2026-11-10T15:02:00Z', stats: { candidates: 58, kept: 51, excluded: 7, pending: 0 } }, ...RUNS]
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(within(s).getByText('Re-check finished: Done. 51 kept, 7 excluded, 0 pending.')).toBeInTheDocument()
  })
})

describe('System settings: daily cap and run stats', () => {
  const companies = () => screen.findByRole('region', { name: /5 · Companies and news/ })
  it('daily request cap: 1 to 5,000, default 200, saved with the feed settings', async () => {
    mockApi.mockImplementation(fake())
    renderPage(PATH, route)
    const s = await companies()
    const cap = within(s).getByLabelText(/Daily request cap per source/)
    expect(cap).toHaveValue('200')
    const save = () => screen.getAllByRole('button', { name: 'Save changes' })[0]
    for (const bad of ['0', '5001', '12.5', 'abc']) {
      await userEvent.clear(cap); await userEvent.type(cap, bad)
      expect(within(s).getByText('A whole number from 1 to 5,000.')).toBeInTheDocument()
      expect(save()).toBeDisabled()
    }
    await userEvent.clear(cap); await userEvent.type(cap, '5000')
    expect(within(s).queryByText('A whole number from 1 to 5,000.')).toBeNull()
    await userEvent.clear(cap); await userEvent.type(cap, '350')
    await userEvent.click(save())
    const dlg = await screen.findByRole('dialog', { name: 'Save 1 setting' })
    expect(within(dlg).getByRole('table', { name: 'Changes to save' })).toHaveTextContent(/Daily request cap per source.*200.*350/)
    await userEvent.type(within(dlg).getByLabelText(/Reason/), 'Brave plan allows more')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save 1 change' }))
    await waitFor(() => expect(bodies('PUT', '/settings/company_feeds')).toEqual([{ path: '/settings/company_feeds',
      body: { value: { enabled: true, run_at: '06:00', time_zone: 'America/Toronto', sources: ['google_news', 'gdelt'], daily_cap: 350 }, reason: 'Brave plan allows more' } }]))
  })

  it('each run shows its checks and calls; Re-check runs are named; runs from before wave E show a dash', async () => {
    mockApi.mockImplementation(fake())
    renderPage(PATH, route)
    const s = await companies()
    const t = await within(s).findByRole('table', { name: 'News runs, newest first' })
    const rows = within(t).getAllByRole('row').slice(1)
    expect(rows.map(r => within(r).getByRole('rowheader').textContent)).toEqual(['Re-check', 'Scheduled', 'Scheduled'])
    const last = (r: HTMLElement) => within(r).getAllByRole('cell').at(-1)!
    expect(last(rows[2]).textContent).toBe('—')
    const sum = within(rows[1]).getByText('40 candidates · 12 kept · 3 excluded')
    const det = sum.closest('details')!
    expect(det.open).toBe(false)
    await userEvent.click(sum)
    expect(det.open).toBe(true)
    const dl = det.querySelector('dl')!
    const pairs = [...dl.querySelectorAll('dt')].map(dt => [dt.textContent, dt.nextElementSibling!.textContent])
    expect(pairs).toEqual([
      ['Calls per source', 'Google News RSS 12, Brave News 200, NewsCatcher 9'], ['Hit the daily cap', 'Brave News'],
      ['Candidates', '40'], ['Kept', '12'], ['Excluded', '3'], ['Pending', '2'], ['Dates confirmed', '10'], ['Claude tokens', '48,210 in, 3,105 out'],
    ])
    expect(last(rows[0])).toHaveTextContent('58 candidates · 51 kept · 7 excluded')
  })
})

/** The element(s) named by aria-describedby. */
function desc(el: HTMLElement) {
  const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
  const div = document.createElement('div')
  div.textContent = ids.map(id => document.getElementById(id)?.textContent ?? '').join(' ')
  return div
}
