/** Corrected re-issues (contracts/openapi.yaml › Upload.replaces_upload_id / replaced_by_upload_id; R12 on a re-issue).
 * The R12 finding's context names the publication being replaced and any later published months. */
import type { Finding, Upload } from './types'

export type ReissueInfo = { replacesId: string; publishedAt: string | null; period: string | null; laterPeriods: string[]; finding?: Finding }

export const isReissueFinding = (f: Finding) =>
  f.rule_id === 'R12' && !!f.context && (f.context.reissue === true || typeof f.context.replaces_upload_id === 'string')

/** Re-issue facts for an upload, from the upload plus its R12 finding when present. Null when not a re-issue. */
export function reissueInfo(u: Upload, findings: Finding[] | undefined): ReissueInfo | null {
  if (!u.replaces_upload_id) return null
  const f = findings?.find(isReissueFinding)
  const ctx = (f?.context ?? {}) as Record<string, unknown>
  const later = Array.isArray(ctx.later_periods) ? ctx.later_periods.filter((p): p is string => typeof p === 'string') : []
  const at = typeof ctx.published_at === 'string' && ctx.published_at !== 'earlier' ? ctx.published_at : null
  return { replacesId: u.replaces_upload_id, publishedAt: at, period: typeof ctx.period === 'string' ? ctx.period : u.collection_period, laterPeriods: later, finding: f }
}
