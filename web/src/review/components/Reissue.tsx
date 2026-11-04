import { Link } from 'react-router-dom'
import { StatusPill, formatPeriod } from '@/design/components'
import { formatDateTime } from '../lib/format'
import type { ReissueInfo } from '../lib/reissue'
import type { Upload } from '../lib/types'

export const reviewHref = (id: string) => `/admin/uploads/queue/${id}`
export const ReissueTag = () => <StatusPill tone="blue" size="sm">Re-issue</StatusPill>

const months = (ps: string[]) => ps.map(formatPeriod).join(', ')

/** Top-of-page banner on a corrected re-issue (what publishing replaces, and the later months it leaves alone), or on
 * an upload a re-issue has replaced (where the newer report is). */
export function ReissueBanner({ upload: u, dealName, info, replacedPublishedAt }: {
  upload: Upload; dealName: string; info: ReissueInfo | null; replacedPublishedAt?: string | null
}) {
  const period = formatPeriod(u.collection_period)
  if (u.replaced_by_upload_id) {
    return (
      <div className="rv-banner rv-banner--blue" role="note" aria-label="Replaced report">
        <p><b>Replaced by a corrected re-issue.</b> Partners now see the newer {dealName} {period} report; this one stays for the record.</p>
        <Link to={reviewHref(u.replaced_by_upload_id)}>Open the re-issue</Link>
      </div>
    )
  }
  if (!info) return null
  const when = info.publishedAt ?? replacedPublishedAt
  const date = when ? formatDateTime(when) : 'earlier'
  const published = u.status === 'published'
  return (
    <div className={'rv-banner ' + (published ? 'rv-banner--blue' : 'rv-banner--warn')} role="note" aria-label="Corrected re-issue">
      <p>
        <b>Corrected re-issue of {dealName} {period}.</b>{' '}
        {published ? `It replaced the report published ${date}.` : `Publishing replaces the report published ${date}.`}
      </p>
      {info.laterPeriods.length > 0 && (
        <p data-testid="later-periods">
          Later published months ({months(info.laterPeriods)}) still carry the earlier figures for {period}.
          {published ? ' Publishing the re-issue did not change them.' : ' Publishing this re-issue does not change them.'}
        </p>
      )}
      <Link to={reviewHref(info.replacesId)}>Open the replaced report</Link>
    </div>
  )
}
