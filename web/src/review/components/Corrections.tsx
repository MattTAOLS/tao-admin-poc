/** D1 c: correcting a published report without a new PDF (decision B1: a correction that raises a block finding waits in
 * the Approval queue), the correction review view, and the published report's version and corrections. */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Button, Card, DataTable, Dialog, Field, FindingCard, Input, SeverityPill, SkeletonBlock, StatePanel, StatusPill, Textarea, formatPeriod, useToast, type Column, type Tone,
} from '@/design/components'
import { access, errorText, reviewApi } from '../lib/api'
import { useLoad } from '../lib/useLoad'
import { ruleTitle } from '../lib/rules'
import { formatDateTime, formatMessage } from '../lib/format'
import { findingBoxes, focusBox, getPointer } from '../lib/provenance'
import { plannedCorrections } from '../lib/corrections'
import {
  KIND_HINT, MIN_EDIT_REASON, blockText, changeText, editsByPointer, fmtFor, labelFor, numericCandidates, parseValue, plural, sameNumber,
  searchCandidates, valueKind,
} from '../lib/edits'
import type { Correction, CorrectionStatus, Extraction, Finding, Upload, ValueEdit } from '../lib/types'
import { PageCrop, type ViewerTarget } from './PageImage'

export const correctionPath = (uploadId: string, correctionId: string) => `/admin/uploads/queue/${uploadId}?correction=${correctionId}`
export const CorrectionTag = () => <StatusPill tone="dpv" size="sm">Correction</StatusPill>
export const CorrectedTag = () => <StatusPill tone="blue" size="sm">Corrected</StatusPill>

const STATUS: Record<CorrectionStatus, { tone: Tone; label: string }> = {
  needs_review: { tone: 'warn', label: 'Needs review' },
  published: { tone: 'ok', label: 'Published' },
  rejected: { tone: 'bad', label: 'Rejected' },
}
export const CorrectionStatusPill = ({ status }: { status: CorrectionStatus }) =>
  <StatusPill tone={STATUS[status]?.tone ?? 'neutral'} size="sm">{STATUS[status]?.label ?? status}</StatusPill>

/** The value now published for a pointer: the last applied edit, else what approve wrote for a use ours / use report
 * resolution, else the extraction. Display only; the API holds the published deal. */
function publishedValue(ex: Extraction, findings: Finding[], edits: ValueEdit[], corrections: Correction[], ptr: string): unknown {
  const s = editsByPointer(ex, edits, corrections).get(ptr)
  if (s) return s.current.new_value
  const w = plannedCorrections(ex, findings).filter(x => x.changed && x.pointer === ptr).pop()
  return w ? w.value : getPointer(ex.deal, ptr)
}

type Row = { pointer: string; input: string }

/** "Correct a value…": one or more values with new values, a reason (10+ characters) and an optional note to partners.
 * The result says whether it was published as the next version or is waiting in the approval queue. */
export function CorrectionDialog({ upload, open, title, initialPointer, onClose, onDone, data }: {
  upload: Upload; open: boolean; title: string; initialPointer?: string | null
  onClose: () => void; onDone: (c: Correction) => void
  /** The review page passes what it has loaded; the Reports library leaves it out and the dialog loads it. */
  data?: { ex?: Extraction; findings?: Finding[]; edits?: ValueEdit[]; corrections?: Correction[] }
}) {
  const own = open && !data
  const exL = useLoad(() => reviewApi.extraction(upload.id), [upload.id, open], own)
  const fL = useLoad(() => reviewApi.findings(upload.id).catch(() => [] as Finding[]), [upload.id, open], own)
  const eL = useLoad(() => reviewApi.edits(upload.id).catch(() => [] as ValueEdit[]), [upload.id, open], own)
  const cL = useLoad(() => reviewApi.uploadCorrections(upload.id).catch(() => [] as Correction[]), [upload.id, open], own)
  const ex = data ? data.ex : exL.data
  const findings = (data ? data.findings : fL.data) ?? []
  const edits = (data ? data.edits : eL.data) ?? []
  const corrections = (data ? data.corrections : cL.data) ?? []

  const [rows, setRows] = useState<Row[]>([])
  const [q, setQ] = useState('')
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  const [result, setResult] = useState<Correction | null>(null)
  useEffect(() => {
    if (!open) return
    setRows(initialPointer ? [{ pointer: initialPointer, input: '' }] : []); setQ(''); setReason(''); setTouched(false); setNote(''); setErr(undefined); setResult(null)
  }, [open, initialPointer])

  const candidates = useMemo(() => numericCandidates(ex), [ex])
  if (!open) return null
  const version = (upload.published_version ?? 1)
  const pending = upload.pending_correction_id

  if (result) {
    const queued = result.status === 'needs_review'
    const blocks = result.finding_counts?.block ?? 0
    return (
      <Dialog open onClose={onClose} title={queued ? 'Correction waiting for approval' : 'Correction published'} description={title}
        footer={<Button variant="primary" onClick={onClose}>Close</Button>}>
        <div className="rv-dialog-body" data-testid="correction-result">
          {queued ? <>
            <p className={'rv-banner rv-banner--warn'}><b>Waiting in the approval queue: {blockText(blocks)}.</b>{' '}
              Version {result.version} is not published. Version {result.version - 1} stays live until a TAO Admin approves or rejects the correction.</p>
            <Link to={correctionPath(result.upload_id, result.id)} onClick={onClose}>Open the correction</Link>
          </> : (
            <p className={'rv-banner rv-banner--blue'}><b>Published as version {result.version}.</b>{' '}
              Partner portals show the corrected numbers and the program roll-up regenerates. Version {result.version - 1} stays on record.</p>
          )}
        </div>
      </Dialog>
    )
  }

  const parsed = rows.map(r => {
    const kind = valueKind(ex?.deal, r.pointer)
    const cur = ex ? publishedValue(ex, findings, edits, corrections, r.pointer) : undefined
    const next = parseValue(r.input, kind)
    const differs = next !== null && typeof cur === 'number' && !sameNumber(next, cur)
    return { ...r, kind, cur, next, differs }
  })
  const reasonOk = reason.trim().length >= MIN_EDIT_REASON
  const valuesOk = parsed.length > 0 && parsed.every(p => p.differs)
  const canSubmit = valuesOk && reasonOk && !busy && !pending && !!ex
  const add = (ptr: string) => { if (!rows.some(r => r.pointer === ptr)) setRows([...rows, { pointer: ptr, input: '' }]); setQ('') }
  const set = (ptr: string, input: string) => setRows(rows.map(r => (r.pointer === ptr ? { ...r, input } : r)))
  const remove = (ptr: string) => setRows(rows.filter(r => r.pointer !== ptr))
  const hits = searchCandidates(candidates, q).filter(c => !rows.some(r => r.pointer === c.pointer))

  const submit = async () => {
    setTouched(true)
    if (!canSubmit) return
    setBusy(true); setErr(undefined)
    try {
      const c = await reviewApi.correct(upload.id, {
        edits: parsed.map(p => ({ pointer: p.pointer, value: p.next as number })), reason: reason.trim(), note_to_partners: note.trim() || null,
      })
      setResult(c); onDone(c)
    } catch (e) { setErr(errorText(e)) }
    finally { setBusy(false) }
  }

  return (
    <Dialog open onClose={onClose} dismissable={!busy} size="lg" title="Correct a published value"
      description={`${title} · published version ${version}. A correction creates version ${version + 1} and re-publishes the deal.`}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!canSubmit} onClick={submit}>Correct and re-publish</Button></>}>
      <div className="rv-dialog-body">
        {pending && <p className="rv-banner rv-banner--warn" role="note"><b>A correction is already waiting in the approval queue.</b>{' '}
          Approve or reject it first. <Link to={correctionPath(upload.id, pending)} onClick={onClose}>Open it</Link></p>}
        {!ex ? (exL.error ? <div className="rv-dialog-error" role="alert">{errorText(exL.error)}</div> : <div aria-busy="true"><SkeletonBlock lines={3} /></div>) : <>
          {parsed.length > 0 && (
            <div className="rv-scroll">
              <table className="ds-table ds-table--compact" aria-label="Values to correct">
                <thead><tr><th scope="col">Value</th><th scope="col" className="ds-num">Published</th><th scope="col">New value</th><th scope="col">Change</th><th scope="col"><span className="ds-visually-hidden">Remove</span></th></tr></thead>
                <tbody>
                  {parsed.map(p => {
                    const fmt = fmtFor(ex.deal, p.pointer)
                    const label = labelFor(ex, p.pointer)
                    const page = ex.sources?.[p.pointer]?.page
                    return (
                      <tr key={p.pointer}>
                        <td>{label}{page != null && <span className="rv-sub">page {page}</span>}</td>
                        <td className="ds-num">{fmt(p.cur)}</td>
                        <td><Input numeric value={p.input} onChange={e => set(p.pointer, e.target.value)} aria-label={`New value for ${label}`} title={KIND_HINT[p.kind]} autoComplete="off" /></td>
                        <td className="rv-muted">{p.differs && typeof p.cur === 'number' && p.next !== null ? changeText(ex.deal, p.pointer, p.cur, p.next)
                          : p.input.trim() ? (p.next === null ? 'Not a number' : 'Same as published') : '—'}</td>
                        <td><Button size="sm" variant="ghost" onClick={() => remove(p.pointer)} aria-label={`Remove ${label}`}>Remove</Button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Field label={parsed.length ? 'Add another value' : 'Value'} required={parsed.length === 0} hint="Any number the extraction read. Search by name, or by page (p. 13).">
            <Input type="search" value={q} onChange={e => setQ(e.target.value)} autoComplete="off" />
          </Field>
          {hits.length > 0 && (
            <ul className="rv-picker" aria-label="Matching values">
              {hits.map(c => <li key={c.pointer}><button type="button" onClick={() => add(c.pointer)}>
                <span>{c.label}</span><span className="rv-muted">{c.page != null ? `p. ${c.page} · ` : ''}{fmtFor(ex.deal, c.pointer)(publishedValue(ex, findings, edits, corrections, c.pointer))}</span>
              </button></li>)}
            </ul>
          )}
          {q.trim() && hits.length === 0 && <p className="rv-hint">No value matches.</p>}
        </>}
        <Field label="Reason" required hint="Goes in the Reports audit log and in the new version's change list. Partners do not see this text."
          error={touched && !reasonOk ? `Give a reason of at least ${MIN_EDIT_REASON} characters (${reason.trim().length} so far).` : undefined}>
          <Textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} onBlur={() => setTouched(true)} />
        </Field>
        <Field label="Note to partners (optional)" hint="Sent to partners with the correction, as a note from TAO in the correction notification.">
          <Textarea rows={2} value={note} maxLength={2000} onChange={e => setNote(e.target.value)} />
        </Field>
        <div className="rv-whensave">
          <h3 className="rv-section__title">What happens when you correct</h3>
          <ul className="rv-summary">
            <li>Version {version + 1} of this report is created with the new values. Version {version} stays on record with its numbers unchanged.</li>
            <li>The rules re-run on version {version + 1}. If a block finding opens, nothing is published: it goes to the Approval queue, and this dialog says so.</li>
            <li>If no block finding opens, version {version + 1} is published straight away and the program roll-up regenerates.</li>
            <li>One Reports audit entry for the correction, one for the re-publish.</li>
          </ul>
        </div>
        {err && <div className="rv-dialog-error" role="alert">{err}</div>}
      </div>
    </Dialog>
  )
}

/** The edits of a correction or a publish: value, old → new, who, reason. */
export function EditsTable({ ex, edits, caption }: { ex?: Extraction; edits: ValueEdit[]; caption: string }) {
  const columns: Column<ValueEdit>[] = [
    { key: 'value', header: 'Value', render: e => <>{labelFor(ex, e.pointer)}{e.source_page != null && <span className="rv-sub">page {e.source_page}</span>}</> },
    { key: 'old', header: 'Old', numeric: true, render: e => fmtFor(ex?.deal, e.pointer)(e.old_value) },
    { key: 'new', header: 'New', numeric: true, render: e => <b>{fmtFor(ex?.deal, e.pointer)(e.new_value)}</b> },
    { key: 'who', header: 'Who', render: e => <>{e.actor_label || e.actor_role}<span className="rv-sub">{formatDateTime(e.at)}</span></> },
    { key: 'reason', header: 'Reason', render: e => <span className="rv-desc">{e.reason}</span> },
  ]
  return <div className="rv-scroll"><DataTable<ValueEdit> caption={caption} captionHidden columns={columns} rows={edits} rowKey={e => e.id} density="compact" /></div>
}

/** A correction under review: its edits, the findings of its rule re-run, and Approve / Reject for TAO Admin.
 * Approve is refused while a block finding is open (409 open_block_findings). */
export function CorrectionReview({ correctionId, uploadId, ex, title, onOpen, onChanged }: {
  correctionId: string; uploadId: string; ex?: Extraction; title: string; onOpen: (t: ViewerTarget) => void; onChanged: () => void
}) {
  const { admin } = access()
  const { toast } = useToast()
  const c = useLoad(() => reviewApi.correction(correctionId), [correctionId])
  const [rejecting, setRejecting] = useState(false)
  const [resolving, setResolving] = useState<{ finding: Finding; choice: 'restatement' | 'acknowledge' } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  if (c.error && !c.data) {
    const nf = (c.error as { status?: number }).status === 404
    return <Card title="Correction"><StatePanel kind={nf ? 'not-found' : 'error'} title={nf ? 'Correction not found' : undefined} message={nf ? 'No correction has this id.' : errorText(c.error)} /></Card>
  }
  if (!c.data) return <Card title="Correction"><div aria-busy="true"><SkeletonBlock lines={4} /></div></Card>
  const k = c.data
  const findings = k.findings ?? []
  const open = findings.filter(f => f.status === 'open')
  const blocks = findings.length ? open.filter(f => f.severity === 'block').length : (k.finding_counts?.block ?? 0)
  const waiting = k.status === 'needs_review'
  const approve = async () => {
    setBusy(true); setErr(undefined)
    try {
      const done = await reviewApi.approveCorrection(k.id)
      c.setData({ ...k, ...done })
      toast({ tone: 'ok', title: `Published as version ${done.version}`, message: title })
      onChanged()
    } catch (e) { setErr(errorText(e)); c.reload() }
    finally { setBusy(false) }
  }
  return (
    <Card aria-label="Correction" title={<>Correction · version {k.version}</>} subtitle={`${title}. Requested ${formatDateTime(k.created_at)} by ${k.created_by}.`}
      actions={<CorrectionStatusPill status={k.status} />}>
      <div className="rv-dialog-body">
        <dl className="rv-facts">
          <div><dt>Reason</dt><dd className="rv-plain">{k.reason}</dd></div>
          <div><dt>Note to partners</dt><dd className="rv-plain">{k.note_to_partners || '—'}<small>sent with the correction</small></dd></div>
          {k.decided_at && <div><dt>{k.status === 'rejected' ? 'Rejected' : 'Approved'}</dt><dd>{formatDateTime(k.decided_at)}<small>{k.decided_by ?? ''}{k.reject_reason ? `: ${k.reject_reason}` : ''}</small></dd></div>}
        </dl>
        <EditsTable ex={ex} edits={k.edits} caption="Values this correction changes" />
        <h3 className="rv-section__title">Rules re-run on version {k.version} <span className="rv-muted">· {open.length} open</span></h3>
        {findings.length === 0 ? <p className="rv-allclear">No findings on the corrected values.</p> : findings.map(f => (
          <FindingCard key={f.id} finding={{ ...f, message: formatMessage(f.message) }} ruleTitle={ruleTitle(f.rule_id)}
            crop={f.source_page != null ? <PageCrop uploadId={uploadId} page={f.source_page} boxes={findingBoxes(ex, f.fields, f.source_page)} focus={focusBox(ex, f.fields, f.source_page, f.report_value)}
              onZoom={() => onOpen({ page: f.source_page!, boxes: findingBoxes(ex, f.fields, f.source_page), tone: 'finding', caption: `${f.rule_id} · ${ruleTitle(f.rule_id)}` })} /> : undefined}
            actions={admin && waiting && f.status === 'open' && f.severity === 'block' ? <>
              <Button size="sm" onClick={() => setResolving({ finding: f, choice: 'restatement' })} aria-label={`Accept as restatement for ${f.rule_id}`}>Accept as restatement</Button>
              <Button size="sm" onClick={() => setResolving({ finding: f, choice: 'acknowledge' })} aria-label={`Acknowledge ${f.rule_id}`}>Acknowledge</Button>
              <span className="rv-hint">A correction&rsquo;s values are its edits, so use ours / use report do not apply.</span>
            </> : undefined} />
        ))}
        {waiting && (
          <div className="rv-footer rv-footer--inline" role="region" aria-label="Correction decision">
            <span id="rv-corr-reason" className={'rv-footer__note' + (blocks > 0 ? ' rv-footer__note--bad' : '')}>
              {!admin ? 'Read only. Only a TAO admin can approve or reject a correction.'
                : blocks > 0 ? `${plural(blocks, 'block finding')} open on the corrected values. Approve is refused until none is open: accept each as a restatement or acknowledge it with a reason, or reject the correction.`
                : `No block findings. Approving publishes version ${k.version}; version ${k.version - 1} stays on record.`}
            </span>
            {admin && <>
              <Button variant="danger" onClick={() => setRejecting(true)} disabled={busy}>Reject…</Button>
              <Button variant="primary" onClick={approve} loading={busy} disabled={blocks > 0} aria-describedby="rv-corr-reason">Approve and publish v{k.version}</Button>
            </>}
          </div>
        )}
        {err && <div className="rv-dialog-error" role="alert">{err}</div>}
      </div>
      {admin && <ResolveCorrectionFindingDialog correctionId={k.id} target={resolving} onClose={() => setResolving(null)}
        onDone={() => { const f = resolving!.finding; setResolving(null); toast({ tone: 'ok', title: `${f.rule_id} resolved on the correction`, message: 'Findings refreshed.' }); c.reload() }} />}
      {admin && <RejectCorrectionDialog open={rejecting} correction={k} onClose={() => setRejecting(false)}
        onDone={done => { c.setData({ ...k, ...done }); setRejecting(false); toast({ tone: 'warn', title: 'Correction rejected', message: `Version ${k.version - 1} stays live.` }); onChanged() }} />}
    </Card>
  )
}

/** Accept as restatement / Acknowledge a block finding on a queued correction, with a reason of 3+ characters. */
function ResolveCorrectionFindingDialog({ correctionId, target, onClose, onDone }: {
  correctionId: string; target: { finding: Finding; choice: 'restatement' | 'acknowledge' } | null; onClose: () => void; onDone: () => void
}) {
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  useEffect(() => { if (target) { setReason(''); setTouched(false); setErr(undefined) } }, [target])
  if (!target) return null
  const ok = reason.trim().length >= 3
  const label = target.choice === 'restatement' ? 'Accept as restatement' : 'Acknowledge'
  const submit = async () => {
    setTouched(true)
    if (!ok) return
    setBusy(true); setErr(undefined)
    try { await reviewApi.overrideCorrectionFinding(correctionId, target.finding.id, target.choice, reason.trim()); onDone() }
    catch (e) { setErr(errorText(e)) }
    finally { setBusy(false) }
  }
  return (
    <Dialog open onClose={onClose} dismissable={!busy} title={`${label}: ${target.finding.rule_id} ${ruleTitle(target.finding.rule_id)}`}
      description="Resolves this finding on the correction only. The choice and reason go in the audit log."
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} disabled={!ok || busy} onClick={submit}>{label}</Button></>}>
      <div className="rv-dialog-body">
        <p style={{ margin: 0 }}>{formatMessage(target.finding.message)}</p>
        <Field label="Reason" required error={touched && !ok ? 'Give a reason of at least 3 characters. It goes in the audit log.' : undefined}>
          <Textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} onBlur={() => setTouched(true)} />
        </Field>
        {err && <div className="rv-dialog-error" role="alert">{err}</div>}
      </div>
    </Dialog>
  )
}

function RejectCorrectionDialog({ open, correction, onClose, onDone }: { open: boolean; correction: Correction; onClose: () => void; onDone: (c: Correction) => void }) {
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  useEffect(() => { if (open) { setReason(''); setTouched(false); setErr(undefined) } }, [open])
  const ok = reason.trim().length >= 3
  const submit = async () => {
    setTouched(true)
    if (!ok) return
    setBusy(true); setErr(undefined)
    try { onDone(await reviewApi.rejectCorrection(correction.id, reason.trim())) }
    catch (e) { setErr(errorText(e)) }
    finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onClose={onClose} dismissable={!busy} role="alertdialog" title="Reject correction"
      description={`Discards version ${correction.version}. Version ${correction.version - 1} stays live, and the reason goes in the audit log.`}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="danger" loading={busy} onClick={submit}>Reject correction</Button></>}>
      <Field label="Reason" required error={touched && !ok ? 'Give a reason of at least 3 characters. It goes in the audit log.' : undefined}>
        <Textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} onBlur={() => setTouched(true)} />
      </Field>
      {err && <div className="rv-dialog-error" role="alert">{err}</div>}
    </Dialog>
  )
}

/** The corrections of a published report, newest first, each linking to its review view. */
export function CorrectionsCard({ upload, corrections }: { upload: Upload; corrections: Correction[] }) {
  const columns: Column<Correction>[] = [
    { key: 'version', header: 'Version', numeric: true, render: c => `v${c.version}` },
    { key: 'status', header: 'Status', render: c => <CorrectionStatusPill status={c.status} /> },
    { key: 'edits', header: 'Values', numeric: true, render: c => c.edits?.length ?? 0 },
    { key: 'findings', header: 'Blocks', numeric: true, render: c => (c.finding_counts?.block ? <SeverityPill severity="block" count={c.finding_counts.block} size="sm" /> : '0') },
    { key: 'created', header: 'Requested', render: c => <>{formatDateTime(c.created_at)}<span className="rv-sub">{c.created_by}</span></> },
    { key: 'reason', header: 'Reason', render: c => <span className="rv-desc">{c.reason}</span> },
    { key: 'open', header: 'Open', align: 'right', render: c => <Link to={correctionPath(upload.id, c.id)} aria-label={`Open correction version ${c.version}`}>Open</Link> },
  ]
  const rows = [...corrections].sort((a, b) => b.created_at.localeCompare(a.created_at))
  return (
    <Card aria-label="Corrections" title="Corrections" padding="flush"
      subtitle={`${formatPeriod(upload.collection_period)} · published version ${upload.published_version ?? 1}. Each correction is a new version; earlier versions stay on record.`}>
      <DataTable<Correction> caption="Corrections" captionHidden columns={columns} rows={rows} rowKey={c => c.id} density="compact"
        empty={{ title: 'No corrections', message: 'This report is as first published.' }} />
    </Card>
  )
}
