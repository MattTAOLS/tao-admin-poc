import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, Dialog, Field, StatusPill, Textarea, icons, formatByUnit, formatDiffByUnit, formatPeriod } from '@/design/components'
import { errorText, reviewApi } from '../lib/api'
import { ruleTitle } from '../lib/rules'
import type { ApiError, Extraction, Finding, HoldRequest, NotifyChoices, NotReason, OverrideChoice, Recipients, Upload, ValueEdit } from '../lib/types'
import { useLoad } from '../lib/useLoad'
import { EditsTable } from './Corrections'
import { CLOSING_RULES, hasTargets, isValueChoice, listLabels, plannedCorrections, pointerLabel, writesFor } from '../lib/corrections'
import { isReissueFinding, type ReissueInfo } from '../lib/reissue'
import { formatDateTime, formatMessage } from '../lib/format'

export const CHOICES: { id: OverrideChoice; label: string; help: string }[] = [
  { id: 'use_ours', label: 'Use ours', help: 'Our value is right; publishing writes it over the report figure.' },
  { id: 'use_report', label: 'Use report', help: 'The report figure is right; publishing keeps it.' },
  { id: 'restatement', label: 'Accept as restatement', help: 'The servicer revised an earlier month on purpose.' },
  { id: 'acknowledge', label: 'Acknowledge', help: 'Noted; no value changes.' },
]
const MIN_REASON = 3
export const NO_TARGET_REASON = 'This rule names no single value to change, so only Accept as restatement or Acknowledge apply.'

/** Reason field shared by the override and reject dialogs: required, at least three characters (OverrideRequest /
 * RejectRequest minLength). */
function useReason(open: boolean) {
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  useEffect(() => { if (open) { setReason(''); setTouched(false) } }, [open])
  const ok = reason.trim().length >= MIN_REASON
  return { reason, setReason, ok, touched, setTouched, error: touched && !ok ? `Give a reason of at least ${MIN_REASON} characters. It goes in the audit log.` : undefined }
}

/** What a value choice does on publish, in one sentence: "Writes $15,020,071.52 to 5 fields: …". */
export function WriteEffect({ ex, finding, choice, done }: { ex?: Extraction; finding: Finding; choice: OverrideChoice; done?: boolean }) {
  const writes = writesFor(ex, finding, choice)
  if (writes.length === 0) return null
  const value = formatByUnit(writes[0].value as number, finding.unit)
  const changed = writes.filter(w => w.changed)
  if (changed.length === 0) {
    return <>{done ? 'Unchanged' : 'Nothing changes'}: the extraction already holds {value} in {writes.length === 1 ? 'that field' : `all ${writes.length} fields`}.</>
  }
  const n = changed.length
  return <>{done ? 'Wrote' : 'Writes'} {value} to {n} field{n === 1 ? '' : 's'}: {listLabels(changed.map(w => w.label), 6)}.</>
}

export function OverrideDialog({ uploadId, finding, ex, initialChoice, onClose, onDone }: {
  uploadId: string; finding: Finding | null; ex?: Extraction; initialChoice: OverrideChoice; onClose: () => void
  onDone: (findings: Finding[], choice: OverrideChoice) => void
}) {
  const open = !!finding
  const [choice, setChoice] = useState<OverrideChoice>(initialChoice)
  const r = useReason(open)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  const valueOk = !!finding && hasTargets(finding)
  useEffect(() => {
    if (open) { setChoice(isValueChoice(initialChoice) && !valueOk ? 'acknowledge' : initialChoice); setErr(undefined) }
  }, [open, initialChoice, valueOk])
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
        <p style={{ margin: 0 }}>{formatMessage(finding.message)}</p>
        {!isReissueFinding(finding) && (finding.our_value !== undefined || finding.report_value !== undefined) && (
          <dl className="rv-facts">
            <div><dt>Ours</dt><dd>{formatByUnit(finding.our_value, finding.unit)}</dd></div>
            <div><dt>Report</dt><dd>{formatByUnit(finding.report_value, finding.unit)}</dd></div>
            <div><dt>Difference</dt><dd>{formatDiffByUnit(finding.difference, finding.unit)}</dd></div>
          </dl>
        )}
        <fieldset className="rv-choices">
          <legend className="ds-field__label">Resolution</legend>
          {CHOICES.map(c => {
            const off = isValueChoice(c.id) && !valueOk
            const label = c.id === 'acknowledge' && isReissueFinding(finding) ? 'Accept as replacement' : c.label
            const help = c.id === 'acknowledge' && isReissueFinding(finding) ? 'Publishing then replaces the earlier report.' : c.help
            return (
              <label key={c.id} className={'rv-choice' + (off ? ' rv-choice--off' : '')}>
                <input type="radio" name="override-choice" value={c.id} checked={choice === c.id} disabled={off} onChange={() => setChoice(c.id)}
                  aria-describedby={off ? 'rv-no-target' : undefined} />
                <span><b>{label}</b><small>{help}</small></span>
              </label>
            )
          })}
          {!valueOk && <p id="rv-no-target" className="rv-hint">{NO_TARGET_REASON}</p>}
        </fieldset>
        {isValueChoice(choice) && valueOk && (
          <p className="rv-effect" data-testid="write-effect"><b>On publish.</b> <WriteEffect ex={ex} finding={finding} choice={choice} /></p>
        )}
        {isReissueFinding(finding) && (
          <p className="rv-hint">This finding marks a corrected re-issue. Acknowledge accepts it as the replacement; publishing then
            replaces the earlier report. Say who sent the correction and why.</p>
        )}
        {CLOSING_RULES.has(finding.rule_id) && valueOk && (
          <p className="rv-hint">This rule corrects the closing balance. If a component (principal, prepayments, defaults) is what
            was misread, the report&rsquo;s closing is right: choose Use report, which changes nothing.</p>
        )}
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
      description={`${title}. The status turns to Rejected and the reason goes in the audit log. The period can be uploaded again.`}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="danger" loading={busy} onClick={submit}>Reject report</Button></>}>
      <div className="rv-dialog-body">
        <Field label="Reason" required error={r.error} hint="Shown on the review page and kept in the audit log.">
          <Textarea rows={3} value={r.reason} onChange={e => r.setReason(e.target.value)} onBlur={() => r.setTouched(true)} />
        </Field>
        {err && <div className="rv-dialog-error" role="alert">{err}</div>}
      </div>
    </Dialog>
  )
}

export const NOTE_MAX = 2000

export const HOLD_NOTE_MAX = 1000
export const SAVED_TOAST = 'Saved. On hold in the Approval queue.'

/** "Save…" on the action bar: marks the report On hold with an optional note. Sends only `note`; the stored draft
 * (publish note and notification choices) is not part of this body, so it stays as it is. */
export function SaveDialog({ upload, open, onClose, onDone }: { upload: Upload; open: boolean; onClose: () => void; onDone: (u: Upload) => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  useEffect(() => { if (open) { setNote(upload.hold?.note ?? ''); setErr(undefined) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    setBusy(true); setErr(undefined)
    try { onDone(await reviewApi.holdUpload(upload.id, { note: note.trim() || null })) }
    catch (e) { setErr(errorText(e)) }
    finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onClose={onClose} dismissable={!busy} title="Save for later" size="sm"
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Save and close</Button></>}>
      <div className="rv-dialog-body">
        <Field label="Why is it waiting? (optional)"
          hint={<>Shown in the Approval queue. <span className="rv-counter" data-testid="hold-note-count">{note.length.toLocaleString('en-US')} / {HOLD_NOTE_MAX.toLocaleString('en-US')}</span></>}>
          <Textarea rows={3} value={note} maxLength={HOLD_NOTE_MAX} onChange={e => setNote(e.target.value)} />
        </Field>
        <p className="rv-hint">The report stays in the Approval queue marked On hold. Nothing is sent to partners. Your draft note and notification choices are kept.</p>
        {err && <div className="rv-dialog-error" role="alert">{err}</div>}
      </div>
    </Dialog>
  )
}

export function PublishDialog({ upload, open, title, partner, findings, ex, edits = [], reissue, replacedPublishedAt, threadCount = 0, onClose, onDone, onSaved, onGoTo }: {
  upload: Upload; open: boolean; title: string; partner: string; findings: Finding[]; ex?: Extraction
  /** Comment threads on the upload: internal, never sent; the dialog says so. */
  threadCount?: number
  /** Value edits in force from review (not reverted, not part of a correction): publishing writes each one. */
  edits?: ValueEdit[]
  reissue?: ReissueInfo | null; replacedPublishedAt?: string | null
  onClose: () => void; onDone: (u: Upload) => void; onGoTo: (findingId: string) => void
  /** "Save for later" in the footer (needs_review only): the note and the choices were stored as the draft. */
  onSaved?: (u: Upload) => void
}) {
  const [busy, setBusy] = useState<'publish' | 'save' | null>(null)
  const [err, setErr] = useState<ApiError>()
  const [note, setNote] = useState('')
  // What was switched by hand, as user ids. Starts from the stored draft; a choice the recipients no longer allow
  // (the person cannot be changed any more, or is already in that state) is dropped by notifyChoices below.
  const [picked, setPicked] = useState<{ add: string[]; remove: string[] }>({ add: [], remove: [] })
  useEffect(() => {
    if (!open) return
    setErr(undefined); setBusy(null)
    setNote(upload.draft?.note_to_partners ?? '')
    setPicked({ add: [...(upload.draft?.notify?.add ?? [])], remove: [...(upload.draft?.notify?.remove ?? [])] })
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const recipients = useLoad(() => reviewApi.recipients(upload.id), [upload.id, open], open)
  const notify = useMemo(() => notifyChoices(recipients.data, picked), [recipients.data, picked])
  const toggle = (userId: string, wasNotified: boolean) => setPicked(p => {
    const key = wasNotified ? 'remove' : 'add'
    return { ...p, [key]: p[key].includes(userId) ? p[key].filter(x => x !== userId) : [...p[key], userId] }
  })
  const resolved = findings.filter(f => f.status !== 'open').length
  const openReview = findings.filter(f => f.status === 'open' && f.severity === 'review').length
  const openNotes = findings.filter(f => f.status === 'open' && f.severity === 'note').length
  const writes = plannedCorrections(ex, findings)
  const changes = writes.filter(w => w.changed)
  const unchanged = [...new Set(writes.map(w => w.finding.id))].filter(id => !changes.some(c => c.finding.id === id))
  const byId = (id: string) => findings.find(f => f.id === id)
  const submit = async () => {
    setBusy('publish'); setErr(undefined)
    try { onDone(await reviewApi.approve(upload.id, note.trim() || null, notify)) }
    catch (e) { setErr(e as ApiError) }
    finally { setBusy(null) }
  }
  // Save for later: the note and the choices become the stored draft. The hold note is sent only when one exists.
  // While the recipients are not loaded the choices cannot be checked, so the stored ones go back unchanged.
  const save = async () => {
    setBusy('save'); setErr(undefined)
    const body: HoldRequest = { note_to_partners: note.trim() || null, notify: recipients.data ? notify : { add: picked.add, remove: picked.remove } }
    if (upload.hold?.note) body.note = upload.hold.note
    try { onSaved?.(await reviewApi.holdUpload(upload.id, body)) }
    catch (e) { setErr(e as ApiError) }
    finally { setBusy(null) }
  }
  const canSave = !!onSaved && upload.status === 'needs_review'
  const goTo = (id: string) => {
    const f = byId(id)
    return f ? <Button key={id} size="sm" onClick={() => onGoTo(id)}>Go to {f.rule_id}</Button> : null
  }
  return (
    <Dialog open={open} onClose={onClose} dismissable={!busy} title="Publish to partner" size="lg"
      description={`${title} goes to ${partner}. Partner portals show it straight away and the program roll-up regenerates.`}
      footer={<>
        <Button onClick={onClose} disabled={!!busy}>Cancel</Button>
        {canSave && <Button loading={busy === 'save'} disabled={busy === 'publish'} onClick={save}>Save for later</Button>}
        <Button variant="primary" loading={busy === 'publish'} disabled={busy === 'save'} onClick={submit}>Approve and publish</Button>
      </>}>
      <ul className="rv-summary">
        <li>Collection period {formatPeriod(upload.collection_period)}{upload.reporting_period && <>, reporting period {formatPeriod(upload.reporting_period)}</>}</li>
        {reissue && (
          <li data-testid="publish-replaces"><b>Replaces the report published {(reissue.publishedAt ?? replacedPublishedAt) ? formatDateTime(reissue.publishedAt ?? replacedPublishedAt) : 'earlier'}.</b>{' '}
            Partners see this re-issue instead; the earlier upload stays in the audit log.
            {reissue.laterPeriods.length > 0 && <> Later months ({reissue.laterPeriods.map(formatPeriod).join(', ')}) keep the earlier figures for this month.</>}</li>
        )}
        <li>{resolved} finding{resolved === 1 ? '' : 's'} resolved with a reason</li>
        {openReview > 0 && <li>{openReview} review finding{openReview === 1 ? '' : 's'} still open: publishing accepts {openReview === 1 ? 'it' : 'them'} as shown</li>}
        {openNotes > 0 && <li>{openNotes} note{openNotes === 1 ? '' : 's'} (information only)</li>}
        {edits.length > 0 && <li>{edits.length} value edit{edits.length === 1 ? '' : 's'} by hand, listed below</li>}
      </ul>
      {edits.length > 0 && (
        <div className="rv-corrections" data-testid="publish-edits">
          <h3 className="rv-section__title">Values edited by hand</h3>
          <EditsTable ex={ex} edits={edits} caption="Values edited by hand" />
          <p className="rv-hint">Publishing writes each edited value and records it in the deal&rsquo;s data corrections as a manual change.</p>
        </div>
      )}
      {changes.length > 0 ? (
        <div className="rv-corrections">
          <h3 className="rv-section__title">Corrections publishing writes</h3>
          <div className="rv-scroll">
            <table className="ds-table ds-table--compact" aria-label="Corrections publishing writes">
              <thead><tr><th scope="col">Field</th><th scope="col" className="ds-num">Extracted</th><th scope="col" className="ds-num">Published</th><th scope="col">From</th></tr></thead>
              <tbody>
                {changes.map(w => (
                  <tr key={w.finding.id + w.pointer}>
                    <td>{w.label}</td>
                    <td className="ds-num">{formatByUnit(w.old as number, w.finding.unit)}</td>
                    <td className="ds-num"><b>{formatByUnit(w.value as number, w.finding.unit)}</b></td>
                    <td>{w.finding.rule_id} · {CHOICES.find(c => c.id === w.choice)?.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="rv-hint">Recorded in the deal&rsquo;s data corrections. The rules re-run on the corrected deal before anything is published.</p>
        </div>
      ) : edits.length === 0 ? (
        <p className="rv-hint">No values change: the published deal is the extraction as shown.</p>
      ) : null}
      {unchanged.length > 0 && <p className="rv-hint">{unchanged.map(id => byId(id)?.rule_id).join(', ')}: the chosen value is already the extracted one, so nothing is written.</p>}
      <div className="rv-notify">
        <Field label="Note to partners (optional)"
          hint={<>Sent with the publish notification as a note from TAO, signed by the company. Plain text. <span className="rv-counter" data-testid="note-count">{note.length.toLocaleString('en-US')} / {NOTE_MAX.toLocaleString('en-US')}</span></>}>
          <Textarea rows={3} value={note} maxLength={NOTE_MAX} onChange={e => setNote(e.target.value)} />
        </Field>
      </div>
      <RecipientsList load={recipients} threadCount={threadCount} choices={notify} onToggle={toggle} onReset={() => setPicked({ add: [], remove: [] })} disabled={!!busy} />
      {err && <PublishError err={err} findings={findings} ex={ex} goTo={goTo} />}
    </Dialog>
  )
}

const PARTNER: Record<string, string> = { investor: 'Investor', manager: 'Manager' }
const partnerName = (s?: string | null) => (s ? PARTNER[s] ?? s : 'TAO')
export const NOT_REASON: Record<NotReason, string> = {
  not_subscribed: 'does not receive this deal',
  deactivated: 'deactivated',
  not_visible: 'the program is not shared with their partner',
  switched_off: 'switched this off in their Profile',
  partner_notifications_off: 'partner notifications are off',
}
export const NOTIFICATIONS_OFF = 'Partner notifications are off, so no partner is notified.'
const channelText = (c: string) => (c === 'email' ? 'Email (coming later)' : c === 'in_app' ? 'In-app' : c)

type Person = { user_id: string; name: string; partner_slug: string | null; notified: boolean; locked: boolean; reason?: NotReason; channels: string[] }

/** Everyone the API listed, as one row each: who is notified by default, and whether the row may be switched. */
export function recipientPeople(r: Recipients | undefined): Person[] {
  if (!r) return []
  return [
    ...r.notified.map(x => ({ user_id: x.user_id, name: x.name, partner_slug: x.partner_slug ?? null, notified: true, locked: x.can_change === false, channels: x.channels ?? [] })),
    ...r.not_notified.map(x => ({ user_id: x.user_id, name: x.name, partner_slug: x.partner_slug ?? null, notified: false, locked: x.can_change !== true, reason: x.reason, channels: [] as string[] })),
  ]
}

/** The choices that still apply: add only for people who are not notified and can be changed, remove only for people
 * who are notified. Anything else (a stale saved choice) is dropped without a word. */
export function notifyChoices(r: Recipients | undefined, picked: NotifyChoices): { add: string[]; remove: string[] } {
  const people = recipientPeople(r)
  const can = (id: string, notified: boolean) => people.some(p => p.user_id === id && p.notified === notified && !p.locked)
  return { add: [...new Set(picked.add ?? [])].filter(id => can(id, false)), remove: [...new Set(picked.remove ?? [])].filter(id => can(id, true)) }
}

/** "Who gets notified": GET /uploads/{id}/recipients, worked out by the API from subscriptions, partner visibility,
 * user status, prefs and the partner notifications setting. One row per person, TAO first, then each partner. A row
 * with can_change can be switched for this publish only; the others are locked with the API's reason. */
export function RecipientsList({ load, threadCount = 0, choices, onToggle, onReset, disabled }: {
  load: { data?: Recipients; error: unknown; loading: boolean; reload: () => void }; threadCount?: number
  /** Choices in force (already checked against the list). Without onToggle the list is read-only. */
  choices?: { add: string[]; remove: string[] }
  onToggle?: (userId: string, wasNotified: boolean) => void; onReset?: () => void; disabled?: boolean
}) {
  const r = load.data
  const off = !!r && r.not_notified.some(x => x.reason === 'partner_notifications_off')
  const add = choices?.add ?? [], remove = choices?.remove ?? []
  const people = recipientPeople(r)
  const isOn = (p: Person) => (p.notified ? !remove.includes(p.user_id) : add.includes(p.user_id))
  const n = people.filter(isOn).length
  const changed = add.length + remove.length
  const slugs = [...new Set(people.map(p => p.partner_slug))].sort((a, b) => (a === null ? -1 : b === null ? 1 : partnerName(a).localeCompare(partnerName(b))))
  return (
    <section className="rv-notify" aria-label="Who gets notified" data-testid="recipients">
      <h3 className="rv-section__title">Who gets notified{r && <span className="rv-muted" data-testid="notify-count"> · {n === 0 ? 'nobody' : `${n} ${n === 1 ? 'person' : 'people'}`}</span>}</h3>
      {load.error != null && !r ? (
        <p className="rv-hint" role="status">Could not load the recipients: {errorText(load.error)} Publishing still works. <button type="button" className="rv-linkbtn" onClick={() => load.reload()}>Retry</button></p>
      ) : !r ? (
        <p className="rv-hint" aria-busy="true">Loading recipients…</p>
      ) : <>
        {changed > 0 && (
          <p className="rv-hint" data-testid="notify-changes">{changed} change{changed === 1 ? '' : 's'} for this report only. Subscriptions are not changed.{' '}
            <button type="button" className="rv-linkbtn" onClick={onReset} disabled={disabled}>Reset</button></p>
        )}
        {off && <p className="rv-notify__off" data-testid="notifications-off"><b>{NOTIFICATIONS_OFF}</b> A TAO Admin can turn them on in System settings.</p>}
        {n === 0 && !off && <p className="rv-hint">Nobody is notified: no active partner user receives this deal.</p>}
        {slugs.map(slug => (
          <div key={slug ?? 'tao'} className="rv-people">
            <h4 className="rv-people__group">{partnerName(slug)}</h4>
            <ul className="rv-people__list" aria-label={partnerName(slug)}>
              {people.filter(p => p.partner_slug === slug).map(p => {
                const on = isOn(p)
                const why = p.reason ? NOT_REASON[p.reason] ?? p.reason.replace(/_/g, ' ') : null
                const hand = on !== p.notified
                return (
                  <li key={p.user_id} className={'rv-person' + (p.locked ? ' rv-person--locked' : '')} data-testid={`recipient-${p.user_id}`}>
                    <input type="checkbox" role="switch" className="rv-switch" aria-label={p.name} checked={on} disabled={p.locked || !onToggle || disabled}
                      onChange={() => onToggle?.(p.user_id, p.notified)} />
                    <span className="rv-person__name">{p.name}</span>
                    <span className="rv-person__side">{partnerName(slug)}</span>
                    <StatusPill tone={on ? 'ok' : 'neutral'} size="sm">{on ? 'Will be notified' : 'Not notified'}</StatusPill>
                    <span className="rv-person__why">
                      {hand ? <b>{on ? 'Added for this report' : 'Left out for this report'}</b>
                        : p.locked ? <><icons.IconLock width={12} height={12} /> Locked: {why ?? 'cannot be changed'}</>
                        : !on ? why
                        : p.channels.map(channelText).join(' · ')}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </>}
      <p className="rv-hint">{threadCount > 0 ? `The ${threadCount} internal comment thread${threadCount === 1 ? '' : 's'} on this upload ${threadCount === 1 ? 'is' : 'are'} not sent.` : 'Comments on this upload are internal and never sent.'}</p>
    </section>
  )
}

/** A refused approve, with the detail the API sends for the two correction errors and links to the cards involved. */
function PublishError({ err, findings, ex, goTo }: { err: ApiError; findings: Finding[]; ex?: Extraction; goTo: (id: string) => ReactNode }) {
  const unitOf = (id: string) => findings.find(f => f.id === id)?.unit
  if (err.code === 'conflicting_corrections' && err.conflicts?.length) {
    return (
      <div className="rv-dialog-error" role="alert">
        <p>{errorText(err)}</p>
        <ul className="rv-summary">
          {err.conflicts.map(c => (
            <li key={c.pointer}>
              <b>{pointerLabel(ex?.deal, c.pointer)}</b>:{' '}
              {c.values.map((v, i) => <span key={i}>{i > 0 && ' vs '}{formatByUnit(v as number, unitOf(c.finding_ids[i]))} ({c.rule_ids[i]})</span>)}
              <span className="rv-pills rv-goto">{c.finding_ids.map(goTo)}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }
  if (err.code === 'correction_inconsistent' && err.findings?.length) {
    const sources = [...new Set(plannedCorrections(ex, findings).filter(w => w.changed).map(w => w.finding.id))]
    return (
      <div className="rv-dialog-error" role="alert">
        <p>{errorText(err)}</p>
        <ul className="rv-summary">
          {err.findings.map((k, i) => <li key={i}><b>{k.rule_id} {ruleTitle(k.rule_id)}</b>: {formatMessage(k.message)}</li>)}
        </ul>
        {sources.length > 0 && <p>Corrections involved: <span className="rv-pills rv-goto">{sources.map(goTo)}</span></p>}
      </div>
    )
  }
  return <div className="rv-dialog-error" role="alert">{errorText(err)}</div>
}

export function ReextractDialog({ upload, open, suggested, editedPages, onClose, onDone }: {
  upload: Upload; open: boolean; suggested: number[]; onClose: () => void; onDone: (u: Upload) => void
  /** Edited values in force, by page: re-extracting such a page keeps the edit (D1 note 5). */
  editedPages?: Map<number, number>
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
      {[...pages].sort((a, b) => a - b).filter(n => editedPages?.get(n)).map(n => {
        const k = editedPages!.get(n)!
        return <p key={n} className="rv-hint rv-warnline" data-testid="reextract-edited">Page {n} has {k} edited value{k === 1 ? '' : 's'}. The edit is kept and applied over the new extraction; check it after the second pass.</p>
      })}
      {err && <div className="rv-dialog-error" role="alert">{err}</div>}
    </Dialog>
  )
}
