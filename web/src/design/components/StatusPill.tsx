import type { HTMLAttributes, ReactNode } from 'react'

export type Tone = 'ok' | 'warn' | 'bad' | 'blue' | 'dpv' | 'neutral'
export type StatusPillProps = HTMLAttributes<HTMLSpanElement> & {
  tone: Tone
  /** The word. Status is never colour alone, so this is required. */
  children: ReactNode
  /** Optional count shown after the word, e.g. "Block 2". */
  count?: number
  size?: 'md' | 'sm'
}

/** Dot plus a word. ok = approved / published / OK; warn = needs review / WATCH; bad = block / BREACH / rejected;
 * blue = informational; dpv = derived (our recomputation); neutral = not started. */
export function StatusPill({ tone, children, count, size = 'md', className, ...rest }: StatusPillProps) {
  const cls = ['ds-pill', `ds-pill--${tone}`, size === 'sm' && 'ds-pill--sm', className].filter(Boolean).join(' ')
  return (
    <span className={cls} {...rest}>
      <span className="ds-pill__dot" aria-hidden="true" />
      {children}
      {count !== undefined && <span className="ds-pill__count">{count}</span>}
    </span>
  )
}

// ---- Status vocabularies from the contracts, mapped once so every page shows the same word and tone ----

/** contracts/openapi.yaml UploadStatus. */
export type UploadStatus = 'received' | 'extracting' | 'needs_review' | 'approved' | 'rejected' | 'published' | 'extraction_failed'
export const UPLOAD_STATUS: Record<UploadStatus, { tone: Tone; label: string }> = {
  received: { tone: 'neutral', label: 'Received' },
  extracting: { tone: 'blue', label: 'Extracting' },
  needs_review: { tone: 'warn', label: 'Needs review' },
  approved: { tone: 'dpv', label: 'Approved' },
  published: { tone: 'ok', label: 'Published' },
  rejected: { tone: 'bad', label: 'Rejected' },
  extraction_failed: { tone: 'bad', label: 'Extraction failed' },
}
/** States where the 2 s status polling stops (motion.md). */
export const UPLOAD_TERMINAL: readonly UploadStatus[] = ['published', 'rejected', 'extraction_failed']

export function UploadStatusPill({ status, ...rest }: { status: UploadStatus } & Omit<StatusPillProps, 'tone' | 'children'>) {
  const s = UPLOAD_STATUS[status] ?? { tone: 'neutral' as Tone, label: String(status) }
  return <StatusPill tone={s.tone} {...rest}>{s.label}</StatusPill>
}

/** contracts/finding.schema.json severity. */
export type Severity = 'block' | 'review' | 'note'
export const SEVERITY: Record<Severity, { tone: Tone; label: string }> = {
  block: { tone: 'bad', label: 'Block' },
  review: { tone: 'warn', label: 'Review' },
  note: { tone: 'blue', label: 'Note' },
}
export function SeverityPill({ severity, ...rest }: { severity: Severity } & Omit<StatusPillProps, 'tone' | 'children'>) {
  const s = SEVERITY[severity]
  return <StatusPill tone={s.tone} {...rest}>{s.label}</StatusPill>
}

/** contracts/finding.schema.json status. */
export type FindingStatus = 'open' | 'resolved_by_pass_2' | 'overridden' | 'accepted_as_restatement' | 'rejected' | 'closed'
export const FINDING_STATUS: Record<FindingStatus, { tone: Tone; label: string }> = {
  open: { tone: 'warn', label: 'Open' },
  resolved_by_pass_2: { tone: 'ok', label: 'Resolved by pass 2' },
  overridden: { tone: 'dpv', label: 'Overridden' },
  accepted_as_restatement: { tone: 'blue', label: 'Restatement accepted' },
  rejected: { tone: 'bad', label: 'Rejected' },
  closed: { tone: 'neutral', label: 'Closed' },
}
export function FindingStatusPill({ status, ...rest }: { status: FindingStatus } & Omit<StatusPillProps, 'tone' | 'children'>) {
  const s = FINDING_STATUS[status] ?? { tone: 'neutral' as Tone, label: String(status) }
  return <StatusPill tone={s.tone} {...rest}>{s.label}</StatusPill>
}

/** Covenant status as the dashboards word it (docs/dashboard-json/SCHEMA.md): OK | WATCH | BREACH | AVAILABLE.
 * Accepts either case, so the published object's value can be passed straight through. */
export type CovenantStatus = 'ok' | 'watch' | 'breach' | 'available'
export const COVENANT_STATUS: Record<CovenantStatus, { tone: Tone; label: string }> = {
  ok: { tone: 'ok', label: 'OK' },
  watch: { tone: 'warn', label: 'WATCH' },
  breach: { tone: 'bad', label: 'BREACH' },
  available: { tone: 'neutral', label: 'AVAILABLE' },
}
/** A covenant whose value or threshold could not be read has no status (null): it reads "No value", never "null". */
export function CovenantPill({ status, ...rest }: { status: CovenantStatus | Uppercase<CovenantStatus> | string | null | undefined } & Omit<StatusPillProps, 'tone' | 'children'>) {
  if (status == null || status === '' || status === 'null') return <StatusPill tone="neutral" {...rest}>No value</StatusPill>
  const s = COVENANT_STATUS[String(status).toLowerCase() as CovenantStatus] ?? { tone: 'neutral' as Tone, label: String(status) }
  return <StatusPill tone={s.tone} {...rest}>{s.label}</StatusPill>
}
