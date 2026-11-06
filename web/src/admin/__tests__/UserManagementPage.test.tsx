// @vitest-environment jsdom
/// <reference types="node" />
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderPage, fakeApi, httpError, PARTNERS, PROGRAMS } from './helpers'
import './matchers'
import type { AuditEntry, Deal, Program } from '../data'

vi.mock('@/shell/api', () => ({ api: vi.fn(), apiBlob: vi.fn() }))
import { api } from '@/shell/api'
import UserManagementPage from '../UserManagementPage'
import { errorText } from '../ui'
import {
  fromTree, lockReason, setAll, toTree, toggleDeal, visiblePrograms, filterUsers, subsText, type AppUser, type Subscription,
} from '../users'

const mockApi = vi.mocked(api)
const root = resolve(__dirname, '../../../..')
/** The real 12 deals (seed/deals.json) and the seeded users (seed/users.json), status and timestamps added as the API returns them. */
const DEALS12: Deal[] = JSON.parse(readFileSync(resolve(root, 'seed/deals.json'), 'utf8'))
const USERS: AppUser[] = (JSON.parse(readFileSync(resolve(root, 'seed/users.json'), 'utf8')) as AppUser[])
  .map(u => ({ ...u, status: 'active' as const, created_at: '2026-11-05T12:00:00Z', last_active_at: null, receives_summary: 'None' }))
const byEmail = (e: string) => USERS.find(u => u.email === e)!
const PATEL = byEmail('tao.admin@example.com'), OKAFOR = byEmail('tao.admin2@example.com'), MOREAU = byEmail('tao.analyst@example.com')
const NOVAK = byEmail('manager.admin@example.com'), HADDAD = byEmail('manager.viewer@example.com')
const PATH = '/admin/settings/users'
const route: [string, JSX.Element][] = [[PATH, <UserManagementPage />]]

type Table = Record<string, unknown>
function usersApi(over: Table = {}, users = USERS, programs: Program[] = PROGRAMS) {
  return fakeApi({
    'GET /users': users, 'GET /master/partners': PARTNERS, 'GET /master/programs': programs, 'GET /master/deals': DEALS12,
    'GET /me': { user: null, role: 'tao_admin', partner_slug: null, display: {} },
    'GET /audit': [],
    ...Object.fromEntries(users.map(u => [`GET /users/${u.id}/subscriptions`, []])),
    ...over,
  })
}
const sent = (method: string, path: string) => mockApi.mock.calls.filter(([p, i]) => p === path && (i?.method ?? 'GET') === method)
const body = (method: string, path: string, n = 0) => JSON.parse(String(sent(method, path)[n][1]!.body))

beforeEach(() => { mockApi.mockReset() })

describe('subscription tree helpers', () => {
  const MOVE = DEALS12.filter(d => d.program_slug === 'move-trust').map(d => d.slug)
  it('round-trips program entries and deal entries', () => {
    const subs: Subscription[] = [{ program_slug: 'move-trust', deal_slug: null, channels: ['in_app'] }, { program_slug: 'f-pil-2-0', deal_slug: 'f-pil-2-0-stride-capital', channels: ['in_app'] }]
    const t = toTree(subs)
    expect(t).toEqual({ 'move-trust': { all: true, deals: [] }, 'f-pil-2-0': { all: false, deals: ['f-pil-2-0-stride-capital'] } })
    expect(fromTree(t, PROGRAMS)).toEqual([subs[1], subs[0]]) // program order from master data: F-PIL 2.0 first
  })
  it('"All deals" replaces deal entries; unticking one deal keeps the rest ticked one by one', () => {
    let t = setAll({}, 'move-trust', true)
    expect(fromTree(t, PROGRAMS)).toEqual([{ program_slug: 'move-trust', deal_slug: null, channels: ['in_app'] }])
    t = toggleDeal(t, 'move-trust', 'move-trust-finloc-2000-inc', false, MOVE)
    expect(t['move-trust'].all).toBe(false)
    expect(t['move-trust'].deals).toHaveLength(8)
    expect(t['move-trust'].deals).not.toContain('move-trust-finloc-2000-inc')
    expect(fromTree(t, PROGRAMS).every(s => s.deal_slug !== null && s.channels.join() === 'in_app')).toBe(true)
  })
  it('a partner user sees only the programs shared with their partner; TAO users see every program', () => {
    const progs: Program[] = [PROGRAMS[0], { ...PROGRAMS[1], partner_slugs: ['investor'] }]
    expect(visiblePrograms({ partner_slug: 'manager' }, progs).map(p => p.slug)).toEqual(['f-pil-2-0'])
    expect(visiblePrograms({ partner_slug: 'investor' }, progs).map(p => p.slug)).toEqual(['f-pil-2-0', 'move-trust'])
    expect(visiblePrograms({ partner_slug: null }, progs)).toHaveLength(2)
  })
  it('names programs and deals in a subscription summary', () => {
    expect(subsText([{ program_slug: 'move-trust', deal_slug: null, channels: ['in_app'] }, { program_slug: 'f-pil-2-0', deal_slug: 'f-pil-2-0-moneda-capital-corp', channels: ['in_app'] }], PROGRAMS, DEALS12))
      .toBe('MOVE Trust: all deals; F-PIL 2.0: Moneda Capital Corp.')
    expect(subsText([], PROGRAMS, DEALS12)).toBe('None')
  })
})

describe('deactivate and role guards', () => {
  it('blocks your own account and the last active admin of a company', () => {
    expect(lockReason(PATEL, USERS, PATEL.id)).toBe('self_change')
    expect(lockReason(PATEL, USERS, null)).toBeNull() // R. Okafor is also an active TAO Admin
    const okaforGone = USERS.map(u => (u.id === OKAFOR.id ? { ...u, status: 'deactivated' as const } : u))
    expect(lockReason(PATEL, okaforGone, null)).toBe('last_admin')
    expect(lockReason(NOVAK, USERS, null)).toBe('last_admin') // the only Manager Company Admin
    expect(lockReason(HADDAD, USERS, null)).toBeNull()
    expect(lockReason(MOREAU, USERS, PATEL.id)).toBeNull()
  })
  it('filters by partner, status and search', () => {
    const withGone = USERS.map(u => (u.id === MOREAU.id ? { ...u, status: 'deactivated' as const } : u))
    expect(filterUsers(withGone, { partner: 'tao', status: '', q: '' })).toHaveLength(4)
    expect(filterUsers(withGone, { partner: 'manager', status: '', q: '' }).map(u => u.name)).toEqual(['K. Novak', 'L. Haddad'])
    expect(filterUsers(withGone, { partner: '', status: 'deactivated', q: '' }).map(u => u.name)).toEqual(['J. Moreau'])
    expect(filterUsers(withGone, { partner: '', status: '', q: 'investor.v' }).map(u => u.name)).toEqual(['D. Alvarez'])
  })
})

describe('error messages', () => {
  it.each([
    ['self_change', 409, /can’t change your own role or deactivate yourself/],
    ['last_admin', 409, /no active TAO Admin.*Company Admin/],
    ['other_partner', 409, /own company’s admins and viewers/],
    ['email_taken', 409, /already has this email address/],
    ['role_partner_mismatch', 422, /TAO roles have no partner/],
    ['not_visible', 422, /not shared with this user’s partner/],
  ])('%s reads as a plain sentence', (code, status, re) => {
    const msg = errorText(httpError(status, code, 'raw api text'))
    expect(msg).toMatch(re)
    expect(msg).not.toContain(code)
  })
})

describe('User management page', () => {
  it('is TAO Admin only: an analyst sees no access and the page calls nothing', async () => {
    mockApi.mockImplementation(usersApi())
    renderPage(PATH, route, 'tao_analyst')
    expect(await screen.findByText('You don’t have access')).toBeInTheDocument()
    expect(sent('GET', '/users')).toHaveLength(0)
  })

  it('a 403 from the API shows the no-access state', async () => {
    mockApi.mockImplementation(usersApi({ 'GET /users': httpError(403, 'company_admin_only') }))
    renderPage(PATH, route)
    expect(await screen.findByText('You don’t have access')).toBeInTheDocument()
  })

  it('lists every user with role, partner, status and reports received, and filters by partner', async () => {
    const users = USERS.map(u => (u.id === MOREAU.id ? { ...u, receives_summary: 'MOVE Trust: all deals' } : u))
    mockApi.mockImplementation(usersApi({}, users))
    renderPage(PATH, route)
    const table = await screen.findByRole('table', { name: 'Users' })
    await within(table).findByText('J. Moreau')
    expect(within(table).getAllByRole('row')).toHaveLength(USERS.length + 1)
    const row = within(table).getByText('J. Moreau').closest('tr')!
    expect(within(row).getByText('TAO Analyst')).toBeInTheDocument()
    expect(within(row).getByText('TAO')).toBeInTheDocument()
    expect(within(row).getByText('Active')).toBeInTheDocument()
    expect(within(row).getByText('MOVE Trust: all deals')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Partner'), 'manager')
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(3))
    expect(within(table).getByText('K. Novak')).toBeInTheDocument()
    expect(within(table).queryByText('A. Patel')).toBeNull()
    await userEvent.type(screen.getByLabelText('Search'), 'haddad')
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2))
  })

  it('your own row: the role is locked and Deactivate is disabled (self_change)', async () => {
    mockApi.mockImplementation(usersApi({ 'GET /me': { user: PATEL, role: 'tao_admin', partner_slug: null, display: {} } }))
    renderPage(`${PATH}?user=${PATEL.id}`, route)
    const drawer = await screen.findByRole('dialog', { name: 'Edit A. Patel' })
    expect(within(drawer).getByLabelText(/^Role/)).toBeDisabled()
    expect(within(drawer).getByRole('button', { name: 'Deactivate user' })).toBeDisabled()
    expect(within(drawer).getAllByText(/can’t change your own role or deactivate yourself/).length).toBeGreaterThan(0)
  })

  it('the last active TAO Admin cannot be deactivated (last_admin)', async () => {
    const users = USERS.map(u => (u.id === OKAFOR.id ? { ...u, status: 'deactivated' as const, deactivation_reason: 'left TAO' } : u))
    mockApi.mockImplementation(usersApi({}, users))
    renderPage(`${PATH}?user=${PATEL.id}`, route)
    const drawer = await screen.findByRole('dialog', { name: 'Edit A. Patel' })
    expect(within(drawer).getByRole('button', { name: 'Deactivate user' })).toBeDisabled()
    expect(within(drawer).getAllByText(/last active admin/).length).toBeGreaterThan(0)
  })

  it('deactivates with a reason of three characters or more; there is no delete', async () => {
    mockApi.mockImplementation(usersApi({ [`POST /users/${MOREAU.id}/deactivate`]: { ...MOREAU, status: 'deactivated' } }))
    renderPage(`${PATH}?user=${MOREAU.id}`, route)
    const drawer = await screen.findByRole('dialog', { name: 'Edit J. Moreau' })
    expect(within(drawer).queryByRole('button', { name: /delete/i })).toBeNull()
    await userEvent.click(within(drawer).getByRole('button', { name: 'Deactivate user' }))
    const dlg = await screen.findByRole('alertdialog', { name: 'Deactivate J. Moreau?' })
    await userEvent.type(within(dlg).getByLabelText(/Reason/), 'ab')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Deactivate' }))
    expect(await within(dlg).findByText('Give a reason of at least three characters.')).toBeInTheDocument()
    expect(sent('POST', `/users/${MOREAU.id}/deactivate`)).toHaveLength(0)
    await userEvent.type(within(dlg).getByLabelText(/Reason/), 'c left the team')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Deactivate' }))
    await waitFor(() => expect(sent('POST', `/users/${MOREAU.id}/deactivate`)).toHaveLength(1))
    expect(body('POST', `/users/${MOREAU.id}/deactivate`)).toEqual({ reason: 'abc left the team' })
  })

  it('shows the API’s last_admin refusal as a plain message', async () => {
    mockApi.mockImplementation(usersApi({ [`POST /users/${HADDAD.id}/deactivate`]: httpError(409, 'last_admin') }))
    renderPage(`${PATH}?user=${HADDAD.id}`, route)
    const drawer = await screen.findByRole('dialog', { name: 'Edit L. Haddad' })
    await userEvent.click(within(drawer).getByRole('button', { name: 'Deactivate user' }))
    const dlg = await screen.findByRole('alertdialog')
    await userEvent.type(within(dlg).getByLabelText(/Reason/), 'moved on')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Deactivate' }))
    expect(await within(dlg).findByRole('alert')).toHaveTextContent(/without an active Company Admin/)
  })

  it('reactivates a deactivated user with a reason', async () => {
    const users = USERS.map(u => (u.id === MOREAU.id ? { ...u, status: 'deactivated' as const } : u))
    mockApi.mockImplementation(usersApi({ [`POST /users/${MOREAU.id}/reactivate`]: { ...MOREAU, status: 'active' } }, users))
    renderPage(`${PATH}?user=${MOREAU.id}`, route)
    const drawer = await screen.findByRole('dialog', { name: 'Edit J. Moreau' })
    await userEvent.click(within(drawer).getByRole('button', { name: 'Reactivate user' }))
    const dlg = await screen.findByRole('dialog', { name: 'Reactivate J. Moreau?' })
    await userEvent.type(within(dlg).getByLabelText(/Reason/), 'back from leave')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Reactivate' }))
    await waitFor(() => expect(body('POST', `/users/${MOREAU.id}/reactivate`)).toEqual({ reason: 'back from leave' }))
  })

  it('subscription tree: program → deals of the real 12, "All deals" and per-deal ticks, saved in-app only', async () => {
    mockApi.mockImplementation(usersApi({
      [`GET /users/${MOREAU.id}/subscriptions`]: [{ program_slug: 'move-trust', deal_slug: null, channels: ['in_app'] }],
      [`PUT /users/${MOREAU.id}/subscriptions`]: (_p: string, i?: RequestInit) => JSON.parse(String(i!.body)),
    }))
    renderPage(`${PATH}?user=${MOREAU.id}`, route)
    const drawer = await screen.findByRole('dialog', { name: 'Edit J. Moreau' })
    const tree = await within(drawer).findByRole('table', { name: 'Reports this user receives' })
    const moveAll = within(tree).getByRole('checkbox', { name: 'All deals in MOVE Trust, including new ones' })
    await waitFor(() => expect(moveAll).toBeChecked())
    expect(within(tree).getByText('9 of 9 deals')).toBeInTheDocument()
    expect(within(tree).getByText('0 of 3 deals')).toBeInTheDocument()
    expect(within(tree).getByRole('checkbox', { name: 'Finloc 2000 Inc. (MOVE Trust), in-app' })).toBeChecked()
    // email is not a live switch in phase 2
    expect(within(tree).getByRole('checkbox', { name: 'Finloc 2000 Inc., email (coming later)' })).toBeDisabled()
    expect(within(tree).getAllByText('Coming later')).toHaveLength(2)
    await userEvent.click(within(tree).getByRole('checkbox', { name: 'Finloc 2000 Inc. (MOVE Trust), in-app' }))
    expect(moveAll).not.toBeChecked()
    expect(within(tree).getByText('8 of 9 deals')).toBeInTheDocument()
    await userEvent.click(within(tree).getByRole('checkbox', { name: 'Moneda Capital Corp. (F-PIL 2.0), in-app' }))
    expect(within(drawer).getByRole('status')).toHaveTextContent('9 of 12 deals')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(sent('PUT', `/users/${MOREAU.id}/subscriptions`)).toHaveLength(1))
    const subs = body('PUT', `/users/${MOREAU.id}/subscriptions`) as Subscription[]
    expect(subs).toHaveLength(9)
    expect(subs[0]).toEqual({ program_slug: 'f-pil-2-0', deal_slug: 'f-pil-2-0-moneda-capital-corp', channels: ['in_app'] })
    expect(subs.some(s => s.deal_slug === 'move-trust-finloc-2000-inc' || s.deal_slug === null)).toBe(false)
    expect(sent('PATCH', `/users/${MOREAU.id}`)).toHaveLength(0) // details unchanged
  })

  it('a partner user’s tree lists only the programs shared with that partner', async () => {
    const progs: Program[] = [PROGRAMS[0], { ...PROGRAMS[1], partner_slugs: ['investor'] }] // MOVE Trust not shared with Manager
    mockApi.mockImplementation(usersApi({}, USERS, progs))
    renderPage(`${PATH}?user=${HADDAD.id}`, route)
    const drawer = await screen.findByRole('dialog', { name: 'Edit L. Haddad' })
    const tree = await within(drawer).findByRole('table', { name: 'Reports this user receives' })
    expect(within(tree).getByText('Programs shared with Manager')).toBeInTheDocument()
    expect(within(tree).getByRole('checkbox', { name: /All deals in F-PIL 2.0/ })).toBeInTheDocument()
    expect(within(tree).queryByText('MOVE Trust')).toBeNull()
    expect(within(tree).queryByText('Dynamic Capital')).toBeNull()
  })

  it('shows not_visible from the API when saving subscriptions', async () => {
    mockApi.mockImplementation(usersApi({ [`PUT /users/${HADDAD.id}/subscriptions`]: httpError(422, 'not_visible') }))
    renderPage(`${PATH}?user=${HADDAD.id}`, route)
    const drawer = await screen.findByRole('dialog', { name: 'Edit L. Haddad' })
    await userEvent.click(await within(drawer).findByRole('checkbox', { name: /All deals in MOVE Trust/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await within(drawer).findByRole('alert')).toHaveTextContent(/not shared with this user’s partner/)
  })

  it('edits details and role with PATCH (only what changed); email_taken reads as a plain message', async () => {
    let n = 0
    mockApi.mockImplementation(usersApi({ [`PATCH /users/${MOREAU.id}`]: () => (++n === 1 ? httpError(409, 'email_taken') : { ...MOREAU, role: 'tao_admin' }) }))
    renderPage(`${PATH}?user=${MOREAU.id}`, route)
    const drawer = await screen.findByRole('dialog', { name: 'Edit J. Moreau' })
    const email = within(drawer).getByLabelText(/^Email/)
    await userEvent.clear(email); await userEvent.type(email, 'tao.admin@example.com')
    await userEvent.selectOptions(within(drawer).getByLabelText(/^Role/), 'tao_admin')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await within(drawer).findByRole('alert')).toHaveTextContent('Another user already has this email address.')
    expect(body('PATCH', `/users/${MOREAU.id}`)).toEqual({ email: 'tao.admin@example.com', role: 'tao_admin' })
  })

  it('Add user: a partner role needs its partner; role_partner_mismatch is explained', async () => {
    mockApi.mockImplementation(usersApi({ 'POST /users': httpError(422, 'role_partner_mismatch') }))
    renderPage(`${PATH}?user=new`, route)
    const drawer = await screen.findByRole('dialog', { name: 'Add user' })
    await userEvent.type(within(drawer).getByLabelText(/^Full name/), 'P. Nguyen')
    await userEvent.type(within(drawer).getByLabelText(/^Email/), 'p.nguyen@example.com')
    await userEvent.selectOptions(within(drawer).getByLabelText(/^Role/), 'investor_viewer')
    // one Investor partner: picked for you
    expect(within(drawer).getByLabelText(/^Partner/)).toHaveValue('investor')
    await userEvent.click(within(drawer).getByRole('button', { name: 'Add user' }))
    await waitFor(() => expect(sent('POST', '/users')).toHaveLength(1))
    expect(body('POST', '/users')).toEqual({ name: 'P. Nguyen', email: 'p.nguyen@example.com', role: 'investor_viewer', partner_slug: 'investor' })
    expect(await within(drawer).findByRole('alert')).toHaveTextContent(/TAO roles have no partner/)
  })

  it('Invite by email sends email and role only (name from the address, no partner for TAO roles)', async () => {
    const created = { ...MOREAU, id: '00000000-0000-4000-8000-000000000099', email: 't.brooks@example.com', name: 't.brooks' }
    mockApi.mockImplementation(usersApi({ 'POST /users': created, [`GET /users/${created.id}/subscriptions`]: [] }))
    renderPage(PATH, route)
    await screen.findByRole('table', { name: 'Users' })
    await userEvent.click(screen.getByRole('button', { name: 'Invite by email' }))
    const dlg = await screen.findByRole('dialog', { name: 'Invite by email' })
    expect(within(dlg).queryByLabelText(/Full name/)).toBeNull()
    await userEvent.type(within(dlg).getByLabelText(/^Email/), 't.brooks@example.com')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Add user' }))
    await waitFor(() => expect(body('POST', '/users')).toEqual({ email: 't.brooks@example.com', name: 't.brooks', role: 'tao_analyst', partner_slug: null }))
  })

  it('the drawer shows the user’s recent changes from the Platform audit log', async () => {
    const entries: AuditEntry[] = [
      { id: 'u1', at: '2026-11-05T14:40:00Z', actor_role: 'tao_admin', actor_label: 'A. Patel', action: 'user_change', upload_id: null, reason: null,
        detail: { user_id: MOREAU.id, partner_slug: null, change: 'subscriptions', before: [], after: [{ program_slug: 'move-trust', deal_slug: null, channels: ['in_app'] }] } },
      { id: 'u2', at: '2026-11-04T10:00:00Z', actor_role: 'tao_admin', actor_label: 'R. Okafor', action: 'user_change', upload_id: null, reason: null,
        detail: { user_id: MOREAU.id, partner_slug: null, change: 'updated', before: { role: 'tao_admin' }, after: { role: 'tao_analyst' } } },
    ]
    mockApi.mockImplementation(usersApi({ 'GET /audit': entries }))
    renderPage(`${PATH}?user=${MOREAU.id}`, route)
    const drawer = await screen.findByRole('dialog', { name: 'Edit J. Moreau' })
    const hist = await within(drawer).findByRole('table', { name: 'Recent changes for J. Moreau' })
    expect(within(hist).getByText('Reports changed: None → MOVE Trust: all deals')).toBeInTheDocument()
    expect(within(hist).getByText(/Details changed · role TAO Admin → TAO Analyst/)).toBeInTheDocument()
    const call = mockApi.mock.calls.find(([p]) => p.startsWith('/audit'))![0]
    expect(call).toContain('scope=platform')
    expect(call).toContain(`q=${encodeURIComponent(MOREAU.email)}`)
  })
})
