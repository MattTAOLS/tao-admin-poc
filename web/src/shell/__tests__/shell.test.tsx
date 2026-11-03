// @vitest-environment jsdom
import '@/design/test-utils'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { App, routeCrumbs } from '../App'
import { KEY } from '../roles'
import { ADMIN_PAGES } from '../pages'
import { usePageHeader, headerStore } from '../header'
import { Button } from '@/design/components'

function Where() { const l = useLocation(); return <output data-testid="where">{l.pathname}</output> }
function renderAt(path: string, role?: string) {
  if (role) localStorage.setItem(KEY, role); else localStorage.removeItem(KEY)
  return render(<MemoryRouter initialEntries={[path]}><App /><Where /></MemoryRouter>)
}
const where = () => screen.getByTestId('where').textContent

beforeEach(() => { localStorage.clear(); headerStore.clear() })

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
  })
  it('hides admin-only nav from analysts and shows No access on direct visit', () => {
    renderAt('/admin/settings/users/audit', 'tao_analyst')
    const acc = screen.getByRole('navigation', { name: 'Account' })
    expect(within(acc).queryByRole('link', { name: 'System settings' })).toBeNull()
    expect(within(acc).queryByRole('link', { name: 'User management' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'You don’t have access' })).toBeTruthy()
  })
  it('lets analysts reach master data (read only in the pages) but not the audit log', () => {
    renderAt('/admin/settings/users/audit', 'tao_analyst')
    expect(screen.getByRole('link', { name: 'Partners' })).toBeTruthy()
  })
  it('registers the nested portfolio routes in the admin shell', () => {
    for (const p of ['/admin/portfolio/:programId', '/admin/portfolio/:programId/dashboard', '/admin/portfolio/:programId/deals/:dealId']) {
      const e = ADMIN_PAGES.find(x => x.path === p)
      expect(e?.owner).toBe('portfolio'); expect(e?.nav).toBeUndefined(); expect(typeof e?.load).toBe('function')
    }
    const c = routeCrumbs(ADMIN_PAGES, '/admin/portfolio/move-trust/deals/move-trust-vcc-iv-lp', 'TAO Admin')
    expect(c.map(x => x.label)).toEqual(['TAO Admin', 'Portfolio Executive Summary', 'Program Executive Summary', 'Deal page'])
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
  it('opens with the keyboard, moves with arrows, picks with Enter and changes shell', async () => {
    renderAt('/admin')
    const btn = screen.getByTestId('role-switcher')
    expect(btn.textContent).toContain('TAO Admin')
    btn.focus(); await userEvent.keyboard('{ArrowUp}')
    const menu = screen.getByRole('menu')
    const opts = within(menu).getAllByRole('menuitemradio')
    expect(opts.length).toBe(6)
    expect(document.activeElement).toBe(opts[0])
    expect(opts[0].getAttribute('aria-checked')).toBe('true')
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}') // investor_viewer
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
