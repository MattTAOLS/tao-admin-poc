import { useState, type FormEvent, type ReactNode } from 'react'
import { Button, Dialog, Field, Input, Select, Textarea, formatPeriod, icons, useToast } from '@/design/components'
import {
  adminApi, programPartners, type ApiError, type Band, type CovenantChange, type CovenantChangeMode, type CovenantChangeResult, type CovenantDefinition,
  type Deal, type Partner, type Program,
} from './data'
import { useResource } from './hooks'
import { firstPeriodFrom, parseNumber, thresholdText } from './master'
import { errorText } from './ui'

/** Shared dialog body: form, error line, Cancel + Save. Escape is disabled while saving. */
function EditDialog({ open, title, description, onClose, onSubmit, busy, error, children, size = 'md', saveLabel = 'Save' }: {
  open: boolean; title: string; description?: string; onClose: () => void; onSubmit: () => void; busy: boolean; error?: string
  children: ReactNode; size?: 'md' | 'lg'; saveLabel?: string
}) {
  const formId = 'adm-form-' + title.replace(/\W+/g, '-').toLowerCase()
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description} size={size} dismissable={!busy}
      footer={<>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" form={formId} loading={busy}>{saveLabel}</Button>
      </>}>
      <form id={formId} className="adm-form" noValidate onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit() }}>
        {children}
        {error && <div className="adm-note adm-note--warn" role="alert">{error}</div>}
      </form>
    </Dialog>
  )
}

function useSave<T>(save: () => Promise<T>, done: (v: T) => void, success: string | ((v: T) => { title: string; message?: string })) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const { toast } = useToast()
  const run = async () => {
    setBusy(true); setError(undefined)
    try {
      const v = await save()
      toast({ tone: 'ok', ...(typeof success === 'string' ? { title: success } : success(v)) })
      done(v)
    }
    catch (e) { setError(errorText(e as ApiError)) }
    finally { setBusy(false) }
  }
  return { busy, error, setError, run }
}

export function ProgramDialog({ program, partners, onClose, onSaved }: { program: Program; partners: Partner[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(program.name)
  const [visible, setVisible] = useState<string[]>(programPartners(program))
  const [currency, setCurrency] = useState(program.currency)
  const [limit, setLimit] = useState(String(program.limit ?? ''))
  const [warehouse, setWarehouse] = useState(program.warehouse_limit == null ? '' : String(program.warehouse_limit))
  const [touched, setTouched] = useState(false)
  const lim = parseNumber(limit), wh = parseNumber(warehouse)
  const errs = {
    name: !name.trim() ? 'Required.' : undefined,
    currency: !/^[A-Z]{3}$/.test(currency) ? 'Three-letter code, e.g. CAD.' : undefined,
    limit: lim === undefined ? 'Required.' : Number.isNaN(lim) || lim < 0 ? 'A non-negative number.' : undefined,
    warehouse: wh !== undefined && (Number.isNaN(wh) || wh < 0) ? 'A non-negative number, or leave blank.' : undefined,
    visible: visible.length === 0 ? 'Choose at least one partner.' : undefined,
  }
  // Keep the master-data order, so the first checked partner becomes partner_slug.
  const ordered = [...partners.map(p => p.slug), ...visible.filter(v => !partners.some(p => p.slug === v))].filter(s => visible.includes(s))
  const toggle = (slug: string, on: boolean) => setVisible(v => (on ? [...v, slug] : v.filter(x => x !== slug)))
  const s = useSave(() => adminApi.putProgram({ ...program, name: name.trim(), partner_slug: ordered[0], partner_slugs: ordered, currency, limit: lim!, warehouse_limit: wh ?? null }), onSaved, `${name.trim()} saved`)
  const e = (k: keyof typeof errs) => (touched ? errs[k] : undefined)
  return (
    <EditDialog open title={`Edit ${program.name}`} description="Limits and the partners who see this program. Saving writes a master_change entry to the audit log."
      onClose={onClose} busy={s.busy} error={s.error}
      onSubmit={() => { setTouched(true); if (!Object.values(errs).some(Boolean)) s.run() }}>
      <Field label="Program name" required error={e('name')}><Input value={name} onChange={ev => setName(ev.target.value)} /></Field>
      <div className="adm-form__row">
        <Field label="Currency" required error={e('currency')}><Input value={currency} maxLength={3} onChange={ev => setCurrency(ev.target.value.toUpperCase())} /></Field>
        <Field label="Program limit" required error={e('limit')}><Input numeric value={limit} onChange={ev => setLimit(ev.target.value)} /></Field>
        <Field label="Warehouse limit" hint="Leave blank if none." error={e('warehouse')}><Input numeric value={warehouse} onChange={ev => setWarehouse(ev.target.value)} /></Field>
      </div>
      <fieldset className="adm-checks" aria-describedby={e('visible') ? 'adm-visible-err' : undefined}>
        <legend className="ds-field__label">Visible to<span className="ds-field__req" aria-hidden="true">*</span></legend>
        {partners.map(pt => (
          <label key={pt.slug} className="adm-check">
            <input type="checkbox" checked={visible.includes(pt.slug)} onChange={ev => toggle(pt.slug, ev.target.checked)} />
            {pt.name}{pt.status !== 'active' && <span className="adm-muted"> ({pt.status})</span>}
          </label>
        ))}
        {partners.length === 0 && <span className="adm-muted">Partner list unavailable; visibility is unchanged.</span>}
        {e('visible') && <span className="ds-field__error" id="adm-visible-err" role="alert">{e('visible')}</span>}
      </fieldset>
    </EditDialog>
  )
}

export function DealDialog({ deal, onClose, onSaved }: { deal: Deal; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(deal.name)
  const [servicer, setServicer] = useState(deal.servicer)
  const [template, setTemplate] = useState(deal.template_id)
  const [touched, setTouched] = useState(false)
  const errs = { name: !name.trim() ? 'Required.' : undefined, servicer: !servicer.trim() ? 'Required.' : undefined, template: !template.trim() ? 'Required.' : undefined }
  const s = useSave(() => adminApi.putDeal({ ...deal, name: name.trim(), servicer: servicer.trim(), template_id: template.trim() }), onSaved, `${name.trim()} saved`)
  const e = (k: keyof typeof errs) => (touched ? errs[k] : undefined)
  return (
    <EditDialog open title={`Edit ${deal.name}`} description="Saving writes a master_change entry to the audit log." onClose={onClose} busy={s.busy} error={s.error}
      onSubmit={() => { setTouched(true); if (!Object.values(errs).some(Boolean)) s.run() }}>
      <Field label="Deal name" required error={e('name')}><Input value={name} onChange={ev => setName(ev.target.value)} /></Field>
      <Field label="Servicer" required error={e('servicer')}><Input value={servicer} onChange={ev => setServicer(ev.target.value)} /></Field>
      <Field label="Template id" required hint="Extraction mapping, e.g. fpil-2.0-settrep-v1." error={e('template')}><Input value={template} onChange={ev => setTemplate(ev.target.value)} /></Field>
    </EditDialog>
  )
}

type BandDraft = { op: 'lte' | 'gt'; bound: string; threshold: string }
/** Edit one covenant (a row of the table; `versions` are the current rows of the same deal + legal ref), or add one. */
export type CovenantMode = { kind: 'edit'; def: CovenantDefinition; versions: CovenantDefinition[] } | { kind: 'add'; dealSlug?: string }
type Choice = Exclude<CovenantChangeMode, 'add'>

const MIN_REASON = 10
/** "SLFA 9.1 (i) saved as a new version" plus the re-run count from rerun_upload_ids. */
export function changeSavedText(mode: CovenantChangeMode, legalRef: string, r: CovenantChangeResult) {
  const n = r.rerun_upload_ids?.length ?? 0
  const what = mode === 'new_version' ? 'saved as a new version' : mode === 'correct' ? 'corrected' : 'added'
  return {
    title: `${legalRef} ${what}`,
    message: n ? `Re-ran the rules on ${n} report${n === 1 ? '' : 's'} in review. Published periods are not touched.`
      : 'No report of this deal was in review, so nothing was re-run. Published periods are not touched.',
  }
}

/** One dialog for every covenant change (PUT /master/covenants, CovenantChange). Edit asks whether the change is a new
 * version from a later date or a correction of the version clicked (same date); Add adds a covenant new to the deal.
 * Deal and legal reference are fixed when editing. Every change needs a reason of at least 10 characters. */
export function CovenantDialog({ mode, deals, onClose, onSaved }: {
  mode: CovenantMode; deals: Deal[]; onClose: () => void; onSaved: (r: CovenantChangeResult, change: CovenantChange) => void
}) {
  const base = mode.kind === 'edit' ? mode.def : undefined
  const latest = mode.kind === 'edit' ? [mode.def, ...mode.versions].map(v => v.effective_from).sort().at(-1)! : undefined
  const [choice, setChoice] = useState<Choice>()
  const [deal, setDeal] = useState(base?.deal_slug ?? (mode.kind === 'add' ? mode.dealSlug ?? '' : ''))
  const [legalRef, setLegalRef] = useState(base?.legal_ref ?? '')
  const [description, setDescription] = useState(base?.description ?? '')
  const [kind, setKind] = useState<'ceiling' | 'floor'>(base?.kind ?? 'ceiling')
  const [unit, setUnit] = useState<string>(base?.unit ?? '')
  const [banded, setBanded] = useState(!!base?.threshold_rule)
  const [threshold, setThreshold] = useState(base?.threshold == null ? '' : String(base.threshold))
  const [on, setOn] = useState(base?.threshold_rule?.on ?? '/tranche_balance/closing')
  const [bands, setBands] = useState<BandDraft[]>(base?.threshold_rule?.bands?.map(b => ({
    op: b.lte != null ? 'lte' : 'gt', bound: String(b.lte ?? b.gt ?? ''), threshold: String(b.threshold),
  })) ?? [{ op: 'lte', bound: '', threshold: '' }, { op: 'gt', bound: '', threshold: '' }])
  const [buffer, setBuffer] = useState(String(base?.watch_buffer_pct ?? 0.1))
  const [effectiveDraft, setEffective] = useState('')
  const [source, setSource] = useState(base?.source ?? '')
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const changeMode: CovenantChangeMode = mode.kind === 'add' ? 'add' : choice ?? 'new_version'
  const effective = changeMode === 'correct' ? base!.effective_from : effectiveDraft
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(effective)

  const th = parseNumber(threshold), buf = parseNumber(buffer)
  const parsedBands = bands.map(b => ({ op: b.op, bound: parseNumber(b.bound), threshold: parseNumber(b.threshold) }))
  const bandError = (b: typeof parsedBands[number]) => b.bound === undefined || Number.isNaN(b.bound) || b.threshold === undefined || Number.isNaN(b.threshold)
  const errs = {
    choice: mode.kind === 'edit' && !choice ? 'Choose how this change applies.' : undefined,
    deal: !deal ? 'Choose a deal.' : undefined,
    legalRef: !legalRef.trim() ? 'Required, e.g. SLFA 9.1 (c).' : undefined,
    description: !description.trim() ? 'Required.' : undefined,
    unit: !unit ? 'Choose the unit the threshold is in.' : undefined,
    threshold: !banded && (th === undefined || Number.isNaN(th)) ? 'A number: a fraction for ratios (0.035 = 3.5%), or the ratio or amount.' : undefined,
    on: banded && !on.startsWith('/') ? 'A JSON pointer into the deal, e.g. /tranche_balance/closing.' : undefined,
    bands: banded && (parsedBands.length === 0 || parsedBands.some(bandError)) ? 'Every band needs a bound and a threshold.' : undefined,
    buffer: buf === undefined || Number.isNaN(buf) || buf < 0 || buf >= 1 ? 'A fraction between 0 and 1 (0.1 = 10%).' : undefined,
    effective: !dateOk ? 'Required (YYYY-MM-DD).'
      : changeMode === 'new_version' && latest && effective <= latest ? `Must be later than ${latest}.` : undefined,
    reason: reason.trim().length < MIN_REASON ? `Required, at least ${MIN_REASON} characters.` : undefined,
  }
  const e = (k: keyof typeof errs) => (touched ? errs[k] : undefined)
  const draft = (): CovenantDefinition => ({
    deal_slug: deal, legal_ref: legalRef.trim(), description: description.trim(), kind,
    unit: (unit || null) as CovenantDefinition['unit'],
    threshold: banded ? null : th ?? null,
    threshold_rule: banded ? { on: on.trim(), bands: parsedBands.map(b => ({ [b.op]: b.bound!, threshold: b.threshold! } as Band)) } : null,
    watch_buffer_pct: buf!, effective_from: effective, source: source.trim() || null,
  })
  const body = (): CovenantChange => ({ ...(changeMode === 'correct' ? { id: base!.id } : {}), ...draft(), mode: changeMode, reason: reason.trim() })
  const s = useSave(() => adminApi.putCovenant(body()), r => onSaved(r, body()), r => changeSavedText(changeMode, legalRef.trim(), r))
  const dealName = deals.find(d => d.slug === deal)?.name ?? deal
  const title = mode.kind === 'edit' ? `Edit ${mode.def.legal_ref} · ${mode.def.description}` : 'Add covenant'
  const desc = mode.kind === 'edit'
    ? `${dealName}. Saving writes an entry to the Platform audit log and adds a row to this covenant’s version history.`
    : 'A covenant R14 has not checked before. Saving writes an entry to the Platform audit log.'
  const saveLabel = mode.kind === 'add' ? 'Add covenant' : choice === 'correct' ? 'Save correction' : choice === 'new_version' ? 'Save new version' : 'Save'
  const setBand = (i: number, patch: Partial<BandDraft>) => setBands(bs => bs.map((b, j) => (j === i ? { ...b, ...patch } : b)))

  return (
    <EditDialog open title={title} description={desc} size="lg" onClose={onClose} busy={s.busy} error={s.error} saveLabel={saveLabel}
      onSubmit={() => { setTouched(true); if (!Object.values(errs).some(Boolean)) s.run() }}>
      {mode.kind === 'edit' ? (
        <>
          <dl className="adm-dl">
            <dt>Deal</dt><dd>{dealName}</dd>
            <dt>Legal reference</dt><dd>{mode.def.legal_ref}</dd>
            <dt>Current version</dt><dd>{`${thresholdText(mode.def)} from ${mode.def.effective_from}`}</dd>
          </dl>
          <fieldset className="adm-choices" aria-describedby={e('choice') ? 'adm-choice-err' : undefined}>
            <legend className="ds-field__label">How this change applies<span className="ds-field__req" aria-hidden="true">*</span></legend>
            <label className="adm-choice">
              <input type="radio" name="adm-cov-choice" value="new_version" checked={choice === 'new_version'} onChange={() => setChoice('new_version')} />
              <span><b>New version from a date</b><small>An amendment. Periods before the effective date keep {thresholdText(mode.def)}.</small></span>
            </label>
            <label className="adm-choice">
              <input type="radio" name="adm-cov-choice" value="correct" checked={choice === 'correct'} onChange={() => setChoice('correct')} />
              <span><b>Correct the current version</b><small>The record was entered wrong. Replaces the values of the version from {mode.def.effective_from}; the old values stay in the history. Reports in review are re-checked.</small></span>
            </label>
            {e('choice') && <span className="ds-field__error" id="adm-choice-err" role="alert">{e('choice')}</span>}
          </fieldset>
        </>
      ) : (
        <>
          <div className="adm-form__row">
            <Field label="Deal" required error={e('deal')}>
              <Select value={deal} onChange={ev => setDeal(ev.target.value)} placeholder="Choose a deal" options={deals.map(d => ({ value: d.slug, label: d.name }))} />
            </Field>
            <Field label="Legal reference" required error={e('legalRef')}><Input value={legalRef} onChange={ev => setLegalRef(ev.target.value)} /></Field>
          </div>
          <Field label="Description" required error={e('description')}><Input value={description} onChange={ev => setDescription(ev.target.value)} /></Field>
        </>
      )}
      <div className="adm-form__row">
        <Field label="Direction" required>
          <Select value={kind} onChange={ev => setKind(ev.target.value as 'ceiling' | 'floor')}
            options={[{ value: 'ceiling', label: 'Ceiling (value must stay at or below)' }, { value: 'floor', label: 'Floor (value must stay at or above)' }]} />
        </Field>
        <Field label="Unit" required hint="Fraction 0.035 = 3.50%, ratio 1.10 = 1.10×, currency = an amount." error={e('unit')}>
          <Select value={unit} onChange={ev => setUnit(ev.target.value)} placeholder="Choose a unit"
            options={[{ value: 'fraction', label: 'Fraction (percentage)' }, { value: 'ratio', label: 'Ratio' }, { value: 'currency', label: 'Currency amount' }]} />
        </Field>
      </div>
      <Field label="Threshold type">
        <Select value={banded ? 'banded' : 'single'} onChange={ev => setBanded(ev.target.value === 'banded')}
          options={[{ value: 'single', label: 'Single threshold' }, { value: 'banded', label: 'Banded threshold rule' }]} />
      </Field>
      {!banded ? (
        <Field label="Threshold" required hint="Fraction for ratios (0.035 = 3.5%); otherwise the ratio or amount." error={e('threshold')}>
          <Input numeric value={threshold} onChange={ev => setThreshold(ev.target.value)} />
        </Field>
      ) : (
        <fieldset className="adm-form" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="adm-section-title">Threshold bands</legend>
          <Field label="Measured on" required hint="JSON pointer into the deal object." error={e('on')}>
            <Input value={on} onChange={ev => setOn(ev.target.value)} className="adm-mono" />
          </Field>
          {bands.map((b, i) => (
            <div className="adm-band-row" key={i}>
              <Field label={`Band ${i + 1} condition`}>
                <Select value={b.op} onChange={ev => setBand(i, { op: ev.target.value as 'lte' | 'gt' })}
                  options={[{ value: 'lte', label: 'at or below' }, { value: 'gt', label: 'above' }]} />
              </Field>
              <Field label={`Band ${i + 1} bound`}><Input numeric value={b.bound} onChange={ev => setBand(i, { bound: ev.target.value })} /></Field>
              <Field label={`Band ${i + 1} threshold`}><Input numeric value={b.threshold} onChange={ev => setBand(i, { threshold: ev.target.value })} /></Field>
              <Button size="sm" aria-label={`Remove band ${i + 1}`} onClick={() => setBands(bs => bs.filter((_, j) => j !== i))} icon={<icons.IconClose width={14} height={14} />} />
            </div>
          ))}
          {e('bands') && <span className="ds-field__error" role="alert">{e('bands')}</span>}
          <div><Button size="sm" icon={<icons.IconPlus width={14} height={14} />} onClick={() => setBands(bs => [...bs, { op: 'gt', bound: '', threshold: '' }])}>Add band</Button></div>
        </fieldset>
      )}
      <div className="adm-form__row">
        <Field label="Watch buffer" required hint="Fraction of the threshold (0.1 = 10%)." error={e('buffer')}><Input numeric value={buffer} onChange={ev => setBuffer(ev.target.value)} /></Field>
        <Field label="Effective from" required error={e('effective')}
          hint={changeMode === 'correct' ? 'A correction keeps the date of the version it corrects.' : changeMode === 'new_version' ? `Must be later than ${latest}.` : undefined}>
          <Input type="date" value={effective} disabled={changeMode === 'correct'} onChange={ev => setEffective(ev.target.value)} />
        </Field>
      </div>
      <Field label="Source" hint="Agreement and amendment, e.g. SLFA dated 2022-12-09; Amendment 2 2025-03-01.">
        <Textarea rows={2} value={source} onChange={ev => setSource(ev.target.value)} />
      </Field>
      <Field label="Reason" required error={e('reason')}
        hint={`At least ${MIN_REASON} characters. Shown in the version history and the Platform audit log.${mode.kind === 'add' ? ' Say where the covenant comes from.' : ''}`}>
        <Textarea rows={2} value={reason} onChange={ev => setReason(ev.target.value)} />
      </Field>
      <Impact mode={changeMode} chosen={mode.kind === 'add' || !!choice} deal={deal} dealName={dealName} legalRef={legalRef.trim() || 'the covenant'}
        base={base} draft={draft()} effective={dateOk ? effective : undefined} />
    </EditDialog>
  )
}

/** "What this change does", worked out from the dates before saving. Every change re-runs the rules on this deal's
 * reports in review (CovenantChange); published periods are never touched. */
function Impact({ mode, chosen, deal, dealName, legalRef, base, draft, effective }: {
  mode: CovenantChangeMode; chosen: boolean; deal: string; dealName: string; legalRef: string; base?: CovenantDefinition; draft: CovenantDefinition; effective?: string
}) {
  const reviews = useResource(() => (deal ? adminApi.uploads({ status: 'needs_review', deal_slug: deal }) : Promise.resolve([])), [deal])
  const open = (reviews.data ?? []).filter(u => u.deal_slug === deal && u.status === 'needs_review')
    .sort((a, b) => a.collection_period.localeCompare(b.collection_period))
  const hasThreshold = draft.threshold != null || !!draft.threshold_rule?.bands?.every(b => Number.isFinite(b.threshold))
  const newText = hasThreshold ? thresholdText(draft) : 'the new threshold'
  const from = effective ? formatPeriod(firstPeriodFrom(effective)) : undefined
  let what: string
  if (!chosen) what = 'Choose how this change applies to see what it does.'
  else if (mode === 'new_version') {
    what = `Adds a new version of ${legalRef}: ${newText}${effective ? ` from ${effective}` : ''}. The version from ${base!.effective_from} (${thresholdText(base!)}) stays in force until then`
      + (from ? `; R14 uses the new version for collection periods from ${from}.` : '.')
  } else if (mode === 'correct') {
    what = `Replaces the values of the version from ${base!.effective_from}: ${thresholdText(base!)} becomes ${newText}. The old values stay in the version history.`
  } else {
    what = `Adds ${legalRef} to ${dealName || 'the deal'}${effective ? ` from ${effective}` : ''}. R14 starts checking it${from ? ` for collection periods from ${from}` : ''}.`
  }
  const uses = (period: string) => (mode === 'new_version' && effective ? (period >= firstPeriodFrom(effective) ? ' (uses the new version)' : ' (keeps the current version)') : '')
  let inReview: ReactNode
  if (!deal) inReview = 'choose a deal.'
  else if (reviews.loading && !reviews.data) inReview = 'checking…'
  else if (reviews.error) inReview = `${dealName}’s reports in review are re-run when you save.`
  else if (open.length === 0) inReview = `none for ${dealName}, so nothing is re-run.`
  else {
    inReview = `${open.map(u => `${dealName} ${formatPeriod(u.collection_period)}${uses(u.collection_period)}`).join('; ')}. `
      + `${open.length === 1 ? 'It is' : 'They are'} re-run when you save, so R14 reflects the change.`
  }
  return (
    <section className="adm-impact" aria-label="What this change does">
      <h3 className="adm-section-title">What this change does</h3>
      <p>{what}</p>
      {chosen && <p><b>Reports in review now:</b> {inReview}</p>}
      <p>Published periods are not touched. To change a published report, use Correct a value on that report.</p>
      <p>Platform audit log: “Master data change”, with old and new values and your reason.</p>
    </section>
  )
}
