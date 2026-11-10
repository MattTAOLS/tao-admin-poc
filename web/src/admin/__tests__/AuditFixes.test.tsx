// @vitest-environment jsdom
/// <reference types="node" />
/** Bug audit (docs/audit/tao-admin-poc-bug-audit_Report_v1.md), TAO Admin pages: L23 reporting calendar typing,
 * L24 links into a System settings section, L25 Toronto business dates, and the audit summary of a one-company news run.
 * Deals are the real 12 (seed/deals.json); covenants are the seed rows in helpers with one deliberate change each. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderPage, fakeApi, upload, PARTNERS, PROGRAMS, DEALS, COVENANTS } from './helpers'
import './matchers'
import type { AuditEntry, CovenantDefinition, Deal } from '../data'

vi.mock('@/shell/api', () => ({ api: vi.fn(), apiBlob: vi.fn() }))
import { api, apiBlob } from '@/shell/api'
import SystemSettingsPage from '../SystemSettingsPage'
import ProgramRecordPage from '../ProgramRecordPage'
import { newsRunText, summary } from '../AuditLogPage'
import { queueCounts } from '../ui'
import { torontoDate, torontoMonth } from '../toronto'
import type { Setting } from '../settings'

const mockApi = vi.mocked(api)
const mockBlob = vi.mocked(apiBlob)
const DEALS12: Deal[] = JSON.parse(readFileSync(resolve(__dirname, '../../../..', 'seed/deals.json'), 'utf8'))
const PATH = '/admin/settings/system'
const route: [string, JSX.Element][] = [[PATH, <SystemSettingsPage />]]
const SETTINGS: Setting[] = [
  { key: 'partner_notifications_enabled', value: false, updated_at: null, updated_by: null },
  { key: 'reporting_calendar', value: {}, updated_at: null, updated_by: null },
  { key: 'notification_defaults', value: {}, updated_at: null, updated_by: null },
  { key: 'publish_note_templates', value: { new_report: 'Report for {deal_name} is ready.', correction: 'Corrected: {change_list}.' }, updated_at: null, updated_by: null },
  { key: 'company_feeds', value: {}, updated_at: null, updated_by: null },
]
const settingsApi = () => fakeApi({ 'GET /settings': SETTINGS, 'GET /master/programs': PROGRAMS, 'GET /master/deals': DEALS12, 'GET /master/partners': PARTNERS, 'GET /news/runs': [] })
const saveBtn = () => screen.getAllByRole('button', { name: 'Save changes' })[0]
const calendarOrder = () => within(screen.getByRole('table', { name: 'Reporting calendar' })).getAllByRole('rowheader').map(x => x.textContent)

/** 23:30 in Toronto on 31 October 2026 (EDT, UTC-4): already 1 November in UTC. */
const LAST_NIGHT_OF_OCTOBER = new Date('2026-11-01T03:30:00Z')

beforeEach(() => { mockApi.mockReset(); mockBlob.mockReset() })
afterEach(() => { vi.useRealTimers() })

describe('L23 reporting calendar: typing a day', () => {
  it('rows keep their place while a day is typed', async () => {
    mockApi.mockImplementation(settingsApi())
    renderPage(PATH, route)
    await screen.findByLabelText('Moneda Capital Corp. expected report day')
    const before = calendarOrder()
    expect(before).toHaveLength(12)
    // The first row has the earliest day; before the fix, typing a later day moved it down the table mid-keystroke.
    const moneda = screen.getByLabelText(`${before[0]} expected report day`)
    await userEvent.clear(moneda)
    expect(calendarOrder()).toEqual(before)
    await userEvent.type(moneda, '28')
    expect(moneda).toHaveValue('28')
    expect(calendarOrder()).toEqual(before)
    expect(document.activeElement).toBe(moneda)
    expect(saveBtn()).not.toBeDisabled()
  })

  it('a non-digit stays in the field with the "1 to 31" error; Discard brings the day back', async () => {
    mockApi.mockImplementation(settingsApi())
    renderPage(PATH, route)
    const stride = await screen.findByLabelText('Stride Capital expected report day')
    const start = (stride as HTMLInputElement).value
    await userEvent.clear(stride); await userEvent.type(stride, '1a')
    expect(stride).toHaveValue('1a')
    expect(stride.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('1 to 31')).toBeInTheDocument()
    expect(saveBtn()).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.getByLabelText('Stride Capital expected report day')).toHaveValue(start)
    expect(screen.queryByText('1 to 31')).toBeNull()
  })
})

describe('L24 links into a System settings section', () => {
  it('scrolls to the section named in the address once the settings have loaded', async () => {
    const scrolled: string[] = []
    const proto = Element.prototype as unknown as { scrollIntoView?: () => void }
    const original = proto.scrollIntoView
    proto.scrollIntoView = function (this: Element) { scrolled.push(this.id) }
    try {
      let release!: () => void
      const gate = new Promise<void>(r => { release = r })
      const inner = settingsApi()
      mockApi.mockImplementation((async (p: string, i?: RequestInit) => { if (p.startsWith('/settings')) await gate; return inner(p, i) }) as never)
      renderPage(`${PATH}#set-sources`, route)
      expect(await screen.findByText('Loading settings…')).toBeInTheDocument()
      expect(scrolled).toEqual([]) // the section is not on the page yet
      release()
      await screen.findByRole('region', { name: /6 · News sources/ })
      await waitFor(() => expect(scrolled).toEqual(['set-sources']))
    } finally { proto.scrollIntoView = original }
  })
})

describe('L25 business dates are Toronto dates', () => {
  it('reads the month and the day in Toronto, not in UTC', () => {
    expect(LAST_NIGHT_OF_OCTOBER.toISOString().slice(0, 10)).toBe('2026-11-01') // what the page used before
    expect(torontoDate(LAST_NIGHT_OF_OCTOBER)).toBe('2026-10-31')
    expect(torontoMonth(LAST_NIGHT_OF_OCTOBER)).toBe('2026-10')
    expect(torontoDate('2026-11-01T04:00:00Z')).toBe('2026-11-01') // midnight in Toronto
    expect(torontoDate('2026-03-01T04:59:00Z')).toBe('2026-02-28') // EST, UTC-5
  })

  it('at 23:30 Toronto on 31 October a covenant effective 1 November is Scheduled, and the one before it is In force', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(LAST_NIGHT_OF_OCTOBER)
    // The seed 9.1 (h) row and a copy with one deliberate change: effective from 1 November 2026.
    const next: CovenantDefinition = { ...COVENANTS[1], id: '7d1f0a8e-0000-4000-8000-0000000000aa', effective_from: '2026-11-01' }
    mockApi.mockImplementation(fakeApi({
      'GET /master/partners': PARTNERS, 'GET /master/programs': PROGRAMS, 'GET /master/deals': DEALS.filter(d => d.program_slug === 'f-pil-2-0'),
      'GET /master/covenants': [COVENANTS[1], next],
    }))
    renderPage('/admin/partners/investor/programs/f-pil-2-0', [['/admin/partners/:partnerId/programs/:programId', <ProgramRecordPage />]])
    const cov = await screen.findByRole('table', { name: 'Covenant definitions' })
    const rows = within(cov).getAllByText('SLFA 9.1 (h)').map(x => x.closest('tr')!)
    expect(rows).toHaveLength(2)
    const scheduled = rows.filter(r => within(r).queryByText('Scheduled'))
    const inForce = rows.filter(r => within(r).queryByText('In force'))
    expect(scheduled).toHaveLength(1)
    expect(inForce).toHaveLength(1)
    expect(scheduled[0].textContent).toMatch(/2026-11-01|Nov 1, 2026/)
  })

  it('at 23:30 Toronto on 31 October "Export this month" asks for October', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(LAST_NIGHT_OF_OCTOBER)
    mockApi.mockImplementation(settingsApi())
    mockBlob.mockResolvedValue(new Blob(['when,tab\n'], { type: 'text/csv' }))
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { expect(this.download).toBe('audit-reports-2026-10.csv') })
    renderPage(PATH, route)
    await userEvent.click(await screen.findByRole('button', { name: 'Export this month, Reports (CSV)' }))
    await waitFor(() => expect(mockBlob).toHaveBeenCalledWith('/audit/export.csv?scope=reports&month=2026-10'))
    await waitFor(() => expect(click).toHaveBeenCalled())
    click.mockRestore()
  })

  it('"Published this month" counts by the Toronto month', () => {
    const list = [
      upload({ id: 'p1', status: 'published', published_at: '2026-11-01T02:00:00Z' }), // 22:00 on 31 October in Toronto
      upload({ id: 'p2', status: 'published', published_at: '2026-11-01T05:00:00Z' }), // 01:00 on 1 November in Toronto
    ]
    expect(queueCounts(list, LAST_NIGHT_OF_OCTOBER).published_this_month).toBe(1)
    expect(queueCounts(list, new Date('2026-11-01T06:00:00Z')).published_this_month).toBe(1)
  })
})

describe('Audit log: a news run for one company', () => {
  const run = (detail: Record<string, unknown>, over: Partial<AuditEntry> = {}): AuditEntry =>
    ({ id: 'n1', at: '2026-11-10T15:00:00Z', actor_role: 'tao_admin', actor_label: 'A. Patel', action: 'news_run', upload_id: null, finding_id: null, reason: null, detail, ...over })
  it('names the company the run covered', () => {
    const one = run({ run_id: '22222222-0000-4000-8000-000000000002', trigger: 'manual', company_slug: 'stride-capital', company_name: 'Stride Capital' })
    expect(newsRunText(one)).toBe('Manual run by A. Patel · Stride Capital only')
    expect(summary(one)).toBe('Manual run by A. Patel · Stride Capital only')
    // No name in the detail: the slug, readable.
    expect(summary(run({ trigger: 'manual', company_slug: 'stride-capital' }))).toBe('Manual run by A. Patel · Stride Capital only')
  })
  it('a run of every company reads as before', () => {
    expect(summary(run({ trigger: 'manual' }))).toBe('Manual run by A. Patel')
    expect(summary(run({ trigger: 'manual', company_slug: null }))).toBe('Manual run by A. Patel')
    expect(summary(run({ trigger: 'schedule' }, { actor_role: 'system', actor_label: 'news' }))).toBe('Scheduled run')
  })
})
