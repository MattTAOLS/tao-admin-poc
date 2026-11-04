import type { ReactNode } from 'react'
import { DataTable, UploadStatusPill, formatNumber, formatPeriod, type Column } from '@/design/components'
import type { Deal, Program, Upload } from './data'
import { TextLink, auditHref, formatDateTime, periodHistoryHref, reviewHref } from './ui'

/** One table for the recent list (Uploads) and the full history. Numbers right-aligned; status is a pill. */
export function UploadsTable({ uploads, deals, programs, loading, caption, empty, compact, showAudit = true }: {
  uploads: Upload[]; deals: Deal[]; programs: Program[]; loading?: boolean; caption: string
  empty: { title: string; message?: string; action?: ReactNode }; compact?: boolean; showAudit?: boolean
}) {
  const dealName = (slug: string) => deals.find(d => d.slug === slug)?.name ?? slug
  const programName = (slug: string) => programs.find(p => p.slug === slug)?.name ?? slug
  const columns: Column<Upload>[] = [
    { key: 'deal', header: 'Deal', emphasis: true, render: u => <span style={{ whiteSpace: 'nowrap' }}>{dealName(u.deal_slug)}</span>, sortValue: u => dealName(u.deal_slug) },
    { key: 'program', header: 'Program', render: u => programName(u.program_slug), sortValue: u => programName(u.program_slug) },
    { key: 'collection_period', header: 'Collection period', render: u => formatPeriod(u.collection_period), sortValue: u => u.collection_period },
    { key: 'reporting_period', header: 'Reporting period', render: u => formatPeriod(u.reporting_period), sortValue: u => u.reporting_period },
    { key: 'status', header: 'Status', render: u => <StatusCell u={u} all={uploads} />, sortValue: u => u.status },
    { key: 'block', header: 'Block', numeric: true, render: u => formatNumber(u.finding_counts?.block), sortValue: u => u.finding_counts?.block },
    { key: 'review', header: 'Review', numeric: true, render: u => formatNumber(u.finding_counts?.review), sortValue: u => u.finding_counts?.review },
    { key: 'note', header: 'Note', numeric: true, render: u => formatNumber(u.finding_counts?.note), sortValue: u => u.finding_counts?.note },
    ...(compact ? [] : [{ key: 'file', header: 'File', render: (u: Upload) => <span title={u.file_name}>{u.file_name}</span> } as Column<Upload>]),
    { key: 'by', header: 'Uploaded by', render: u => u.uploaded_by },
    { key: 'at', header: 'Uploaded', render: u => <time dateTime={u.uploaded_at}>{formatDateTime(u.uploaded_at)}</time>, sortValue: u => u.uploaded_at },
    {
      key: 'open', header: 'Open', ariaLabel: 'Open', render: u => (
        <span className="adm-actions">
          {u.status === 'needs_review' && <TextLink to={reviewHref(u.id)} label={`Review ${dealName(u.deal_slug)} ${formatPeriod(u.collection_period)}`}>Review</TextLink>}
          {showAudit && <TextLink to={auditHref(u.id)} label={`Audit trail for ${dealName(u.deal_slug)} ${formatPeriod(u.collection_period)}`}>Audit</TextLink>}
        </span>
      ),
    },
  ]
  return (
    <DataTable columns={columns} rows={uploads} rowKey={u => u.id} caption={caption} captionHidden loading={loading}
      empty={empty} density={compact ? 'compact' : 'normal'} rowLabel={u => `${dealName(u.deal_slug)} ${formatPeriod(u.collection_period)}`} />
  )
}

/** Status pill plus the re-issue tags: "Re-issue" on an upload that replaces a published one, "Replaced by re-issue"
 * on the published upload it superseded. Both link to Upload history for that deal and period, which lists the pair. */
function StatusCell({ u, all }: { u: Upload; all: Upload[] }) {
  const href = periodHistoryHref(u.deal_slug, u.collection_period)
  const other = (id?: string | null) => (id ? all.find(x => x.id === id) : undefined)
  const replaces = other(u.replaces_upload_id), replacedBy = other(u.replaced_by_upload_id)
  return (
    <span className="adm-status">
      <UploadStatusPill status={u.status} size="sm" />
      {u.replaces_upload_id && (
        <TextLink to={href} label={`Re-issue: replaces the upload${replaces ? ` of ${formatDateTime(replaces.uploaded_at)}` : ''}${replaces?.published_at ? `, published ${formatDateTime(replaces.published_at)}` : ''}`}>
          <span className="adm-tag">Re-issue</span>
        </TextLink>
      )}
      {u.replaced_by_upload_id && (
        <TextLink to={href} label={`Replaced by re-issue${replacedBy ? ` uploaded ${formatDateTime(replacedBy.uploaded_at)}` : ''}`}>
          <span className="adm-tag adm-tag--muted">Replaced by re-issue</span>
        </TextLink>
      )}
    </span>
  )
}
