import { loadRole, loadUserId, ROLES } from './roles'
import { sessionStore } from './session'
import type { Features, Me, UnreadCount } from './types'
export const API_BASE: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api/v1'

/** The demo headers: X-Role, plus X-Partner for partner roles (phase 1 behaviour). */
export function demoHeaders(): Record<string, string> {
  const role = loadRole(); const meta = ROLES.find(r => r.id === role)!
  const headers: Record<string, string> = { 'X-Role': role }
  if (meta.partner) headers['X-Partner'] = meta.partner
  return headers
}

/** The headers every call carries: the demo headers always (so an older API keeps working), plus X-User when signed in
 * as a user and GET /me has not failed. With X-User the API takes role and partner from the user record.
 * Code that calls fetch itself spreads this, so it sends X-User too. */
export function roleHeaders(): Record<string, string> {
  const headers = demoHeaders()
  const id = loadUserId()
  if (id && sessionStore.get().mode !== 'role-only') headers['X-User'] = id
  return headers
}
export const callerHeaders = roleHeaders

async function fail(res: Response): Promise<never> {
  const err = await res.json().catch(() => ({ code: 'http_' + res.status, message: res.statusText }))
  throw Object.assign(new Error(err.message), { code: err.code, status: res.status })
}

/** Every call carries X-Role (and X-Partner for partner roles), and X-User when signed in as a user. The API, not the
 * UI, is the tenancy boundary. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...callerHeaders(), ...(init.headers as Record<string, string> || {}) }
  if (!(init.body instanceof FormData)) headers['Content-Type'] = 'application/json'
  const res = await fetch(API_BASE + path, { ...init, headers })
  if (!res.ok) return fail(res)
  return res.status === 204 ? (undefined as T) : res.json()
}

/** Binary GET with the caller headers, e.g. a page image: `URL.createObjectURL(await apiBlob('/uploads/x/pages/2.png'))`.
 * Errors throw like api(): Error with `code` and `status`. */
export async function apiBlob(path: string, init: RequestInit = {}): Promise<Blob> {
  const headers: Record<string, string> = { ...callerHeaders(), ...(init.headers as Record<string, string> || {}) }
  const res = await fetch(API_BASE + path, { ...init, headers })
  if (!res.ok) return fail(res)
  return res.blob()
}

/** Me.features from a /me reply; an older API without the field shows nothing feature-gated. */
export const featuresOf = (me: Me | null | undefined): Features => ({ companies: me?.features?.companies === true })
const FEATURES_OFF: Features = { companies: false }

/** Resolves the stored user with GET /me. No user stored, a failed call (older API without /me, unknown or deactivated
 * user) or a reply without a user: role-only mode, and X-User stops being sent.
 * GET /me is read in role-only mode too (demo headers only): it answers with user null and the role's features. */
export async function refreshMe(): Promise<void> {
  const id = loadUserId()
  const role = loadRole()
  if (!id) {
    sessionStore.set({ mode: 'role-only', userId: null, me: null, unread: null, fallback: undefined, features: null })
    return roleOnlyFeatures(id, role)
  }
  sessionStore.set({ mode: 'pending', userId: id, me: null, unread: null, fallback: undefined, features: null })
  try {
    const me = await api<Me>('/me')
    if (loadUserId() !== id) return
    if (me && me.user) sessionStore.set({ mode: 'user', me, features: featuresOf(me) })
    else sessionStore.set({ mode: 'role-only', me: null, fallback: 'no_user', features: featuresOf(me) })
  } catch (e) {
    if (loadUserId() !== id) return
    sessionStore.set({ mode: 'role-only', me: null, fallback: (e as { code?: string }).code ?? 'network' })
    // The user was refused; the role still works, so ask again without X-User for the role's features.
    return roleOnlyFeatures(id, role)
  }
}

/** GET /me with the demo headers only, for Me.features. A reply that arrives after the user or role changed is dropped. */
async function roleOnlyFeatures(id: string | null, role: string): Promise<void> {
  const current = () => loadUserId() === id && loadRole() === role && sessionStore.get().mode === 'role-only'
  let features = FEATURES_OFF
  try { features = featuresOf(await api<Me>('/me')) } catch { /* older API: nothing feature-gated */ }
  if (current()) sessionStore.set({ features })
}

/** Unread counts for the sidebar badge and the Notifications tabs. Only for a signed-in user. */
export async function refreshUnread(): Promise<void> {
  if (sessionStore.get().mode !== 'user') { if (sessionStore.get().unread) sessionStore.set({ unread: null }); return }
  // An answer that arrives after the user changed (or signed out) is dropped: it is the previous person's count.
  const id = sessionStore.get().userId
  const current = () => sessionStore.get().mode === 'user' && sessionStore.get().userId === id
  try { const unread = await api<UnreadCount>('/notifications/unread-count'); if (current()) sessionStore.set({ unread }) }
  catch { if (current()) sessionStore.set({ unread: null }) }
}
