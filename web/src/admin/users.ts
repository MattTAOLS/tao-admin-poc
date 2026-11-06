/** Wave C people: users, subscriptions and the caller (/me). Shapes follow contracts/openapi.yaml (AppUser,
 * AppUserCreate, AppUserPatch, StatusChangeRequest, Subscription, Me). Pure helpers live here so they can be tested
 * without rendering. */
import { api } from '@/shell/api'
import type { Role } from '@/shell/roles'
import { adminApi, programPartners, type Deal, type Partner, type Program } from './data'

export type AppUser = {
  id: string
  email: string
  name: string
  role: Role
  partner_slug: string | null
  status: 'active' | 'deactivated'
  created_at: string
  last_active_at?: string | null
  deactivated_at?: string | null
  deactivation_reason?: string | null
  /** One line from the subscriptions, e.g. "MOVE Trust: all deals; F-PIL 2.0: 2 deals"; "None" when empty. */
  receives_summary?: string
}
export type AppUserCreate = { email: string; name: string; role: Role; partner_slug: string | null }
export type AppUserPatch = Partial<AppUserCreate>
export type Channel = 'in_app' | 'email'
export type Subscription = { program_slug: string; deal_slug: string | null; channels: Channel[] }
export type Me = { user: AppUser | null; role: Role; partner_slug: string | null }

const enc = encodeURIComponent
export const usersApi = {
  list: () => api<AppUser[]>('/users'),
  create: (u: AppUserCreate) => api<AppUser>('/users', { method: 'POST', body: JSON.stringify(u) }),
  patch: (id: string, p: AppUserPatch) => api<AppUser>(`/users/${enc(id)}`, { method: 'PATCH', body: JSON.stringify(p) }),
  deactivate: (id: string, reason: string) => api<AppUser>(`/users/${enc(id)}/deactivate`, { method: 'POST', body: JSON.stringify({ reason }) }),
  reactivate: (id: string, reason: string) => api<AppUser>(`/users/${enc(id)}/reactivate`, { method: 'POST', body: JSON.stringify({ reason }) }),
  subscriptions: (id: string) => api<Subscription[]>(`/users/${enc(id)}/subscriptions`),
  putSubscriptions: (id: string, subs: Subscription[]) => api<Subscription[]>(`/users/${enc(id)}/subscriptions`, { method: 'PUT', body: JSON.stringify(subs) }),
  /** The caller; user is null in demo mode (no X-User). */
  me: () => api<Me>('/me'),
  /** Platform entries that mention this user (their email is in every user_change detail). */
  history: (email: string) => adminApi.audit({ scope: 'platform', q: email, limit: 50 }),
}

export const ROLE_LABEL: Record<Role, string> = {
  tao_admin: 'TAO Admin', tao_analyst: 'TAO Analyst',
  investor_admin: 'Company Admin', investor_viewer: 'Viewer',
  manager_admin: 'Company Admin', manager_viewer: 'Viewer',
}
export const ROLE_ORDER: Role[] = ['tao_admin', 'tao_analyst', 'investor_admin', 'investor_viewer', 'manager_admin', 'manager_viewer']
export const isTaoRole = (r: Role) => r === 'tao_admin' || r === 'tao_analyst'
export const isCompanyAdmin = (r: Role) => r === 'investor_admin' || r === 'manager_admin'
/** investor_* roles belong to the investor partner kind, manager_* to the manager kind; TAO roles to none. */
export const roleKind = (r: Role): 'investor' | 'manager' | null => (r.startsWith('investor_') ? 'investor' : r.startsWith('manager_') ? 'manager' : null)
/** Partners a role may carry (contract: TAO roles null, partner roles their own partner). */
export const partnersForRole = (r: Role, partners: Partner[]) => { const k = roleKind(r); return k ? partners.filter(p => p.kind === k) : [] }
export function roleText(u: Pick<AppUser, 'role' | 'partner_slug'>, partners: Partner[] = []) {
  if (isTaoRole(u.role)) return ROLE_LABEL[u.role]
  const p = partners.find(x => x.slug === u.partner_slug)?.name ?? u.partner_slug ?? ''
  return `${p ? p + ' · ' : ''}${ROLE_LABEL[u.role]}`
}
export const partnerName = (slug: string | null, partners: Partner[]) => (slug ? partners.find(p => p.slug === slug)?.name ?? slug : 'TAO')
export const initials = (name: string) => name.split(/[\s.]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?'

// ---- Filters ----
export type UserFilter = { partner: string; status: string; q: string }
/** partner: '' all, 'tao' TAO staff, else a partner slug. q: name or email, two characters or more. */
export function filterUsers(users: AppUser[], f: UserFilter): AppUser[] {
  const q = f.q.trim().toLowerCase()
  return users.filter(u =>
    (!f.partner || (f.partner === 'tao' ? u.partner_slug === null : u.partner_slug === f.partner))
    && (!f.status || u.status === f.status)
    && (q.length < 2 || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)))
}
export function sortUsers(users: AppUser[]) {
  const key = (u: AppUser) => [u.partner_slug ?? '', ROLE_ORDER.indexOf(u.role), u.status === 'active' ? 0 : 1, u.name.toLowerCase()] as const
  return users.slice().sort((a, b) => {
    const ka = key(a), kb = key(b)
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1
    return 0
  })
}

// ---- Admin guards (the API enforces the same: 409 self_change / last_admin) ----
/** Why this user cannot be deactivated or have their role changed by `me`, or null when nothing blocks it. */
export function lockReason(u: AppUser, all: AppUser[], meId: string | null | undefined): 'self_change' | 'last_admin' | null {
  if (meId && u.id === meId) return 'self_change'
  if (u.status !== 'active') return null
  if (u.role === 'tao_admin' && all.filter(x => x.status === 'active' && x.role === 'tao_admin').length <= 1) return 'last_admin'
  if (isCompanyAdmin(u.role) && all.filter(x => x.status === 'active' && x.role === u.role && x.partner_slug === u.partner_slug).length <= 1) return 'last_admin'
  return null
}

// ---- Subscription tree ----
/** Per program: `all` = the program entry (deal_slug null: every deal, including new ones), `deals` = deals ticked one by one. */
export type Tree = Record<string, { all: boolean; deals: string[] }>
/** Programs a user can receive: every program for TAO users, only programs shared with the partner for partner users
 * (the partner_filter rule; the API answers 422 not_visible otherwise). */
export const visiblePrograms = (u: Pick<AppUser, 'partner_slug'>, programs: Program[]) =>
  u.partner_slug ? programs.filter(p => programPartners(p).includes(u.partner_slug!)) : programs
export function toTree(subs: Subscription[]): Tree {
  const t: Tree = {}
  for (const s of subs) {
    const e = (t[s.program_slug] ??= { all: false, deals: [] })
    if (s.deal_slug === null) e.all = true
    else if (!e.deals.includes(s.deal_slug)) e.deals.push(s.deal_slug)
  }
  return t
}
/** In-app is the only channel in phase 2; email is refused with 422 email_later. A program entry replaces its deal entries. */
export function fromTree(t: Tree, programs: Program[]): Subscription[] {
  const order = programs.map(p => p.slug)
  const out: Subscription[] = []
  for (const slug of Object.keys(t).sort((a, b) => order.indexOf(a) - order.indexOf(b))) {
    const e = t[slug]
    if (e.all) out.push({ program_slug: slug, deal_slug: null, channels: ['in_app'] })
    else for (const d of e.deals.slice().sort()) out.push({ program_slug: slug, deal_slug: d, channels: ['in_app'] })
  }
  return out
}
export const setAll = (t: Tree, program: string, on: boolean): Tree => ({ ...t, [program]: { all: on, deals: on ? [] : t[program]?.deals ?? [] } })
/** Ticking or unticking one deal. Unticking a deal while "All deals" is on turns it off and keeps every other deal ticked one by one. */
export function toggleDeal(t: Tree, program: string, deal: string, on: boolean, programDeals: string[]): Tree {
  const e = t[program] ?? { all: false, deals: [] }
  if (e.all && !on) return { ...t, [program]: { all: false, deals: programDeals.filter(d => d !== deal) } }
  if (e.all) return t
  const deals = on ? [...new Set([...e.deals, deal])] : e.deals.filter(d => d !== deal)
  return { ...t, [program]: { all: false, deals } }
}
export const dealTicked = (t: Tree, program: string, deal: string) => !!t[program]?.all || !!t[program]?.deals.includes(deal)
export function tickedCount(t: Tree, program: string, deals: Deal[]) {
  const ds = deals.filter(d => d.program_slug === program)
  return ds.filter(d => dealTicked(t, program, d.slug)).length
}
/** "MOVE Trust: all deals; F-PIL 2.0: Moneda Capital Corp., Stride Capital" from a subscription list. */
export function subsText(subs: Subscription[] | unknown, programs: Program[], deals: Deal[]): string {
  if (!Array.isArray(subs) || subs.length === 0) return 'None'
  const t = toTree(subs as Subscription[])
  const pname = (s: string) => programs.find(p => p.slug === s)?.name ?? s
  const dname = (s: string) => deals.find(d => d.slug === s)?.name ?? s
  return Object.entries(t).map(([p, e]) => `${pname(p)}: ${e.all ? 'all deals' : e.deals.map(dname).join(', ')}`).join('; ')
}
export const sameSubs = (a: Subscription[], b: Subscription[]) =>
  JSON.stringify(a.map(s => `${s.program_slug}|${s.deal_slug}`).sort()) === JSON.stringify(b.map(s => `${s.program_slug}|${s.deal_slug}`).sort())

/** The one-line "Reports received" cell: the API's receives_summary, else None. */
export const receives = (u: AppUser) => (u.status === 'deactivated' ? 'None (deactivated)' : u.receives_summary || 'None')

// ---- User change history (audit user_change detail) ----
export const USER_CHANGE_LABEL: Record<string, string> = {
  created: 'User added', updated: 'Details changed', deactivated: 'User deactivated', reactivated: 'User reactivated', subscriptions: 'Reports changed',
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const validEmail = (s: string) => EMAIL.test(s.trim())
