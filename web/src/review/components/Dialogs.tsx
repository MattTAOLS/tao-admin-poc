import { useEffect, useState } from 'react'
import { Button, Dialog, Field, Textarea, formatByUnit, formatDiffByUnit, formatPeriod } from '@/design/components'
import { errorText, reviewApi } from '../lib/api'
import { ruleTitle } from '../lib/rules'
import type { Finding, OverrideChoice, Upload } from '../lib/types'

export const CHOICES: { id: OverrideChoice; label: string; help: string }[] = [
  { id: 'use_ours', label: 'Use ours', help: 'Keep our computed value; the report figure is wrong.' },
  { id: 'use_report', label: 'Use report', help: 'Keep the value the report states.' },
  { id: 'restatement', label: 'Accept as restatement', help: 'The servicer revised an earlier month on purpose.' },
  { id: 'acknowledge', label: 'Acknowledge', help: 'Noted; no value changes.' },
]
const MIN_REASON = 3

/** Reason field shared by the override and reject dialogs: required, at least three characters (OverrideRequest /
 * RejectRequest minLength). */
function useReason(open: boolean) {
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  useEffect(() => { if (open) { setReason(''); setTouched(false) } }, [open])
  const ok = reason.trim().length >= MIN_REASON
  return { reason, setReason, ok, touched, setTouched, error: touched && !ok ? `Give a reason of at least ${MIN_REASON} characters. It goes in the audit log.` : undefined }
}

export function OverrideDialog({ uploadId, finding, initialChoice, onClose, onDone }: {
  uploadId: string; finding: Finding | null; initialChoice: OverrideChoice; onClose: () => void
  onDone: (findings: Finding[], choice: OverrideChoice) => void
}) {
  const open = !!finding
  const [choice, setChoice] = useState<OverrideChoice>(initialChoice)
  const r = useReason(open)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  useEffect(() => { if (open) { setChoice(initialChoice); setErr(undefined) } }, [open, initialChoice])
  if (!finding) return null
  const submit = async () => {
    r.setTouched(true)
    if (!r.ok) return
    setBusy(true); setErr(undefined)
    try { onDone(await reviewApi.override(uploadId, finding.id, choice, r.reason.trim()), choice) }
    catch (e) { setErr(errorText(e)) }
    finally { setBusy(false) }
  }
  return (
    <Dialog open onClose={onClose} dismissable={!busy} title={`Resolve ${finding.rule_id}: ${ruleTitle(finding.rule_id)}`}
      description="The rules re-run after you save. The choice and reason go in the audit log."
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Save and re-run rules</Button></>}>
      <div className="rv-dialog-body">
        <p style={{ margin: 0 }}>{finding.message}</p>
        {(finding.our_value !== undefined || finding.report_value !== undefined) && (
          <dl className="rv-facts">
            <div><dt>Ours</dt><dd>{formatByUnit(finding.our_value, finding.unit)}</dd></div>
            <div><dt>Report</dt><dd>{formatByUnit(finding.report_value, finding.unit)}</dd></div>
            <div><dt>Difference</dt><dd>{formatDiffByUnit(finding.difference, finding.unit)}</dd></div>
          </dl>
        )}
        <fieldset className="rv-choices">
          <legend className="ds-field__label">Resolution</legend>
          {CHOICES.map(c => (
            <label key={c.id} className="rv-choice">
              <input type="radio" name="override-choice" value={c.id} checked={choice === c.id} onChange={() => setChoice(c.id)} />
              <span><b>{c.label}</b><small>{c.help}</small></span>
            </label>
          ))}
        </fieldset>
        <Field label="Reason" required error={r.error} hint="Who confirmed it, or what you checked on the page.">
          <Textarea rows={3} value={r.reason} onChange={e => r.setReason(e.target.value)} onBlur={() => r.setTouched(true)} />
        </Field>
        {err && <div className="rv-dialog-error" role="alert">{err}</div>}
      </div>
    </Dialog>
  )
}

export function RejectDialog({ upload, open, title, onClose, onDone }: { upload: Upload; open: boolean; title: string; onClose: () => void; onDone: (u: Upload) => void }) {
  const r = useReason(open)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  useEffect(() => { if (open) setErr(undefined) }, [open])
  const submit = async () => {
    r.setTouched(true)
    if (!r.ok) return
    setBusy(true); setErr(undefined)
    try { onDone(await reviewApi.reject(upload.id, r.reason.trim())) }
    catch (e) { setErr(errorText(e)) }
    finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onClose={onClose} dismissable={!busy} role="alertdialog" title="Reject report"
      description={`${title}. The uploader is told, and the period can be uploaded again.`}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="danger" loading={busy} onClick={submit}>Reject report</Button></>}>
      <div className="rv-dialog-body">
        <Field label="Reason" required error={r.error} hint="Shown to the uploader and kept in the audit log.">
          <Textarea rows={3} value={r.reason} onChange={e => r.setReason(e.target.value)} onBlur={() => r.setTouched(true)} />
        </Field>
        {err && <div className="rv-dialog-error" role="alert">{err}</div>}
      </div>
    </Dialog>
  )
}

export function PublishDialog({ upload, open, title, partner, findings, onClose, onDone }: {
  upload: Upload; open: boolean; title: string; partner: string; findings: Finding[]; onClose: () => void; onDone: (u: Upload) => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  useEffect(() => { if (open) setErr(undefined) }, [open])
  const resolved = findings.filter(f => f.status !== 'open').length
  const openReview = findings.filter(f => f.status === 'open' && f.severity === 'review').length
  const openNotes = findings.filter(f => f.status === 'open' && f.severity === 'note').length
  const submit = async () => {
    setBusy(true); setErr(undefined)
    try { onDone(await reviewApi.approve(upload.id)) }
    catch (e) { setErr(errorText(e)) }
    finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onClose={onClose} dismissable={!busy} title="Publish to partner"
      description={`${title} goes to ${partner}. Partner portals show it straight away and the program roll-up regenerates.`}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Approve and publish</Button></>}>
      <ul className="rv-summary">
        <li>Collection period {formatPeriod(upload.collection_period)}{upload.reporting_period && <>, reporting period {formatPeriod(upload.reporting_period)}</>}</li>
        <li>{resolved} finding{resolved === 1 ? '' : 's'} resolved with a reason</li>
        {openReview > 0 && <li>{openReview} review finding{openReview === 1 ? '' : 's'} still open: publishing accepts {openReview === 1 ? 'it' : 'them'} as shown</li>}
        {openNotes > 0 && <li>{openNotes} note{openNotes === 1 ? '' : 's'} (information only)</li>}
      </ul>
      {err && <div className="rv-dialog-error" role="alert">{err}</div>}
    </Dialog>
  )
}

export function ReextractDialog({ upload, open, suggested, onClose, onDone }: {
  upload: Upload; open: boolean; suggested: number[]; onClose: () => void; onDone: (u: Upload) => void
}) {
  const [pages, setPages] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  useEffect(() => { if (open) { setPages(new Set(suggested)); setErr(undefined) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const total = upload.page_count ?? Math.max(1, ...suggested)
  const toggle = (n: number) => setPages(s => { const x = new Set(s); if (x.has(n)) x.delete(n); else x.add(n); return x })
  const submit = async () => {
    if (pages.size === 0) { setErr('Pick at least one page.'); return }
    setBusy(true); setErr(undefined)
    try { onDone(await reviewApi.reextract(upload.id, [...pages].sort((a, b) => a - b))) }
    catch (e) { setErr(errorText(e)) }
    finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onClose={onClose} dismissable={!busy} title="Re-extract pages"
      description="A second pass re-reads the pages you pick. Findings refresh when it finishes. Pages with open findings are preselected."
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Re-extract {pages.size} page{pages.size === 1 ? '' : 's'}</Button></>}>
      <fieldset className="rv-choices">
        <legend className="ds-field__label">Pages</legend>
        <div className="rv-pages">
          {Array.from({ length: total }, (_, i) => i + 1).map(n => (
            <label key={n}><input type="checkbox" checked={pages.has(n)} onChange={() => toggle(n)} aria-label={`Page ${n}`} />{n}</label>
          ))}
        </div>
      </fieldset>
      {err && <div className="rv-dialog-error" role="alert">{err}</div>}
    </Dialog>
  )
}
