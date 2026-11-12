/** Shapes from contracts/openapi.yaml and contracts/finding.schema.json, plus the extra fields the real API returns
 * (marked "real API only"; see docs/requests.md › Data & API). Every extra is optional so the mock still fits. */
import type { FindingView, UploadStatus } from '@/design/components'

export type Upload = {
  id: string
  deal_slug: string
  program_slug: string
  partner_slug: string
  /** Every partner the program is visible to (the API sends it; older responses only partner_slug). */
  partner_slugs?: string[]
  collection_period: string
  reporting_period?: string | null
  status: UploadStatus
  file_name: string
  page_count?: number | null
  uploaded_by: string
  uploaded_at: string
  finding_counts?: { block?: number; review?: number; note?: number }
  latest_extraction_id?: string | null
  published_at?: string | null
  /** real API only */
  reject_reason?: string | null
  /** Set while status is extraction_failed: why extraction failed (newest extract audit reason). */
  failure_reason?: string | null
  /** Corrected re-issue: the published upload this one replaces on approve. */
  replaces_upload_id?: string | null
  /** Set on a published upload once a re-issue for its period is approved. */
  replaced_by_upload_id?: string | null
  /** Wave B: value edits in force (not reverted) on this upload. */
  active_edit_count?: number
  /** Wave B: current publication version; null until published. */
  published_version?: number | null
  /** Wave B: a correction waiting in the approval queue. */
  pending_correction_id?: string | null
  /** Set while a TAO Admin has saved the report for later (On hold): a marker on a needs_review upload, not a status. */
  hold?: Hold | null
  /** What was in the publish pop-up when it was last saved; kept until the report is published or rejected. */
  draft?: PublishDraft | null
}

/** contracts/openapi.yaml › NotifyChoices: per-person choices for one publish only, never a subscription. */
export type NotifyChoices = { add?: string[]; remove?: string[] }
/** contracts/openapi.yaml › Upload.hold. `by` is null in role-only mode; `by_label` is the name to show. */
export type Hold = { at: string; by: { id: string; name: string } | null; by_label: string; note: string | null }
/** contracts/openapi.yaml › Upload.draft. */
export type PublishDraft = { note_to_partners: string | null; notify: NotifyChoices }
/** contracts/openapi.yaml › HoldRequest: every key is optional. */
export type HoldRequest = { note?: string | null; note_to_partners?: string | null; notify?: NotifyChoices }

/** `targets`: JSON pointers approve writes to on use_ours / use_report (finding.schema.json). */
export type Finding = FindingView & { extraction_id?: string; created_at?: string; targets?: string[] }

export type Source = { page: number; raw_text: string; bbox?: number[] | null; confidence?: number | null; pass?: number }

export type ExtractionMeta = {
  upload_id?: string
  pass?: number
  pages_reread?: number[]
  template_id?: string
  page_count?: number
  reporting_period?: string | null
  confidence?: number | null
  /** real API only: months carried over from the last publication (no per-field source in this upload). */
  history?: { carried?: string[]; periods?: string[]; extended_from?: string | null }
  [k: string]: unknown
}

export type Extraction = {
  id: string
  upload_id: string
  meta: ExtractionMeta
  deal: Record<string, unknown>
  sources: Record<string, Source>
  /** real API only */
  pass?: number
  /** real API only */
  confidence?: number | null
  /** real API only */
  created_at?: string
}

export type Deal = { slug: string; name: string; program_slug: string; servicer: string; template_id: string }
export type Program = { slug: string; name: string; partner_slug: string; currency: string; limit: number; warehouse_limit?: number | null }

export type AuditEntry = {
  id: string
  at: string
  actor_role: string
  actor_label?: string
  action: string
  upload_id: string | null
  finding_id?: string | null
  reason?: string | null
  detail?: Record<string, unknown>
}

export type OverrideChoice = 'use_ours' | 'use_report' | 'restatement' | 'acknowledge'

/** 409 conflicting_corrections body item. */
export type CorrectionConflict = { pointer: string; values: unknown[]; finding_ids: string[]; rule_ids: string[] }
/** 409 correction_inconsistent body item: a block finding the corrected deal raises. */
export type KnockOnFinding = { rule_id: string; message: string; fields?: string[]; our_value?: unknown; report_value?: unknown }

export type ApiError = Error & { code?: string; status?: number; conflicts?: CorrectionConflict[]; findings?: KnockOnFinding[] }

export type FindingCounts = { block?: number; review?: number; note?: number }

/** contracts/openapi.yaml › ValueEdit: a TAO Admin's change to one extracted number (in review, or in a correction). */
export type ValueEdit = {
  id: string
  upload_id: string
  correction_id?: string | null
  pointer: string
  old_value: number
  new_value: number
  reason: string
  source_page?: number | null
  actor_role: string
  actor_label?: string | null
  at: string
  reverted_at?: string | null
  reverted_by?: string | null
  revert_reason?: string | null
}

export type ValueEditResult = { edit: ValueEdit; finding_counts: FindingCounts }

export type CorrectionStatus = 'needs_review' | 'published' | 'rejected'

/** contracts/openapi.yaml › Correction: a change to a published report without a new PDF. */
export type Correction = {
  id: string
  upload_id: string
  deal_slug?: string
  collection_period?: string
  status: CorrectionStatus
  version: number
  edits: ValueEdit[]
  reason: string
  note_to_partners?: string | null
  finding_counts?: FindingCounts
  created_at: string
  created_by: string
  decided_at?: string | null
  decided_by?: string | null
  reject_reason?: string | null
}

/** GET /corrections/{id}: the correction plus the findings of its rule re-run. */
export type CorrectionDetail = Correction & { findings?: Finding[] }

/** contracts/openapi.yaml › PublicationVersion. */
export type PublicationVersion = { version: number; published_at: string; published_by: string; correction_id?: string | null; reason?: string | null; note_to_partners?: string | null; current?: boolean }

export type CorrectionRequest = { edits: { pointer: string; value: number }[]; reason: string; note_to_partners?: string | null }

// Wave C: comments, the caller, publish note and recipients (contracts/openapi.yaml).

/** contracts/openapi.yaml › ThreadAnchor: exactly one of finding_id or pointer. */
export type ThreadAnchor = { finding_id?: string; pointer?: string; rule_id?: string | null }
export type CommentAuthor = { id: string; name: string }
export type Comment = {
  id: string
  thread_id: string
  author: CommentAuthor
  body: string
  mentions: string[]
  created_at: string
  edited_at: string | null
}
export type Thread = {
  id: string
  upload_id: string
  anchor: ThreadAnchor
  status: 'open' | 'resolved'
  /** Publication version current when the thread started; null before the first publish. */
  version?: number | null
  created_by: CommentAuthor
  created_at: string
  resolved_by?: CommentAuthor | null
  resolved_at?: string | null
  /** Oldest first. */
  comments: Comment[]
}

/** contracts/openapi.yaml › AppUser (the fields the review pages use). */
export type AppUser = { id: string; email: string; name: string; role: string; partner_slug: string | null; status: 'active' | 'deactivated' }
/** contracts/openapi.yaml › Me: user is null in demo mode (no X-User). */
export type Me = { user: AppUser | null; role: string; partner_slug: string | null }

export type RecipientChannel = 'in_app' | 'email'
export type NotReason = 'not_subscribed' | 'deactivated' | 'not_visible' | 'switched_off' | 'partner_notifications_off'
export type Recipients = {
  /** can_change: the person can be left out of this publish (always true on the contract API). */
  notified: { user_id: string; name: string; partner_slug: string | null; channels: RecipientChannel[]; can_change?: boolean }[]
  /** can_change: true only for not_subscribed (the person can be added by hand); false rows are shown locked. */
  not_notified: { user_id: string; name: string; partner_slug?: string | null; reason: NotReason; can_change?: boolean }[]
}
