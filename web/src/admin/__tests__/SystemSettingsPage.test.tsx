// @vitest-environment jsdom
/// <reference types="node" />
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderPage, fakeApi, httpError, PARTNERS, PROGRAMS } from './helpers'
import './matchers'
import type { Deal } from '../data'

vi.mock('@/shell/api', () => ({ api: vi.fn(), apiBlob: vi.fn() }))
import { api } from '@/shell/api'
import SystemSettingsPage from '../SystemSettingsPage'
import RolesPage, { MATRIX } from '../RolesPage'
import { SUGGESTED_DAYS, parseRules, prefillCalendar, settingDiff, type Setting } from '../settings'
import rulesYaml from '@contracts/rules.yaml?raw'

const mockApi = vi.mocked(api)
const root = resolve(__dirname, '../../../..')
const DEALS12: Deal[] = JSON.parse(readFileSync(resolve(root, 'seed/deals.json'), 'utf8'))
const PATH = '/admin/settings/system'
const route: [string, JSX.Element][] = [[PATH, <SystemSettingsPage />]]
const SETTINGS: Setting[] = [
  { key: 'partner_notifications_enabled', value: false, updated_at: null, updated_by: null },
  { key: 'reporting_calendar', value: {}, updated_at: null, updated_by: null },
  { key: 'notification_defaults', updated_at: null, updated_by: null, value: {
    tao_admin: [{ kind: 'report_needs_review', in_app: true, digest: 'instant' }, { kind: 'covenant_changed', in_app: true, digest: 'instant', required: true }],
    investor_viewer: [{ kind: 'report_published', in_app: true, digest: 'instant' }, { kind: 'correction_published', in_app: true, digest: 'instant', required: true }],
  } },
  { key: 'publish_note_templates', value: { new_report: 'Report for {deal_name} is ready.', correction: 'Corrected: {change_list}.' }, updated_at: '2026-11-04T15:00:00Z', updated_by: 'A. Patel' },
  { key: 'company_feeds', value: {}, updated_at: null, updated_by: null },
]
function settingsApi(over: Record<string, unknown> = {}, settings = SETTINGS) {
  return fakeApi({
    'GET /settings': settings, 'GET /master/programs': PROGRAMS, 'GET /master/deals': DEALS12, 'GET /master/partners': PARTNERS,
    'PUT /settings/partner_notifications_enabled': (_p: string, i?: RequestInit) => ({ key: 'partner_notifications_enabled', value: JSON.parse(String(i!.body)).value, updated_at: '2026-11-05T15:00:00Z', updated_by: 'tao_admin' }),
    'PUT /settings/reporting_calendar': (_p: string, i?: RequestInit) => ({ key: 'reporting_calendar', value: JSON.parse(String(i!.body)).value, updated_at: '2026-11-05T15:00:00Z', updated_by: 'tao_admin' }),
    ...over,
  })
}
const puts = () => mockApi.mock.calls.filter(([, i]) => i?.method === 'PUT').map(([p, i]) => ({ path: p, body: JSON.parse(String(i!.body)) }))
const saveBtn = () => screen.getAllByRole('button', { name: 'Save changes' })[0]

beforeEach(() => { mockApi.mockReset() })

describe('settings helpers', () => {
  it('suggested days are the settlement days of the real August 2026 reports, one per deal', () => {
    const dir = resolve(root, 'docs/dashboard-json')
    const files = readdirSync(dir).filter(f => f.endsWith('.dashboard.json') && !f.startsWith('program-'))
    expect(files).toHaveLength(12)
    for (const f of files) {
      const d = JSON.parse(readFileSync(resolve(dir, f), 'utf8'))
      expect(SUGGESTED_DAYS[d.deal_slug]).toBe(new Date(d.settlement_date).getDate())
    }
    expect(Object.keys(SUGGESTED_DAYS).sort()).toEqual(DEALS12.map(d => d.slug).sort())
  })
  it('a saved day wins over the suggestion', () => {
    const r = prefillCalendar({ 'f-pil-2-0-moneda-capital-corp': 8 }, DEALS12.map(d => d.slug))
    expect(r.value['f-pil-2-0-moneda-capital-corp']).toBe(8)
    expect(r.suggested).toHaveLength(11)
  })
  it('reads the whole rule catalogue from contracts/rules.yaml', () => {
    const r = parseRules(rulesYaml)
    expect(r.version).toBe('1')
    expect(r.rules.map(x => x.id)).toEqual(Array.from({ length: 22 }, (_, i) => `R${String(i + 1).padStart(2, '0')}`))
    expect(r.rules[0]).toMatchObject({ title: 'Required fields present', layer: 'structural', severity: 'block', phase: 1 })
    expect(r.rules.find(x => x.id === 'R05')!.tolerance).toBe('currency')
    expect(r.tolerances).toMatchObject({ currency: '1.00', count: '0', ratio: '0.005' })
    expect(r.lags).toEqual({ 'fpil-2.0-settrep-v1': 1, 'move-trust-settrep-v1': 0 })
  })
  it('describes a change field by field', () => {
    expect(settingDiff('reporting_calendar', { a: 7 }, { a: 8, b: 5 }, s => s.toUpperCase()))
      .toEqual([{ field: 'A expected day', before: '7', after: '8' }, { field: 'B expected day', before: 'not set', after: '5' }])
    expect(settingDiff('partner_notifications_enabled', false, true)).toEqual([{ field: 'Partner notifications', before: 'Off', after: 'On' }])
  })
})

describe('System settings page', () => {
  it('is TAO Admin only', async () => {
    mockApi.mockImplementation(settingsApi())
    renderPage(PATH, route, 'tao_analyst')
    expect(await screen.findByText('You don’t have access')).toBeInTheDocument()
    expect(mockApi).not.toHaveBeenCalled()
  })

  it('pre-fills the reporting calendar with the real settlement days, not yet saved', async () => {
    mockApi.mockImplementation(settingsApi())
    renderPage(PATH, route)
    expect(await screen.findByLabelText('Moneda Capital Corp. expected report day')).toHaveValue('7')
    expect(screen.getByLabelText('Finloc 2000 Inc. expected report day')).toHaveValue('13')
    expect(screen.getByLabelText('TPine Leasing Capital Corporation expected report day')).toHaveValue('24')
    expect(screen.getAllByText('Suggested, not saved')).toHaveLength(12)
    // suggestions alone are not a change
    expect(saveBtn()).toBeDisabled()
  })

  it('partner notifications: off by default with a warning; saving asks for a reason of 3+ characters', async () => {
    mockApi.mockImplementation(settingsApi())
    renderPage(PATH, route)
    const sw = await screen.findByRole('switch', { name: 'Partner notifications' })
    expect(sw).not.toBeChecked()
    expect(screen.getByText(/While off, no partner user is notified/)).toBeInTheDocument()
    await userEvent.click(sw)
    expect(screen.getByText(/Not saved yet: Partner notifications/)).toBeInTheDocument()
    await userEvent.click(saveBtn())
    const dlg = await screen.findByRole('dialog', { name: 'Save 1 setting' })
    expect(within(dlg).getByRole('table', { name: 'Changes to save' })).toHaveTextContent(/Partner notifications.*Off.*On/)
    await userEvent.type(within(dlg).getByLabelText(/Reason/), 'no')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save 1 change' }))
    expect(await within(dlg).findByText('Give a reason of at least three characters.')).toBeInTheDocument()
    expect(puts()).toHaveLength(0)
    await userEvent.type(within(dlg).getByLabelText(/Reason/), 'w live for the pilot')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save 1 change' }))
    await waitFor(() => expect(puts()).toEqual([{ path: '/settings/partner_notifications_enabled', body: { value: true, reason: 'now live for the pilot' } }]))
  })

  it('one reason, one PUT per changed setting; the calendar sends every deal’s day', async () => {
    mockApi.mockImplementation(settingsApi())
    renderPage(PATH, route)
    const moneda = await screen.findByLabelText('Moneda Capital Corp. expected report day')
    await userEvent.clear(moneda); await userEvent.type(moneda, '8')
    await userEvent.click(screen.getByRole('switch', { name: 'Partner notifications' }))
    await userEvent.click(saveBtn())
    const dlg = await screen.findByRole('dialog', { name: 'Save 2 settings' })
    await userEvent.type(within(dlg).getByLabelText(/Reason/), 'Calendar confirmed with servicers')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save 2 changes' }))
    await waitFor(() => expect(puts()).toHaveLength(2))
    const [a, b] = puts()
    expect(a.path).toBe('/settings/partner_notifications_enabled')
    expect(b.path).toBe('/settings/reporting_calendar')
    expect(b.body.reason).toBe('Calendar confirmed with servicers')
    expect(b.body.value).toEqual({ ...SUGGESTED_DAYS, 'f-pil-2-0-moneda-capital-corp': 8 })
  })

  it('a day outside 1–31 blocks saving', async () => {
    mockApi.mockImplementation(settingsApi())
    renderPage(PATH, route)
    const stride = await screen.findByLabelText('Stride Capital expected report day')
    await userEvent.clear(stride); await userEvent.type(stride, '40')
    expect(screen.getByText('1 to 31')).toBeInTheDocument()
    expect(saveBtn()).toBeDisabled()
  })

  it('a failed save says which setting failed and which were saved', async () => {
    mockApi.mockImplementation(settingsApi({ 'PUT /settings/reporting_calendar': httpError(422, 'invalid', 'value does not fit the key') }))
    renderPage(PATH, route)
    await userEvent.click(await screen.findByRole('switch', { name: 'Partner notifications' }))
    await userEvent.click(screen.getByRole('button', { name: 'using the suggested days' }))
    await userEvent.click(saveBtn())
    const dlg = await screen.findByRole('dialog', { name: 'Save 2 settings' })
    await userEvent.type(within(dlg).getByLabelText(/Reason/), 'go live')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save 2 changes' }))
    const alert = await within(dlg).findByRole('alert')
    expect(alert).toHaveTextContent('Reporting calendar was not saved: value does not fit the key')
    expect(alert).toHaveTextContent('Saved already: Partner notifications.')
  })

  it('notification defaults: required kinds say Always and cannot be switched off', async () => {
    mockApi.mockImplementation(settingsApi())
    renderPage(PATH, route)
    expect(await screen.findAllByText('Always')).toHaveLength(2)
    const box = screen.getByRole('checkbox', { name: 'Report waiting for approval, TAO Admin, in-app' })
    expect(box).toBeChecked()
    expect(screen.queryByRole('checkbox', { name: /Covenant WATCH \/ BREACH, TAO Admin/ })).toBeNull()
    await userEvent.click(box)
    await userEvent.click(saveBtn())
    const dlg = await screen.findByRole('dialog', { name: 'Save 1 setting' })
    expect(within(dlg).getByRole('table', { name: 'Changes to save' })).toHaveTextContent(/tao_admin · Report waiting for approval.*In-app.*Off/)
  })

  it('read-only sections: templates locked, rules from rules.yaml with a request-a-change note, retention kept indefinitely, reset demo a script', async () => {
    mockApi.mockImplementation(settingsApi())
    renderPage(PATH, route)
    const progs = await screen.findByRole('region', { name: /1 · Programs and deals/ })
    expect(within(progs).getAllByText('Locked')).toHaveLength(12)
    expect(within(progs).getAllByText('move-trust-settrep-v1')).toHaveLength(9)
    expect(within(progs).queryByRole('textbox')).toBeNull()
    const rules = screen.getByRole('region', { name: /2 · Validation rules/ })
    expect(within(rules).getByText('Shows what exists')).toBeInTheDocument()
    expect(within(rules).getByText(/request it from the Lead/)).toBeInTheDocument()
    expect(within(rules).getByText('Required fields present')).toBeInTheDocument()
    expect(within(rules).getByText('Provenance and second-pass agreement')).toBeInTheDocument()
    expect(within(rules).queryByRole('textbox')).toBeNull()
    expect(within(screen.getByRole('region', { name: /3 · Reporting calendar/ })).getByText('New')).toBeInTheDocument()
    const ret = screen.getByRole('region', { name: /5 · Data retention/ })
    expect(within(ret).getAllByText(/Kept indefinitely/).length).toBeGreaterThanOrEqual(4)
    expect(within(ret).getByRole('button', { name: 'Export this month, Platform (CSV)' })).toBeInTheDocument()
    const maint = screen.getByRole('region', { name: /8 · Maintenance/ })
    expect(within(maint).getByRole('link', { name: 'Reports library, Regenerate' })).toBeInTheDocument()
    expect(within(maint).queryByRole('button', { name: /Reset/ })).toBeNull()
    expect(within(maint).getByText('python scripts/reset_demo.py')).toBeInTheDocument()
  })

  it('a 403 from /settings shows the no-access state', async () => {
    mockApi.mockImplementation(settingsApi({ 'GET /settings': httpError(403, 'admin_only') }))
    renderPage(PATH, route)
    expect(await screen.findByText('You don’t have access')).toBeInTheDocument()
  })
})

describe('Roles & permissions', () => {
  it('is TAO Admin only', async () => {
    renderPage('/admin/settings/users/roles', [['/admin/settings/users/roles', <RolesPage />]], 'tao_analyst')
    expect(await screen.findByText('You don’t have access')).toBeInTheDocument()
  })
  it('a read-only matrix of the six roles, dot plus Yes / No / Limited, new abilities tagged', async () => {
    renderPage('/admin/settings/users/roles', [['/admin/settings/users/roles', <RolesPage />]])
    const table = await screen.findByRole('table', { name: 'Abilities by role' })
    const head = within(table).getAllByRole('columnheader').map(h => h.textContent)
    expect(head).toEqual(['Ability', 'TAO Admin', 'TAO Analyst', 'Investor · Company Admin', 'Investor · Viewer', 'Manager · Company Admin', 'Manager · Viewer'])
    const row = within(table).getByRole('rowheader', { name: /Resolve or reopen a comment thread/ }).closest('tr')!
    expect(within(row).getByText('New')).toBeInTheDocument()
    expect(within(row).getAllByRole('cell').map(c => c.textContent)).toEqual(['Yes', 'Limited', 'No', 'No', 'No', 'No'])
    expect(table.querySelectorAll('.ds-pill__dot').length).toBe(MATRIX.flatMap(g => g.rows).length * 6)
    expect(within(table).queryByRole('checkbox')).toBeNull()
    expect(within(table).queryByRole('button')).toBeNull()
  })
})
