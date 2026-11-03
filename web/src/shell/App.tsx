import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom'
import { ROLES, loadRole, saveRole, type Role } from './roles'
import { ADMIN_PAGES, PARTNER_PAGES, type Page } from './pages'

function Placeholder({ page }: { page: Page }) {
  return <div className="placeholder"><h2>{page.title}</h2><p>{page.purpose ?? 'Not built in the POC. Navigation placeholder so the shell is complete.'}</p><p style={{ fontSize: 'var(--fs-small)' }}>Owner: {page.owner} · route {page.path || '/'}</p></div>
}

function Shell({ shell, role, setRole }: { shell: 'admin' | 'investor' | 'manager'; role: Role; setRole: (r: Role) => void }) {
  const base = shell === 'admin' ? '' : '/' + shell
  const pages = shell === 'admin' ? ADMIN_PAGES : PARTNER_PAGES.map(p => ({ ...p, path: base + p.path }))
  const visible = (p: Page) => !p.roles || p.roles.includes(role)
  const loc = useLocation()
  const current = pages.find(p => matchPath(p.path, loc.pathname)) ?? pages[0]
  const title = shell === 'admin' ? 'TAO Admin' : shell === 'investor' ? 'Investor Portal' : 'Manager Portal'
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><span style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--purple)', display: 'inline-block' }} /><div>{title}<small>{shell === 'admin' ? 'Operations' : 'Portfolio monitoring'}</small></div></div>
        <div className="navlabel">Workspace</div>
        <nav className="nav">{pages.filter(p => p.nav === 'main' && visible(p)).map(p => <NavLink key={p.path} to={p.path || '/'} end={p.path === '/admin' || p.path === base}>{p.title}</NavLink>)}</nav>
        <div className="navlabel">Account</div>
        <nav className="nav">{pages.filter(p => p.nav === 'account' && visible(p)).map(p => <NavLink key={p.path} to={p.path}>{p.title}</NavLink>)}</nav>
        <div className="foot">
          <div className="navlabel">Signed in as (POC role switcher)</div>
          <select className="roleswitch" aria-label="Role" value={role} onChange={e => setRole(e.target.value as Role)}>{ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
        </div>
      </aside>
      <div className="main">
        <header className="topbar"><div><div className="crumb">{title} / <b>{current.title}</b></div><h1>{current.title}</h1></div></header>
        <main className="content" key={loc.pathname}>
          <Routes>
            {pages.map(p => <Route key={p.path} path={p.path || '/'} element={!visible(p) ? <NoAccess /> : (shell !== 'admin' && p.path === base) ? <Navigate to={base + '/portfolio'} replace /> : <Placeholder page={p} />} />)}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
function matchPath(pattern: string, path: string) { const re = new RegExp('^' + pattern.replace(/:[^/]+/g, '[^/]+') + '$'); return re.test(path) }
export function NoAccess() { return <div className="placeholder"><h2>You don’t have access</h2><p>This page isn’t available to your role. Switch role in the sidebar to see it.</p></div> }
export function NotFound() { return <div className="placeholder"><h2>Page not found</h2></div> }

export function App() {
  const [role, setRoleState] = useState<Role>(loadRole())
  const setRole = (r: Role) => { saveRole(r); setRoleState(r) }
  const shell = ROLES.find(r => r.id === role)!.shell
  const home = shell === 'admin' ? '/admin' : '/' + shell + '/portfolio'
  const loc = useLocation()
  useEffect(() => { document.title = (shell === 'admin' ? 'TAO Admin' : shell === 'investor' ? 'Investor Portal' : 'Manager Portal') }, [shell])
  // A role may only see its own shell: a partner role on /admin or on the other partner's shell gets No access.
  if (loc.pathname === '/') return <Navigate to={home} replace />
  const allowed = loc.pathname.startsWith(shell === 'admin' ? '/admin' : '/' + shell)
  if (!allowed) return <Navigate to={home} replace />   // a role never sees another shell's URLs; the API enforces the same
  return <Shell shell={shell} role={role} setRole={setRole} />
}
