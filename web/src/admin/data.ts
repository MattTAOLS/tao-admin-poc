/** Typed calls for the TAO Admin pages. Shapes follow contracts/openapi.yaml; fields the real API adds that the
 * contract does not list yet are marked "real API only" and always treated as optional. */
import { api, apiBlob } from '@/shell/api'
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
  /** Set while status is extraction_failed: why extraction failed (newest extract audit reason). */
  failure_reason?: string | null
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
  /** seed rows may be replaced by a later seed run; ui rows never are. */
  origin?: 'seed' | 'ui'
  /** Set when a correction or a seed run replaced this row (only with include_history=true). */
  superseded_at?: string | null
  /** The row this one corrected (mode=correct). */
  supersedes_id?: string | null
  /** Role or user label of the change that created this row; null for seed rows. */
  changed_by?: string | null
  change_reason?: string | null
  /** real API only (requested in docs/requests.md): when the row was written. Without it the page shows the date only
   * where it can be derived (a correction's time is the superseded row's superseded_at). */
  changed_at?: string | null
}
/** PUT /master/covenants (TAO Admin). new_version and add omit `id`; correct sends the current row's id. */
export type CovenantChangeMode = 'new_version' | 'correct' | 'add'
export type CovenantChange = CovenantDefinition & { mode: CovenantChangeMode; reason: string }
export type CovenantChangeResult = { definition: CovenantDefinition; superseded_id?: string | null; rerun_upload_ids: string[] }
export const AUDIT_ACTIONS = ['upload', 'extract', 'reextract', 'override', 'restate', 'approve', 'reject', 'publish', 'regenerate', 'master_change', 'export',
  'value_edit', 'value_edit_revert', 'correction', 'correction_approve', 'correction_reject'] as const
export type AuditAction = typeof AUDIT_ACTIONS[number]
/** The two audit tabs. The API derives the scope from the action (contracts/openapi.yaml /audit): reports = entries
 * with an upload_id, plus publish and regenerate; platform = everything else. */
export type AuditScope = 'reports' | 'platform'
export const PLATFORM_ACTIONS: readonly string[] = ['master_change', 'export']
export const REPORT_ACTIONS: readonly string[] = AUDIT_ACTIONS.filter(a => !PLATFORM_ACTIONS.includes(a))
/** Wave B actions about one report: always on the Reports tab, even if an entry arrives without an upload_id. */
const REPORT_ONLY: readonly string[] = ['publish', 'regenerate', 'value_edit', 'value_edit_revert', 'correction', 'correction_approve', 'correction_reject']
export const auditScope = (e: Pick<AuditEntry, 'action' | 'upload_id'>): AuditScope =>
  e.upload_id || REPORT_ONLY.includes(e.action) ? 'reports' : 'platform'
export type AuditQuery = {
  scope?: AuditScope; month?: string; q?: string; action?: string; actor_role?: string; deal_slug?: string; upload_id?: string
  limit?: number; offset?: number
}
export type AuditMonth = { month: string; count: number }
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
  /** The upload's deal (or detail.deal_slug); null for platform entries without a deal. */
  deal_slug?: string | null
  deal_name?: string | null
  /** YYYY-MM of the upload: MOVE Trust's own report month, F-PIL's settlement month. */
  collection_period?: string | null
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

const qs = (params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v || v === 0) p.set(k, String(v))
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
  /** Current rows only; with `history` also the rows a correction or a seed run replaced (superseded_at set). */
  covenants: (deal_slug?: string, history = false) => api<CovenantDefinition[]>('/master/covenants' + qs({ deal_slug, include_history: history ? 'true' : undefined })),
  putProgram: (p: Program) => api<Program>('/master/programs', { method: 'PUT', body: JSON.stringify(p) }),
  putDeal: (d: Deal) => api<Deal>('/master/deals', { method: 'PUT', body: JSON.stringify(d) }),
  putCovenant: (c: CovenantChange) => api<CovenantChangeResult>('/master/covenants', { method: 'PUT', body: JSON.stringify(c) }),
  portfolio: () => api<PublishedPortfolio>('/published/portfolio'),
  /** Parameters go out in a fixed order (scope, month, q, filters, paging) so the URL is stable. */
  audit: (f: AuditQuery = {}) => api<AuditEntry[]>('/audit' + qs({ scope: f.scope, month: f.month, q: f.q, upload_id: f.upload_id, action: f.action,
    actor_role: f.actor_role, deal_slug: f.deal_slug, limit: f.limit, offset: f.offset })),
  auditMonths: (scope: AuditScope, q?: string) => api<AuditMonth[]>('/audit/months' + qs({ scope, q })),
  /** One month of one tab as CSV; the API writes its own `export` entry to the Platform tab. */
  auditExport: (scope: AuditScope, month: string) => apiBlob('/audit/export.csv' + qs({ scope, month })),
}

/** Statuses the upload poller keeps watching (motion.md: 2 s while non-terminal; this page stops once it reaches review). */
export const IN_FLIGHT: readonly UploadStatus[] = ['received', 'extracting']
