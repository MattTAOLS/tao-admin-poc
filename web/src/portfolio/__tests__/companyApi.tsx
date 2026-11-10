/** A fake API for the company pages, shaped like contracts/openapi.yaml (Companies, wave D; news in the wave E shape), with partner filtering the
 * way partner_filter applies it, plus helpers to render a page inside a router and a toast provider. */
import { vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ToastProvider } from '@/design/components'
import { KEY } from '@/shell/roles'
import { sessionStore } from '@/shell/session'
import type { AppUser } from '@/shell/types'
import { OWNERS, apiDeal, apiPortfolio, apiProgram, programOf } from './fixtures'
import { SEED_COMPANIES, TAO_USERS, apiAdverse, apiCompanies, apiCompany, apiInsights, apiNews, apiNotes } from './companyFixtures'
import CompaniesPage from '../companies/CompaniesPage'
import CompanyProfilePage from '../companies/CompanyProfilePage'
import { PortfolioSummary } from '../PortfolioSummary'

export type Call = { method: string; path: string; headers: Record<string, string>; body?: unknown }
export const state = {
  calls: [] as Call[],
  /** Programs shared with the partner. */
  shared: ['f-pil-2-0', 'move-trust'],
  /** Me.features.companies for partner roles. */
  partnerFeature: true,
  following: [] as string[],
  /** Run now on a company profile: 'ok' answers a finished run, 'active' answers 409 run_active. */
  run: 'ok' as 'ok' | 'active',
}

function respond(status: number, body?: unknown) {
  return Promise.resolve(new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}
const isTao = (role?: string) => role === 'tao_admin' || role === 'tao_analyst'

export function fakeFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input), 'http://x')
  const path = url.pathname.replace(/^.*\/api\/v1/, '')
  const method = init?.method ?? 'GET'
  const headers = (init?.headers ?? {}) as Record<string, string>
  const body = init?.body ? JSON.parse(String(init.body)) : undefined
  state.calls.push({ method, path: path + url.search, headers, body })
  const role = headers['X-Role']
  const tao = isTao(role)
  const partner = headers['X-Partner'] ?? null
  const shared = tao ? ['f-pil-2-0', 'move-trust'] : state.shared
  const visibleCompany = (slug: string) => {
    const c = SEED_COMPANIES.find(x => x.slug === slug)
    return !!c && (tao || (state.partnerFeature && c.deal_slugs.some(s => shared.includes(programOf(s)))))
  }
  let m: RegExpMatchArray | null
  if (path === '/me') return respond(200, { user: null, role, partner_slug: partner, display: {}, features: { companies: tao || state.partnerFeature } })
  if (path === '/published/portfolio') {
    const pf = apiPortfolio(partner)
    return respond(200, { ...pf, programs: pf.programs.filter(p => shared.includes(p.program!.slug)) })
  }
  if ((m = path.match(/^\/published\/programs\/([^/]+)\/deals\/([^/]+)$/))) {
    if (!OWNERS[m[1]] || !shared.includes(m[1])) return respond(404, { code: 'not_found', message: 'no' })
    return respond(200, apiDeal(m[2]))
  }
  if ((m = path.match(/^\/published\/programs\/([^/]+)$/))) return respond(200, apiProgram(m[1]))
  if (path === '/users') {
    if (!tao) return respond(403, { code: 'company_admin_only', message: 'no' })
    return respond(200, TAO_USERS)
  }
  if (!tao && !state.partnerFeature && path.startsWith('/companies')) return respond(404, { code: 'not_found', message: 'not found' })
  if (path === '/companies' && method === 'GET') {
    const rows = apiCompanies(tao, shared, state.following)
    return respond(200, url.searchParams.get('following') === 'true' ? rows.filter(r => r.following) : rows)
  }
  if ((m = path.match(/^\/companies\/([^/]+)\/follow$/))) {
    if (!headers['X-User']) return respond(401, { code: 'user_required', message: 'Sign in as a user first.' })
    state.following = method === 'PUT' ? [...state.following, m[1]] : state.following.filter(s => s !== m![1])
    return respond(204)
  }
  if ((m = path.match(/^\/companies\/([^/]+)\/deals\/([^/]+)\/insights$/))) {
    if (!visibleCompany(m[1]) || !shared.includes(programOf(m[2]))) return respond(404, { code: 'not_found', message: 'no' })
    return respond(200, apiInsights(m[2]))
  }
  if ((m = path.match(/^\/companies\/([^/]+)\/news$/))) {
    // include is TAO only; ignored for partners (contract).
    const include = url.searchParams.get('include') as 'excluded' | 'pending' | 'all' | null
    return visibleCompany(m[1]) ? respond(200, apiNews(m[1], tao, include)) : respond(404, { code: 'not_found' })
  }
  if ((m = path.match(/^\/companies\/([^/]+)\/adverse$/))) return visibleCompany(m[1]) ? respond(200, apiAdverse(m[1], tao)) : respond(404, { code: 'not_found' })
  if ((m = path.match(/^\/companies\/([^/]+)\/notes$/))) {
    if (!tao) return respond(403, { code: 'forbidden', message: 'TAO only' })
    if (method === 'POST') return respond(201, { id: 'b0000000-0000-4000-8000-0000000000ff', company_slug: m[1], author: { id: headers['X-User'], name: 'Me' }, body: body.body, mentions: TAO_USERS.filter(u => (body.mentions ?? []).includes(u.id)).map(u => ({ id: u.id, name: u.name })), collection_period: body.collection_period ?? null, created_at: '2026-11-06T10:00:00Z', edited_at: null })
    return respond(200, apiNotes(m[1]))
  }
  if ((m = path.match(/^\/company-notes\/([^/]+)$/))) {
    if (method === 'DELETE') return respond(204)
    const n = apiNotes('essex-lease-financial-corp').find(x => x.id === m![1])!
    return respond(200, { ...n, body: body.body, edited_at: '2026-11-06T10:00:00Z' })
  }
  if ((m = path.match(/^\/adverse\/([^/]+)\/(review|dismiss)$/))) {
    const a = apiAdverse('essex-lease-financial-corp', true).find(x => x.id === m![1])!
    return respond(200, { ...a, state: m[2] === 'review' ? 'reviewed' : 'dismissed', note: body.note, state_by: { id: '00000000-0000-4000-8000-000000000001', name: 'A. Patel' }, state_at: '2026-11-06T10:00:00Z' })
  }
  if ((m = path.match(/^\/companies\/([^/]+)\/contacts$/)) && method === 'POST') return respond(201, { id: 'c0000000-0000-4000-8000-0000000000ff', name: body.name, role: body.role, email: body.email, receives: body.receives })
  if (path === '/news/runs' && method === 'POST') {
    if (role !== 'tao_admin') return respond(403, { code: 'admin_only', message: 'TAO Admin only' })
    if (state.run === 'active') return respond(409, { code: 'run_active', message: 'a news run is already running' })
    return respond(202, { id: 'r0000000-0000-4000-8000-000000000001', trigger: 'manual', status: 'ok', company_slug: url.searchParams.get('company_slug'),
      queued_at: '2026-11-10T15:00:00Z', started_at: '2026-11-10T15:00:01Z', finished_at: '2026-11-10T15:00:20Z', companies: 1, items_added: 2, adverse_added: 0,
      errors: [], stats: { candidates: 9, kept: 2, excluded: 3, pending: 0 } })
  }
  if ((m = path.match(/^\/company-contacts\/([^/]+)$/))) return method === 'DELETE' ? respond(204) : respond(200, { id: m[1], ...body })
  if ((m = path.match(/^\/companies\/([^/]+)$/))) {
    if (!visibleCompany(m[1])) return respond(404, { code: 'not_found', message: 'not found' })
    const c = apiCompany(m[1], tao, { following: state.following.includes(m[1]) })
    if (!tao) c.deals = c.deals.filter(d => shared.includes(d.program_slug))
    if (method === 'PATCH') {
      const { reason: _r, owner_user_id, ...rest } = body
      return respond(200, { ...c, ...rest, ...(owner_user_id !== undefined ? { owner: TAO_USERS.find(u => u.id === owner_user_id) ?? null } : {}) })
    }
    return respond(200, c)
  }
  return respond(404, { code: 'not_found', message: path })
}

export function setup() {
  state.calls = []; state.shared = ['f-pil-2-0', 'move-trust']; state.partnerFeature = true; state.following = []; state.run = 'ok'
  localStorage.clear(); sessionStore.reset()
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
}

/** Signs in as a seed user (session mode `user`), so follow and notes are enabled and X-User is sent. */
export function signIn(user: Pick<AppUser, 'id' | 'name' | 'role'>, partner: string | null = null) {
  localStorage.setItem('tao-admin-poc.user', user.id)
  sessionStore.set({ mode: 'user', userId: user.id, me: { user: { ...user, email: 'x@example.com', partner_slug: partner, status: 'active', created_at: '2026-11-01T00:00:00Z' }, role: user.role, partner_slug: partner, display: {}, features: { companies: partner === null || state.partnerFeature } } })
}

export function Where() { const l = useLocation(); return <output data-testid="where">{l.pathname + l.search}</output> }

export function renderAt(path: string, role: string) {
  localStorage.setItem(KEY, role)
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          {['admin', 'investor', 'manager'].map(s => [
            <Route key={s + 'l'} path={`/${s}/companies`} element={<CompaniesPage />} />,
            <Route key={s + 'p'} path={`/${s}/companies/:companySlug`} element={<CompanyProfilePage />} />,
          ])}
          <Route path="/admin/portfolio" element={<PortfolioSummary />} />
          <Route path="/:shell/portfolio" element={<PortfolioSummary />} />
          <Route path="*" element={<p>elsewhere</p>} />
        </Routes>
        <Where />
      </MemoryRouter>
    </ToastProvider>,
  )
}
