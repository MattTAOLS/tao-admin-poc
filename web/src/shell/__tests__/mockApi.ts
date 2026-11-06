import { vi } from 'vitest'

export type Call = { method: string; path: string; headers: Record<string, string>; body: unknown }
type Handler = (c: Call) => { status?: number; body?: unknown } | undefined

/** Stubs global fetch with a tiny router: `routes['GET /me']` is a body, `{ status, body }`, or a function of the call.
 * Unknown routes are 404. Returns
 * the recorded calls (path without the API base, query included). */
export function mockApi(routes: Record<string, unknown | Handler>) {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = new URL(url)
    const path = u.pathname.replace(/^\/api\/v1/, '') + u.search
    const method = (init.method ?? 'GET').toUpperCase()
    const call: Call = { method, path, headers: (init.headers ?? {}) as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined }
    calls.push(call)
    const key = Object.keys(routes).find(k => {
      const [m, p] = k.split(' ')
      return m === method && (p === path || p === path.split('?')[0])
    })
    if (!key) return new Response(JSON.stringify({ code: 'not_found', message: 'No route ' + path }), { status: 404 })
    const r = routes[key]
    const isResponse = (x: unknown): x is { status: number; body?: unknown } => !!x && typeof x === 'object' && typeof (x as { status?: unknown }).status === 'number' && 'body' in x
    const out = typeof r === 'function' ? (r as Handler)(call) ?? { body: undefined } : isResponse(r) ? r : { body: r }
    const status = out.status ?? 200
    return new Response(out.body === undefined ? null : JSON.stringify(out.body), { status: status === 200 && out.body === undefined ? 204 : status })
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

export const ME = (over: Record<string, unknown> = {}) => ({
  user: { id: '00000000-0000-4000-8000-000000000001', email: 'tao.admin@example.com', name: 'A. Patel', role: 'tao_admin', partner_slug: null, status: 'active', created_at: '2026-11-01T00:00:00Z' },
  role: 'tao_admin', partner_slug: null, display: { time_zone: 'America/Toronto', date_format: 'D MMM YYYY', number_format: '1,234.56' }, ...over,
})
export const PARTNER_ME = () => ME({
  user: { id: '00000000-0000-4000-8000-000000000006', email: 'investor.viewer@example.com', name: 'D. Alvarez', role: 'investor_viewer', partner_slug: 'investor', status: 'active', created_at: '2026-11-01T00:00:00Z' },
  role: 'investor_viewer', partner_slug: 'investor',
})
