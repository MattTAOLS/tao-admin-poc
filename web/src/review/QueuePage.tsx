import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { DataTable, StatePanel, StatusPill, Button, UploadStatusPill, SeverityPill, formatPeriod, type Column } from '@/design/components'
import { usePageHeader } from '@/shell/header'
import { access, errorText, reviewApi } from './lib/api'
import { useLoad } from './lib/useLoad'
import { useMasterNames } from './lib/master'
import { formatDateTime } from './lib/format'
import type { Correction, Upload } from './lib/types'
import { ReissueTag } from './components/Reissue'
import { CorrectionTag, correctionPath } from './components/Corrections'
import './review.css'

export const QUEUE_PATH = '/admin/uploads/queue'
export const reviewPath = (id: string) => `${QUEUE_PATH}/${id}`

/** The On hold marker: a TAO Admin saved the report for later. A marker beside the status, never a status itself. */
export function OnHoldPill({ size }: { size?: 'md' | 'sm' }) {
  return <StatusPill tone="neutral" size={size} data-testid="on-hold">On hold</StatusPill>
}

/** Uploads waiting for a reviewer: needs_review, plus approved-but-unpublished if that state is ever used.
 * Oldest first, so the report that has waited longest is at the top. */
export async function loadQueue(): Promise<Upload[]> {
  const [review, approved] = await Promise.all([reviewApi.uploads('needs_review'), reviewApi.uploads('approved').catch(() => [] as Upload[])])
  return [...review, ...approved].sort((a, b) => a.uploaded_at.localeCompare(b.uploaded_at))
}

/** One queue row: an upload waiting for review, or a correction of a published report (decision B1). */
export type QueueRow =
  | { kind: 'upload'; key: string; at: string; upload: Upload }
  | { kind: 'correction'; key: string; at: string; correction: Correction }

/** The queue: uploads (oldest first) plus corrections waiting for approval. A missing corrections route (the API before
 * wave B) leaves only the uploads. */
export async function loadQueueRows(): Promise<QueueRow[]> {
  const [uploads, corrections] = await Promise.all([loadQueue(), reviewApi.corrections('needs_review').catch(() => [] as Correction[])])
  return [
    ...uploads.map(u => ({ kind: 'upload' as const, key: u.id, at: u.uploaded_at, upload: u })),
    ...corrections.map(c => ({ kind: 'correction' as const, key: 'c:' + c.id, at: c.created_at, correction: c })),
  ].sort((a, b) => a.at.localeCompare(b.at))
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
  const q = useLoad(loadQueueRows, [])
  const [show, setShow] = useState<'all' | 'hold'>('all')
  const { dealName, programName, deals } = useMasterNames()
  const href = (r: QueueRow) => (r.kind === 'upload' ? reviewPath(r.upload.id) : correctionPath(r.correction.upload_id, r.correction.id))
  const slug = (r: QueueRow) => (r.kind === 'upload' ? r.upload.deal_slug : r.correction.deal_slug ?? '')
  const program = (r: QueueRow) => (r.kind === 'upload' ? r.upload.program_slug : deals.find(d => d.slug === r.correction.deal_slug)?.program_slug ?? '')
  const period = (r: QueueRow) => (r.kind === 'upload' ? r.upload.collection_period : r.correction.collection_period ?? '')
  const label = (r: QueueRow) => `${dealName(slug(r))} ${formatPeriod(period(r))}${r.kind === 'correction' ? ' correction' : ''}`

  if (q.error && !q.data) {
    return <StatePanel kind="error" message={errorText(q.error)} actions={<Button onClick={() => q.reload()}>Retry</Button>} />
  }

  const counts = (r: QueueRow) => (r.kind === 'upload' ? r.upload.finding_counts : r.correction.finding_counts)
  const columns: Column<QueueRow>[] = [
    { key: 'deal', header: 'Deal', emphasis: true, sortValue: r => dealName(slug(r)),
      render: r => <span className="rv-dealcell"><Link to={href(r)} className="rv-rowlink" onClick={e => e.stopPropagation()} aria-label={r.kind === 'correction' ? `${dealName(slug(r))} correction` : undefined}>{dealName(slug(r))}</Link>
        {r.kind === 'upload' && r.upload.replaces_upload_id && <ReissueTag />}
        {r.kind === 'correction' && <><CorrectionTag /><span className="rv-sub">version {r.correction.version} · {r.correction.edits?.length ?? 0} value{r.correction.edits?.length === 1 ? '' : 's'}</span></>}</span> },
    { key: 'program', header: 'Program', render: r => programName(program(r)) },
    { key: 'period', header: 'Collection period', sortValue: r => period(r),
      render: r => <>{formatPeriod(period(r))}{r.kind === 'upload' && r.upload.reporting_period && <span className="rv-sub">reporting {formatPeriod(r.upload.reporting_period)}</span>}</> },
    { key: 'status', header: 'Status', render: r => {
      const hold = r.kind === 'upload' ? r.upload.hold : null
      return <>
        <span className="rv-pills"><UploadStatusPill status={r.kind === 'upload' ? r.upload.status : 'needs_review'} size="sm" />{hold && <OnHoldPill size="sm" />}</span>
        {hold?.note && <span className="rv-sub rv-holdnote" title={hold.note} data-testid="hold-note">“{hold.note}”</span>}
        {hold && <span className="rv-sub" data-testid="hold-by">{hold.by_label}, {formatDateTime(hold.at)}</span>}
      </>
    } },
    { key: 'findings', header: 'Findings', sortValue: r => { const c = counts(r) ?? {}; return -((c.block ?? 0) * 1e6 + (c.review ?? 0) * 1e3 + (c.note ?? 0)) },
      render: r => <FindingCountPills counts={counts(r)} /> },
    { key: 'uploaded_by', header: 'Uploaded by', render: r => (r.kind === 'upload' ? r.upload.uploaded_by : r.correction.created_by) },
    { key: 'uploaded_at', header: 'Uploaded', numeric: true, sortValue: r => r.at, render: r => formatDateTime(r.at) },
  ]

  const all = q.data ?? []
  const held = all.filter(r => r.kind === 'upload' && !!r.upload.hold)
  const rows = show === 'hold' ? held : all

  return (
    <div className="rv-page">
      <div className="rv-sections" role="group" aria-label="Show reports">
        <button type="button" className="rv-chip" aria-pressed={show === 'all'} onClick={() => setShow('all')}>All{q.data ? ` ${all.length}` : ''}</button>
        <button type="button" className="rv-chip" aria-pressed={show === 'hold'} onClick={() => setShow('hold')}>On hold{q.data ? ` ${held.length}` : ''}</button>
      </div>
      <DataTable<QueueRow>
        caption="Reports waiting for review" captionHidden
        columns={columns} rows={rows} rowKey={r => r.key} loading={q.loading && !q.data}
        onRowClick={r => nav(href(r))} rowLabel={label}
        empty={show === 'hold' && all.length > 0
          ? { title: 'Nothing on hold', message: 'A report is On hold after a TAO Admin saves it for later on the review page.' }
          : { title: 'Nothing waiting for review', message: 'New uploads appear here once extraction and validation finish.' }}
      />
    </div>
  )
}
