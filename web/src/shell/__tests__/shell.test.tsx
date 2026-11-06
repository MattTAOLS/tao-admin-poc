// @vitest-environment jsdom
import '@/design/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { App, routeCrumbs } from '../App'
import { KEY } from '../roles'
import { ADMIN_PAGES, PARTNER_PAGES, type Page } from '../pages'
import { usePageHeader, headerStore } from '../header'
import { sessionStore } from '../session'
import { Button } from '@/design/components'
import { mockApi, ME } from './mockApi'

function Where() { const l = useLocation(); return <output data-testid="where">{l.pathname}</output> }
function renderAt(path: string, role?: string) {
  if (role) localStorage.setItem(KEY, role); else localStorage.removeItem(KEY)
  return render(<MemoryRouter initialEntries={[path]}><App /><Where /></MemoryRouter>)
}
const where = () => screen.getByTestId('where').textContent

// The shell reads GET /me in every mode (wave D, Me.features). No API here unless a test sets one: /me is 404.
beforeEach(() => { localStorage.clear(); headerStore.clear(); sessionStore.reset(); mockApi({}) })
afterEach(() => { vi.unstubAllGlobals() })

describe('shell routing', () => {
  it('sends / to the role home', () => {
    renderAt('/')
    expect(where()).toBe('/admin')
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeTruthy()
  })
  it('groups nav into Workspace and Account', () => {
    renderAt('/admin')
    const ws = screen.getByRole('navigation', { name: 'Workspace' })
    const acc = screen.getByRole('navigation', { name: 'Account' })
    expect(within(ws).getByRole('link', { name: 'Uploads' })).toBeTruthy()
    expect(within(acc).getByRole('link', { name: 'Profile' })).toBeTruthy()
    expect(within(ws).getByRole('link', { name: 'Dashboard' }).className).toContain('active')
    expect(within(acc).getByRole('link', { name: 'Audit log' }).getAttribute('href')).toBe('/admin/settings/users/audit')
  })
  it('hides admin-only nav from analysts and shows No access on direct visit', () => {
    renderAt('/admin/settings/system', 'tao_analyst')
    const acc = screen.getByRole('navigation', { name: 'Account' })
    expect(within(acc).queryByRole('link', { name: 'System settings' })).toBeNull()
    expect(within(acc).queryByRole('link', { name: 'User management' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'You don’t have access' })).toBeTruthy()
  })
  it('lets analysts reach master data and the audit log (Reports tab, decision A4) from the sidebar', () => {
    renderAt('/admin/settings/users/audit', 'tao_analyst')
    expect(screen.getByRole('link', { name: 'Partners' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'You don’t have access' })).toBeNull()
    expect(within(screen.getByRole('navigation', { name: 'Account' })).getByRole('link', { name: 'Audit log' }).getAttribute('href')).toBe('/admin/settings/users/audit')
  })
  it('registers the nested portfolio routes in the admin shell', () => {
    for (const p of ['/admin/portfolio/:programId', '/admin/portfolio/:programId/dashboard', '/admin/portfolio/:programId/deals/:dealId']) {
      const e = ADMIN_PAGES.find(x => x.path === p)
      expect(e?.owner).toBe('portfolio'); expect(e?.nav).toBeUndefined(); expect(typeof e?.load).toBe('function')
    }
    const c = routeCrumbs(ADMIN_PAGES, '/admin/portfolio/move-trust/deals/move-trust-vcc-iv-lp', 'TAO Admin')
    expect(c.map(x => x.label)).toEqual(['TAO Admin', 'Portfolio Executive Summary', 'Program Executive Summary', 'Deal page'])
  })
  it('lists the Approval queue right after Uploads and highlights only the most specific item', () => {
    renderAt('/admin/uploads/queue/abc')
    const ws = screen.getByRole('navigation', { name: 'Workspace' })
    const names = within(ws).getAllByRole('link').map(a => a.textContent)
    expect(names.indexOf('Approval queue')).toBe(names.indexOf('Uploads') + 1)
    expect(within(ws).getByRole('link', { name: 'Approval queue' }).getAttribute('aria-current')).toBe('page')
    expect(within(ws).getByRole('link', { name: 'Uploads' }).className).not.toContain('active')
  })
  it('keeps Uploads active on its other subpages', () => {
    renderAt('/admin/uploads/history')
    const ws = screen.getByRole('navigation', { name: 'Workspace' })
    expect(within(ws).getByRole('link', { name: 'Uploads' }).className).toContain('active')
    expect(within(ws).getByRole('link', { name: 'Approval queue' }).className).not.toContain('active')
  })
  it('shows Not found with a way home for an unknown path', async () => {
    renderAt('/admin/nope')
    expect(screen.getByRole('heading', { level: 2, name: 'Page not found' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Go to home' }))
    expect(where()).toBe('/admin')
  })
  it('keeps a partner role out of other shells', () => {
    renderAt('/admin/uploads', 'investor_viewer')
    expect(where()).toBe('/investor/portfolio')
    expect(screen.getByRole('heading', { level: 1, name: 'Portfolio Executive Summary' })).toBeTruthy()
  })
  it('redirects the partner shell root to the portfolio summary', () => {
    renderAt('/manager', 'manager_admin')
    expect(where()).toBe('/manager/portfolio')
  })
  it('breadcrumb on the shell root is the shell title and the page', () => {
    expect(routeCrumbs(ADMIN_PAGES, '/admin', 'TAO Admin').map(x => x.label)).toEqual(['TAO Admin', 'Dashboard'])
  })
  it('builds a breadcrumb from the registry with real URL prefixes', () => {
    const c = routeCrumbs(ADMIN_PAGES, '/admin/uploads/queue/123', 'TAO Admin')
    expect(c.map(x => x.label)).toEqual(['TAO Admin', 'Uploads', 'Approval queue', 'Review report'])
    expect(c.map(x => x.href)).toEqual([undefined, '/admin/uploads', '/admin/uploads/queue', '/admin/uploads/queue/123'])
  })
})

describe('role switcher (sidebar user card)', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 }))) })
  afterEach(() => { vi.unstubAllGlobals() })
  it('opens with the keyboard, moves with arrows, picks with Enter and changes shell', async () => {
    renderAt('/admin')
    const btn = screen.getByTestId('role-switcher')
    expect(btn.textContent).toContain('TAO Admin')
    btn.focus(); await userEvent.keyboard('{ArrowUp}')
    const menu = screen.getByRole('menu')
    const opts = within(menu).getAllByRole('menuitemradio')
    expect(opts.length).toBe(8) // seeded users, two per TAO role and one per partner role
    expect(document.activeElement).toBe(opts[0])
    expect(opts[0].getAttribute('aria-checked')).toBe('false') // role-only: no user is signed in yet
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}') // D. Alvarez, investor_viewer
    expect(screen.queryByRole('menu')).toBeNull()
    expect(localStorage.getItem(KEY)).toBe('investor_viewer')
    expect(where()).toBe('/investor/portfolio')
    expect(screen.getByTestId('role-switcher').textContent).toContain('Investor · Viewer')
  })
  it('Escape closes and returns focus to the card', async () => {
    renderAt('/admin')
    const btn = screen.getByTestId('role-switcher')
    await userEvent.click(btn)
    expect(screen.getByRole('menu')).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(btn)
  })
})

describe('usePageHeader', () => {
  it('lets a page set the top bar title, status and actions, and clears on unmount', () => {
    function Fake() { usePageHeader({ title: 'F-PIL 2.0 - Moneda Capital Corp.', actions: <Button variant="primary">Publish</Button> }); return <p>page body</p> }
    const { unmount } = render(<MemoryRouter><Fake /></MemoryRouter>)
    expect(headerStore.get().title).toBe('F-PIL 2.0 - Moneda Capital Corp.')
    act(() => unmount())
    expect(headerStore.get().title).toBeUndefined()
  })
})

describe('page registration', () => {
  it('renders a registered page lazily, with the route progress bar while it loads', async () => {
    const entry = ADMIN_PAGES.find(p => p.path === '/admin/uploads')!
    let resolve!: (m: { default: () => JSX.Element }) => void
    entry.load = () => new Promise(r => { resolve = r })
    try {
      renderAt('/admin/uploads')
      expect(screen.getByRole('progressbar', { name: 'Loading page' })).toBeTruthy()
      await act(async () => { resolve({ default: () => <p>Uploads page body</p> }) })
      expect(await screen.findByText('Uploads page body')).toBeTruthy()
      expect(screen.queryByRole('progressbar')).toBeNull()
    } finally { delete entry.load }
  })
})

describe('companies (wave D)', () => {
  const NAV_ORDER_TAO = ['Dashboard', 'Uploads', 'Approval queue', 'Reports library', 'Partners', 'Portfolio Executive Summary', 'Companies', 'Notifications', 'Help & support']
  const fake = (name: string) => () => Promise.resolve({ default: () => <p>{name} body</p> })
  const entries = (pages: Page[], paths: string[]) => paths.map(p => pages.find(x => x.path === p)!)
  let saved: [Page, Page['load']][] = []
  beforeEach(() => {
    // UI-Partner's page files may not be merged yet: render stand-ins.
    const all = [...entries(ADMIN_PAGES, ['/admin/companies', '/admin/companies/:companySlug']), ...entries(PARTNER_PAGES, ['/companies', '/companies/:companySlug'])]
    saved = all.map(e => [e, e.load])
    for (const e of all) e.load = fake(e.title)
  })
  afterEach(() => { for (const [e, l] of saved) e.load = l })
  const meFor = (role: string, partner: string | null, companies: boolean) => ({ 'GET /me': ME({ user: null, role, partner_slug: partner, features: { companies } }) })

  it('registers the four routes against the UI-Partner page files', () => {
    const [list, profile] = entries(ADMIN_PAGES, ['/admin/companies', '/admin/companies/:companySlug'])
    expect(list).toMatchObject({ title: 'Companies', nav: 'main', roles: ['tao_admin', 'tao_analyst'], owner: 'portfolio', built: true })
    expect(profile).toMatchObject({ title: 'Company profile', roles: ['tao_admin', 'tao_analyst'], owner: 'portfolio', built: true })
    expect(profile.nav).toBeUndefined()
    const [plist, pprofile] = entries(PARTNER_PAGES, ['/companies', '/companies/:companySlug'])
    expect(plist).toMatchObject({ title: 'Companies', nav: 'main', feature: 'companies', owner: 'portfolio', built: true })
    expect(pprofile).toMatchObject({ title: 'Company profile', feature: 'companies', owner: 'portfolio', built: true })
    expect(pprofile.nav).toBeUndefined()
    expect(routeCrumbs(ADMIN_PAGES, '/admin/companies/tlfc', 'TAO Admin').map(c => [c.label, c.href])).toEqual([
      ['TAO Admin', undefined], ['Companies', '/admin/companies'], ['Company profile', '/admin/companies/tlfc']])
  })
  it('puts Companies right after Portfolio Executive Summary for both TAO roles, whatever /me says', async () => {
    for (const role of ['tao_admin', 'tao_analyst']) {
      const { unmount } = renderAt('/admin/companies', role)
      const ws = screen.getByRole('navigation', { name: 'Workspace' })
      expect(within(ws).getAllByRole('link').map(a => a.textContent)).toEqual(NAV_ORDER_TAO)
      expect(within(ws).getByRole('link', { name: 'Companies' }).getAttribute('aria-current')).toBe('page')
      expect(await screen.findByText('Companies body')).toBeTruthy()
      unmount()
    }
  })
  it('keeps Companies active on a company profile and names it in the breadcrumb', async () => {
    renderAt('/admin/companies/tlfc', 'tao_analyst')
    expect(await screen.findByText('Company profile body')).toBeTruthy()
    const ws = screen.getByRole('navigation', { name: 'Workspace' })
    expect(within(ws).getByRole('link', { name: 'Companies' }).className).toContain('active')
    expect(screen.getByRole('heading', { level: 1, name: 'Company profile' })).toBeTruthy()
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'Companies' }).getAttribute('href')).toBe('/admin/companies')
  })
  it('shows partners Companies after Portfolio Executive Summary when Me.features.companies is true (role-only, no X-User)', async () => {
    const calls = mockApi(meFor('investor_viewer', 'investor', true))
    renderAt('/investor/companies/tlfc', 'investor_viewer')
    expect(await screen.findByText('Company profile body')).toBeTruthy()
    const ws = screen.getByRole('navigation', { name: 'Workspace' })
    const names = within(ws).getAllByRole('link').map(a => a.textContent)
    expect(names.indexOf('Companies')).toBe(names.indexOf('Portfolio Executive Summary') + 1)
    expect(within(ws).getByRole('link', { name: 'Companies' }).getAttribute('href')).toBe('/investor/companies')
    expect(calls[0]).toMatchObject({ path: '/me', headers: { 'X-Role': 'investor_viewer', 'X-Partner': 'investor' } })
    expect(calls[0].headers['X-User']).toBeUndefined()
  })
  it('hides Companies from partners while it is off, and a direct visit reads Page not found', async () => {
    mockApi(meFor('manager_admin', 'manager', false))
    renderAt('/manager/companies/tlfc', 'manager_admin')
    expect(await screen.findByRole('heading', { level: 2, name: 'Page not found' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy()
    expect(screen.queryByText('Company profile body')).toBeNull()
    expect(within(screen.getByRole('navigation', { name: 'Workspace' })).queryByRole('link', { name: 'Companies' })).toBeNull()
  })
  it('fails closed for partners when /me fails (older API), and waits for /me before deciding', async () => {
    let answer!: (r: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r => { answer = r })))
    renderAt('/investor/companies', 'investor_admin')
    expect(screen.getByRole('progressbar', { name: 'Loading page' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Companies' })).toBeNull()
    await act(async () => { answer(new Response('{}', { status: 404 })) })
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Page not found' })).toBeTruthy())
    expect(screen.queryByText('Companies body')).toBeNull()
  })
  it('reads /me again after signing in as a user of another shell, and the nav follows', async () => {
    mockApi(meFor('investor_viewer', 'investor', true))
    renderAt('/investor/portfolio', 'investor_viewer')
    expect(await screen.findByRole('link', { name: 'Companies' })).toBeTruthy()
    const calls = mockApi({ 'GET /me': ME(), 'GET /notifications/unread-count': { total: 0, mentions: 0, reports: 0, system: 0 } })
    await userEvent.click(screen.getByTestId('role-switcher'))
    await userEvent.click(screen.getByRole('menuitemradio', { name: /A\. Patel/ }))
    expect(where()).toBe('/admin')
    await waitFor(() => expect(sessionStore.get().mode).toBe('user'))
    expect(calls.find(c => c.path === '/me')!.headers['X-User']).toBeTruthy()
    expect(within(screen.getByRole('navigation', { name: 'Workspace' })).getByRole('link', { name: 'Companies' }).getAttribute('href')).toBe('/admin/companies')
  })
})
