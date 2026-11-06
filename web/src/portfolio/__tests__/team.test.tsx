// @vitest-environment jsdom
/** Team members (D8 c) against a fake API shaped like contracts/openapi.yaml /users, /users/{id}/subscriptions, /me and
 * /published/portfolio. People are the seed users (seed/users.json) plus one sample Investor viewer; programs and deals
 * are the real objects in docs/dashboard-json. The deliberate change: in some tests only MOVE Trust is shared with
 * Investor, so the tree must leave F-PIL 2.0 out. */
import '@/design/test-utils'
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { App } from '@/shell/App'
import { KEY } from '@/shell/roles'
import { headerStore } from '@/shell/header'
import { apiPortfolio } from './fixtures'
import type { AppUser, Subscription } from '../team'
import { toPicks, toSubscriptions } from '../team'

const T = '2026-11-05T15:02:00Z'
const u = (id: number, name: string, email: string, role: AppUser['role'], partner: string | null, extra: Partial<AppUser> = {}): AppUser =>
  ({ id: `00000000-0000-4000-8000-00000000000${id}`, name, email, role, partner_slug: partner, status: 'active', created_at: T, last_active_at: T, receives_summary: 'None', ...extra })
const PEOPLE: AppUser[] = [
  u(1, 'A. Patel', 'tao.admin@example.com', 'tao_admin', null),
  u(3, 'J. Moreau', 'tao.analyst@example.com', 'tao_analyst', null),
  u(5, 'M. Chen', 'investor.admin@example.com', 'investor_admin', 'investor', { receives_summary: 'MOVE Trust: all deals' }),
  u(6, 'D. Alvarez', 'investor.viewer@example.com', 'investor_viewer', 'investor', { receives_summary: 'F-PIL 2.0: 1 deal' }),
  u(9, 'P. Nguyen', 'p.nguyen@example.com', 'investor_viewer', 'investor', { status: 'deactivated', last_active_at: null, deactivation_reason: 'left the company' }),
  u(7, 'K. Novak', 'manager.admin@example.com', 'manager_admin', 'manager'),
  u(8, 'L. Haddad', 'manager.viewer@example.com', 'manager_viewer', 'manager'),
]
const MOVE_DEALS = apiPortfolio('investor').programs.find(p => p.program?.slug === 'move-trust')!.deals

let calls: { method: string; path: string; headers: Record<string, string>; body?: unknown }[] = []
let me: AppUser | null = null
let leak = false
let shared: string[] = ['f-pil-2-0', 'move-trust']
let subs: Record<string, Subscription[]> = {}
let fail: Record<string, { status: number; code: string }> = {}

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}
function fakeFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input), 'http://x')
  const path = url.pathname.replace(/^.*\/api\/v1/, '')
  const method = init?.method ?? 'GET'
  const headers = (init?.headers ?? {}) as Record<string, string>
  const body = init?.body ? JSON.parse(String(init.body)) : undefined
  calls.push({ method, path: path + url.search, headers, body })
  const partner = headers['X-Partner'] ?? null
  const key = `${method} ${path}`
  if (fail[key]) return respond(fail[key].status, { code: fail[key].code, message: `server says ${fail[key].code}` })
  if (key === 'GET /me') return respond(200, { user: me, role: headers['X-Role'], partner_slug: partner, display: {} })
  if (key === 'GET /users') {
    if (!headers['X-Role']?.endsWith('_admin')) return respond(403, { code: 'company_admin_only', message: 'no' })
    // The real API forces the caller's partner; `leak` simulates a server that forgot, so the page must still filter.
    return respond(200, leak ? PEOPLE : PEOPLE.filter(p => p.partner_slug === partner))
  }
  if (key === 'POST /users') return respond(201, { ...u(2, body.name, body.email, body.role, body.partner_slug), id: '00000000-0000-4000-8000-0000000000aa' })
  let m: RegExpMatchArray | null
  if ((m = path.match(/^\/users\/([^/]+)\/subscriptions$/))) {
    if (method === 'PUT') { subs[m[1]] = body; return respond(200, body) }
    return respond(200, subs[m[1]] ?? [])
  }
  if ((m = path.match(/^\/users\/([^/]+)$/)) && method === 'PATCH') return respond(200, { ...PEOPLE.find(p => p.id === m![1])!, ...body })
  if ((m = path.match(/^\/users\/([^/]+)\/(deactivate|reactivate)$/))) {
    const p = PEOPLE.find(x => x.id === m![1])!
    return respond(200, { ...p, status: m[2] === 'deactivate' ? 'deactivated' : 'active', deactivation_reason: m[2] === 'deactivate' ? body.reason : null })
  }
  if (key === 'GET /published/portfolio') {
    const pf = apiPortfolio(partner)
    return respond(200, { ...pf, programs: pf.programs.filter(p => shared.includes(p.program!.slug)) })
  }
  return respond(404, { code: 'not_found', message: path })
}

function renderAt(path: string, role: string) {
  localStorage.setItem(KEY, role)
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
}
const table = () => screen.findByRole('table', { name: 'Team members' })
const names = (t: HTMLElement) => within(t).getAllByRole('row').slice(1).map(r => { const c = within(r).getAllByRole('cell')[0]; return c.textContent!.slice(c.querySelector('.tm-av')!.textContent!.length) })
async function openEdit(name: string) {
  await table()
  await userEvent.click(screen.getByRole('button', { name: `Edit ${name}` }))
  return screen.getByRole('dialog', { name: `Edit ${name}` })
}

beforeAll(async () => { await import('../TeamPage') })
beforeEach(() => {
  calls = []; me = null; leak = false; shared = ['f-pil-2-0', 'move-trust']; subs = {}; fail = {}
  localStorage.clear(); headerStore.clear(); vi.stubGlobal('fetch', vi.fn(fakeFetch))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('Team members: who is listed', () => {
  it('a Company Admin sees only their own partner’s people, asked for with their partner', async () => {
    leak = true // even if the server returned everyone, TAO and Manager people never show
    renderAt('/investor/settings/team', 'investor_admin')
    const t = await table()
    await waitFor(() => expect(names(t)).toEqual(['D. Alvarez', 'M. Chen', 'P. Nguyen']))
    expect(within(t).queryByText(/Patel|Moreau|Novak|Haddad/)).toBeNull()
    const list = calls.find(c => c.method === 'GET' && c.path.startsWith('/users'))!
    expect(list.path).toBe('/users?partner_slug=investor')
    expect(list.headers['X-Role']).toBe('investor_admin')
    expect(list.headers['X-Partner']).toBe('investor')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Team members')
    // Columns: role words, status dot plus word, reports received.
    const row = within(t).getByText('P. Nguyen').closest('tr')!
    expect(within(row).getByText('Viewer')).toBeTruthy()
    expect(within(row).getByText('Deactivated')).toBeTruthy()
    expect(within(row).getByText('Never')).toBeTruthy()
    const chen = within(t).getByText('M. Chen').closest('tr')!
    expect(within(chen).getByText('Company Admin')).toBeTruthy()
    expect(within(chen).getByText('investor.admin@example.com')).toBeTruthy()
    expect(within(chen).getByText('MOVE Trust: all deals')).toBeTruthy()
    // The notes the design asks for.
    const note = screen.getByRole('note', { name: 'How the team works' }).textContent!
    expect(note).toContain('sets notifications only. Every teammate can still open every report')
    expect(note).toContain('always keeps at least one active Company Admin')
    expect(note).toContain('nobody can change their own role')
  })

  it('the Manager Company Admin sees the Manager team', async () => {
    renderAt('/manager/settings/team', 'manager_admin')
    const t = await table()
    await waitFor(() => expect(names(t)).toEqual(['K. Novak', 'L. Haddad']))
    expect(calls.find(c => c.path.startsWith('/users'))!.headers['X-Partner']).toBe('manager')
    expect(screen.getByRole('link', { name: 'Team members' })).toBeTruthy()
  })

  for (const role of ['investor_viewer', 'manager_viewer']) {
    it(`${role} gets the no-access state and no /users call`, async () => {
      renderAt(`/${role.split('_')[0]}/settings/team`, role)
      expect(await screen.findByRole('heading', { name: 'You don’t have access' })).toBeTruthy()
      expect(screen.queryByRole('link', { name: 'Team members' })).toBeNull()
      expect(calls.some(c => c.path.startsWith('/users'))).toBe(false)
    })
  }

  it('the signed-in Company Admin is marked "you" and cannot change their own role or deactivate themselves', async () => {
    me = PEOPLE.find(p => p.name === 'M. Chen')!
    renderAt('/investor/settings/team', 'investor_admin')
    const t = await table()
    await waitFor(() => expect(within(t).getByText(/· you/)).toBeTruthy())
    const d = await openEdit('M. Chen')
    expect((within(d).getByLabelText(/^Role/) as HTMLSelectElement).disabled).toBe(true)
    expect(within(d).getByText('Nobody can change their own role. Ask another Company Admin.')).toBeTruthy()
    expect((within(d).getByRole('button', { name: 'Deactivate user' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('Team members: reports this person receives', () => {
  it('the tree lists only the programs shared with the partner; an unshared subscription drops out on save', async () => {
    shared = ['move-trust']
    const alvarez = PEOPLE.find(p => p.name === 'D. Alvarez')!.id
    subs[alvarez] = [{ program_slug: 'f-pil-2-0', deal_slug: 'f-pil-2-0-stride-capital', channels: ['in_app'] }]
    renderAt('/investor/settings/team', 'investor_admin')
    const d = await openEdit('D. Alvarez')
    const tree = await within(d).findByRole('group', { name: 'Programs shared with Investor' })
    expect(within(tree).getByRole('group', { name: 'MOVE Trust' })).toBeTruthy()
    expect(within(tree).queryByText('F-PIL 2.0')).toBeNull()
    expect(within(tree).queryByText(/Stride/)).toBeNull()
    const move = within(tree).getByRole('group', { name: 'MOVE Trust' })
    expect(within(move).getByText(`0 of ${MOVE_DEALS.length} deals`)).toBeTruthy()
    expect(within(move).getAllByRole('checkbox', { name: /./ }).length).toBeGreaterThan(MOVE_DEALS.length)
    // Email is not offered yet.
    expect(within(move).getByText('Coming later')).toBeTruthy()
    await userEvent.click(within(move).getByRole('checkbox', { name: 'All deals in this program, including new ones' }))
    expect(within(move).getByText(`${MOVE_DEALS.length} of ${MOVE_DEALS.length} deals`)).toBeTruthy()
    // With All on, each deal shows ticked and locked.
    const deal = within(move).getByRole('checkbox', { name: MOVE_DEALS[0].deal_name }) as HTMLInputElement
    expect(deal.checked && deal.disabled).toBe(true)
    await userEvent.click(within(d).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const put = calls.find(c => c.method === 'PUT')!
    expect(put.path).toBe(`/users/${alvarez}/subscriptions`)
    expect(put.body).toEqual([{ program_slug: 'move-trust', deal_slug: null, channels: ['in_app'] }])
    expect(calls.some(c => c.method === 'PATCH')).toBe(false)
    expect(d.textContent).toContain('“Receives” sets notifications only.')
  })

  it('per-deal ticks save as deal entries; the program box is mixed', async () => {
    renderAt('/investor/settings/team', 'investor_admin')
    const d = await openEdit('D. Alvarez')
    const tree = await within(d).findByRole('group', { name: 'Programs shared with Investor' })
    expect(within(tree).getByRole('group', { name: 'F-PIL 2.0' })).toBeTruthy()
    const fpil = within(tree).getByRole('group', { name: 'F-PIL 2.0' })
    await userEvent.click(within(fpil).getByRole('checkbox', { name: 'F-PIL 2.0 - Stride Capital' }))
    expect(within(fpil).getByText('1 of 3 deals')).toBeTruthy()
    expect((within(fpil).getByRole('checkbox', { name: 'F-PIL 2.0' }) as HTMLInputElement).indeterminate).toBe(true)
    await userEvent.click(within(d).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(calls.some(c => c.method === 'PUT')).toBe(true))
    expect(calls.find(c => c.method === 'PUT')!.body).toEqual([{ program_slug: 'f-pil-2-0', deal_slug: 'f-pil-2-0-stride-capital', channels: ['in_app'] }])
  })

  it('subscription mapping: a program entry wins; unknown deals and programs drop out', () => {
    const progs = [{ slug: 'p', name: 'P', deals: [{ slug: 'a', name: 'A' }, { slug: 'b', name: 'B' }] }]
    const picks = toPicks([
      { program_slug: 'p', deal_slug: 'a', channels: ['in_app'] }, { program_slug: 'p', deal_slug: 'gone', channels: ['in_app'] },
      { program_slug: 'q', deal_slug: null, channels: ['in_app'] },
    ], progs)
    expect(picks).toEqual({ p: { all: false, deals: ['a'] } })
    expect(toPicks([{ program_slug: 'p', deal_slug: null, channels: ['in_app'] }, { program_slug: 'p', deal_slug: 'a', channels: ['in_app'] }], progs)).toEqual({ p: { all: true, deals: [] } })
    expect(toSubscriptions({ p: { all: false, deals: ['b', 'a'] } }, progs)).toEqual([
      { program_slug: 'p', deal_slug: 'a', channels: ['in_app'] }, { program_slug: 'p', deal_slug: 'b', channels: ['in_app'] }])
  })
})

describe('Team members: changes and their errors', () => {
  it('making the last Company Admin a Viewer shows the last_admin message and keeps the drawer open', async () => {
    fail['PATCH /users/00000000-0000-4000-8000-000000000005'] = { status: 409, code: 'last_admin' }
    renderAt('/investor/settings/team', 'investor_admin')
    const d = await openEdit('M. Chen')
    const roleSel = within(d).getByLabelText(/^Role/) as HTMLSelectElement
    expect([...roleSel.options].map(o => o.textContent)).toEqual(['Company Admin', 'Viewer'])
    await userEvent.selectOptions(roleSel, 'investor_viewer')
    await userEvent.click(within(d).getByRole('button', { name: 'Save changes' }))
    expect((await within(d).findByRole('alert')).textContent).toBe('Investor must keep at least one active Company Admin. Make someone else a Company Admin first.')
    expect(calls.find(c => c.method === 'PATCH')!.body).toEqual({ role: 'investor_viewer' })
    expect(screen.getByRole('dialog', { name: 'Edit M. Chen' })).toBeTruthy()
  })

  it('deactivating yourself in role-only mode shows the server’s self_change message', async () => {
    fail['POST /users/00000000-0000-4000-8000-000000000005/deactivate'] = { status: 409, code: 'self_change' }
    renderAt('/investor/settings/team', 'investor_admin')
    const d = await openEdit('M. Chen')
    await userEvent.click(within(d).getByRole('button', { name: 'Deactivate user' }))
    const confirm = within(d).getByRole('button', { name: 'Confirm deactivate' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true) // a reason is required
    await userEvent.type(within(d).getByLabelText(/^Reason for deactivating/), 'testing')
    await userEvent.click(confirm)
    expect((await within(d).findByRole('alert')).textContent).toBe('You can’t change your own role or deactivate yourself. Ask another Company Admin.')
  })

  it('deactivate and reactivate send the reason; there is no delete', async () => {
    renderAt('/investor/settings/team', 'investor_admin')
    const d = await openEdit('D. Alvarez')
    expect(within(d).queryByRole('button', { name: /delete|remove/i })).toBeNull()
    await userEvent.click(within(d).getByRole('button', { name: 'Deactivate user' }))
    await userEvent.type(within(d).getByLabelText(/^Reason for deactivating/), 'left the fund')
    await userEvent.click(within(d).getByRole('button', { name: 'Confirm deactivate' }))
    await within(d).findByRole('button', { name: 'Reactivate user' })
    expect(calls.find(c => c.path.endsWith('/deactivate'))!.body).toEqual({ reason: 'left the fund' })
    expect(within(d).getByText('Deactivated')).toBeTruthy()
  })

  it('Add user: offers only Company Admin or Viewer at the partner, shows email_taken, then succeeds', async () => {
    fail['POST /users'] = { status: 409, code: 'email_taken' }
    renderAt('/investor/settings/team', 'investor_admin')
    await table()
    await userEvent.click(screen.getByRole('button', { name: 'Add user' }))
    const d = screen.getByRole('dialog', { name: 'Add user' })
    expect([...(within(d).getByLabelText(/^Role/) as HTMLSelectElement).options].map(o => o.value)).toEqual(['investor_admin', 'investor_viewer'])
    expect(within(d).getByText('(coming later)')).toBeTruthy()
    await userEvent.type(within(d).getByLabelText(/^Full name/), 'H. Berg')
    await userEvent.type(within(d).getByLabelText(/^Email/), 'h.berg@example.com')
    await userEvent.click(within(d).getByRole('button', { name: 'Add user' }))
    expect((await within(d).findByRole('alert')).textContent).toBe('That email is already used by another account.')
    delete fail['POST /users']
    await userEvent.click(within(d).getByRole('button', { name: 'Add user' }))
    await screen.findByRole('dialog', { name: 'Edit H. Berg' })
    expect(calls.find(c => c.method === 'POST' && c.path === '/users' && !fail['POST /users'])!.body).toEqual(
      { name: 'H. Berg', email: 'h.berg@example.com', role: 'investor_viewer', partner_slug: 'investor' })
  })

  it('Invite opens the same form and says the email is coming later', async () => {
    renderAt('/investor/settings/team', 'investor_admin')
    await table()
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }))
    const d = screen.getByRole('dialog', { name: 'Invite teammate' })
    expect(d.textContent).toContain('Invite emails are coming later')
    expect(within(d).getByRole('button', { name: 'Add and invite' })).toBeTruthy()
  })
})
