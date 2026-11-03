import { Link } from 'react-router-dom'
import { UploadStatusPill, formatPeriod, type UploadStatus } from '@/design/components'
import { paths, usePublished } from './data'
import { dealPeriod } from './fmt'
import { reviewHref } from './nav'
import type { Deal, UploadSummary } from './types'

/** TAO Admin shell only: the upload behind this period, its status and a link to its review page, plus any newer
 * upload still in the pipeline. Uses the publication metadata the deal carries; the upload list is TAO-only and is
 * never requested from a partner shell. */
export function AdminStrip({ deal }: { deal: Deal }) {
  const period = dealPeriod(deal)
  const uploads = usePublished<UploadSummary[]>(paths.uploads(deal.deal_slug))
  const list = uploads.state === 'ok' && Array.isArray(uploads.data) ? uploads.data : []
  const forPeriod = list.filter(u => u.collection_period === period)
  const shown = forPeriod.find(u => u.id === deal.upload_id) ?? forPeriod.find(u => u.status === 'published') ?? forPeriod[0]
  const uploadId = shown?.id ?? (typeof deal.upload_id === 'string' ? deal.upload_id : undefined)
  const status = (shown?.status ?? (deal.published_at ? 'published' : undefined)) as UploadStatus | undefined
  const newer = list.filter(u => period && u.collection_period > period && u.status !== 'rejected')
    .sort((a, b) => b.collection_period.localeCompare(a.collection_period))[0]
  return (
    <div className="pf-strip" role="region" aria-label="Upload status">
      <span className="pf-strip__label">Upload · {formatPeriod(period)}</span>
      {status ? <UploadStatusPill status={status} size="sm" /> : <span className="pf-muted">No upload on record</span>}
      {deal.published_at && <span className="pf-muted pf-small">published {new Date(deal.published_at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}{deal.published_by ? ` by ${deal.published_by}` : ''}</span>}
      {uploadId && <Link className="pf-strip__link" to={reviewHref(uploadId)}>Open review for {formatPeriod(period)}</Link>}
      {newer && <span className="pf-strip__newer">Newer upload {formatPeriod(newer.collection_period)}: <UploadStatusPill status={newer.status as UploadStatus} size="sm" /> <Link className="pf-strip__link" to={reviewHref(newer.id)}>Review</Link></span>}
    </div>
  )
}
