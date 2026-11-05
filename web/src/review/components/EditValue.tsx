/** D1 a: edit an extracted value while the report is in review (TAO Admin), the Edited marker every TAO role sees,
 * and Revert. D1 c: on a published report the same control reads "Correct…" and opens the correction dialog. */
import { createContext, useContext, useEffect, useId, useState, type ReactNode } from 'react'
import { Button, Dialog, Field, Input, StatusPill, Textarea } from '@/design/components'
import { errorText, reviewApi } from '../lib/api'
import { ruleTitle } from '../lib/rules'
import { formatDateTime } from '../lib/format'
import { getPointer } from '../lib/provenance'
import {
  KIND_HINT, MIN_EDIT_REASON, MIN_REVERT_REASON, changeText, fmtFor, parseValue, rulesReading, sameNumber, valueKind, type EditState,
} from '../lib/edits'
import type { Extraction, Finding, ValueEdit, ValueEditResult } from '../lib/types'
import { PageCrop, type ViewerTarget } from './PageImage'

export type EditTarget = { pointer: string; label: string }

/** edit: TAO Admin in review (needs_review / approved). correct: TAO Admin on a current published report. read: everyone else. */
export type EditMode = 'edit' | 'correct' | 'read'

type Ctx = {
  mode: EditMode
  states: Map<string, EditState>
  onEdit?: (t: EditTarget) => void
  onRevert?: (t: EditTarget, s: EditState) => void
}
const EditCtx = createContext<Ctx>({ mode: 'read', states: new Map() })
export const EditProvider = EditCtx.Provider
export const useEdits = () => useContext(EditCtx)

const who = (e: ValueEdit) => e.actor_label || (e.actor_role === 'tao_admin' ? 'TAO Admin' : e.actor_role)

/** A number in Extracted values: the value (the edit in force when there is one), the Edited marker with the original
 * underneath, and Edit / Revert / Correct… for TAO Admin. Non-numbers render as they are. */
export function EditableValue({ ex, pointer, label, fmt, align = 'end' }: {
  ex: Extraction; pointer: string; label: string; fmt: (v: unknown) => ReactNode; align?: 'end' | 'start'
}) {
  const { mode, states, onEdit, onRevert } = useEdits()
  const tipId = useId()
  const raw = getPointer(ex.deal, pointer)
  const s = states.get(pointer)
  const numeric = typeof raw === 'number' || !!s
  const target = { pointer, label }
  const control = numeric && mode !== 'read' && (
    <span className="rv-ev__ctl">
      {mode === 'edit' && <button type="button" className="rv-ev__btn" onClick={() => onEdit?.(target)} aria-label={`Edit ${label}`}>Edit</button>}
      {mode === 'edit' && s && !s.current.correction_id && <button type="button" className="rv-ev__btn" onClick={() => onRevert?.(target, s)} aria-label={`Revert ${label}`}>Revert</button>}
      {mode === 'correct' && <button type="button" className="rv-ev__btn" onClick={() => onEdit?.(target)} aria-label={`Correct ${label}`}>Correct…</button>}
    </span>
  )
  if (!s) return <span className={'rv-ev rv-ev--' + align}><span className="rv-ev__val">{fmt(raw)}</span>{control}</span>
  const e = s.current
  const corrected = !!e.correction_id
  return (
    <span className={'rv-ev rv-ev--edited rv-ev--' + align} data-testid="edited-value" data-pointer={pointer}>
      <span className="rv-ev__stack">
        <span className="rv-ev__val">{fmt(e.new_value)}</span>
        <small className="rv-ev__orig">original {fmt(s.original)}</small>
      </span>
      <span className="rv-ev__marker" tabIndex={0} aria-describedby={tipId}>
        <StatusPill tone="blue" size="sm">{corrected ? 'Corrected' : 'Edited'}</StatusPill>
        <span role="tooltip" id={tipId} className="rv-ev__tip">
          {who(e)} · {formatDateTime(e.at)}{s.chain.length > 1 ? ` · edit ${s.chain.length} of ${s.chain.length}` : ''}. {e.reason}
        </span>
      </span>
      {control}
    </span>
  )
}

function useReasonField(open: boolean, min: number) {
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  useEffect(() => { if (open) { setReason(''); setTouched(false) } }, [open])
  const n = reason.trim().length
  const ok = n >= min
  return {
    reason, setReason, ok, setTouched,
    error: touched && !ok ? `Give a reason of at least ${min} characters (${n} so far). It goes in the audit log.` : undefined,
  }
}

/** Edit one value: current value with its page crop and source link, the new value, a reason of 10+ characters, and the
 * rules whose findings read the value. Save stays disabled until the value parses, differs and the reason is long enough. */
export function EditValueDialog({ uploadId, title, ex, findings, target, state, onClose, onOpen, onDone }: {
  uploadId: string; title: string; ex: Extraction; findings: Finding[]; target: EditTarget | null; state?: EditState
  onClose: () => void; onOpen: (t: ViewerTarget) => void; onDone: (r: ValueEditResult, t: EditTarget) => void
}) {
  const open = !!target
  const [input, setInput] = useState('')
  const r = useReasonField(open, MIN_EDIT_REASON)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  useEffect(() => { if (open) { setInput(''); setErr(undefined) } }, [open])
  if (!target) return null
  const ptr = target.pointer
  const fmt = fmtFor(ex.deal, ptr)
  const kind = valueKind(ex.deal, ptr)
  const extracted = getPointer(ex.deal, ptr)
  const current = state ? state.current.new_value : (extracted as number)
  const src = ex.sources?.[ptr]
  const bbox = src && Array.isArray(src.bbox) && src.bbox.length === 4 ? src.bbox : undefined
  const next = parseValue(input, kind)
  const differs = next !== null && !sameNumber(next, current)
  const valueError = input.trim() && next === null ? 'Not a number in this format.' : input.trim() && next !== null && !differs ? 'Same as the current value.' : undefined
  const rules = rulesReading(findings, ptr)
  const canSave = differs && r.ok && !busy
  const view = () => src && onOpen({ page: src.page, boxes: bbox ? [bbox] : [], tone: 'source', caption: target.label, raw: src.raw_text })

  const submit = async () => {
    r.setTouched(true)
    if (!differs || !r.ok || next === null) return
    setBusy(true); setErr(undefined)
    try { onDone(await reviewApi.editValue(uploadId, ptr, next, r.reason.trim()), target) }
    catch (e) { setErr(errorText(e)) }
    finally { setBusy(false) }
  }

  return (
    <Dialog open onClose={onClose} dismissable={!busy} size="lg" title={`Edit ${target.label}`}
      description={`${title}. The original value stays on record. The rules re-run after you save, and the edit goes in the Reports audit log.`}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!canSave} onClick={submit}>Save and re-run rules</Button></>}>
      <div className="rv-dialog-body">
        <div className="rv-editgrid">
          <div>
            <dl className="rv-facts">
              <div><dt>Current value</dt><dd data-testid="edit-current">{fmt(current)}
                <small>{state ? <>edited; extracted {fmt(state.original)}</> : src ? <>extracted from page {src.page}{typeof src.pass === 'number' ? `, pass ${src.pass}` : ''}</> : 'no page source'}</small></dd></div>
            </dl>
            {src && <p className="rv-hint">Raw text on the page: <code>{src.raw_text}</code>{' '}
              <button type="button" className="rv-srclink" onClick={view} aria-label={`Open page ${src.page} in the page viewer`}><span className="rv-srclink__chip">p. {src.page}</span></button></p>}
          </div>
          {src && <PageCrop uploadId={uploadId} page={src.page} boxes={bbox ? [bbox] : []} focus={bbox} onZoom={view} />}
        </div>
        <Field label="New value" required hint={KIND_HINT[kind]} error={valueError}>
          <Input numeric value={input} onChange={e => setInput(e.target.value)} autoComplete="off" />
        </Field>
        {differs && next !== null && <p className="rv-effect" data-testid="edit-change"><b>Change.</b> {changeText(ex.deal, ptr, current, next)}: {fmt(current)} → {fmt(next)}</p>}
        <Field label="Reason" required error={r.error} hint="What you checked on the page, or who confirmed it. Goes in the audit log and on the Edited marker.">
          <Textarea rows={3} value={r.reason} onChange={e => r.setReason(e.target.value)} onBlur={() => r.setTouched(true)} />
        </Field>
        <div className="rv-whensave">
          <h3 className="rv-section__title">When you save</h3>
          <ul className="rv-summary">
            <li>The value shows as Edited, with the original {fmt(state?.original ?? extracted)} next to it.</li>
            <li data-testid="edit-rules">All rules re-run on the edited report.{' '}
              {rules.length > 0
                ? <>Rules that read this value: {rules.map(id => `${id} ${ruleTitle(id)}`).join(', ')}.</>
                : <>No finding on this report names this value, so no rule is known to read it.</>}</li>
            <li>A Reports audit entry records who, when, old → new, and the reason.</li>
          </ul>
        </div>
        {err && <div className="rv-dialog-error" role="alert">{err}</div>}
      </div>
    </Dialog>
  )
}

/** Revert the edit in force on a value, with its own reason (3+ characters) and audit entry. */
export function RevertDialog({ uploadId, ex, target, state, onClose, onDone }: {
  uploadId: string; ex: Extraction; target: EditTarget | null; state?: EditState; onClose: () => void; onDone: (r: ValueEditResult, t: EditTarget) => void
}) {
  const open = !!target && !!state
  const r = useReasonField(open, MIN_REVERT_REASON)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  useEffect(() => { if (open) setErr(undefined) }, [open])
  if (!target || !state) return null
  const fmt = fmtFor(ex.deal, target.pointer)
  const e = state.current
  const submit = async () => {
    r.setTouched(true)
    if (!r.ok) return
    setBusy(true); setErr(undefined)
    try { onDone(await reviewApi.revertEdit(uploadId, e.id, r.reason.trim()), target) }
    catch (x) { setErr(errorText(x)) }
    finally { setBusy(false) }
  }
  return (
    <Dialog open onClose={onClose} dismissable={!busy} title={`Revert ${target.label}`}
      description={`Restores ${fmt(e.old_value)} (the value before this edit; it now shows ${fmt(e.new_value)}). The rules re-run, and the revert goes in the audit log.`}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} disabled={!r.ok || busy} onClick={submit}>Revert and re-run rules</Button></>}>
      <div className="rv-dialog-body">
        <p className="rv-hint">Edited by {who(e)} on {formatDateTime(e.at)}: {e.reason}</p>
        <Field label="Reason" required error={r.error}>
          <Textarea rows={2} value={r.reason} onChange={x => r.setReason(x.target.value)} onBlur={() => r.setTouched(true)} />
        </Field>
        {err && <div className="rv-dialog-error" role="alert">{err}</div>}
      </div>
    </Dialog>
  )
}
