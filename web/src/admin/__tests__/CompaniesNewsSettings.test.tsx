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
import { FEEDS_DEFAULT, asFeeds, describe as describeSetting, feedsErrors, settingDiff, timeZones, type NewsRun, type Setting } from '../settings'

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
  { key: 'company_feeds', value: {}, updated_at: null, updated_by: null },
  { key: 'company_profiles_partner_enabled', value: false, updated_at: null, updated_by: null },
]
const ON: Setting = { key: 'company_feeds', value: { enabled: true, run_at: '06:00', time_zone: 'America/Toronto', sources: ['google_news', 'gdelt'] }, updated_at: '2026-11-06T13:00:00Z', updated_by: 'A. Patel' }
const run = (o: Partial<NewsRun> & Pick<NewsRun, 'id'>): NewsRun => ({
  trigger: 'schedule', status: 'ok', queued_at: '2026-11-06T11:00:00Z', started_at: '2026-11-06T11:00:02Z', finished_at: '2026-11-06T11:01:10Z',
  companies: 10, items_added: 14, adverse_added: 1, errors: [], ...o,
})
const RUNS: NewsRun[] = [
  run({ id: 'r1', trigger: 'manual', status: 'partial', items_added: 3, adverse_added: 0,
    errors: [{ company_slug: 'moneda-capital-corp', source: 'gdelt', message: 'timeout after 20 s' }, { company_slug: null, source: 'google_news', message: 'HTTP 503' }] }),
  run({ id: 'r2' }),
  run({ id: 'r3', status: 'failed', items_added: 0, adverse_added: 0, finished_at: '2026-11-05T11:00:30Z', errors: [{ source: 'gdelt', message: 'no network' }] }),
]
const PUT = (key: string) => (_p: string, i?: RequestInit) => ({ key, value: JSON.parse(String(i!.body)).value, updated_at: '2026-11-06T15:00:00Z', updated_by: 'tao_admin' })
function fake(over: Record<string, unknown> = {}, settings = SETTINGS) {
  return fakeApi({
    'GET /settings': settings, 'GET /master/programs': PROGRAMS, 'GET /master/deals': DEALS12, 'GET /master/partners': PARTNERS,
    'GET /news/runs': RUNS, 'PUT /settings/company_feeds': PUT('company_feeds'), 'PUT /settings/company_profiles_partner_enabled': PUT('company_profiles_partner_enabled'),
    ...over,
  })
}
const puts = () => mockApi.mock.calls.filter(([, i]) => i?.method === 'PUT').map(([p, i]) => ({ path: p, body: JSON.parse(String(i!.body)) }))
const runGets = () => mockApi.mock.calls.filter(([p, i]) => p.startsWith('/news/runs') && (i?.method ?? 'GET') === 'GET').length
const saveBtn = () => screen.getAllByRole('button', { name: 'Save changes' })[0]
const section = () => screen.findByRole('region', { name: /5 · Companies and news/ })
/** The element named by aria-describedby. */
const desc = (el: HTMLElement) => document.getElementById(el.getAttribute('aria-describedby') ?? '')!
const runsTable = () => screen.getByRole('table', { name: 'News runs, newest first' })

beforeEach(() => { mockApi.mockReset() })
afterEach(() => { vi.useRealTimers() })

describe('company feed helpers', () => {
  it('an empty or partial value reads as the contract defaults', () => {
    expect(asFeeds({})).toEqual({ enabled: false, run_at: '06:00', time_zone: 'America/Toronto', sources: ['google_news', 'gdelt'] })
    expect(asFeeds(null)).toEqual(FEEDS_DEFAULT)
    expect(asFeeds({ enabled: true, sources: ['gdelt', 'other'] })).toMatchObject({ enabled: true, sources: ['gdelt'] })
  })
  it('validates the run time and asks for at least one source', () => {
    expect(feedsErrors(FEEDS_DEFAULT)).toEqual({})
    expect(feedsErrors({ ...FEEDS_DEFAULT, run_at: '24:00' }).run_at).toBeTruthy()
    expect(feedsErrors({ ...FEEDS_DEFAULT, run_at: '6:00' }).run_at).toBeTruthy()
    expect(feedsErrors({ ...FEEDS_DEFAULT, run_at: '23:59' }).run_at).toBeUndefined()
    expect(feedsErrors({ ...FEEDS_DEFAULT, sources: [] }).sources).toBe('Pick at least one source.')
  })
  it('the time zone list is IANA and always holds the default and the saved zone', () => {
    const z = timeZones('America/Regina')
    expect(z).toContain('America/Toronto')
    expect(z).toContain('America/Regina')
    expect(z).toEqual([...z].sort())
  })
  it('describes a change field by field', () => {
    expect(settingDiff('company_feeds', {}, { enabled: true, run_at: '07:30', time_zone: 'America/Toronto', sources: ['gdelt'] })).toEqual([
      { field: 'Search', before: 'Off', after: 'On' }, { field: 'Run time', before: '06:00', after: '07:30' }, { field: 'Sources', before: 'Google News RSS, GDELT', after: 'GDELT' },
    ])
    expect(settingDiff('company_profiles_partner_enabled', false, true)).toEqual([{ field: 'Partner company pages', before: 'Off', after: 'On' }])
    expect(describeSetting('company_feeds', ON.value)).toBe('On, 06:00 America/Toronto')
  })
})

describe('System settings: Companies and news', () => {
  it('the news search is off by default and says plainly what it does', async () => {
    mockApi.mockImplementation(fake())
    renderPage(PATH, route)
    const sec = await section()
    expect(within(sec).getByText('New')).toBeInTheDocument()
    const sw = within(sec).getByRole('switch', { name: 'Daily news search' })
    expect(sw).not.toBeChecked()
    expect(desc(sw)).toHaveTextContent(/free public sources, Google News RSS and GDELT, by each company’s name/)
    expect(desc(sw)).toHaveTextContent(/Our own keyword screening/)
    expect(desc(sw)).toHaveTextContent(/reach the internet once a day/)
    expect(within(sec).getByLabelText(/Run time/)).toHaveValue('06:00')
    expect(within(sec).getByLabelText(/Time zone/)).toHaveValue('America/Toronto')
    expect(within(sec).getByRole('checkbox', { name: 'Google News RSS' })).toBeChecked()
    expect(within(sec).getByRole('checkbox', { name: 'GDELT' })).toBeChecked()
    expect(saveBtn()).toBeDisabled()
  })

  it('switching it on saves the whole value with a reason, one PUT and one audit entry', async () => {
    mockApi.mockImplementation(fake())
    renderPage(PATH, route)
    const sec = await section()
    await userEvent.click(within(sec).getByRole('switch', { name: 'Daily news search' }))
    const t = within(sec).getByLabelText(/Run time/)
    await userEvent.clear(t); await userEvent.type(t, '07:30')
    await userEvent.selectOptions(within(sec).getByLabelText(/Time zone/), 'America/Vancouver')
    await userEvent.click(within(sec).getByRole('checkbox', { name: 'Google News RSS' }))
    expect(screen.getByText(/Not saved yet: News search/)).toBeInTheDocument()
    await userEvent.click(saveBtn())
    const dlg = await screen.findByRole('dialog', { name: 'Save 1 setting' })
    const tbl = within(dlg).getByRole('table', { name: 'Changes to save' })
    expect(tbl).toHaveTextContent(/News search · Search.*Off.*On/)
    expect(tbl).toHaveTextContent(/Run time.*06:00.*07:30/)
    expect(tbl).toHaveTextContent(/Time zone.*America\/Toronto.*America\/Vancouver/)
    expect(tbl).toHaveTextContent(/Sources.*Google News RSS, GDELT.*GDELT/)
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save 1 change' }))
    expect(await within(dlg).findByText('Give a reason of at least three characters.')).toBeInTheDocument()
    expect(puts()).toHaveLength(0)
    await userEvent.type(within(dlg).getByLabelText(/Reason/), 'Pilot the news search')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save 1 change' }))
    await waitFor(() => expect(puts()).toEqual([{ path: '/settings/company_feeds',
      body: { value: { enabled: true, run_at: '07:30', time_zone: 'America/Vancouver', sources: ['gdelt'] }, reason: 'Pilot the news search' } }]))
  })

  it('a bad run time or no source blocks saving', async () => {
    mockApi.mockImplementation(fake())
    renderPage(PATH, route)
    const sec = await section()
    const t = within(sec).getByLabelText(/Run time/)
    await userEvent.clear(t); await userEvent.type(t, '25:00')
    expect(within(sec).getByText('Use 24-hour HH:MM, e.g. 06:00.')).toBeInTheDocument()
    expect(t.getAttribute('aria-invalid')).toBe('true')
    expect(saveBtn()).toBeDisabled()
    expect(screen.getByText(/Fix the fields marked in red first/)).toBeInTheDocument()
    await userEvent.clear(t); await userEvent.type(t, '05:45')
    expect(saveBtn()).not.toBeDisabled()
    await userEvent.click(within(sec).getByRole('checkbox', { name: 'Google News RSS' }))
    await userEvent.click(within(sec).getByRole('checkbox', { name: 'GDELT' }))
    expect(within(sec).getByText('Pick at least one source.')).toBeInTheDocument()
    expect(saveBtn()).toBeDisabled()
  })

  it('the partner switch explains what partners see and saves with a reason', async () => {
    mockApi.mockImplementation(fake())
    renderPage(PATH, route)
    const sec = await section()
    const sw = within(sec).getByRole('switch', { name: 'Partners can see company pages' })
    expect(sw).not.toBeChecked()
    expect(desc(sw)).toHaveTextContent(/only companies with a deal in a program shared with them/)
    expect(desc(sw)).toHaveTextContent(/only after a TAO Admin marks it reviewed/)
    await userEvent.click(sw)
    await userEvent.click(saveBtn())
    const dlg = await screen.findByRole('dialog', { name: 'Save 1 setting' })
    expect(within(dlg).getByRole('table', { name: 'Changes to save' })).toHaveTextContent(/Partner company pages.*Off.*On/)
    await userEvent.type(within(dlg).getByLabelText(/Reason/), 'Open company pages to MOVE Trust partners')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save 1 change' }))
    await waitFor(() => expect(puts()).toEqual([{ path: '/settings/company_profiles_partner_enabled', body: { value: true, reason: 'Open company pages to MOVE Trust partners' } }]))
  })

  it('the reporting calendar says it drives Next report due and the late-report alert', async () => {
    mockApi.mockImplementation(fake())
    renderPage(PATH, route)
    const cal = await screen.findByRole('region', { name: /3 · Reporting calendar/ })
    expect(cal).toHaveTextContent('It now drives “Next report due” and the late-report alert on company pages.')
  })

  it('lists the latest runs: trigger, status as dot and word, times, counts, errors expandable', async () => {
    mockApi.mockImplementation(fake({}, [...SETTINGS.filter(s => s.key !== 'company_feeds'), ON]))
    renderPage(PATH, route)
    await section()
    const table = await screen.findByRole('table', { name: 'News runs, newest first' })
    expect(mockApi.mock.calls.some(([p]) => p === '/news/runs?limit=10')).toBe(true)
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(rows.map(r => within(r).getByRole('rowheader').textContent)).toEqual(['Manual', 'Scheduled', 'Scheduled'])
    expect(rows.map(r => r.querySelector('.ds-pill')!.textContent)).toEqual(['Partial', 'Done', 'Failed'])
    expect(table.querySelectorAll('.ds-pill__dot')).toHaveLength(3)
    expect(within(rows[1]).getAllByRole('cell').map(c => c.textContent).slice(3, 6)).toEqual(['10', '14', '1'])
    expect(within(rows[1]).getByText('None')).toBeInTheDocument()
    const sum = within(rows[0]).getByText('2 errors')
    const det = sum.closest('details')!
    expect(det.open).toBe(false)
    await userEvent.click(sum)
    expect(det.open).toBe(true)
    expect(det).toHaveTextContent('moneda-capital-corp · GDELT: timeout after 20 s')
    expect(det).toHaveTextContent('All companies · Google News RSS: HTTP 503')
    expect(within(rows[2]).getByText('1 error')).toBeInTheDocument()
    expect(screen.getByText(/Runs every day at 06:00 America\/Toronto/)).toBeInTheDocument()
  })

  it('no runs yet; the hint says the saved setting is off', async () => {
    mockApi.mockImplementation(fake({ 'GET /news/runs': [] }))
    renderPage(PATH, route)
    const sec = await section()
    expect(await within(sec).findByText('No runs yet.')).toBeInTheDocument()
    expect(within(sec).getByText(/The saved setting is off/)).toBeInTheDocument()
  })

  it('Run now: 409 feeds_off and run_active read as plain messages', async () => {
    let code = 'feeds_off'
    mockApi.mockImplementation(fake({ 'POST /news/runs': () => httpError(409, code, 'conflict') }))
    renderPage(PATH, route)
    const sec = await section()
    await within(sec).findByRole('table', { name: 'News runs, newest first' })
    await userEvent.click(within(sec).getByRole('button', { name: 'Run now' }))
    expect(await within(sec).findByText('The news search is switched off. Switch it on and save first.')).toBeInTheDocument()
    code = 'run_active'
    await userEvent.click(within(sec).getByRole('button', { name: 'Run now' }))
    expect(await within(sec).findByText('A run is already queued or running. Wait for it to finish.')).toBeInTheDocument()
    expect(within(sec).queryByText(/feeds_off|run_active/)).toBeNull()
  })

  it('Run now: 202 shows the queued run and refreshes every 5 s until it finishes', async () => {
    let list = RUNS
    const queued = run({ id: 'r9', trigger: 'manual', status: 'queued', started_at: null, finished_at: null, companies: 0, items_added: 0, adverse_added: 0 })
    mockApi.mockImplementation(fake({ 'GET /news/runs': () => list, 'POST /news/runs': () => { list = [queued, ...RUNS]; return queued } },
      [...SETTINGS.filter(s => s.key !== 'company_feeds'), ON]))
    renderPage(PATH, route)
    const sec = await section()
    await within(sec).findByRole('table', { name: 'News runs, newest first' })
    vi.useFakeTimers()
    const before = runGets()
    fireEvent.click(within(sec).getByRole('button', { name: 'Run now' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(within(sec).getByText(/Run queued\. The news worker picks it up within seconds/)).toBeInTheDocument()
    const first = within(runsTable()).getAllByRole('row')[1]
    expect(first).toHaveTextContent(/Manual.*Queued/)
    expect(within(sec).getByRole('button', { name: 'Run now' })).toBeDisabled()
    expect(runGets()).toBe(before)

    list = [{ ...queued, status: 'running', started_at: '2026-11-06T15:00:03Z' }, ...RUNS]
    await act(async () => { await vi.advanceTimersByTimeAsync(4999) })
    expect(runGets()).toBe(before)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(runGets()).toBe(before + 1)
    expect(within(runsTable()).getAllByRole('row')[1].querySelector('.ds-pill')!.textContent).toBe('Running')

    list = [{ ...queued, status: 'ok', started_at: '2026-11-06T15:00:03Z', finished_at: '2026-11-06T15:00:40Z', companies: 10, items_added: 5, adverse_added: 1 }, ...RUNS]
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(runGets()).toBe(before + 2)
    expect(within(runsTable()).getAllByRole('row')[1].querySelector('.ds-pill')!.textContent).toBe('Done')
    expect(within(sec).getByText('Run finished: Done. 5 news items and 1 adverse item added.')).toBeInTheDocument()
    expect(within(sec).getByRole('button', { name: 'Run now' })).not.toBeDisabled()
    await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
    expect(runGets()).toBe(before + 2)
  })

  it('Run now: stops refreshing after 2 minutes and says so', async () => {
    const queued = run({ id: 'r9', trigger: 'manual', status: 'queued', started_at: null, finished_at: null })
    mockApi.mockImplementation(fake({ 'GET /news/runs': () => [queued, ...RUNS], 'POST /news/runs': () => queued },
      [...SETTINGS.filter(s => s.key !== 'company_feeds'), ON]))
    renderPage(PATH, route)
    const sec = await section()
    await within(sec).findByRole('table', { name: 'News runs, newest first' })
    vi.useFakeTimers()
    const before = runGets()
    fireEvent.click(within(sec).getByRole('button', { name: 'Run now' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    await act(async () => { await vi.advanceTimersByTimeAsync(120000) })
    expect(runGets()).toBe(before + 24)
    expect(within(sec).getByText(/has not finished after 2 minutes/)).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
    expect(runGets()).toBe(before + 24)
    expect(within(sec).getByRole('button', { name: 'Run now' })).not.toBeDisabled()
  })
})
