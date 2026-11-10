// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderPage, fakeApi, DEALS, PROGRAMS } from './helpers'
import './matchers'
import type { AuditEntry } from '../data'

vi.mock('@/shell/api', () => ({ api: vi.fn(), apiBlob: vi.fn() }))
import { api } from '@/shell/api'
import AuditLogPage, { ACTION_LABEL, adverseDecision, dealLinks, entryChanges, newsSourceSummary, summary, torontoMonth } from '../AuditLogPage'
import { AUDIT_ACTIONS, PLATFORM_ACTIONS, REPORT_ACTIONS, auditScope } from '../data'

const mockApi = vi.mocked(api)
const PATH = '/admin/settings/users/audit'
const CUR = torontoMonth(new Date())
const at = (h: number) => `${CUR}-01T${String(h).padStart(2, '0')}:00:00Z`
const PATEL = '00000000-0000-4000-8000-000000000001'
const MOREAU = '00000000-0000-4000-8000-000000000003'
const NOTE = '11111111-0000-4000-8000-000000000001'
const e = (o: Partial<AuditEntry> & Pick<AuditEntry, 'id' | 'at' | 'action'>): AuditEntry =>
  ({ actor_role: 'tao_admin', actor_label: 'A. Patel', upload_id: null, finding_id: null, reason: null, detail: {}, ...o })
const ENTRIES: AuditEntry[] = [
  // the record: aliases and a deal link
  e({ id: 'd1', at: at(20), action: 'company_change', reason: 'Stride also trades as Stride Cap', detail: {
    company_slug: 'stride-capital', company_name: 'Stride Capital', change: 'updated',
    before: { aliases: [], deal_slugs: ['f-pil-2-0-stride-capital'] },
    after: { aliases: ['Stride Cap'], deal_slugs: ['f-pil-2-0-stride-capital', 'f-pil-2-0-moneda-capital-corp'] },
  } }),
  // a contact added
  e({ id: 'd2', at: at(19), action: 'company_change', reason: 'New servicing lead', detail: {
    company_slug: 'stride-capital', company_name: 'Stride Capital', change: 'contact_added', contact_id: 'c1',
    before: null, after: { id: 'c1', name: 'R. Singh', role: 'Head of servicing', email: null, receives: 'Monthly SetRep' },
  } }),
  e({ id: 'd3', at: at(18), action: 'company_note', actor_role: 'tao_analyst', actor_label: 'J. Moreau', detail: {
    company_slug: 'moneda-capital-corp', note_id: NOTE, body: 'Called the servicer about the August arrears; they expect to cure by October.', mentions: [], collection_period: '2026-08',
  } }),
  e({ id: 'd4', at: at(17), action: 'company_note_edit', actor_role: 'tao_analyst', actor_label: 'J. Moreau', detail: {
    company_slug: 'moneda-capital-corp', note_id: NOTE, change: 'edited', before: 'cure by October', after: 'cure by November',
  } }),
  e({ id: 'd5', at: at(16), action: 'company_note_edit', reason: 'Duplicate', detail: { company_slug: 'moneda-capital-corp', note_id: NOTE, change: 'removed', before: 'cure by November', after: null } }),
  e({ id: 'd6', at: at(15), action: 'adverse_change', detail: {
    company_slug: 'moneda-capital-corp', adverse_id: 'a1', category: 'litigation', title: 'Lender sues equipment dealer', state: 'reviewed', note: 'Not our servicer; no exposure.',
  } }),
  e({ id: 'd7', at: at(14), action: 'adverse_change', detail: { company_slug: 'moneda-capital-corp', adverse_id: 'a2', category: 'fraud', title: 'Moneda Bank fraud charges', state: 'dismissed', note: 'Different entity (Moneda Bank, Chile).' } }),
  e({ id: 'd8', at: at(13), action: 'news_run', detail: { run_id: '22222222-0000-4000-8000-000000000001', trigger: 'manual' } }),
]
function auditApi() {
  return fakeApi({
    'GET /master/deals': DEALS, 'GET /master/programs': PROGRAMS, 'GET /uploads': [],
    'GET /users': [
      { id: PATEL, email: 'tao.admin@example.com', name: 'A. Patel', role: 'tao_admin', partner_slug: null, status: 'active', created_at: '2026-11-05T12:00:00Z' },
      { id: MOREAU, email: 'tao.analyst@example.com', name: 'J. Moreau', role: 'tao_analyst', partner_slug: null, status: 'active', created_at: '2026-11-05T12:00:00Z' },
    ],
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
const C = { deals: DEALS, programs: PROGRAMS }
beforeEach(() => { mockApi.mockReset() })

describe('wave D audit actions', () => {
  it('labels the five new actions and puts them all on the Platform tab', () => {
    const NEW = ['company_change', 'company_note', 'company_note_edit', 'adverse_change', 'news_run']
    for (const a of NEW) {
      expect(AUDIT_ACTIONS).toContain(a)
      expect(ACTION_LABEL[a]).toBeTruthy()
      expect(PLATFORM_ACTIONS).toContain(a)
      expect(REPORT_ACTIONS).not.toContain(a)
    }
    expect(ENTRIES.every(x => auditScope(x) === 'platform')).toBe(true)
    // a company note about a report month is still Platform: it has no upload_id
    expect(auditScope({ action: 'company_note', upload_id: null })).toBe('platform')
  })

  it('company_change: field-level before and after, deals by name, linked and unlinked', () => {
    expect(entryChanges(ENTRIES[0], C)).toEqual([
      { field: 'Aliases', before: 'none', after: 'Stride Cap' },
      { field: 'Deals', before: 'Stride Capital', after: 'Stride Capital, Moneda Capital Corp.' },
    ])
    expect(dealLinks(ENTRIES[0].detail!, C)).toEqual({ linked: ['Moneda Capital Corp.'], unlinked: [] })
    expect(dealLinks({ before: { deal_slugs: ['a', 'b'] }, after: { deal_slugs: ['b'] } })).toEqual({ linked: [], unlinked: ['a'] })
    expect(summary(ENTRIES[0], C)).toBe('Record updated · Linked Moneda Capital Corp. · Aliases none → Stride Cap')
  })

  it('company_change: a contact shows as contact fields, named in the summary', () => {
    expect(entryChanges(ENTRIES[1], C)).toEqual([
      { field: 'Contact · Name', before: undefined, after: 'R. Singh' },
      { field: 'Contact · Role', before: undefined, after: 'Head of servicing' },
      { field: 'Contact · Receives', before: undefined, after: 'Monthly SetRep' },
    ])
    expect(summary(ENTRIES[1], C)).toBe('Contact added · R. Singh')
  })

  it('company_note_edit: old and new text, or removed', () => {
    expect(entryChanges(ENTRIES[3], C)).toEqual([{ field: 'Note', before: 'cure by October', after: 'cure by November' }])
    expect(entryChanges(ENTRIES[4], C)).toEqual([{ field: 'Note', before: 'cure by November', after: 'removed' }])
    expect(summary(ENTRIES[4], C)).toBe('Note removed · cure by November')
  })

  it('company_note: the note text and its report month', () => {
    expect(summary(ENTRIES[2], C)).toBe('August 2026 · Called the servicer about the August arrears; they expect to cure by October.')
  })

  it('adverse_change: reviewed or dismissed, with the note', () => {
    expect(adverseDecision(ENTRIES[5])).toMatchObject({ label: 'Reviewed', tone: 'ok', note: 'Not our servicer; no exposure.', item: 'Litigation · Lender sues equipment dealer' })
    expect(adverseDecision(ENTRIES[6])).toMatchObject({ label: 'Dismissed', note: 'Different entity (Moneda Bank, Chile).' })
    expect(summary(ENTRIES[6], C)).toBe('Dismissed · Fraud · Moneda Bank fraud charges · Note: Different entity (Moneda Bank, Chile).')
    // the state can also arrive as before → after
    expect(adverseDecision(e({ id: 'x', at: at(1), action: 'adverse_change', reason: 'checked', detail: { before: { state: 'open' }, after: { state: 'reviewed' } } })))
      .toMatchObject({ label: 'Reviewed', note: 'checked' })
  })

  it('news_source_change (wave E): labelled, on the Platform tab, and summarised by field name only', () => {
    expect(ACTION_LABEL.news_source_change).toBe('News source change')
    expect(auditScope({ action: 'news_source_change', upload_id: null })).toBe('platform')
    expect(AUDIT_ACTIONS).toContain('news_source_change')
    expect(newsSourceSummary({ provider: 'brave', label: 'Brave Search', enabled: { before: false, after: false }, config_changed: [], secrets_set: ['api_key'], secrets_removed: [] }))
      .toBe('Key set: api key')
    expect(newsSourceSummary({ enabled: { before: false, after: true }, config_changed: ['archive_months'], secrets_set: [], secrets_removed: ['api_key'] }))
      .toBe('Switched on · Key removed: api key · Settings changed: archive months')
    expect(summary({ ...ENTRIES[7], action: 'news_source_change', detail: { label: 'Brave Search', enabled: { before: true, after: false } } }, C)).toBe('Switched off')
  })

  it('news_run: manual, with who', () => {
    expect(summary(ENTRIES[7], C)).toBe('Manual run by A. Patel')
    expect(summary({ ...ENTRIES[7], actor_label: 'tao_admin' }, C)).toBe('Manual run by TAO Admin')
  })

  it('the Platform tab renders every new action with its subject and detail', async () => {
    mockApi.mockImplementation(auditApi())
    renderPage(`${PATH}?tab=platform`, [[PATH, <AuditLogPage />]])
    const table = await screen.findByRole('table', { name: 'Audit log' })
    await waitFor(() => expect(within(table).getAllByText('Company change')).toHaveLength(2))

    const rec = within(table).getByText('Record updated · Linked Moneda Capital Corp. · Aliases none → Stride Cap').closest('tr')!
    expect(within(rec).getByRole('link', { name: /Stride Capital/ }).getAttribute('href')).toBe('/admin/companies/stride-capital')
    expect(rec).toHaveTextContent('Stride also trades as Stride Cap')

    expect(within(table).getByText('Contact added · R. Singh')).toBeInTheDocument()

    const note = within(table).getByText(/Called the servicer about the August arrears/).closest('tr')!
    expect(within(note).getByRole('link', { name: /Moneda Capital Corp/ }).getAttribute('href')).toBe(`/admin/companies/moneda-capital-corp?note=${NOTE}`)
    expect(note).toHaveTextContent('Company note')

    // one-field edits read as before → after in the Detail cell
    const edited = within(table).getAllByText('Company note edited').map(x => x.closest('tr')!)
    expect(edited).toHaveLength(2)
    expect(edited[0]).toHaveTextContent(/Note.*cure by October.*cure by November/)
    expect(edited[1]).toHaveTextContent(/Note.*cure by November.*removed/)

    const rev = within(table).getByText(/Lender sues equipment dealer/).closest('tr')!
    expect(rev.querySelector('.ds-pill')!.textContent).toBe('Reviewed')
    expect(rev.querySelector('.ds-pill__dot')).not.toBeNull()
    expect(rev).toHaveTextContent('Not our servicer; no exposure.')
    const dis = within(table).getByText(/Moneda Bank fraud charges/).closest('tr')!
    expect(dis.querySelector('.ds-pill')!.textContent).toBe('Dismissed')

    const run = within(table).getByText('Manual run by A. Patel').closest('tr')!
    expect(run).toHaveTextContent('News run')
    expect(within(run).getByRole('link', { name: /Company news/ }).getAttribute('href')).toBe('/admin/settings/system#set-companies')

    // the expanded company_change lists every field, linked deals and the reason
    await userEvent.click(rec)
    const ba = await screen.findByRole('table', { name: 'Before and after' })
    expect(ba).toHaveTextContent(/Aliases.*none.*Stride Cap/)
    expect(ba).toHaveTextContent(/Deals.*Stride Capital.*Stride Capital, Moneda Capital Corp\./)
    expect(screen.getByText(/Deals linked/).closest('div')!).toHaveTextContent('Moneda Capital Corp.')
  })

  it('the action filter offers the new actions under Platform', async () => {
    mockApi.mockImplementation(auditApi())
    renderPage(`${PATH}?tab=platform`, [[PATH, <AuditLogPage />]])
    await screen.findByRole('table', { name: 'Audit log' })
    const opts = [...document.querySelectorAll('optgroup[label="Platform"] option')].map(o => o.textContent)
    expect(opts).toEqual(expect.arrayContaining(['Company change', 'Company note', 'Company note edited', 'Adverse media decision', 'News run']))
  })
})
