/** Every network call the review pages make, through the shell client (X-Role / X-Partner headers). Page images come
 * from apiBlob and are shown through object URLs. */
import { api, apiBlob, API_BASE, roleHeaders } from '@/shell/api'
import { loadRole, type Role } from '@/shell/roles'
import type {
  AuditEntry, Correction, CorrectionDetail, CorrectionRequest, CorrectionStatus, Deal, Extraction, Finding, OverrideChoice, Program, Upload, ValueEdit, ValueEditResult,
} from './types'

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

export const reviewApi = {
  uploads: (status: string) => api<Upload[]>(`/uploads?status=${encodeURIComponent(status)}`),
  upload: (id: string) => api<Upload>(`/uploads/${id}`),
  findings: (id: string) => api<Finding[]>(`/uploads/${id}/findings`),
  extraction: (id: string) => api<Extraction>(`/uploads/${id}/extraction`),
  override: (id: string, findingId: string, choice: OverrideChoice, reason: string) =>
    api<Finding[]>(`/uploads/${id}/findings/${findingId}/override`, json({ choice, reason })),
  /** Own fetch so a 409's `conflicts` / `findings` reach the dialog (the shell client keeps only code and status). */
  approve: async (id: string): Promise<Upload> => {
    const res = await fetch(`${API_BASE}/uploads/${id}/approve`, { method: 'POST', headers: { ...roleHeaders(), 'Content-Type': 'application/json' } })
    const body = await res.json().catch(() => ({ code: 'http_' + res.status, message: res.statusText }))
    if (!res.ok) throw Object.assign(new Error(body.message), { code: body.code, status: res.status, conflicts: body.conflicts, findings: body.findings })
    return body as Upload
  },
  reject: (id: string, reason: string) => api<Upload>(`/uploads/${id}/reject`, json({ reason })),
  reextract: (id: string, pages: number[]) => api<Upload>(`/uploads/${id}/reextract`, json({ pages })),
  deals: () => api<Deal[]>('/master/deals'),
  programs: () => api<Program[]>('/master/programs'),
  audit: (uploadId: string) => api<AuditEntry[]>(`/audit?upload_id=${encodeURIComponent(uploadId)}`),
  // Wave B: value edits while in review, and corrections after publish (contracts/openapi.yaml).
  edits: (id: string) => api<ValueEdit[]>(`/uploads/${id}/edits`),
  editValue: (id: string, pointer: string, value: number, reason: string) =>
    api<ValueEditResult>(`/uploads/${id}/edits`, json({ pointer, value, reason })),
  revertEdit: (id: string, editId: string, reason: string) =>
    api<ValueEditResult>(`/uploads/${id}/edits/${editId}/revert`, json({ reason })),
  uploadCorrections: (id: string) => api<Correction[]>(`/uploads/${id}/corrections`),
  correct: (id: string, body: CorrectionRequest) => api<Correction>(`/uploads/${id}/corrections`, json(body)),
  corrections: (status?: CorrectionStatus) => api<Correction[]>('/corrections' + (status ? `?status=${status}` : '')),
  correction: (cid: string) => api<CorrectionDetail>(`/corrections/${cid}`),
  approveCorrection: (cid: string) => api<Correction>(`/corrections/${cid}/approve`, { method: 'POST' }),
  rejectCorrection: (cid: string, reason: string) => api<Correction>(`/corrections/${cid}/reject`, json({ reason })),
  regenerate: (programSlug?: string) =>
    api<{ queued?: boolean; programs?: string[]; publications?: number } | undefined>('/published/regenerate', json(programSlug ? { program_slug: programSlug } : {})),
}

// One object URL per page image and dpi for the session; the same page is shown by several cards and the page viewer.
// 110 dpi (the contract default, no query) is the finding-card crop; the page viewer also asks for 200 and 300.
const pageCache = new Map<string, Promise<string>>()

export type PageDpi = 110 | 200 | 300

export function pageImagePath(uploadId: string, page: number, dpi: PageDpi = 110): string {
  return `/uploads/${uploadId}/pages/${page}.png` + (dpi === 110 ? '' : `?dpi=${dpi}`)
}

export function pageImageUrl(uploadId: string, page: number, dpi: PageDpi = 110): Promise<string> {
  const role = loadRole()
  const key = `${role}:${uploadId}:${page}:${dpi}`
  let p = pageCache.get(key)
  if (!p) {
    p = apiBlob(pageImagePath(uploadId, page, dpi)).then(b => URL.createObjectURL(b))
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
    case 'no_target': return 'This finding names no single value to change. Use Accept as restatement or Acknowledge.'
    case 'conflicting_corrections': return 'Two resolutions write different values to the same field, so nothing was published. Saved choices cannot be changed: re-extract the pages or reject the report.'
    case 'correction_inconsistent': return 'Writing the corrections makes another rule fail, so nothing was published. Use report or re-extract instead.'
    case 'bad_state': return err.message || 'The report is not in a state that allows this action. Reload the page.'
    case 'not_open': return 'That finding was already resolved. The list has been refreshed.'
    case 'already_reverted': return 'That edit was already reverted. The list has been refreshed.'
    case 'correction_pending': return 'A correction of this report is already waiting in the approval queue. Approve or reject it first.'
    case 'invalid': return err.message || 'The API could not find that value, or it is not a number.'
    case 'admin_only': case 'tao_only': return 'Your role cannot do this. Only a TAO admin can.'
  }
  if (err?.status === 403) return 'Your role cannot do this. Only a TAO admin can.'
  return err?.message || 'The request failed. Try again in a moment.'
}
