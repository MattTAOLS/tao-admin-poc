import type { ReactNode } from 'react'
import { Card, DataTable, formatByUnit, type Column } from '@/design/components'
import type { AuditEntry, Finding } from '../lib/types'
import { formatDateTime } from '../lib/format'
import { CHOICES } from './Dialogs'

const ACTION: Record<string, string> = {
  upload: 'Uploaded', extract: 'Extracted', reextract: 'Re-extract requested', override: 'Override', restate: 'Restatement accepted',
  approve: 'Approved', reject: 'Rejected', publish: 'Published', regenerate: 'Dashboards regenerated', master_change: 'Master data changed',
}
const choiceLabel = (c: unknown) => CHOICES.find(x => x.id === c)?.label ?? String(c)

/** The audit trail for this upload (tao_admin only; /audit is admin-only on the API). */
export function Activity({ entries, findings, loading }: { entries: AuditEntry[]; findings: Finding[]; loading: boolean }) {
  const unitOf = (id?: string | null) => findings.find(f => f.id === id)?.unit
  const columns: Column<AuditEntry>[] = [
    { key: 'at', header: 'When', render: e => formatDateTime(e.at), sortValue: e => e.at, width: 140 },
    { key: 'actor', header: 'Who', render: e => e.actor_label ?? e.actor_role },
    { key: 'action', header: 'Action', render: e => ACTION[e.action] ?? e.action },
    { key: 'detail', header: 'Detail', render: e => <Detail e={e} unit={unitOf(e.finding_id)} /> },
    { key: 'reason', header: 'Reason', render: e => e.reason ?? '—' },
  ]
  const rows = [...entries].sort((a, b) => b.at.localeCompare(a.at))
  return (
    <Card aria-label="Activity" title="Activity" subtitle="Audit log entries for this upload, newest first" padding="flush">
      <DataTable<AuditEntry> caption="Activity" captionHidden columns={columns} rows={rows} rowKey={e => e.id} loading={loading && entries.length === 0}
        density="compact" empty={{ title: 'No activity yet' }} />
    </Card>
  )
}

function Detail({ e, unit }: { e: AuditEntry; unit: Finding['unit'] }) {
  const d = e.detail ?? {}
  const parts: ReactNode[] = []
  if (d.rule_id) parts.push(<b key="r">{String(d.rule_id)}</b>)
  if (d.choice) parts.push(<span key="c">{choiceLabel(d.choice)}</span>)
  const val = (v: unknown) => formatByUnit(v as number | string | boolean | null, unit)
  if ('our_value' in d || 'report_value' in d) parts.push(<span key="v">ours <b>{val(d.our_value)}</b> · report <b>{val(d.report_value)}</b></span>)
  if (Array.isArray(d.pages)) parts.push(<span key="p">pages {(d.pages as number[]).join(', ')}</span>)
  if (d.file_name) parts.push(<span key="f">{String(d.file_name)}</span>)
  if (d.status && !d.rule_id) parts.push(<span key="s">{String(d.status).replace(/_/g, ' ')}</span>)
  if (d.program_slug) parts.push(<span key="g">{String(d.program_slug)}</span>)
  if (typeof d.pass === 'number') parts.push(<span key="x">pass {d.pass}</span>)
  if (Array.isArray(d.overrides_used)) parts.push(<span key="o">{d.overrides_used.length} override{d.overrides_used.length === 1 ? '' : 's'} applied</span>)
  if (d.collection_period && !d.file_name) parts.push(<span key="cp">{String(d.collection_period)}</span>)
  if (parts.length === 0) return <span className="rv-detail">—</span>
  return <span className="rv-detail">{parts.map((p, i) => <span key={i}>{i > 0 && ' · '}{p}</span>)}</span>
}
