/** Every network call the review pages make. JSON goes through the shell client (X-Role / X-Partner headers); page
 * images need the same headers, so they are fetched as blobs here and shown through object URLs. */
import { api } from '@/shell/api'
import { loadRole, ROLES, type Role } from '@/shell/roles'
import type { AuditEntry, Deal, Extraction, Finding, OverrideChoice, Program, Upload } from './types'

const BASE: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api/v1'
const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

export const reviewApi = {
  uploads: (status: string) => api<Upload[]>(`/uploads?status=${encodeURIComponent(status)}`),
  upload: (id: string) => api<Upload>(`/uploads/${id}`),
  findings: (id: string) => api<Finding[]>(`/uploads/${id}/findings`),
  extraction: (id: string) => api<Extraction>(`/uploads/${id}/extraction`),
  override: (id: string, findingId: string, choice: OverrideChoice, reason: string) =>
    api<Finding[]>(`/uploads/${id}/findings/${findingId}/override`, json({ choice, reason })),
  approve: (id: string) => api<Upload>(`/uploads/${id}/approve`, { method: 'POST' }),
  reject: (id: string, reason: string) => api<Upload>(`/uploads/${id}/reject`, json({ reason })),
  reextract: (id: string, pages: number[]) => api<Upload>(`/uploads/${id}/reextract`, json({ pages })),
  deals: () => api<Deal[]>('/master/deals'),
  programs: () => api<Program[]>('/master/programs'),
  audit: (uploadId: string) => api<AuditEntry[]>(`/audit?upload_id=${encodeURIComponent(uploadId)}`),
  regenerate: (programSlug?: string) =>
    api<{ queued?: boolean; programs?: string[]; publications?: number } | undefined>('/published/regenerate', json(programSlug ? { program_slug: programSlug } : {})),
}

// One object URL per page image for the session; the same page is shown by several cards and the page viewer.
const pageCache = new Map<string, Promise<string>>()

export function pageImageUrl(uploadId: string, page: number): Promise<string> {
  const role = loadRole()
  const key = `${role}:${uploadId}:${page}`
  let p = pageCache.get(key)
  if (!p) {
    const meta = ROLES.find(r => r.id === role)!
    const headers: Record<string, string> = { 'X-Role': role }
    if (meta.partner) headers['X-Partner'] = meta.partner
    p = fetch(`${BASE}/uploads/${uploadId}/pages/${page}.png`, { headers }).then(async res => {
      if (!res.ok) throw Object.assign(new Error(`Page ${page} image: HTTP ${res.status}`), { status: res.status })
      return URL.createObjectURL(await res.blob())
    })
    p.catch(() => pageCache.delete(key))
    pageCache.set(key, p)
  }
  return p
}

/** Test hook: forget cached page images. */
export function clearPageCache() { pageCache.clear() }

export type Access = { role: Role; tao: boolean; admin: boolean }
/** tao = may read intake routes; admin = may override, re-extract, reject, publish, regenerate, read the audit log. */
export function access(role: Role = loadRole()): Access {
  return { role, tao: role === 'tao_admin' || role === 'tao_analyst', admin: role === 'tao_admin' }
}

/** Human message for an API error, using the codes the real API returns. */
export function errorText(e: unknown): string {
  const err = e as { code?: string; message?: string; status?: number }
  switch (err?.code) {
    case 'open_block_findings': return 'A block finding is still open. Resolve it before publishing.'
    case 'bad_state': return err.message || 'The report is not in a state that allows this action. Reload the page.'
    case 'not_open': return 'That finding was already resolved. The list has been refreshed.'
    case 'admin_only': case 'tao_only': return 'Your role cannot do this. Only a TAO admin can.'
  }
  if (err?.status === 403) return 'Your role cannot do this. Only a TAO admin can.'
  return err?.message || 'The request failed. Try again in a moment.'
}
