import { loadRole, ROLES } from './roles'
export const API_BASE: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api/v1'

/** The role headers every call carries: X-Role, plus X-Partner for partner roles. */
export function roleHeaders(): Record<string, string> {
  const role = loadRole(); const meta = ROLES.find(r => r.id === role)!
  const headers: Record<string, string> = { 'X-Role': role }
  if (meta.partner) headers['X-Partner'] = meta.partner
  return headers
}

async function fail(res: Response): Promise<never> {
  const err = await res.json().catch(() => ({ code: 'http_' + res.status, message: res.statusText }))
  throw Object.assign(new Error(err.message), { code: err.code, status: res.status })
}

/** Every call carries X-Role (and X-Partner for partner roles). The API, not the UI, is the tenancy boundary. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...roleHeaders(), ...(init.headers as Record<string, string> || {}) }
  if (!(init.body instanceof FormData)) headers['Content-Type'] = 'application/json'
  const res = await fetch(API_BASE + path, { ...init, headers })
  if (!res.ok) return fail(res)
  return res.status === 204 ? (undefined as T) : res.json()
}

/** Binary GET with the role headers, e.g. a page image: `URL.createObjectURL(await apiBlob('/uploads/x/pages/2.png'))`.
 * Errors throw like api(): Error with `code` and `status`. */
export async function apiBlob(path: string, init: RequestInit = {}): Promise<Blob> {
  const headers: Record<string, string> = { ...roleHeaders(), ...(init.headers as Record<string, string> || {}) }
  const res = await fetch(API_BASE + path, { ...init, headers })
  if (!res.ok) return fail(res)
  return res.blob()
}
