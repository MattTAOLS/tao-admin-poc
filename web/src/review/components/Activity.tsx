import type { ReactNode } from 'react'
import { Card, DataTable, formatByUnit, type Column } from '@/design/components'
import type { AuditEntry, Finding } from '../lib/types'
import { formatDateTime } from '../lib/format'
import { CHOICES } from './Dialogs'
import { fmtFor } from '../lib/edits'
import { pointerLabel } from '../lib/corrections'

const ACTION: Record<string, string> = {
  upload: 'Uploaded', extract: 'Extracted', reextract: 'Re-extract requested', override: 'Override', restate: 'Restatement accepted',
  approve: 'Approved', reject: 'Rejected', publish: 'Published', regenerate: 'Dashboards regenerated', master_change: 'Master data changed',
  export: 'Exported', value_edit: 'Value edited', value_edit_revert: 'Edit reverted', correction: 'Value corrected',
  correction_approve: 'Correction approved', correction_reject: 'Correction rejected',
  hold: 'Saved for later (On hold)', hold_release: 'Hold released',
  comment: 'Comment added', comment_edit: 'Comment edited', thread_resolve: 'Thread resolved', thread_reopen: 'Thread reopened',
}
export const actionLabel = (a: string) => ACTION[a] ?? a.replace(/_/g, ' ')
const choiceLabel = (c: unknown) => CHOICES.find(x => x.id === c)?.label ?? String(c)

/** The audit trail for this upload (tao_admin only; /audit is admin-only on the API). */
export function Activity({ entries, findings, loading, deal }: { entries: AuditEntry[]; findings: Finding[]; loading: boolean; deal?: Record<string, unknown> }) {
  const unitOf = (id?: string | null) => findings.find(f => f.id === id)?.unit
  const columns: Column<AuditEntry>[] = [
    { key: 'at', header: 'When', render: e => formatDateTime(e.at), sortValue: e => e.at, width: 140 },
    { key: 'actor', header: 'Who', render: e => e.actor_label ?? e.actor_role },
    { key: 'action', header: 'Action', render: e => actionLabel(e.action) },
    { key: 'detail', header: 'Detail', render: e => <Detail e={e} unit={unitOf(e.finding_id)} deal={deal} /> },
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

type EditDetail = { pointer?: unknown; old_value?: unknown; new_value?: unknown; value?: unknown; source_page?: unknown }

/** "Total Equity (p. 13): 6,755,120 → 6,755,210" for a value edit, revert or correction entry. */
function editLine(deal: Record<string, unknown> | undefined, x: EditDetail, key: string): ReactNode {
  if (typeof x.pointer !== 'string') return null
  const fmt = fmtFor(deal, x.pointer)
  const to = x.new_value ?? x.value
  return <span key={key}>{pointerLabel(deal, x.pointer)}{typeof x.source_page === 'number' && ` (p. ${x.source_page})`}
    {(x.old_value !== undefined || to !== undefined) && <>: <b>{fmt(x.old_value)}</b> → <b>{fmt(to)}</b></>}</span>
}

const clip = (s: string, n = 120) => (s.length > n ? s.slice(0, n) + '…' : s)
/** A list in an audit detail as a count: an array (ids or people) or a number. */
const size = (v: unknown) => (Array.isArray(v) ? v.length : typeof v === 'number' ? v : 0)
/** People in an audit detail ({id, name} or plain names) as names. */
const names = (v: unknown): string[] => (Array.isArray(v) ? v.map(x => (typeof x === 'string' ? x : x && typeof x === 'object' ? String((x as { name?: unknown }).name ?? '') : '')).filter(Boolean) : [])

function Detail({ e, unit, deal }: { e: AuditEntry; unit: Finding['unit']; deal?: Record<string, unknown> }) {
  const d = e.detail ?? {}
  const parts: ReactNode[] = []
  if (typeof d.pointer === 'string') parts.push(editLine(deal, d as EditDetail, 'e'))
  if (Array.isArray(d.edits)) (d.edits as EditDetail[]).forEach((x, i) => parts.push(editLine(deal, x, 'e' + i)))
  // Wave C comment entries: the anchor, the text (or before → after for an edit) and the mention count.
  if (d.anchor && typeof d.anchor === 'object') {
    const a = d.anchor as { pointer?: string; rule_id?: string | null; finding_id?: string }
    parts.push(<span key="an">{a.rule_id ? <b>{a.rule_id}</b> : a.pointer ? pointerLabel(deal, a.pointer) : 'finding'} thread</span>)
  }
  if (typeof d.body === 'string') parts.push(<span key="bd">“{clip(d.body)}”</span>)
  if (typeof d.before === 'string' && typeof d.after === 'string' && e.action === 'comment_edit') parts.push(<span key="ba">“{clip(d.before)}” → “{clip(d.after)}”</span>)
  if (Array.isArray(d.mentions) && d.mentions.length > 0) parts.push(<span key="mn">{d.mentions.length} mention{d.mentions.length === 1 ? '' : 's'}</span>)
  // Save for later: why it is waiting, and what was kept as the draft of the publish pop-up.
  if (e.action === 'hold') {
    // The note is the entry's reason (the Reason column); it is repeated here only if no reason came with it.
    if (!e.reason && typeof d.note === 'string' && d.note) parts.push(<span key="hn">“{clip(d.note)}”</span>)
    if (d.has_draft_note === true) parts.push(<span key="hd">draft note kept</span>)
    const n = size(d.notify_add) + size(d.notify_remove)
    if (n > 0) parts.push(<span key="hc">{n} notification change{n === 1 ? '' : 's'}</span>)
    if (d.has_draft_note !== true && n === 0) parts.push(<span key="hz">No draft</span>)
  }
  // Publish: people added or left out by hand for that publish only.
  if (names(d.notified_added).length) parts.push(<span key="na">Added by hand: {names(d.notified_added).join(', ')}</span>)
  if (names(d.notified_removed).length) parts.push(<span key="nr">Left out: {names(d.notified_removed).join(', ')}</span>)
  if (typeof d.note_to_partners === 'string' && d.note_to_partners) parts.push(<span key="nt">note to partners “{clip(d.note_to_partners)}”</span>)
  if (Array.isArray(d.recipients)) parts.push(<span key="rc">{d.recipients.length} recipient{d.recipients.length === 1 ? '' : 's'} notified</span>)
  if (typeof d.version === 'number') parts.push(<span key="ver">version {d.version}</span>)
  if (d.rule_id) parts.push(<b key="r">{String(d.rule_id)}</b>)
  if (d.choice) parts.push(<span key="c">{choiceLabel(d.choice)}</span>)
  const val = (v: unknown) => formatByUnit(v as number | string | boolean | null, unit)
  if ('our_value' in d || 'report_value' in d) parts.push(<span key="v">ours <b>{val(d.our_value)}</b> · report <b>{val(d.report_value)}</b></span>)
  if (Array.isArray(d.pages)) parts.push(<span key="p">pages {(d.pages as number[]).join(', ')}</span>)
  if (d.file_name) parts.push(<span key="f">{String(d.file_name)}</span>)
  if (d.status && !d.rule_id) parts.push(<span key="s">{String(d.status).replace(/_/g, ' ')}</span>)
  if (d.program_slug) parts.push(<span key="g">{String(d.program_slug)}</span>)
  if (typeof d.pass === 'number') parts.push(<span key="x">pass {d.pass}</span>)
  if (Array.isArray(d.corrections)) parts.push(<span key="k">{d.corrections.length === 0 ? 'no values changed' : `${d.corrections.length} correction${d.corrections.length === 1 ? '' : 's'} written`}</span>)
  if (Array.isArray(d.overrides_used)) parts.push(<span key="o">{d.overrides_used.length} override{d.overrides_used.length === 1 ? '' : 's'} applied</span>)
  if (d.collection_period && !d.file_name) parts.push(<span key="cp">{String(d.collection_period)}</span>)
  if (parts.length === 0) return <span className="rv-detail">—</span>
  return <span className="rv-detail">{parts.map((p, i) => <span key={i}>{i > 0 && ' · '}{p}</span>)}</span>
}
