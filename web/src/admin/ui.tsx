import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button, KpiTile, StatePanel, formatNumber, type SelectOption } from '@/design/components'
import type { ApiError, Deal, FindingCounts, Program, Upload } from './data'
import rulesYaml from '@contracts/rules.yaml?raw'
import './admin.css'

/** Error panel for a failed load. 403 is the no-access state (the API, not the UI, is the boundary). */
export function LoadError({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  if (error.status === 403) return <StatePanel kind="no-access" message="Your role can’t open this data. Switch role in the sidebar to see it." />
  if (error.status === 404) return <StatePanel kind="not-found" title="Not found" message={error.message || 'This record does not exist.'} />
  return (
    <StatePanel kind="error" message={error.message ? `The request failed: ${error.message}` : undefined}
      actions={onRetry ? <Button onClick={onRetry}>Try again</Button> : undefined} />
  )
}

/** Human-readable error for an action (upload, save). */
export function errorText(e: ApiError): string {
  switch (e.code) {
    case 'already_published': return 'This deal and collection period are already published. Upload the file as a corrected re-issue to replace it.'
    case 'nothing_to_replace': return 'Nothing is published for this deal and collection period yet, so there is nothing to replace. Upload it as a normal report.'
    case 'upload_in_progress': return 'An upload for this deal and collection period is already in progress. Find it in Upload history.'
    case 'not_a_pdf': return 'The file is not a readable PDF.'
    case 'unknown_deal': return 'The API does not know this deal. Refresh the page and pick it again.'
    // PUT /master/covenants (CovenantChange)
    case 'not_current': return 'This version has already been replaced by another change. Close the dialog, and edit the version the table shows now.'
    case 'exists': return 'This deal already has a covenant with this legal reference. Edit that covenant instead of adding it again.'
    case 'effective_not_later': return 'A new version must start after the current version’s effective date. Pick a later date, or choose Correct the current version.'
    case 'tao_only': case 'admin_only': return 'Your role can’t do this. Switch to TAO Admin in the sidebar.'
    // Wave C: users, subscriptions and settings
    case 'self_change': return 'You can’t change your own role or deactivate yourself. Ask another TAO Admin to do it.'
    case 'last_admin': return 'This would leave no active TAO Admin, or leave a partner without an active Company Admin. Add or promote another admin first.'
    case 'other_partner': return 'A Company Admin can only add or change their own company’s admins and viewers, never TAO staff or another partner’s people.'
    case 'email_taken': return 'Another user already has this email address. Search for them in the table instead.'
    case 'role_partner_mismatch': return 'TAO roles have no partner, and investor or manager roles need their own partner. Check the role and partner.'
    case 'not_visible': return 'One of the ticked programs is not shared with this user’s partner, so they can’t receive its reports. Untick it, or share the program on Partner details first.'
    case 'unknown_partner': return 'The API does not know this partner. Refresh the page and pick it again.'
    case 'email_later': return 'Email is coming later. Phase 2 sends in-app notifications only.'
    case 'already_active': return 'This user is already active. Refresh the page to see the current status.'
    case 'already_deactivated': return 'This user is already deactivated. Refresh the page to see the current status.'
    case 'company_admin_only': return 'Only a TAO Admin, or the partner’s Company Admin, can manage users.'
    case 'unknown_setting': return 'The API does not know this setting. Refresh the page; the platform may be on an older version.'
    case 'unknown_program': return 'The API does not know one of the ticked programs. Refresh the page and try again.'
    case 'inactive_user': return 'Your account is deactivated, so the API refused the request. Sign in as another user.'
    case 'unknown_user': return 'The API does not know the signed-in user. Sign in again from the sidebar.'
  }
  if (e.status === 403) return 'Your role can’t do this. Switch to TAO Admin in the sidebar.'
  return e.message || 'The request failed. Try again in a moment.'
}

const DT = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
/** ISO timestamp → "Nov 3, 2026, 15:08" in the viewer's zone. */
export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : DT.format(d)
}
export const isoMonth = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
/** The month before "YYYY-MM". */
export function prevMonth(p: string) {
  const [y, m] = p.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

/** "YYYY-MM" moved by n months (negative goes back). */
export function addMonths(p: string, n: number) {
  const [y, m] = p.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

/** Months from the page-header (reporting) month to the collection period, per template id, read from
 * `reporting_lag_months` in contracts/rules.yaml (F-PIL 1, MOVE Trust 0). Line scan, like review/lib/rules.ts. */
export function parseReportingLags(yaml: string): Record<string, number> {
  const out: Record<string, number> = {}
  let inBlock = false
  for (const line of yaml.split(/\r?\n/)) {
    if (/^reporting_lag_months:\s*$/.test(line)) { inBlock = true; continue }
    if (!inBlock) continue
    const m = /^\s+([\w.-]+):\s*(-?\d+)\s*$/.exec(line)
    if (m) out[m[1]] = Number(m[2])
    else if (line.trim() && !/^\s/.test(line)) break
  }
  return out
}
export const REPORTING_LAG = parseReportingLags(rulesYaml)
/** Unknown template: 1, as rule R04 assumes. */
export const reportingLag = (templateId?: string | null) => REPORTING_LAG[templateId ?? ''] ?? 1

/** Deals grouped by program name, for <Select options>. */
export function dealOptions(deals: Deal[], programs: Program[]): { group: string; options: SelectOption[] }[] {
  const byProgram = new Map<string, Deal[]>()
  for (const d of deals) byProgram.set(d.program_slug, [...(byProgram.get(d.program_slug) ?? []), d])
  const name = (slug: string) => programs.find(p => p.slug === slug)?.name ?? slug
  return [...byProgram.entries()]
    .sort((a, b) => name(a[0]).localeCompare(name(b[0])))
    .map(([slug, ds]) => ({ group: name(slug), options: ds.slice().sort((a, b) => a.name.localeCompare(b.name)).map(d => ({ value: d.slug, label: d.name })) }))
}

export const totalFindings = (c?: FindingCounts) => (c?.block ?? 0) + (c?.review ?? 0) + (c?.note ?? 0)

/** "2 block · 1 review · 0 note" with numbers; words carry the meaning, not colour. */
export function FindingCountsText({ counts }: { counts?: FindingCounts }) {
  if (!counts) return <span className="adm-muted">—</span>
  return (
    <span className="adm-counts">
      <span>{formatNumber(counts.block ?? 0)} block</span>
      <span>{formatNumber(counts.review ?? 0)} review</span>
      <span>{formatNumber(counts.note ?? 0)} note</span>
    </span>
  )
}

export const reviewHref = (id: string) => `/admin/uploads/queue/${id}`
/** Upload history filtered to one deal and period: shows a re-issue next to the upload it replaces. */
export const periodHistoryHref = (deal: string, period: string) => `/admin/uploads/history?deal=${encodeURIComponent(deal)}&period=${encodeURIComponent(period)}`
export const auditHref = (uploadId: string) => `/admin/settings/users/audit?upload_id=${encodeURIComponent(uploadId)}`
/** The published deal page at one collection period (the deal page reads ?period=YYYY-MM). */
export const dealPageHref = (program: string, deal: string, period?: string | null) =>
  `/admin/portfolio/${encodeURIComponent(program)}/deals/${encodeURIComponent(deal)}${period ? `?period=${encodeURIComponent(period)}` : ''}`

export type UploadTarget = { href: string; verb: 'Review' | 'Open deal' | 'Details'; label: string }
/** Where an upload row opens, by status (D4): Review when in review or approved; the published deal page at the
 * upload's own collection period when published (a replaced publication too); upload details otherwise (failed,
 * rejected, received, extracting). `name` and `period` are only for the accessible label. */
export function uploadTarget(u: Pick<Upload, 'id' | 'status' | 'program_slug' | 'deal_slug' | 'collection_period'>, name: string, period: string): UploadTarget {
  if (u.status === 'needs_review' || u.status === 'approved') return { href: reviewHref(u.id), verb: 'Review', label: `Review ${name} ${period}` }
  if (u.status === 'published') return { href: dealPageHref(u.program_slug, u.deal_slug, u.collection_period), verb: 'Open deal', label: `Open the published deal ${name} ${period}` }
  const what = u.status === 'extraction_failed' ? 'the failed upload' : u.status === 'rejected' ? 'the rejected upload' : 'the upload'
  return { href: reviewHref(u.id), verb: 'Details', label: `Details of ${what} ${name} ${period}` }
}

export function TextLink({ to, children, label }: { to: string; children: ReactNode; label?: string }) {
  return <Link className="adm-link" to={to} aria-label={label} onClick={e => e.stopPropagation()}>{children}</Link>
}

export type QueueCounts = { received: number; extracting: number; needs_review: number; published_this_month: number }
export function queueCounts(uploads: Upload[], now = new Date()): QueueCounts {
  const month = isoMonth(now)
  const c: QueueCounts = { received: 0, extracting: 0, needs_review: 0, published_this_month: 0 }
  for (const u of uploads) {
    if (u.status === 'received') c.received++
    else if (u.status === 'extracting') c.extracting++
    else if (u.status === 'needs_review') c.needs_review++
    if (u.status === 'published' && u.published_at && isoMonth(new Date(u.published_at)) === month) c.published_this_month++
  }
  return c
}

/** The four queue tiles shared by Dashboard and Uploads. */
export function QueueTiles({ uploads, loading }: { uploads?: Upload[]; loading?: boolean }) {
  const c = uploads ? queueCounts(uploads) : undefined
  const v = (n?: number) => (n === undefined ? undefined : formatNumber(n))
  return (
    <>
      <KpiTile label="Received" value={v(c?.received)} context="waiting for the worker" loading={loading} />
      <KpiTile label="Extracting" value={v(c?.extracting)} context="being read now" loading={loading} />
      <KpiTile label="Needs review" value={v(c?.needs_review)} tone={c && c.needs_review > 0 ? 'warn' : undefined}
        context={c && c.needs_review > 0 ? 'waiting for a TAO reviewer' : 'nothing waiting'} loading={loading} />
      <KpiTile label="Published this month" value={v(c?.published_this_month)} context={new Intl.DateTimeFormat('en-CA', { month: 'long', year: 'numeric' }).format(new Date())} loading={loading} />
    </>
  )
}
