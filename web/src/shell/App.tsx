import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react'
import { Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom'
import { ToastProvider, PageHeader, StatePanel, Button, SkeletonBlock, icons, type Crumb, type LinkLike } from '@/design/components'
import { ROLES, loadRole, saveRole, type Role } from './roles'
import { ADMIN_PAGES, PARTNER_PAGES, type Page } from './pages'
import { RoleSwitcher } from './RoleSwitcher'
import { usePageHeaderMeta } from './header'

type ShellId = 'admin' | 'investor' | 'manager'
const SHELL_TITLE: Record<ShellId, string> = { admin: 'TAO Admin', investor: 'Investor Portal', manager: 'Manager Portal' }
const SHELL_SUB: Record<ShellId, string> = { admin: 'Operations', investor: 'Portfolio monitoring', manager: 'Portfolio monitoring' }

/** Nav icon per page title (inline SVG from the design icon set). */
const NAV_ICON: Record<string, ComponentType<{ width?: number; height?: number }>> = {
  'Dashboard': icons.IconGrid, 'Home': icons.IconGrid, 'Uploads': icons.IconUpload, 'Approval queue': icons.IconInbox, 'Reports library': icons.IconBook, 'Reports': icons.IconBook,
  'Partners': icons.IconBuilding, 'Portfolio Executive Summary': icons.IconChart, 'Notifications': icons.IconBell, 'Help & support': icons.IconHelp,
  'User management': icons.IconUsers, 'Audit log': icons.IconBook, 'Profile': icons.IconUser, 'System settings': icons.IconSettings, 'Data room': icons.IconFolder,
  "What's new": icons.IconSparkle, 'Team members': icons.IconUsers,
}

const RouterLink: LinkLike = ({ to, className, children }) => <Link to={to} className={className}>{children}</Link>

// One lazy component per registered loader, created once.
const lazyCache = new Map<Page['load'], LazyExoticComponent<ComponentType>>()
function lazyFor(load: NonNullable<Page['load']>) {
  let c = lazyCache.get(load)
  if (!c) { c = lazy(load); lazyCache.set(load, c) }
  return c
}

const toRegex = (pattern: string, exact: boolean) => new RegExp('^' + pattern.replace(/:[^/]+/g, '[^/]+') + (exact ? '/?$' : '(?:/|$)'))
export function matchPath(pattern: string, path: string) { return toRegex(pattern, true).test(path) }

/** Breadcrumb from the registry: every registered ancestor of the current path, linked with the real URL prefix. */
export function routeCrumbs(pages: Page[], pathname: string, shellTitle: string): Crumb[] {
  const segs = pathname.replace(/\/$/, '').split('/')
  const chain = pages
    .filter(p => p.path && toRegex(p.path, false).test(pathname))
    // The shell root (/admin, /investor) is the shell title crumb already; list it only when it is the page itself.
    .filter(p => p.path.split('/').length > 2 || toRegex(p.path, true).test(pathname))
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length)
  const crumbs: Crumb[] = [{ label: shellTitle }]
  for (const p of chain) crumbs.push({ label: p.title, href: segs.slice(0, p.path.split('/').length).join('/') })
  return crumbs
}

function Placeholder({ page }: { page: Page }) {
  return (
    <div className="placeholder">
      <h2>{page.title}</h2>
      <p>{page.purpose ?? 'Not built in the POC. Navigation placeholder so the shell is complete.'}</p>
      <p className="placeholder__meta">Owner: {page.owner} · route <code>{page.path || '/'}</code>{page.built ? ' · wave 1' : ''}</p>
    </div>
  )
}

export function NoAccess() {
  return <StatePanel kind="no-access" />
}
export function NotFound({ home }: { home?: string }) {
  const nav = useNavigate()
  return <StatePanel kind="not-found" actions={home ? <Button variant="primary" onClick={() => nav(home)}>Go to home</Button> : undefined} />
}

/** Route-load state: the thin bar under the top bar plus skeleton content (motion.md). */
export function RouteLoading() {
  return (
    <div aria-busy="true">
      <div className="routebar" role="progressbar" aria-label="Loading page" />
      <div className="routeskel">
        <div className="routeskel__tiles">{[0, 1, 2].map(i => <div key={i} className="ds-kpi"><SkeletonBlock width="40%" height={10} /><SkeletonBlock width="60%" height={26} style={{ marginTop: 10 }} /></div>)}</div>
        <div className="ds-card ds-card--pad"><SkeletonBlock lines={5} /></div>
      </div>
      <span className="ds-visually-hidden">Loading</span>
    </div>
  )
}

function PageView({ page }: { page: Page }) {
  if (!page.load) return <Placeholder page={page} />
  const C = lazyFor(page.load)
  return <Suspense fallback={<RouteLoading />}><C /></Suspense>
}

function TopBar({ current, crumbs }: { current: Page | undefined; crumbs: Crumb[] }) {
  const meta = usePageHeaderMeta()
  const ref = useRef<HTMLElement>(null)
  // Publish the top bar height so DataTable headers stick just under it (--ds-sticky-top).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const set = () => el.parentElement?.style.setProperty('--ds-sticky-top', el.offsetHeight + 'px')
    set()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(set); ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <header className="topbar" ref={ref}>
      <PageHeader title={meta.title ?? current?.title ?? 'Page not found'} crumbs={meta.crumbs ?? crumbs} subtitle={meta.subtitle}
        status={meta.status} actions={meta.actions} linkAs={RouterLink} />
    </header>
  )
}

function NavGroup({ label, pages, isActive }: { label: string; pages: Page[]; isActive: (p: Page) => boolean }) {
  if (pages.length === 0) return null
  return (
    <>
      <div className="navlabel" id={`nav-${label}`}>{label}</div>
      <nav className="nav" aria-labelledby={`nav-${label}`}>
        {pages.map(p => {
          const I = NAV_ICON[p.title] ?? icons.IconFile
          const on = isActive(p)
          return <Link key={p.path} to={p.path || '/'} className={on ? 'active' : undefined} aria-current={on ? 'page' : undefined}><I width={17} height={17} /><span>{p.title}</span></Link>
        })}
      </nav>
    </>
  )
}

function Shell({ shell, role, setRole }: { shell: ShellId; role: Role; setRole: (r: Role) => void }) {
  const base = shell === 'admin' ? '' : '/' + shell
  const home = shell === 'admin' ? '/admin' : base + '/portfolio'
  const pages = shell === 'admin' ? ADMIN_PAGES : PARTNER_PAGES.map(p => ({ ...p, path: base + p.path }))
  const visible = (p: Page) => !p.roles || p.roles.includes(role)
  const loc = useLocation()
  const current = pages.find(p => matchPath(p.path || '/', loc.pathname))
  const title = SHELL_TITLE[shell]
  const crumbs = current ? routeCrumbs(pages, loc.pathname, title) : [{ label: title }, { label: 'Page not found' }]
  const end = (p: Page) => p.path === '/admin' || p.path === base || p.path === base + '/portfolio'
  const navPages = pages.filter(p => p.nav && visible(p))
  const matches = (p: Page) => toRegex(p.path || '/', end(p)).test(loc.pathname)
  // A nav item is active on its own subtree, unless a more specific nav item (Approval queue under Uploads) matches.
  const isActive = (p: Page) => matches(p) && !navPages.some(q => q !== p && q.path.startsWith(p.path + '/') && matches(q))
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true"><icons.IconLayers width={18} height={18} /></span>
          <span><b>{title}</b><small>{SHELL_SUB[shell]}</small></span>
        </div>
        <NavGroup label="Workspace" pages={pages.filter(p => p.nav === 'main' && visible(p) && !(shell !== 'admin' && p.path === base))} isActive={isActive} />
        <NavGroup label="Account" pages={pages.filter(p => p.nav === 'account' && visible(p))} isActive={isActive} />
        <div className="foot"><RoleSwitcher role={role} onChange={setRole} /></div>
      </aside>
      <div className="main">
        <TopBar current={current} crumbs={crumbs} />
        <main className="content" key={loc.pathname} id="main">
          <Routes>
            {pages.map(p => (
              <Route key={p.path} path={p.path || '/'}
                element={!visible(p) ? <NoAccess /> : (shell !== 'admin' && p.path === base) ? <Navigate to={home} replace /> : <PageView page={p} />} />
            ))}
            <Route path="*" element={<NotFound home={home} />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

export function App() {
  const [role, setRoleState] = useState<Role>(loadRole())
  const setRole = (r: Role) => { saveRole(r); setRoleState(r) }
  const shell = ROLES.find(r => r.id === role)!.shell
  const home = shell === 'admin' ? '/admin' : '/' + shell + '/portfolio'
  const loc = useLocation()
  useEffect(() => { document.title = SHELL_TITLE[shell] }, [shell])
  let body: ReactNode
  // A role may only see its own shell: a role never sees another shell's URLs; the API enforces the same.
  if (loc.pathname === '/') body = <Navigate to={home} replace />
  else if (!loc.pathname.startsWith(shell === 'admin' ? '/admin' : '/' + shell)) body = <Navigate to={home} replace />
  else body = <Shell shell={shell} role={role} setRole={setRole} />
  return <ToastProvider>{body}</ToastProvider>
}
