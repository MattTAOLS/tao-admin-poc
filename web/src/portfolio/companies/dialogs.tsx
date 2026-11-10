/** TAO Admin dialogs on the company profile: Edit record, add / edit / remove a key contact, and Mark reviewed / Dismiss
 * for an adverse media item. Every write carries a reason or a note (the API audits it). */
import { useState } from 'react'
import { Button, Dialog, Field, Input, Select, Textarea } from '@/design/components'
import { api } from '@/shell/api'
import type { AdverseItem, Company, CompanyContact, CompanyPatch, ContactInput, NewsLanguage, TaoUser } from './types'
import { LANGUAGE_WORD, errText } from './util'

const MIN_REASON = 3
const orNull = (s: string) => (s.trim() ? s.trim() : null)
/** Contract: each context word and exclusion phrase has at least 2 characters. */
const MIN_TERM = 2
const LANGS: NewsLanguage[] = ['en', 'fr']
const uniqueTerms = (xs: string[]) => {
  const seen = new Set<string>()
  return xs.map(x => x.trim()).filter(x => x && !seen.has(x.toLowerCase()) && (seen.add(x.toLowerCase()), true))
}

export type DealOption = { deal_slug: string; deal_name: string; program_name: string }

export function EditRecordDialog({ company, users, deals, onClose, onSaved }: {
  company: Company; users: TaoUser[] | null; deals: DealOption[]; onClose: () => void; onSaved: (c: Company) => void
}) {
  const [industry, setIndustry] = useState(company.industry ?? '')
  const [naics, setNaics] = useState(company.naics ?? '')
  const [hq, setHq] = useState(company.headquarters ?? '')
  const [website, setWebsite] = useState(company.website ?? '')
  const [since, setSince] = useState(company.relationship_since_source === 'record' ? company.relationship_since ?? '' : '')
  const [owner, setOwner] = useState(company.owner?.id ?? '')
  const [aliases, setAliases] = useState(company.aliases.join(', '))
  const current = company.deals.map(d => d.deal_slug)
  const [links, setLinks] = useState<string[]>(current)
  // News search (decision E7): only when the API sends the settings (TAO callers on a wave E API).
  const ns = company.news_search
  const [context, setContext] = useState(ns ? ns.context_terms.join(', ') : '')
  const [exclusions, setExclusions] = useState(ns ? ns.exclusions.join('\n') : '')
  const [langs, setLangs] = useState<NewsLanguage[]>(ns ? ns.languages : LANGS)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  const [tried, setTried] = useState(false)

  const sinceOk = !since || /^\d{4}-(0[1-9]|1[0-2])$/.test(since)
  const reasonOk = reason.trim().length >= MIN_REASON
  const patch: CompanyPatch = { reason: reason.trim() }
  if (orNull(industry) !== company.industry) patch.industry = orNull(industry)
  if (orNull(naics) !== company.naics) patch.naics = orNull(naics)
  if (orNull(hq) !== company.headquarters) patch.headquarters = orNull(hq)
  if (orNull(website) !== company.website) patch.website = orNull(website)
  const sinceWas = company.relationship_since_source === 'record' ? company.relationship_since : null
  if (orNull(since) !== sinceWas) patch.relationship_since = orNull(since)
  if ((owner || null) !== (company.owner?.id ?? null)) patch.owner_user_id = owner || null
  const aliasList = aliases.split(',').map(a => a.trim()).filter(Boolean)
  if (aliasList.join('|') !== company.aliases.join('|')) patch.aliases = aliasList
  if ([...links].sort().join('|') !== [...current].sort().join('|')) patch.deal_slugs = links
  const terms = uniqueTerms(context.split(','))
  const excl = uniqueTerms(exclusions.split(/\r?\n/))
  const langList = LANGS.filter(l => langs.includes(l))
  const termsOk = terms.every(t => t.length >= MIN_TERM)
  const exclOk = excl.every(t => t.length >= MIN_TERM)
  const langsOk = langList.length > 0
  const searchOk = !ns || (termsOk && exclOk && langsOk)
  if (ns && (terms.join('|') !== ns.context_terms.join('|') || excl.join('|') !== ns.exclusions.join('|')
    || langList.join('|') !== LANGS.filter(l => ns.languages.includes(l)).join('|'))) {
    patch.news_search = { context_terms: terms, exclusions: excl, languages: langList }
  }
  const changed = Object.keys(patch).length > 1

  const save = async () => {
    setTried(true)
    if (!reasonOk || !sinceOk || !searchOk || !changed || !links.length) return
    setBusy(true); setErr(undefined)
    try { onSaved(await api<Company>(`/companies/${encodeURIComponent(company.slug)}`, { method: 'PATCH', body: JSON.stringify(patch) })) }
    catch (e) { setErr(errText(e)); setBusy(false) }
  }
  const ownerOptions = [{ value: '', label: 'Not set' }, ...(users ?? []).map(u => ({ value: u.id, label: `${u.name} · ${u.role === 'tao_admin' ? 'TAO Admin' : 'TAO Analyst'}` }))]
  if (company.owner && !(users ?? []).some(u => u.id === company.owner!.id)) ownerOptions.push({ value: company.owner.id, label: company.owner.name })

  return (
    <Dialog open onClose={onClose} dismissable={!busy} size="lg" title={`Edit record · ${company.name}`}
      description="Every change is recorded in the Platform audit log with the reason."
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save record</Button></>}>
      <div className="co-form">
        <div className="tm-grid2">
          <Field label="Industry"><Input value={industry} onChange={e => setIndustry(e.target.value)} placeholder="Not set" /></Field>
          <Field label="NAICS code"><Input value={naics} onChange={e => setNaics(e.target.value)} placeholder="Not set" /></Field>
          <Field label="Headquarters"><Input value={hq} onChange={e => setHq(e.target.value)} placeholder="Not set" /></Field>
          <Field label="Website"><Input value={website} onChange={e => setWebsite(e.target.value)} placeholder="Not set" /></Field>
          <Field label="Relationship since" hint="YYYY-MM. Leave empty to use the first vintage in the report." error={sinceOk ? undefined : 'Use YYYY-MM, e.g. 2018-09.'}>
            <Input value={since} onChange={e => setSince(e.target.value)} placeholder="YYYY-MM" />
          </Field>
          <Field label="TAO relationship owner" hint={users === null ? 'The TAO user list could not be loaded.' : 'An active TAO user.'}>
            <Select value={owner} onChange={e => setOwner(e.target.value)} options={ownerOptions} />
          </Field>
        </div>
        <Field label="Aliases" hint="Other names the news search uses, separated by commas.">
          <Input value={aliases} onChange={e => setAliases(e.target.value)} />
        </Field>
        <fieldset className="tm-sec co-fieldset">
          <legend className="tm-sec__title">Deals linked to this company</legend>
          <div className="co-deallinks">
            {deals.map(d => (
              <label key={d.deal_slug} className="pf-check">
                <input type="checkbox" checked={links.includes(d.deal_slug)}
                  onChange={e => setLinks(l => (e.target.checked ? [...l, d.deal_slug] : l.filter(x => x !== d.deal_slug)))} />
                {d.deal_name} <span className="pf-muted">· {d.program_name}</span>
              </label>
            ))}
          </div>
          <p className="co-hint">A deal belongs to one company. A deal you unlink shows as its own company until linked again.</p>
          {tried && !links.length && <p className="co-err" role="alert">Keep at least one deal linked.</p>}
        </fieldset>
        {ns && (
          <fieldset className="tm-sec co-fieldset co-form" data-testid="news-search-edit">
            <legend className="tm-sec__title">News search</legend>
            <Field label="Context words" hint="For a generic name: a story must mention at least one of these, e.g. leasing, equipment, finance. Separate with commas; leave empty for no rule."
              error={termsOk ? undefined : `Each context word needs at least ${MIN_TERM} characters.`}>
              <Input value={context} onChange={e => setContext(e.target.value)} placeholder="None" />
            </Field>
            <Field label="Exclusion phrases" hint="Phrases that always mean a different company. One per line."
              error={exclOk ? undefined : `Each phrase needs at least ${MIN_TERM} characters.`}>
              <Textarea rows={2} value={exclusions} onChange={e => setExclusions(e.target.value)} placeholder="None" />
            </Field>
            <fieldset className="co-fieldset">
              <legend className="ds-field__label">Languages</legend>
              <div className="co-langs">
                {LANGS.map(l => (
                  <label key={l} className="pf-check">
                    <input type="checkbox" checked={langs.includes(l)}
                      onChange={e => setLangs(x => (e.target.checked ? [...x, l] : x.filter(y => y !== l)))} />
                    {LANGUAGE_WORD[l]}
                  </label>
                ))}
              </div>
              {!langsOk && <p className="co-err" role="alert">Choose at least one language.</p>}
            </fieldset>
          </fieldset>
        )}
        <Field label="Reason" required error={tried && !reasonOk ? `Give a reason (at least ${MIN_REASON} characters).` : undefined}>
          <Textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} />
        </Field>
        {tried && !changed && <p className="co-err" role="alert">Nothing has changed yet.</p>}
        {err && <p className="co-err" role="alert">{err}</p>}
      </div>
    </Dialog>
  )
}

export function ContactDialog({ slug, contact, onClose, onSaved }: {
  slug: string; contact: CompanyContact | null; onClose: () => void; onSaved: (c: CompanyContact) => void
}) {
  const [name, setName] = useState(contact?.name ?? '')
  const [role, setRole] = useState(contact?.role ?? '')
  const [email, setEmail] = useState(contact?.email ?? '')
  const [receives, setReceives] = useState(contact?.receives ?? '')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  const [tried, setTried] = useState(false)
  const ok = name.trim() && reason.trim().length >= MIN_REASON
  const save = async () => {
    setTried(true)
    if (!ok) return
    setBusy(true); setErr(undefined)
    const body: ContactInput = { name: name.trim(), role: orNull(role), email: orNull(email), receives: orNull(receives), reason: reason.trim() }
    try {
      const path = contact ? `/company-contacts/${encodeURIComponent(contact.id)}` : `/companies/${encodeURIComponent(slug)}/contacts`
      onSaved(await api<CompanyContact>(path, { method: contact ? 'PATCH' : 'POST', body: JSON.stringify(body) }))
    } catch (e) { setErr(errText(e)); setBusy(false) }
  }
  return (
    <Dialog open onClose={onClose} dismissable={!busy} title={contact ? `Edit contact · ${contact.name}` : 'Add contact'}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>{contact ? 'Save contact' : 'Add contact'}</Button></>}>
      <div className="co-form">
        <Field label="Name" required error={tried && !name.trim() ? 'Enter a name.' : undefined}><Input value={name} onChange={e => setName(e.target.value)} /></Field>
        <Field label="Role"><Input value={role} onChange={e => setRole(e.target.value)} /></Field>
        <Field label="Email"><Input type="email" value={email} onChange={e => setEmail(e.target.value)} /></Field>
        <Field label="Receives" hint="For example: Monthly SetRep, Covenant queries."><Input value={receives} onChange={e => setReceives(e.target.value)} /></Field>
        <Field label="Reason" required error={tried && reason.trim().length < MIN_REASON ? `Give a reason (at least ${MIN_REASON} characters).` : undefined}>
          <Textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} />
        </Field>
        {err && <p className="co-err" role="alert">{err}</p>}
      </div>
    </Dialog>
  )
}

export function RemoveContactDialog({ contact, onClose, onRemoved }: { contact: CompanyContact; onClose: () => void; onRemoved: () => void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  const [tried, setTried] = useState(false)
  const remove = async () => {
    setTried(true)
    if (reason.trim().length < MIN_REASON) return
    setBusy(true); setErr(undefined)
    try {
      await api<void>(`/company-contacts/${encodeURIComponent(contact.id)}?reason=${encodeURIComponent(reason.trim())}`, { method: 'DELETE' })
      onRemoved()
    } catch (e) { setErr(errText(e)); setBusy(false) }
  }
  return (
    <Dialog open role="alertdialog" onClose={onClose} dismissable={!busy} title={`Remove ${contact.name}?`}
      description="The contact leaves the company record. The audit log keeps it."
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="danger" loading={busy} onClick={remove}>Remove contact</Button></>}>
      <div className="co-form">
        <Field label="Reason" required error={tried && reason.trim().length < MIN_REASON ? `Give a reason (at least ${MIN_REASON} characters).` : undefined}>
          <Textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} />
        </Field>
        {err && <p className="co-err" role="alert">{err}</p>}
      </div>
    </Dialog>
  )
}

/** Mark reviewed (with a note; following partners are then told) or Dismiss (with a reason; never shown to partners). */
export function AdverseDialog({ item, action, onClose, onDone }: {
  item: AdverseItem; action: 'review' | 'dismiss'; onClose: () => void; onDone: (a: AdverseItem) => void
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  const [tried, setTried] = useState(false)
  const review = action === 'review'
  const go = async () => {
    setTried(true)
    if (note.trim().length < MIN_REASON) return
    setBusy(true); setErr(undefined)
    try { onDone(await api<AdverseItem>(`/adverse/${encodeURIComponent(item.id)}/${action}`, { method: 'POST', body: JSON.stringify({ note: note.trim() }) })) }
    catch (e) { setErr(errText(e)); setBusy(false) }
  }
  return (
    <Dialog open onClose={onClose} dismissable={!busy} title={review ? 'Mark reviewed' : 'Dismiss item'}
      description={review
        ? 'Reviewed items are shown to partners who can see this company, and partners who follow it are notified.'
        : 'Dismissed items stay TAO only. Use this for a false match, such as a different entity.'}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant={review ? 'primary' : 'danger'} loading={busy} onClick={go}>{review ? 'Mark reviewed' : 'Dismiss'}</Button></>}>
      <div className="co-form">
        <p className="co-hint"><b>{item.title}</b></p>
        <Field label={review ? 'Review note' : 'Reason'} required
          hint={review ? 'What you checked and what it means for the deal.' : 'For example: different entity, registry number does not match.'}
          error={tried && note.trim().length < MIN_REASON ? `Write at least ${MIN_REASON} characters.` : undefined}>
          <Textarea rows={3} value={note} onChange={e => setNote(e.target.value)} />
        </Field>
        {err && <p className="co-err" role="alert">{err}</p>}
      </div>
    </Dialog>
  )
}
