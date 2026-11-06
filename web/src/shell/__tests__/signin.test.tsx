// @vitest-environment jsdom
import '@/design/test-utils'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { App, UNREAD_POLL_MS } from '../App'
import { KEY, USER_KEY, ROLES, loadRole, saveRole, loadUserId } from '../roles'
import { SEED_USERS } from '../users'
import { itemName } from '../RoleSwitcher'
import { api, roleHeaders, refreshMe } from '../api'
import { sessionStore } from '../session'
import { headerStore } from '../header'
import { mockApi, ME, PARTNER_ME } from './mockApi'

function Where() { const l = useLocation(); return <output data-testid="where">{l.pathname}</output> }
const renderAt = (p: string) => render(<MemoryRouter initialEntries={[p]}><App /><Where /></MemoryRouter>)
const where = () => screen.getByTestId('where').textContent

beforeEach(() => { localStorage.clear(); headerStore.clear(); sessionStore.reset() })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('seeded users', () => {
  it('match seed/users.json exactly', () => {
    const seed = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../seed/users.json'), 'utf8'))
    expect(SEED_USERS).toEqual(seed)
  })
})

describe('Sign in as (POC) menu', () => {
  it('keeps the test id and lists the seeded users grouped by role, with name and role', async () => {
    mockApi({ 'GET /me': { status: 500, body: { code: 'boom', message: 'x' } } })
    renderAt('/admin')
    const btn = screen.getByTestId('role-switcher')
    await userEvent.click(btn)
    const menu = screen.getByRole('menu', { name: 'Sign in as (POC)' })
    expect(within(menu).getByText(/Stands in for real sign-in/)).toBeTruthy()
    const groups = within(menu).getAllByRole('group')
    expect(groups.map(g => g.getAttribute('aria-label'))).toEqual(ROLES.map(r => r.label))
    const items = within(menu).getAllByRole('menuitemradio')
    expect(items.length).toBe(SEED_USERS.length)
    expect(within(groups[0]).getAllByRole('menuitemradio').map(i => i.textContent)).toEqual([
      expect.stringContaining('A. Patel'), expect.stringContaining('R. Okafor')])
    expect(items[0].getAttribute('aria-label')).toBe('A. Patel, TAO Admin (tao_admin)')
    expect(items[0].textContent).toContain('tao.admin@example.com')
  })
  it('keeps each role id in exactly one item’s accessible name, the first user of the role (e2e lib/ui.ts)', async () => {
    renderAt('/admin')
    await userEvent.click(screen.getByTestId('role-switcher'))
    for (const r of ROLES) {
      const re = new RegExp(`(^|[^a-z_])${r.id}([^a-z_]|$)`)
      const hits = screen.getAllByRole('menuitemradio').filter(i => re.test(i.getAttribute('aria-label') ?? ''))
      expect(hits.length, r.id).toBe(1)
      expect(hits[0].getAttribute('aria-label')).toBe(itemName(SEED_USERS.find(u => u.role === r.id)!))
      expect(screen.getByRole('menuitemradio', { name: re })).toBe(hits[0])
    }
  })
  it('signs in as a user: stores id and role, sends X-User with the role headers, and shows name and role', async () => {
    const calls = mockApi({ 'GET /me': PARTNER_ME(), 'GET /notifications/unread-count': { total: 0, mentions: 0, reports: 0, system: 0 } })
    renderAt('/admin')
    await userEvent.click(screen.getByTestId('role-switcher'))
    await userEvent.click(screen.getByRole('menuitemradio', { name: /investor_viewer/ }))
    expect(localStorage.getItem(KEY)).toBe('investor_viewer')
    expect(localStorage.getItem(USER_KEY)).toBe('00000000-0000-4000-8000-000000000006')
    expect(where()).toBe('/investor/portfolio')
    await waitFor(() => expect(sessionStore.get().mode).toBe('user'))
    const me = calls.find(c => c.path === '/me' && c.headers['X-User'])! // the first /me is the role-only one, for Me.features
    expect(me.headers).toMatchObject({ 'X-User': '00000000-0000-4000-8000-000000000006', 'X-Role': 'investor_viewer', 'X-Partner': 'investor' })
    const card = screen.getByTestId('role-switcher')
    expect(card.textContent).toContain('D. Alvarez')
    expect(card.textContent).toContain('Investor · Viewer')
    expect(roleHeaders()).toEqual({ 'X-Role': 'investor_viewer', 'X-Partner': 'investor', 'X-User': '00000000-0000-4000-8000-000000000006' })
  })
  it('keyboard: arrows move across users, Enter picks', async () => {
    mockApi({ 'GET /me': ME() })
    renderAt('/manager/portfolio')
    const btn = screen.getByTestId('role-switcher')
    btn.focus(); await userEvent.keyboard('{ArrowUp}')
    const opts = screen.getAllByRole('menuitemradio')
    expect(document.activeElement).toBe(opts[0])
    await userEvent.keyboard('{ArrowDown}{Enter}') // R. Okafor, TAO Admin
    expect(localStorage.getItem(USER_KEY)).toBe('00000000-0000-4000-8000-000000000002')
    expect(where()).toBe('/admin')
  })
})

describe('role-only fallback', () => {
  it('falls back to role-only when GET /me fails (older API) and stops sending X-User', async () => {
    const calls = mockApi({})
    localStorage.setItem(KEY, 'tao_analyst'); localStorage.setItem(USER_KEY, '00000000-0000-4000-8000-000000000003')
    sessionStore.reset()
    renderAt('/admin')
    await waitFor(() => expect(sessionStore.get().mode).toBe('role-only'))
    expect(sessionStore.get().fallback).toBe('not_found')
    expect(calls[0].headers['X-User']).toBe('00000000-0000-4000-8000-000000000003')
    await api('/uploads').catch(() => {})
    expect(calls.at(-1)!.headers).toEqual({ 'X-Role': 'tao_analyst', 'Content-Type': 'application/json' })
    const card = screen.getByTestId('role-switcher')
    expect(card.textContent).toContain('TAO Analyst')
    expect(card.textContent).toContain('Role only')
    expect(screen.queryByTestId('unread-badge')).toBeNull()
  })
  it('treats an unknown user (401) and a reply without a user the same way', async () => {
    mockApi({ 'GET /me': { status: 401, body: { code: 'unknown_user', message: 'Unknown user' } } })
    localStorage.setItem(USER_KEY, 'nobody')
    await refreshMe()
    expect(sessionStore.get()).toMatchObject({ mode: 'role-only', fallback: 'unknown_user' })
    mockApi({ 'GET /me': ME({ user: null }) })
    await refreshMe()
    expect(sessionStore.get()).toMatchObject({ mode: 'role-only', fallback: 'no_user' })
  })
  it('without a stored user reads /me with the phase 1 headers only (wave D: for Me.features) and stays role-only', async () => {
    const calls = mockApi({ 'GET /me': ME({ user: null, role: 'manager_admin', partner_slug: 'manager', features: { companies: true } }) })
    localStorage.setItem(KEY, 'manager_admin')
    await refreshMe()
    expect(calls.map(c => c.path)).toEqual(['/me'])
    expect(calls[0].headers).toEqual({ 'X-Role': 'manager_admin', 'X-Partner': 'manager', 'Content-Type': 'application/json' })
    expect(sessionStore.get()).toMatchObject({ mode: 'role-only', me: null, features: { companies: true } })
    expect(roleHeaders()).toEqual({ 'X-Role': 'manager_admin', 'X-Partner': 'manager' })
  })
  it('loadRole / saveRole still work; saving another role clears a user of a different role', () => {
    localStorage.setItem(USER_KEY, '00000000-0000-4000-8000-000000000001'); localStorage.setItem(KEY, 'tao_admin')
    saveRole('tao_admin', 'tao_admin')
    expect(loadUserId()).toBe('00000000-0000-4000-8000-000000000001')
    saveRole('investor_admin')
    expect(loadRole()).toBe('investor_admin')
    expect(loadUserId()).toBeNull()
  })
})

describe('notification bell', () => {
  it('shows the unread count on Notifications, refreshes on navigation and every 60 s', async () => {
    let total = 3
    const calls = mockApi({ 'GET /me': ME(), 'GET /notifications/unread-count': () => ({ body: { total, mentions: 1, reports: 2, system: 0 } }) })
    localStorage.setItem(KEY, 'tao_admin'); localStorage.setItem(USER_KEY, '00000000-0000-4000-8000-000000000001')
    sessionStore.reset()
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    renderAt('/admin')
    const link = await screen.findByRole('link', { name: /^Notifications/ })
    await waitFor(() => expect(within(link).getByTestId('unread-badge').textContent).toContain('3'))
    expect(link.textContent).toContain('3 unread')
    const count = () => calls.filter(c => c.path === '/notifications/unread-count').length
    const before = count()
    await userEvent.click(screen.getByRole('link', { name: 'Uploads' }))
    await waitFor(() => expect(count()).toBeGreaterThan(before))
    total = 5
    const mid = count()
    await act(async () => { vi.advanceTimersByTime(UNREAD_POLL_MS) })
    await waitFor(() => expect(count()).toBe(mid + 1))
    await waitFor(() => expect(screen.getByTestId('unread-badge').textContent).toContain('5'))
    expect(UNREAD_POLL_MS).toBe(60_000)
  })
  it('shows no badge in role-only mode and makes no count call', async () => {
    const calls = mockApi({})
    renderAt('/admin')
    expect(screen.getByRole('link', { name: 'Notifications' })).toBeTruthy()
    expect(screen.queryByTestId('unread-badge')).toBeNull()
    expect(calls.some(c => c.path.startsWith('/notifications'))).toBe(false)
  })
})
