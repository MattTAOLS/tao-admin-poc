// @vitest-environment jsdom
/** Notifications inbox, bug audit: L19 (a slow tab's answer never lands on the tab selected after it), L22 ("Show older"
 * pages with the contract's offset), M19 UI half (links get the portal prefix; never a page the role cannot open). */
import '@/design/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { App } from '@/shell/App'
import { KEY, USER_KEY } from '@/shell/roles'
import { sessionStore } from '@/shell/session'
import { headerStore } from '@/shell/header'
import { mockApi, ME, PARTNER_ME, type Call } from '@/shell/__tests__/mockApi'
import { notificationTarget } from '../common'
import { PAGE_SIZE } from '../NotificationsPage'

function Where() { const l = useLocation(); return <output data-testid="where">{l.pathname + l.search}</output> }
function signIn(role: string, id: string, path: string) {
  localStorage.setItem(KEY, role); localStorage.setItem(USER_KEY, id); sessionStore.reset()
  return render(<MemoryRouter initialEntries={[path]}><App /><Where /></MemoryRouter>)
}
const TAO_ID = '00000000-0000-4000-8000-000000000001'
const ANALYST_ID = '00000000-0000-4000-8000-000000000003'
const PARTNER_ID = '00000000-0000-4000-8000-000000000006'
const UNREAD = { total: 0, mentions: 0, reports: 0, system: 0 }
const note = (id: string, kind: string, title: string, link = '/admin/reports', read = true) =>
  ({ id, kind, title, body: null, link, created_at: '2026-11-03T21:20:00Z', read_at: read ? '2026-11-03T22:00:00Z' : null })
const titles = () => screen.queryAllByTestId('notification').map(r => r.querySelector('h4')!.textContent)

beforeEach(() => { localStorage.clear(); headerStore.clear() })
afterEach(() => { vi.unstubAllGlobals() })

describe('tab race (audit L19)', () => {
  it('the answer for a tab left behind does not replace the tab now selected', async () => {
    mockApi({
      'GET /me': ME(), 'GET /notifications/unread-count': UNREAD,
      'GET /notifications': (c: Call) => ({
        body: c.path.includes('tab=mentions') ? [note('m1', 'mention', 'A mention')]
          : c.path.includes('tab=reports') ? [note('r1', 'report_published', 'A report')]
          : [note('m1', 'mention', 'A mention'), note('r1', 'report_published', 'A report')],
      }),
    })
    // Hold the Mentions answer until the test lets it go.
    const inner = globalThis.fetch
    let release!: () => void
    const gate = new Promise<void>(res => { release = res })
    let heldAnswered = false
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (String(url).includes('tab=mentions')) { await gate; const r = await inner(url, init); heldAnswered = true; return r }
      return inner(url, init)
    })
    signIn('tao_admin', TAO_ID, '/admin/notifications')
    await waitFor(() => expect(titles()).toEqual(['A mention', 'A report']), { timeout: 20_000 })
    await userEvent.click(screen.getByRole('tab', { name: /^Mentions/ }))
    await userEvent.click(screen.getByRole('tab', { name: /^Reports/ }))
    await waitFor(() => expect(titles()).toEqual(['A report']))
    release()
    await waitFor(() => expect(heldAnswered).toBe(true))
    await new Promise(res => setTimeout(res, 20))
    expect(screen.getByRole('tab', { name: /^Reports/ }).getAttribute('aria-selected')).toBe('true')
    expect(titles()).toEqual(['A report'])
  }, 60_000)
})

describe('paging (audit L22)', () => {
  it('a full page offers "Show older", which asks for the next page with offset and adds it underneath', async () => {
    const first = Array.from({ length: PAGE_SIZE }, (_, i) => note(`n${i}`, 'system', `Notice ${i}`))
    const older = [note('o1', 'system', 'Older 1'), note('o2', 'system', 'Older 2'), note(`n${PAGE_SIZE - 1}`, 'system', 'Seen twice')]
    const calls = mockApi({
      'GET /me': ME(), 'GET /notifications/unread-count': UNREAD,
      'GET /notifications': (c: Call) => ({ body: c.path.includes('offset=') ? older : first }),
    })
    signIn('tao_admin', TAO_ID, '/admin/notifications')
    await waitFor(() => expect(screen.getAllByTestId('notification')).toHaveLength(PAGE_SIZE), { timeout: 20_000 })
    expect(calls.find(c => c.path.startsWith('/notifications?'))!.path).toBe(`/notifications?tab=all&limit=${PAGE_SIZE}`)
    await userEvent.click(screen.getByRole('button', { name: 'Show older' }))
    // the row the two pages share is listed once
    await waitFor(() => expect(screen.getAllByTestId('notification')).toHaveLength(PAGE_SIZE + 2))
    expect(calls.at(-1)!.path).toBe(`/notifications?tab=all&limit=${PAGE_SIZE}&offset=${PAGE_SIZE}`)
    expect(titles().slice(-2)).toEqual(['Older 1', 'Older 2'])
    // a short page is the end
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull()
  }, 60_000)

  it('a short first page has no "Show older"', async () => {
    mockApi({ 'GET /me': ME(), 'GET /notifications/unread-count': UNREAD, 'GET /notifications': [note('a', 'system', 'Only one')] })
    signIn('tao_admin', TAO_ID, '/admin/notifications')
    await waitFor(() => expect(titles()).toEqual(['Only one']), { timeout: 20_000 })
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull()
  }, 60_000)
})

describe('where Open goes (audit M19, UI half)', () => {
  it('adds the portal prefix to a link without one', () => {
    expect(notificationTarget('/settings/profile', 'investor', 'investor_viewer')).toBe('/investor/settings/profile')
    expect(notificationTarget('/settings/profile', 'manager', 'manager_admin')).toBe('/manager/settings/profile')
    expect(notificationTarget('/settings/profile', 'admin', 'tao_admin')).toBe('/admin/settings/profile')
    expect(notificationTarget('/portfolio/f-pil-2-0/deals/x?period=2026-08', 'investor', 'investor_viewer')).toBe('/investor/portfolio/f-pil-2-0/deals/x?period=2026-08')
  })
  it('keeps a link the role can open, query and all', () => {
    expect(notificationTarget('/admin/uploads/queue/abc?thread=t1', 'admin', 'tao_analyst')).toBe('/admin/uploads/queue/abc?thread=t1')
    expect(notificationTarget('/admin/settings/users', 'admin', 'tao_admin')).toBe('/admin/settings/users')
    expect(notificationTarget('/investor/settings/team', 'investor', 'investor_admin')).toBe('/investor/settings/team')
    expect(notificationTarget('/admin/companies/acme?note=n1', 'admin', 'tao_analyst')).toBe('/admin/companies/acme?note=n1')
  })
  it('sends the person to their profile instead of a page the role cannot open, or one that does not exist here', () => {
    expect(notificationTarget('/admin/settings/users', 'admin', 'tao_analyst')).toBe('/admin/settings/profile')
    expect(notificationTarget('/settings/team', 'investor', 'investor_viewer')).toBe('/investor/settings/profile')
    expect(notificationTarget('/admin/reports', 'investor', 'investor_viewer')).toBe('/investor/settings/profile')
    expect(notificationTarget('/nowhere', 'manager', 'manager_admin')).toBe('/manager/settings/profile')
    expect(notificationTarget('/companies/acme', 'investor', 'investor_viewer', { companies: false })).toBe('/investor/settings/profile')
    expect(notificationTarget('/companies/acme', 'investor', 'investor_viewer', { companies: true })).toBe('/investor/companies/acme')
  })
  it('never leaves the app', () => {
    for (const l of ['https://example.com/x', '//example.com/x', 'settings/profile', '', null, undefined]) {
      expect(notificationTarget(l, 'admin', 'tao_admin')).toBe('/admin/settings/profile')
    }
  })

  it('a partner account notification with a bare link opens the partner profile', async () => {
    mockApi({ 'GET /me': PARTNER_ME(), 'GET /notifications/unread-count': UNREAD, 'GET /notifications': [note('u1', 'user_change', 'Your role changed', '/settings/profile')] })
    signIn('investor_viewer', PARTNER_ID, '/investor/notifications')
    await userEvent.click(await screen.findByRole('button', { name: 'Open: Your role changed' }, { timeout: 20_000 }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/investor/settings/profile'))
  }, 60_000)

  it('an analyst is not sent to the admin-only User management page', async () => {
    const analyst = ME({ user: { ...ME().user, id: ANALYST_ID, name: 'J. Moreau', role: 'tao_analyst' }, role: 'tao_analyst' })
    mockApi({ 'GET /me': analyst, 'GET /notifications/unread-count': UNREAD, 'GET /notifications': [note('u1', 'user_change', 'A user was added', '/admin/settings/users')] })
    signIn('tao_analyst', ANALYST_ID, '/admin/notifications')
    await userEvent.click(await screen.findByRole('button', { name: 'Open: A user was added' }, { timeout: 20_000 }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/admin/settings/profile'))
  }, 60_000)
})
