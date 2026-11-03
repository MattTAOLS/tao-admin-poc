import { loadRole, ROLES } from './roles'
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api/v1'
/** Every call carries X-Role (and X-Partner for partner roles). The API, not the UI, is the tenancy boundary. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const role = loadRole(); const meta = ROLES.find(r => r.id === role)!
  const headers: Record<string, string> = { 'X-Role': role, ...(init.headers as Record<string, string> || {}) }
  if (meta.partner) headers['X-Partner'] = meta.partner
  if (!(init.body instanceof FormData)) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + path, { ...init, headers })
  if (!res.ok) { const err = await res.json().catch(() => ({ code: 'http_' + res.status, message: res.statusText })); throw Object.assign(new Error(err.message), { code: err.code, status: res.status }) }
  return res.status === 204 ? (undefined as T) : res.json()
}
