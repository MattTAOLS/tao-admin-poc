import fs from 'node:fs'
import path from 'node:path'
import { API_URL, EXTRACT_BUDGET_MS } from './env'
import { DEALS, type DealKey } from './facts'

export type Role = 'tao_admin' | 'tao_analyst' | 'investor_admin' | 'investor_viewer' | 'manager_admin' | 'manager_viewer'
const PARTNER: Partial<Record<Role, string>> = {
  investor_admin: 'investor', investor_viewer: 'investor', manager_admin: 'manager', manager_viewer: 'manager',
}

export type Res<T = any> = { status: number; body: T }

/** The role-header client: every request carries X-Role and, for partner roles, X-Partner (contracts/openapi.yaml). */
export class Api {
  /** `user`: an app_user id sent as X-User (wave C); the API then takes role and partner from the user. */
  constructor(readonly role: Role, readonly partner: string | undefined = PARTNER[role], readonly user?: string) {}

  headers(extra: Record<string, string> = {}): Record<string, string> {
    return { 'X-Role': this.role, ...(this.partner ? { 'X-Partner': this.partner } : {}), ...(this.user ? { 'X-User': this.user } : {}), ...extra }
  }

  /** The same role acting as one seeded user. */
  as(user: { id: string }) { return new Api(this.role, this.partner, user.id) }

  async req<T = any>(method: string, route: string, body?: unknown): Promise<Res<T>> {
    const init: RequestInit = { method, headers: this.headers(body === undefined ? {} : { 'Content-Type': 'application/json' }) }
    if (body !== undefined) init.body = JSON.stringify(body)
    const r = await fetch(API_URL + route, init)
    const text = await r.text()
    let parsed: any = text
    try { parsed = text ? JSON.parse(text) : null } catch { /* not JSON */ }
    return { status: r.status, body: parsed }
  }
  get<T = any>(route: string) { return this.req<T>('GET', route) }
  post<T = any>(route: string, body: unknown = {}) { return this.req<T>('POST', route, body) }
  put<T = any>(route: string, body: unknown) { return this.req<T>('PUT', route, body) }
  patch<T = any>(route: string, body: unknown) { return this.req<T>('PATCH', route, body) }

  async upload(dealSlug: string, collectionPeriod: string, file: string | { name: string; bytes: Buffer }): Promise<Res> {
    const name = typeof file === 'string' ? path.basename(file) : file.name
    const bytes = typeof file === 'string' ? fs.readFileSync(file) : file.bytes
    const form = new FormData()
    form.set('deal_slug', dealSlug)
    form.set('collection_period', collectionPeriod)
    form.set('file', new Blob([bytes], { type: 'application/pdf' }), name)
    const r = await fetch(API_URL + '/uploads', { method: 'POST', headers: this.headers(), body: form })
    return { status: r.status, body: await r.json().catch(() => null) }
  }
}

export const tao = new Api('tao_admin')
export const analyst = new Api('tao_analyst')

export const IN_FLIGHT = ['received', 'extracting']

/** Polls an upload until it leaves received / extracting. Returns the upload and the seconds it took. */
export async function waitSettled(id: string, budgetMs = EXTRACT_BUDGET_MS): Promise<{ upload: any; seconds: number; seen: string[] }> {
  const t0 = Date.now()
  const seen: string[] = []
  for (;;) {
    const u = (await tao.get(`/uploads/${id}`)).body
    if (seen[seen.length - 1] !== u.status) seen.push(u.status)
    if (!IN_FLIGHT.includes(u.status)) return { upload: u, seconds: (Date.now() - t0) / 1000, seen }
    if (Date.now() - t0 > budgetMs) throw new Error(`upload ${id} still ${u.status} after ${budgetMs / 1000}s`)
    await new Promise(r => setTimeout(r, 1000))
  }
}

/** The newest upload for a deal + collection period, or undefined. */
export async function findUpload(deal: DealKey, period: string, status?: string): Promise<any | undefined> {
  const r = await tao.get(`/uploads?deal_slug=${DEALS[deal].slug}`)
  if (r.status !== 200) throw new Error(`GET /uploads ${r.status}`)
  return (r.body as any[]).find(u => u.collection_period === period && (!status || u.status === status))
}

export async function mustFindUpload(deal: DealKey, period: string, status?: string): Promise<any> {
  const u = await findUpload(deal, period, status)
  if (!u) throw new Error(`no ${status ?? ''} upload for ${deal} ${period}; run the earlier demo steps first (npm run test:e2e runs them in order)`)
  return u
}

export async function findings(id: string): Promise<any[]> {
  return (await tao.get(`/uploads/${id}/findings`)).body
}

export async function audit(uploadId?: string): Promise<any[]> {
  return (await tao.get(`/audit${uploadId ? `?upload_id=${uploadId}` : ''}`)).body
}
