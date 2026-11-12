// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderPage, fakeApi, DEALS, PROGRAMS } from './helpers'
import './matchers'
import type { AuditEntry } from '../data'

vi.mock('@/shell/api', () => ({ api: vi.fn(), apiBlob: vi.fn() }))
import { api } from '@/shell/api'
import AuditLogPage, { ACTION_LABEL, entryChanges, summary, torontoMonth } from '../AuditLogPage'
import { AUDIT_ACTIONS, PLATFORM_ACTIONS, REPORT_ACTIONS, auditScope } from '../data'

const mockApi = vi.mocked(api)
const PATH = '/admin/settings/users/audit'
const CUR = torontoMonth(new Date())
const at = (day: number, h = 15) => `${CUR}-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00Z`
const UPLOAD = 'aaaaaaaa-0000-4000-8000-000000000001'
const MOREAU = '00000000-0000-4000-8000-000000000003'
const e = (o: Partial<AuditEntry> & Pick<AuditEntry, 'id' | 'at' | 'action'>): AuditEntry =>
  ({ actor_role: 'tao_admin', actor_label: 'A. Patel', upload_id: null, finding_id: null, reason: null, detail: {}, ...o })
const ENTRIES: AuditEntry[] = [
  e({ id: 'w1', at: at(1, 16), action: 'user_change', detail: { user_id: MOREAU, partner_slug: null, change: 'updated', before: { name: 'J. Moreau', role: 'tao_admin' }, after: { name: 'J. Moreau', role: 'tao_analyst' } } }),
  e({ id: 'w2', at: at(1, 15), action: 'user_change', detail: { user_id: MOREAU, partner_slug: null, change: 'subscriptions',
    before: [], after: [{ program_slug: 'move-trust', deal_slug: null, channels: ['in_app'] }, { program_slug: 'f-pil-2-0', deal_slug: 'f-pil-2-0-stride-capital', channels: ['in_app'] }] } }),
  e({ id: 'w3', at: at(1, 14), action: 'settings_change', reason: 'pilot go-live', detail: { key: 'partner_notifications_enabled', before: false, after: true } }),
  e({ id: 'w4', at: at(1, 13), action: 'settings_change', reason: 'confirmed', detail: { key: 'reporting_calendar', before: {}, after: { 'f-pil-2-0-moneda-capital-corp': 8 } } }),
  e({ id: 'w5', at: at(1, 12), action: 'prefs_change', actor_role: 'investor_viewer', actor_label: 'D. Alvarez', detail: { user_id: '00000000-0000-4000-8000-000000000006', before: { time_zone: 'America/Toronto' }, after: { time_zone: 'America/Vancouver' } } }),
  e({ id: 'r1', at: at(1, 11), action: 'comment', actor_role: 'tao_analyst', actor_label: 'J. Moreau', upload_id: UPLOAD, deal_slug: 'f-pil-2-0-moneda-capital-corp', collection_period: '2026-08',
    detail: { thread_id: 't1', comment_id: 'c1', anchor: { finding_id: 'f1' }, body: 'Servicer confirmed the closing balance.', mentions: [] } }),
  e({ id: 'r2', at: at(1, 10), action: 'thread_resolve', upload_id: UPLOAD, deal_slug: 'f-pil-2-0-moneda-capital-corp', collection_period: '2026-08', detail: { thread_id: 't1' } }),
  e({ id: 'r3', at: at(1, 9), action: 'thread_reopen', upload_id: UPLOAD, detail: { thread_id: 't1' } }),
  e({ id: 'r4', at: at(1, 8), action: 'comment_edit', upload_id: UPLOAD, detail: { thread_id: 't1', comment_id: 'c1', before: 'teh closing', after: 'the closing' } }),
]
function auditApi() {
  return fakeApi({
    'GET /master/deals': DEALS, 'GET /master/programs': PROGRAMS, 'GET /uploads': [],
    'GET /users': [{ id: MOREAU, email: 'tao.analyst@example.com', name: 'J. Moreau', role: 'tao_analyst', partner_slug: null, status: 'active', created_at: '2026-11-05T12:00:00Z' }],
    'GET /audit': (p: string) => {
      const q = new URLSearchParams(p.split('?')[1] ?? '')
      return ENTRIES.filter(x => !q.get('scope') || auditScope(x) === q.get('scope')).filter(x => !q.get('action') || x.action === q.get('action'))
    },
    'GET /audit/months': (p: string) => {
      const scope = new URLSearchParams(p.split('?')[1]).get('scope')
      return [{ month: CUR, count: ENTRIES.filter(x => auditScope(x) === scope).length }]
    },
  })
}
beforeEach(() => { mockApi.mockReset() })

describe('wave C audit actions', () => {
  it('labels every new action and puts it in the tab the contract names', () => {
    for (const a of ['user_change', 'prefs_change', 'settings_change', 'comment', 'comment_edit', 'thread_resolve', 'thread_reopen']) {
      expect(AUDIT_ACTIONS).toContain(a)
      expect(ACTION_LABEL[a]).toBeTruthy()
    }
    expect(PLATFORM_ACTIONS).toEqual(expect.arrayContaining(['user_change', 'prefs_change', 'settings_change']))
    expect(REPORT_ACTIONS).toEqual(expect.arrayContaining(['comment', 'comment_edit', 'thread_resolve', 'thread_reopen']))
    expect(ENTRIES.filter(x => auditScope(x) === 'platform').map(x => x.id)).toEqual(['w1', 'w2', 'w3', 'w4', 'w5'])
    // a comment action without an upload_id still belongs to Reports
    expect(auditScope({ action: 'thread_resolve', upload_id: null })).toBe('reports')
    expect(auditScope({ action: 'settings_change', upload_id: null })).toBe('platform')
  })
  it('shows before and after for user and settings changes', () => {
    const c = { deals: DEALS, programs: PROGRAMS }
    expect(entryChanges(ENTRIES[0], c)).toEqual([{ field: 'role', before: 'TAO Admin', after: 'TAO Analyst' }])
    expect(entryChanges(ENTRIES[1], c)).toEqual([{ field: 'Reports received', before: 'None', after: 'MOVE Trust: all deals; F-PIL 2.0: Stride Capital' }])
    expect(entryChanges(ENTRIES[2], c)).toEqual([{ field: 'Partner notifications', before: false, after: true }])
    expect(entryChanges(ENTRIES[3], c)).toEqual([{ field: 'Moneda Capital Corp. expected day', before: undefined, after: 8 }])
    expect(summary(ENTRIES[0])).toBe('Details changed · role tao_admin → tao_analyst')
    expect(summary(ENTRIES[5])).toBe('Servicer confirmed the closing balance.')
  })
  it('the Platform tab lists user and settings changes with before → after; the Reports tab the comment actions', async () => {
    mockApi.mockImplementation(auditApi())
    renderPage(`${PATH}?tab=platform`, [[PATH, <AuditLogPage />]])
    const table = await screen.findByRole('table', { name: 'Audit log' })
    await waitFor(() => expect(within(table).getAllByText('User change')).toHaveLength(2))
    const sub = within(table).getByText('Reports received').closest('tr')!
    expect(sub).toHaveTextContent('None')
    expect(sub).toHaveTextContent('MOVE Trust: all deals; F-PIL 2.0: Stride Capital')
    expect(within(sub).getByRole('link', { name: /J. Moreau/ }).getAttribute('href')).toBe(`/admin/settings/users?user=${MOREAU}`)
    const pn = within(table).getByRole('link', { name: /Partner notifications/ }).closest('tr')!
    expect(pn).toHaveTextContent(/false.*true/)
    expect(pn).toHaveTextContent('pilot go-live')
    expect(within(table).getByText('Own settings changed')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Reports/ }))
    const rep = await screen.findByRole('table', { name: 'Audit log' })
    await waitFor(() => expect(within(rep).getAllByText('Thread resolved').length).toBeGreaterThan(0))
    expect(within(rep).getAllByText('Thread reopened').length).toBeGreaterThan(0)
    expect(within(rep).getByText('Comment edited')).toBeInTheDocument()
    expect(within(rep).getByText('Servicer confirmed the closing balance.')).toBeInTheDocument()
  })
})

describe('Save for later (On hold) audit actions', () => {
  const HOLD = e({ id: 'h1', at: at(2, 16), action: 'hold', upload_id: UPLOAD, deal_slug: 'f-pil-2-0-moneda-capital-corp', collection_period: '2026-08',
    reason: 'Waiting for the servicer to confirm tranche 52.',
    detail: { note: 'Waiting for the servicer to confirm tranche 52.', has_draft_note: true, notify_add: ['00000000-0000-4000-8000-000000000002'], notify_remove: ['00000000-0000-4000-8000-000000000005'] } })
  const RELEASE = e({ id: 'h2', at: at(2, 17), action: 'hold_release', upload_id: UPLOAD })
  const PUBLISH = e({ id: 'h3', at: at(2, 18), action: 'publish', upload_id: UPLOAD,
    detail: { replaced_upload_id: null, notified_added: [{ id: '00000000-0000-4000-8000-000000000002', name: 'R. Okafor' }], notified_removed: [{ id: '00000000-0000-4000-8000-000000000005', name: 'M. Chen' }, { id: '00000000-0000-4000-8000-000000000007', name: 'K. Novak' }] } })

  it('labels hold and hold_release and keeps them on the Reports tab and in the action filter', () => {
    expect(ACTION_LABEL.hold).toBe('Saved for later (On hold)')
    expect(ACTION_LABEL.hold_release).toBe('Hold released')
    for (const a of ['hold', 'hold_release']) {
      expect(AUDIT_ACTIONS).toContain(a)
      expect(REPORT_ACTIONS).toContain(a)
      expect(PLATFORM_ACTIONS).not.toContain(a)
      expect(auditScope({ action: a, upload_id: null })).toBe('reports')
    }
  })
  it('summarises a hold by what was kept as the draft; the note is the reason and is not repeated', () => {
    expect(summary(HOLD)).toBe('draft note kept · 2 notification changes')
    expect(summary({ ...HOLD, detail: { note: HOLD.reason, has_draft_note: false, notify_add: [], notify_remove: [] } })).toBe('No draft')
    expect(summary({ ...HOLD, reason: null, detail: { note: null, has_draft_note: false, notify_add: [], notify_remove: [] } })).toBe('No draft')
    expect(summary({ ...HOLD, detail: { note: HOLD.reason, notify_add: ['R. Okafor'] } })).toBe('1 notification change')
    // The choices may arrive as counts. A note that came without a reason is still shown, once.
    expect(summary({ ...HOLD, detail: { has_draft_note: true, notify_add: 0, notify_remove: 3 } })).toBe('draft note kept · 3 notification changes')
    expect(summary({ ...HOLD, reason: null, detail: { note: 'x'.repeat(120), notify_add: ['a'] } })).toBe(`“${'x'.repeat(79)}…” · 1 notification change`)
    expect(summary(RELEASE)).toBe('Hold released; back to Needs review')
  })
  it('a publish entry names the people added or left out by hand', () => {
    expect(summary(PUBLISH)).toBe('Published to partners · Added by hand: R. Okafor · Left out: M. Chen, K. Novak')
    expect(summary({ ...PUBLISH, detail: { replaced_upload_id: null, notified_added: [], notified_removed: ['M. Chen'] } })).toBe('Published to partners · Left out: M. Chen')
    expect(summary({ ...PUBLISH, detail: { replaced_upload_id: null } })).toBe('Published to partners')
  })
  it('the Reports tab lists them, the filter offers them, and the expanded publish entry spells the choices out', async () => {
    mockApi.mockImplementation(fakeApi({
      'GET /master/deals': DEALS, 'GET /master/programs': PROGRAMS, 'GET /uploads': [], 'GET /users': [],
      'GET /audit': (p: string) => {
        const q = new URLSearchParams(p.split('?')[1] ?? '')
        return [PUBLISH, RELEASE, HOLD].filter(x => !q.get('scope') || auditScope(x) === q.get('scope')).filter(x => !q.get('action') || x.action === q.get('action'))
      },
      'GET /audit/months': () => [{ month: CUR, count: 3 }],
    }))
    renderPage(PATH, [[PATH, <AuditLogPage />]])
    const table = await screen.findByRole('table', { name: 'Audit log' })
    const hold = (await within(table).findByText('Saved for later (On hold)')).closest('tr')!
    expect(hold).toHaveTextContent('draft note kept · 2 notification changes')
    expect(hold.textContent!.match(/Waiting for the servicer to confirm tranche 52\./g)).toHaveLength(1)
    expect(within(table).getByText('Hold released').closest('tr')!).toHaveTextContent('Hold released; back to Needs review')
    const pub = within(table).getByText('Published to partners · Added by hand: R. Okafor · Left out: M. Chen, K. Novak').closest('tr')!
    const options = [...document.querySelectorAll('option')].map(o => o.textContent)
    expect(options).toEqual(expect.arrayContaining(['Saved for later (On hold)', 'Hold released']))
    // Expanded, the hold still shows its note once (Reason), not again as a detail field.
    await userEvent.click(hold)
    await waitFor(() => expect(table).toHaveTextContent('Saved for later: draft note kept · 2 notification changes'))
    expect(table.textContent!.match(/Waiting for the servicer to confirm tranche 52\./g)).toHaveLength(2)
    await userEvent.click(hold)
    await userEvent.click(pub)
    await waitFor(() => expect(table).toHaveTextContent('Added by hand: R. Okafor (this publish only)'))
    expect(table).toHaveTextContent('Left out: M. Chen, K. Novak (this publish only)')
  })
})
