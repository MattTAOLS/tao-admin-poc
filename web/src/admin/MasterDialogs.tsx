import { useState, type FormEvent, type ReactNode } from 'react'
import { Button, Dialog, Field, Input, Select, Textarea, icons, useToast } from '@/design/components'
import { adminApi, type ApiError, type Band, type CovenantDefinition, type Deal, type Program } from './data'
import { parseNumber } from './master'
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

function useSave<T>(save: () => Promise<T>, done: (v: T) => void, successTitle: string) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const { toast } = useToast()
  const run = async () => {
    setBusy(true); setError(undefined)
    try { const v = await save(); toast({ tone: 'ok', title: successTitle }); done(v) }
    catch (e) { setError(errorText(e as ApiError)) }
    finally { setBusy(false) }
  }
  return { busy, error, setError, run }
}

export function ProgramDialog({ program, onClose, onSaved }: { program: Program; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(program.name)
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
  }
  const s = useSave(() => adminApi.putProgram({ ...program, name: name.trim(), currency, limit: lim!, warehouse_limit: wh ?? null }), onSaved, `${name.trim()} saved`)
  const e = (k: keyof typeof errs) => (touched ? errs[k] : undefined)
  return (
    <EditDialog open title={`Edit ${program.name}`} description="Program limits. Saving writes a master_change entry to the audit log."
      onClose={onClose} busy={s.busy} error={s.error}
      onSubmit={() => { setTouched(true); if (!Object.values(errs).some(Boolean)) s.run() }}>
      <Field label="Program name" required error={e('name')}><Input value={name} onChange={ev => setName(ev.target.value)} /></Field>
      <div className="adm-form__row">
        <Field label="Currency" required error={e('currency')}><Input value={currency} maxLength={3} onChange={ev => setCurrency(ev.target.value.toUpperCase())} /></Field>
        <Field label="Program limit" required error={e('limit')}><Input numeric value={limit} onChange={ev => setLimit(ev.target.value)} /></Field>
        <Field label="Warehouse limit" hint="Leave blank if none." error={e('warehouse')}><Input numeric value={warehouse} onChange={ev => setWarehouse(ev.target.value)} /></Field>
      </div>
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
export type CovenantMode = { kind: 'edit'; def: CovenantDefinition } | { kind: 'version'; def: CovenantDefinition } | { kind: 'new'; dealSlug?: string }

/** Edit a definition in place, add a new version (same deal + legal ref, new effective date), or add a new one. */
export function CovenantDialog({ mode, deals, onClose, onSaved }: { mode: CovenantMode; deals: Deal[]; onClose: () => void; onSaved: () => void }) {
  const base = mode.kind === 'new' ? undefined : mode.def
  const [deal, setDeal] = useState(base?.deal_slug ?? (mode.kind === 'new' ? mode.dealSlug ?? '' : ''))
  const [legalRef, setLegalRef] = useState(base?.legal_ref ?? '')
  const [description, setDescription] = useState(base?.description ?? '')
  const [kind, setKind] = useState<'ceiling' | 'floor'>(base?.kind ?? 'ceiling')
  const [banded, setBanded] = useState(!!base?.threshold_rule)
  const [threshold, setThreshold] = useState(base?.threshold == null ? '' : String(base.threshold))
  const [on, setOn] = useState(base?.threshold_rule?.on ?? '/tranche_balance/closing')
  const [bands, setBands] = useState<BandDraft[]>(base?.threshold_rule?.bands?.map(b => ({
    op: b.lte != null ? 'lte' : 'gt', bound: String(b.lte ?? b.gt ?? ''), threshold: String(b.threshold),
  })) ?? [{ op: 'lte', bound: '', threshold: '' }, { op: 'gt', bound: '', threshold: '' }])
  const [buffer, setBuffer] = useState(String(base?.watch_buffer_pct ?? 0.1))
  const [effective, setEffective] = useState(mode.kind === 'version' ? '' : base?.effective_from ?? '')
  const [source, setSource] = useState(mode.kind === 'version' ? '' : base?.source ?? '')
  const [touched, setTouched] = useState(false)

  const th = parseNumber(threshold), buf = parseNumber(buffer)
  const parsedBands = bands.map(b => ({ op: b.op, bound: parseNumber(b.bound), threshold: parseNumber(b.threshold) }))
  const bandError = (b: typeof parsedBands[number]) => b.bound === undefined || Number.isNaN(b.bound) || b.threshold === undefined || Number.isNaN(b.threshold)
  const errs = {
    deal: !deal ? 'Choose a deal.' : undefined,
    legalRef: !legalRef.trim() ? 'Required, e.g. SLFA 9.1 (c).' : undefined,
    description: !description.trim() ? 'Required.' : undefined,
    threshold: !banded && (th === undefined || Number.isNaN(th)) ? 'A number: a fraction for ratios (0.035 = 3.5%), or the ratio or amount.' : undefined,
    on: banded && !on.startsWith('/') ? 'A JSON pointer into the deal, e.g. /tranche_balance/closing.' : undefined,
    bands: banded && (parsedBands.length === 0 || parsedBands.some(bandError)) ? 'Every band needs a bound and a threshold.' : undefined,
    buffer: buf === undefined || Number.isNaN(buf) || buf < 0 || buf >= 1 ? 'A fraction between 0 and 1 (0.1 = 10%).' : undefined,
    effective: !/^\d{4}-\d{2}-\d{2}$/.test(effective) ? 'Required (YYYY-MM-DD).' : mode.kind === 'version' && effective === mode.def.effective_from ? 'A new version needs a different effective date.' : undefined,
  }
  const e = (k: keyof typeof errs) => (touched ? errs[k] : undefined)
  const body = (): CovenantDefinition => ({
    ...(mode.kind === 'edit' ? { id: mode.def.id } : {}),
    deal_slug: deal, legal_ref: legalRef.trim(), description: description.trim(), kind,
    threshold: banded ? null : th!,
    threshold_rule: banded ? { on: on.trim(), bands: parsedBands.map(b => ({ [b.op]: b.bound!, threshold: b.threshold! } as Band)) } : null,
    watch_buffer_pct: buf!, effective_from: effective, source: source.trim() || null,
  })
  const s = useSave(() => adminApi.putCovenant(body()), onSaved, `${legalRef.trim()} saved`)
  const title = mode.kind === 'edit' ? `Edit ${mode.def.legal_ref}` : mode.kind === 'version' ? `New version of ${mode.def.legal_ref}` : 'Add covenant definition'
  const desc = mode.kind === 'version'
    ? 'An amendment: same deal and legal reference, a new effective date. The earlier version stays on record.'
    : 'Saving writes a master_change entry to the audit log.'
  const setBand = (i: number, patch: Partial<BandDraft>) => setBands(bs => bs.map((b, j) => (j === i ? { ...b, ...patch } : b)))

  return (
    <EditDialog open title={title} description={desc} size="lg" onClose={onClose} busy={s.busy} error={s.error}
      onSubmit={() => { setTouched(true); if (!Object.values(errs).some(Boolean)) s.run() }}>
      <div className="adm-form__row">
        <Field label="Deal" required error={e('deal')}>
          <Select value={deal} onChange={ev => setDeal(ev.target.value)} disabled={mode.kind !== 'new'} placeholder="Choose a deal"
            options={deals.map(d => ({ value: d.slug, label: d.name }))} />
        </Field>
        <Field label="Legal reference" required error={e('legalRef')}>
          <Input value={legalRef} onChange={ev => setLegalRef(ev.target.value)} disabled={mode.kind === 'version'} />
        </Field>
        <Field label="Kind" required>
          <Select value={kind} onChange={ev => setKind(ev.target.value as 'ceiling' | 'floor')}
            options={[{ value: 'ceiling', label: 'Ceiling (value must stay at or below)' }, { value: 'floor', label: 'Floor (value must stay at or above)' }]} />
        </Field>
      </div>
      <Field label="Description" required error={e('description')}><Input value={description} onChange={ev => setDescription(ev.target.value)} /></Field>
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
        <Field label="Effective from" required error={e('effective')}><Input type="date" value={effective} onChange={ev => setEffective(ev.target.value)} /></Field>
      </div>
      <Field label="Source" hint="Agreement and amendment, e.g. SLFA dated 2022-12-09; Amendment 2 2025-03-01.">
        <Textarea rows={2} value={source} onChange={ev => setSource(ev.target.value)} />
      </Field>
    </EditDialog>
  )
}
