import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, Card, DataTable, Field, Input, Select, formatNumber, type Column } from '@/design/components'
import { usePageHeader } from '@/shell/header'
import { adminApi, AUDIT_ACTIONS, type AuditEntry } from './data'
import { useResource, useRole } from './hooks'
import { LoadError, TextLink, formatDateTime, reviewHref } from './ui'

const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i
export const ACTION_LABEL: Record<string, string> = {
  upload: 'Upload', extract: 'Extract', reextract: 'Re-extract', override: 'Override', restate: 'Restate', approve: 'Approve',
  reject: 'Reject', publish: 'Publish', regenerate: 'Regenerate', master_change: 'Master data change',
}
const short = (id: string) => id.slice(0, 8)

function DetailView({ e }: { e: AuditEntry }) {
  const entries = Object.entries(e.detail ?? {})
  return (
    <dl className="adm-dl">
      <dt>Entry id</dt><dd className="adm-mono">{e.id}</dd>
      {e.upload_id && <><dt>Upload id</dt><dd className="adm-mono">{e.upload_id}</dd></>}
      {e.finding_id && <><dt>Finding id</dt><dd className="adm-mono">{e.finding_id}</dd></>}
      {entries.map(([k, v]) => (
        <span key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{typeof v === 'object' && v !== null ? <pre className="adm-pre">{JSON.stringify(v, null, 2)}</pre> : String(v)}</dd>
        </span>
      ))}
    </dl>
  )
}

/** Audit log: every recorded action, newest first. Upload filter goes to the API (`upload_id`); the action filter
 * is applied here (the contract has no action parameter). Both live in the URL. */
export default function AuditLogPage() {
  const role = useRole()
  const [params, setParams] = useSearchParams()
  const uploadId = params.get('upload_id') ?? ''
  const action = params.get('action') ?? ''
  const [uploadDraft, setUploadDraft] = useState(uploadId)
  useEffect(() => setUploadDraft(uploadId), [uploadId])
  usePageHeader({ title: 'Audit log', subtitle: 'Uploads, extractions, overrides, approvals, publications and master data changes.' })
  const validUpload = uploadId && UUID.test(uploadId) ? uploadId : ''
  const res = useResource(() => adminApi.audit(validUpload || undefined), [validUpload, role])
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v); else next.delete(k)
    setParams(next, { replace: true })
  }
  if (res.error) return <LoadError error={res.error} onRetry={res.reload} />

  const loading = res.loading && !res.data
  const rows = (res.data ?? []).filter(e => !action || e.action === action).sort((a, b) => b.at.localeCompare(a.at))
  const filtered = !!(uploadId || action)
  const draftError = uploadDraft && !UUID.test(uploadDraft.trim()) ? 'Paste a full upload id (a UUID).' : undefined

  const columns: Column<AuditEntry>[] = [
    { key: 'at', header: 'When', render: e => <time dateTime={e.at}>{formatDateTime(e.at)}</time>, sortValue: e => e.at, width: 170 },
    { key: 'action', header: 'Action', emphasis: true, render: e => ACTION_LABEL[e.action] ?? e.action, sortValue: e => e.action },
    { key: 'actor', header: 'Actor', render: e => e.actor_label && e.actor_label !== e.actor_role ? `${e.actor_label} (${e.actor_role})` : e.actor_role, sortValue: e => e.actor_role },
    { key: 'upload', header: 'Upload', render: e => e.upload_id
      ? <TextLink to={`?upload_id=${e.upload_id}`} label={`Show only upload ${e.upload_id}`}><span className="adm-mono">{short(e.upload_id)}</span></TextLink>
      : <span className="adm-muted">—</span> },
    { key: 'reason', header: 'Reason', render: e => e.reason ?? <span className="adm-muted">—</span> },
    { key: 'summary', header: 'Detail', render: e => summary(e) },
  ]

  return (
    <div className="adm-stack">
      <Card>
        <form className="adm-filters" role="search" aria-label="Filter the audit log"
          onSubmit={ev => { ev.preventDefault(); if (!draftError) set('upload_id', uploadDraft.trim()) }}>
          <Field label="Upload id" error={draftError} hint="Shows one upload’s trail.">
            <Input value={uploadDraft} onChange={e => setUploadDraft(e.target.value)} className="adm-mono" placeholder="All uploads" spellCheck={false} />
          </Field>
          <Button type="submit" disabled={!!draftError || uploadDraft.trim() === uploadId}>Apply</Button>
          <Field label="Action">
            <Select value={action} onChange={e => set('action', e.target.value)}>
              <option value="">All actions</option>
              {AUDIT_ACTIONS.map(a => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}
            </Select>
          </Field>
          {filtered && <Button onClick={() => { setUploadDraft(''); setParams(new URLSearchParams(), { replace: true }) }}>Clear filters</Button>}
        </form>
      </Card>
      {uploadId && <div className="adm-note">Showing upload <span className="adm-mono">{uploadId}</span>. <TextLink to={reviewHref(uploadId)}>Open the upload</TextLink></div>}
      <Card title="Entries" subtitle={loading ? 'Loading' : `${formatNumber(rows.length)} entr${rows.length === 1 ? 'y' : 'ies'}${filtered ? ' match the filters' : ''}, newest first`} padding="flush">
        <DataTable columns={columns} rows={rows} rowKey={e => e.id} caption="Audit log" captionHidden loading={loading}
          renderExpanded={e => <DetailView e={e} />} rowLabel={e => `${ACTION_LABEL[e.action] ?? e.action} at ${formatDateTime(e.at)}`}
          empty={filtered
            ? { title: 'No entries match these filters', action: <Button onClick={() => { setUploadDraft(''); setParams(new URLSearchParams(), { replace: true }) }}>Clear filters</Button> }
            : { title: 'No audit entries yet', message: 'Entries appear as soon as someone uploads, reviews or changes master data.' }} />
      </Card>
    </div>
  )
}

/** One line from `detail` for the table; the full detail is in the expanded row. */
function summary(e: AuditEntry): string {
  const d = (e.detail ?? {}) as Record<string, unknown>
  if (e.action === 'upload') return [d.file_name, d.page_count != null ? `${d.page_count} pages` : null, d.collection_period].filter(Boolean).join(' · ')
  if (e.action === 'master_change') return [d.entity, d.key].filter(Boolean).join(' ')
  if (e.action === 'regenerate') return [d.program_slug ?? 'all programs', d.publications != null ? `${d.publications} publications` : null].filter(Boolean).join(' · ')
  if (typeof d.status === 'string') return d.status
  const keys = Object.keys(d)
  return keys.length ? keys.slice(0, 3).map(k => `${k}: ${typeof d[k] === 'object' ? '…' : String(d[k])}`).join(' · ') : '—'
}
