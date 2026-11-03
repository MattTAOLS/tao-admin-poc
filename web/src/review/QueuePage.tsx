import { useNavigate, Link } from 'react-router-dom'
import { DataTable, StatePanel, Button, UploadStatusPill, SeverityPill, formatPeriod, type Column } from '@/design/components'
import { usePageHeader } from '@/shell/header'
import { access, errorText, reviewApi } from './lib/api'
import { useLoad } from './lib/useLoad'
import { useMasterNames } from './lib/master'
import { formatDateTime } from './lib/format'
import type { Upload } from './lib/types'
import './review.css'

export const reviewPath = (id: string) => `/admin/uploads/queue/${id}`

/** Uploads waiting for a reviewer: needs_review, plus approved-but-unpublished if that state is ever used.
 * Oldest first, so the report that has waited longest is at the top. */
export async function loadQueue(): Promise<Upload[]> {
  const [review, approved] = await Promise.all([reviewApi.uploads('needs_review'), reviewApi.uploads('approved').catch(() => [] as Upload[])])
  return [...review, ...approved].sort((a, b) => a.uploaded_at.localeCompare(b.uploaded_at))
}

export function FindingCountPills({ counts }: { counts: Upload['finding_counts'] }) {
  const c = counts ?? {}
  const any = (c.block ?? 0) + (c.review ?? 0) + (c.note ?? 0) > 0
  if (!any) return <span className="rv-muted">No findings</span>
  return (
    <span className="rv-pills">
      {(['block', 'review', 'note'] as const).map(s => (c[s] ?? 0) > 0 && <SeverityPill key={s} severity={s} count={c[s]} size="sm" />)}
    </span>
  )
}

export default function QueuePage() {
  const { tao } = access()
  usePageHeader({ title: 'Approval queue', subtitle: 'Reports waiting for a TAO reviewer, oldest first' })
  if (!tao) return <StatePanel kind="no-access" />
  return <Queue />
}

function Queue() {
  const nav = useNavigate()
  const q = useLoad(loadQueue, [])
  const { dealName, programName } = useMasterNames()

  if (q.error && !q.data) {
    return <StatePanel kind="error" message={errorText(q.error)} actions={<Button onClick={() => q.reload()}>Retry</Button>} />
  }

  const columns: Column<Upload>[] = [
    { key: 'deal', header: 'Deal', emphasis: true, sortValue: u => dealName(u.deal_slug),
      render: u => <Link to={reviewPath(u.id)} className="rv-rowlink" onClick={e => e.stopPropagation()}>{dealName(u.deal_slug)}</Link> },
    { key: 'program', header: 'Program', render: u => programName(u.program_slug) },
    { key: 'period', header: 'Collection period', sortValue: u => u.collection_period,
      render: u => <>{formatPeriod(u.collection_period)}{u.reporting_period && <span className="rv-sub">reporting {formatPeriod(u.reporting_period)}</span>}</> },
    { key: 'status', header: 'Status', render: u => <UploadStatusPill status={u.status} size="sm" /> },
    { key: 'findings', header: 'Findings', sortValue: u => -((u.finding_counts?.block ?? 0) * 1e6 + (u.finding_counts?.review ?? 0) * 1e3 + (u.finding_counts?.note ?? 0)),
      render: u => <FindingCountPills counts={u.finding_counts} /> },
    { key: 'uploaded_by', header: 'Uploaded by' },
    { key: 'uploaded_at', header: 'Uploaded', numeric: true, sortValue: u => u.uploaded_at, render: u => formatDateTime(u.uploaded_at) },
  ]

  return (
    <div className="rv-page">
      <DataTable<Upload>
        caption="Reports waiting for review" captionHidden
        columns={columns} rows={q.data ?? []} rowKey={u => u.id} loading={q.loading && !q.data}
        onRowClick={u => nav(reviewPath(u.id))} rowLabel={u => `${dealName(u.deal_slug)} ${formatPeriod(u.collection_period)}`}
        empty={{ title: 'Nothing waiting for review', message: 'New uploads appear here once extraction and validation finish.' }}
      />
    </div>
  )
}
