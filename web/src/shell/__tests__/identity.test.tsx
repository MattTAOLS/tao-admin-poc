// @vitest-environment jsdom
/** Audit M17: switching user inside the same portal remounts the page content, so lists and follow state are read again
 * for the new person. Audit L26: a role or user switch in another browser tab is taken over by this tab. */
import '@/design/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { App, identityKey } from '../App'
import { KEY, USER_KEY, loadRole } from '../roles'
import { headerStore } from '../header'
import { sessionStore } from '../session'
import { refreshUnread } from '../api'
import { mockApi, ME, PARTNER_ME, type Call } from './mockApi'

const U1 = '00000000-0000-4000-8000-000000000001'   // A. Patel, tao_admin
const U2 = '00000000-0000-4000-8000-000000000002'   // R. Okafor, tao_admin
const U6 = '00000000-0000-4000-8000-000000000006'   // D. Alvarez, investor_viewer

function Where() { const l = useLocation(); return <output data-testid="where">{l.pathname}</output> }
function signIn(role: string, id: string, path: string) {
  localStorage.setItem(KEY, role); localStorage.setItem(USER_KEY, id); sessionStore.reset()
  return render(<MemoryRouter initialEntries={[path]}><App /><Where /></MemoryRouter>)
}

const meFor = (c: Call) => ({
  body: c.headers['X-User'] === U6 ? PARTNER_ME()
    : c.headers['X-User'] === U2 ? ME({ user: { ...ME().user, id: U2, name: 'R. Okafor', email: 'tao.admin2@example.com' }, features: { companies: true } })
    : ME({ features: { companies: true } }),
})
const row = (following: boolean) => ({
  slug: 'acme', name: 'Acme Leasing', deals: [], industry: null, status: null, breach: 0, watch: 0, balance: null,
  delinquency: { min: null, max: null, direction: null }, news_7d: 0, adverse: { state: 'clear', to_review: 0 }, notes: 0, following,
})
const company = (following: boolean) => ({
  slug: 'acme', name: 'Acme Leasing', aliases: [], industry: null, naics: null, headquarters: null, website: null, relationship_since: null,
  relationship_since_source: null, owner: null, deals: [], contacts: [], following, updated_at: '2026-11-01T00:00:00Z',
})
/** U1 follows Acme; U2 does not. */
const routes = () => ({
  'GET /me': meFor,
  'GET /notifications/unread-count': { total: 0, mentions: 0, reports: 0, system: 0 },
  'GET /companies': (c: Call) => ({ body: [row(c.headers['X-User'] === U1)] }),
  'GET /companies/acme': (c: Call) => ({ body: company(c.headers['X-User'] === U1) }),
  'GET /companies/acme/news': [], 'GET /companies/acme/adverse': [], 'GET /companies/acme/notes': [], 'GET /users': [],
})
const pickUser = async (name: RegExp) => {
  await userEvent.click(screen.getByTestId('role-switcher'))
  await userEvent.click(screen.getByRole('menuitemradio', { name }))
}

beforeEach(() => { localStorage.clear(); headerStore.clear(); sessionStore.reset() })
afterEach(() => { vi.unstubAllGlobals() })

describe('identityKey', () => {
  it('changes with role, user and whether calls carry X-User; not when GET /me resolves', () => {
    expect(identityKey('tao_admin', U1, 'pending')).toBe(identityKey('tao_admin', U1, 'user'))
    const keys = [identityKey('tao_admin', U1, 'user'), identityKey('tao_admin', U2, 'user'), identityKey('tao_analyst', U1, 'user'),
      identityKey('tao_admin', U1, 'role-only'), identityKey('tao_admin', null, 'role-only')]
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('switching user inside the same portal (audit M17)', () => {
  it('the Companies list is read again as the new user and the follow star follows', async () => {
    const calls = mockApi(routes())
    signIn('tao_admin', U1, '/admin/companies')
    expect(await screen.findByRole('button', { name: 'Stop following Acme Leasing' }, { timeout: 20_000 })).toBeTruthy()
    await pickUser(/R\. Okafor/)
    expect(await screen.findByRole('button', { name: 'Follow Acme Leasing' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Stop following Acme Leasing' })).toBeNull()
    const lists = calls.filter(c => c.path === '/companies')
    expect(lists.at(-1)!.headers['X-User']).toBe(U2)
    expect(lists.some(c => c.headers['X-User'] === U1)).toBe(true)
    expect(screen.getByTestId('where').textContent).toBe('/admin/companies')
  }, 60_000)

  it('the company profile (record, news, adverse media) is read again and "Following" does not stay', async () => {
    const calls = mockApi(routes())
    signIn('tao_admin', U1, '/admin/companies/acme')
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Following/ }).length).toBeGreaterThan(0), { timeout: 20_000 })
    await pickUser(/R\. Okafor/)
    await waitFor(() => {
      expect(screen.queryAllByRole('button', { name: /Following/ })).toHaveLength(0)
      expect(screen.getAllByRole('button', { name: /Follow/ }).length).toBeGreaterThan(0)
    })
    for (const p of ['/companies/acme', '/companies/acme/news?days=30', '/companies/acme/adverse']) {
      const mine = calls.filter(c => c.path === p)
      expect(mine.some(c => c.headers['X-User'] === U1), p).toBe(true)
      expect(mine.at(-1)!.headers['X-User'], p).toBe(U2)
    }
  }, 60_000)
})

describe('the unread count', () => {
  it('read for one person does not land on the next (same class as M17)', async () => {
    mockApi({ 'GET /notifications/unread-count': { total: 7, mentions: 7, reports: 0, system: 0 } })
    const inner = globalThis.fetch
    let release!: () => void
    const gate = new Promise<void>(res => { release = res })
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => { await gate; return inner(url, init) })
    sessionStore.set({ mode: 'user', userId: U1, unread: null })
    const pending = refreshUnread()
    sessionStore.set({ mode: 'user', userId: U2, unread: null })
    release(); await pending
    expect(sessionStore.get().unread).toBeNull()
    // and for the same person it does land
    await refreshUnread()
    expect(sessionStore.get().unread).toMatchObject({ total: 7 })
  })
})

describe('a switch made in another browser tab (audit L26)', () => {
  const otherTab = (role: string, id: string | null) => {
    localStorage.setItem(KEY, role)
    if (id) localStorage.setItem(USER_KEY, id); else localStorage.removeItem(USER_KEY)
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: id ? USER_KEY : KEY })) })
  }

  it('takes over the new user and role: sidebar, shell, GET /me', async () => {
    const calls = mockApi(routes())
    signIn('tao_admin', U1, '/admin')
    await waitFor(() => expect(screen.getByTestId('role-switcher').textContent).toContain('A. Patel'))
    otherTab('investor_viewer', U6)
    // The shell follows at once, and the previous person's role is never written back over the new one
    expect(screen.getByTestId('where').textContent).toBe('/investor/portfolio')
    expect(localStorage.getItem(KEY)).toBe('investor_viewer')
    await waitFor(() => expect(screen.getByTestId('role-switcher').textContent).toContain('D. Alvarez'))
    expect(screen.getByTestId('role-switcher').textContent).toContain('Investor · Viewer')
    expect(screen.getByTestId('where').textContent).toBe('/investor/portfolio')
    expect(sessionStore.get()).toMatchObject({ mode: 'user', userId: U6 })
    expect(calls.filter(c => c.path === '/me').at(-1)!.headers).toMatchObject({ 'X-User': U6, 'X-Role': 'investor_viewer', 'X-Partner': 'investor' })
  }, 60_000)

  it('same portal, another user: the page content is read again', async () => {
    const calls = mockApi(routes())
    signIn('tao_admin', U1, '/admin/companies')
    expect(await screen.findByRole('button', { name: 'Stop following Acme Leasing' }, { timeout: 20_000 })).toBeTruthy()
    otherTab('tao_admin', U2)
    expect(await screen.findByRole('button', { name: 'Follow Acme Leasing' })).toBeTruthy()
    expect(screen.getByTestId('role-switcher').textContent).toContain('R. Okafor')
    expect(calls.filter(c => c.path === '/companies').at(-1)!.headers['X-User']).toBe(U2)
  }, 60_000)

  it('ignores other storage keys and survives a role that is not a role', async () => {
    const calls = mockApi(routes())
    signIn('tao_admin', U1, '/admin')
    await waitFor(() => expect(sessionStore.get().mode).toBe('user'))
    const before = calls.filter(c => c.path === '/me').length
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'something-else' })) })
    expect(calls.filter(c => c.path === '/me').length).toBe(before)
    localStorage.setItem(KEY, 'not-a-role')
    expect(loadRole()).toBe('tao_admin')
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: KEY })) })
    expect(screen.getByTestId('where').textContent).toBe('/admin')
  }, 60_000)
})
