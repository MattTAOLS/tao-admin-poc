/** Typed calls for the TAO Admin pages. Shapes follow contracts/openapi.yaml; fields the real API adds that the
 * contract does not list yet are marked "real API only" and always treated as optional. */
import { api } from '@/shell/api'
import type { UploadStatus } from '@/design/components'

export type FindingCounts = { block?: number; review?: number; note?: number }
export type Upload = {
  id: string
  deal_slug: string
  program_slug: string
  partner_slug: string
  collection_period: string
  reporting_period?: string | null
  status: UploadStatus
  file_name: string
  page_count?: number | null
  uploaded_by: string
  uploaded_at: string
  finding_counts?: FindingCounts
  latest_extraction_id?: string | null
  published_at?: string | null
  /** real API only */
  reject_reason?: string | null
  /** Corrected re-issue: the published upload this one replaces when approved. */
  replaces_upload_id?: string | null
  /** Set on a published upload once a re-issue for its period has been approved. */
  replaced_by_upload_id?: string | null
}
export type Program = {
  slug: string; name: string
  /** First partner, kept for compatibility. */
  partner_slug: string
  /** Every partner who sees the program (a program may be visible to several partners). */
  partner_slugs?: string[]
  currency: string; limit: number; warehouse_limit?: number | null
}
export type Partner = { slug: string; name: string; kind: 'investor' | 'manager' | string; status: string }
/** The partners a program is visible to: partner_slugs, or [partner_slug] from an older API. */
export const programPartners = (p: Program) => (p.partner_slugs?.length ? p.partner_slugs : [p.partner_slug])
export type ThresholdUnit = 'fraction' | 'ratio' | 'currency'
export type Deal = { slug: string; name: string; program_slug: string; servicer: string; template_id: string }
export type Band = { lte?: number; gt?: number; threshold: number }
export type ThresholdRule = { on: string; bands: Band[] }
export type CovenantDefinition = {
  /** Optional on PUT in the real API (omit = new definition / version); the contract marks it required. */
  id?: string
  deal_slug: string
  legal_ref: string
  description: string
  kind: 'ceiling' | 'floor'
  threshold?: number | null
  /** fraction: 0.035 = 3.5%; ratio: 1.10 = 1.10x; currency: an amount. Null = unknown (the page guesses). */
  unit?: ThresholdUnit | null
  threshold_rule?: ThresholdRule | null
  watch_buffer_pct?: number
  effective_from: string
  source?: string | null
}
export const AUDIT_ACTIONS = ['upload', 'extract', 'reextract', 'override', 'restate', 'approve', 'reject', 'publish', 'regenerate', 'master_change'] as const
export type AuditAction = typeof AUDIT_ACTIONS[number]
export type AuditEntry = {
  id: string
  at: string
  actor_role: string
  actor_label?: string
  action: AuditAction | string
  upload_id: string | null
  finding_id?: string | null
  reason?: string | null
  detail?: Record<string, unknown>
}
export type CovenantTotals = { BREACH?: number; WATCH?: number; OK?: number; AVAILABLE?: number }
export type PortfolioDeal = { deal_slug?: string; deal_name?: string; collection_period?: string; worst_status?: string }
/** The contract leaves PublishedPortfolio open (`type: object`). The real API returns {partner, programs[]};
 * each program has period, deal_count, covenant_totals, deals[] (index). Every field is read defensively. */
export type PortfolioProgram = {
  program?: { slug?: string; name?: string }
  period?: string
  deal_count?: number
  covenant_totals?: CovenantTotals
  deals_with_escalations?: string[]
  deals?: PortfolioDeal[]
}
export type PublishedPortfolio = { partner?: string | null; programs?: PortfolioProgram[] }

export type ApiError = Error & { code?: string; status?: number }

const qs = (params: Record<string, string | undefined>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v)
  const s = p.toString()
  return s ? '?' + s : ''
}

export const adminApi = {
  uploads: (f: { status?: string; deal_slug?: string; collection_period?: string } = {}) => api<Upload[]>('/uploads' + qs(f)),
  upload: (id: string) => api<Upload>(`/uploads/${encodeURIComponent(id)}`),
  /** `replace` uploads a corrected re-issue of a published period (otherwise the API answers 409 already_published). */
  createUpload: (deal_slug: string, collection_period: string, file: File, replace = false) => {
    const body = new FormData()
    body.set('deal_slug', deal_slug)
    body.set('collection_period', collection_period)
    if (replace) body.set('replace', 'true')
    body.set('file', file, file.name)
    return api<Upload>('/uploads', { method: 'POST', body })
  },
  partners: () => api<Partner[]>('/master/partners'),
  programs: () => api<Program[]>('/master/programs'),
  deals: (program_slug?: string) => api<Deal[]>('/master/deals' + qs({ program_slug })),
  covenants: (deal_slug?: string) => api<CovenantDefinition[]>('/master/covenants' + qs({ deal_slug })),
  putProgram: (p: Program) => api<Program>('/master/programs', { method: 'PUT', body: JSON.stringify(p) }),
  putDeal: (d: Deal) => api<Deal>('/master/deals', { method: 'PUT', body: JSON.stringify(d) }),
  putCovenant: (c: CovenantDefinition) => api<CovenantDefinition>('/master/covenants', { method: 'PUT', body: JSON.stringify(c) }),
  portfolio: () => api<PublishedPortfolio>('/published/portfolio'),
  audit: (f: { upload_id?: string; action?: string } = {}) => api<AuditEntry[]>('/audit' + qs(f)),
}

/** Statuses the upload poller keeps watching (motion.md: 2 s while non-terminal; this page stops once it reaches review). */
export const IN_FLIGHT: readonly UploadStatus[] = ['received', 'extracting']
