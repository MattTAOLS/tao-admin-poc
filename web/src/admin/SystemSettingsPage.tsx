import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, Card, Dialog, Field, Input, StatePanel, StatusPill, Textarea, formatCurrency, formatNumber, useToast } from '@/design/components'
import { usePageHeader } from '@/shell/header'
import { ROLES, type Role } from '@/shell/roles'
import rulesYaml from '@contracts/rules.yaml?raw'
import { adminApi, programPartners, type ApiError, type AuditScope } from './data'
import { useResource, useRole } from './hooks'
import { LoadError, TextLink, errorText, formatDateTime, isoMonth } from './ui'
import {
  EDITABLE, KIND_LABEL, KIND_ORDER, SETTING_LABEL, TEMPLATE_FIELDS, TOLERANCE_MEANS, asBool, asCalendar, asDefaults, asTemplates, cap, isRequired,
  parseRules, prefillCalendar, setPref, settingDiff, settingsApi, validDay, type Calendar, type Defaults, type Setting, type Templates,
} from './settings'

const RULES = parseRules(rulesYaml)
const SECTIONS = [
  ['programs', 'Programs and deals'], ['rules', 'Validation rules'], ['calendar', 'Reporting calendar'], ['notifications', 'Notifications'],
  ['retention', 'Data retention and audit'], ['branding', 'Partner branding'], ['integrations', 'Integrations'], ['maintenance', 'Maintenance'],
] as const

type Draft = { partner_notifications_enabled: boolean; reporting_calendar: Calendar; notification_defaults: Defaults; publish_note_templates: Templates }

function Tag({ kind }: { kind: 'new' | 'shows' | 'later' }) {
  return kind === 'new' ? <span className="adm-tag">New</span>
    : kind === 'later' ? <span className="adm-tag adm-tag--muted">Placeholder</span>
    : <span className="adm-tag adm-tag--muted">Shows what exists</span>
}
function Section({ id, n, title, tag, subtitle, children, actions }: { id: string; n: number; title: string; tag: 'new' | 'shows' | 'later'; subtitle?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <Card as="section" id={`set-${id}`} aria-labelledby={`set-${id}-h`}
      title={<span id={`set-${id}-h`}>{n} · {title} <Tag kind={tag} /></span>} subtitle={subtitle} actions={actions}>
      {children}
    </Card>
  )
}

/** System settings (D10), TAO Admin only. Four editable settings (PUT /settings/{key} with a reason; one audit entry
 * per setting), everything else read-only: extraction templates, rules.yaml (S1), retention (S2: kept indefinitely),
 * branding and integrations placeholders, maintenance (Reset demo stays a script, S4). */
export default function SystemSettingsPage() {
  const role = useRole()
  const admin = role === 'tao_admin'
  const { toast } = useToast()
  const res = useResource(() => (admin ? Promise.all([settingsApi.list(), adminApi.programs(), adminApi.deals(), adminApi.partners()]) : Promise.resolve(null)), [role])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  /** Settings shown with suggested values that the admin chose to save as they are. */
  const [forced, setForced] = useState<string[]>([])
  const [exportBusy, setExportBusy] = useState<AuditScope | null>(null)

  const [settings, programs, deals, partners] = res.data ?? [[], [], [], []]
  const byKey = useMemo(() => new Map(settings.map(s => [s.key, s])), [settings])
  const dealSlugs = deals.map(d => d.slug)
  const loaded = useMemo(() => {
    if (!res.data) return null
    const cal = prefillCalendar(asCalendar(byKey.get('reporting_calendar')?.value), dealSlugs)
    const tpl = asTemplates(byKey.get('publish_note_templates')?.value)
    const saved: Draft = {
      partner_notifications_enabled: asBool(byKey.get('partner_notifications_enabled')?.value),
      reporting_calendar: asCalendar(byKey.get('reporting_calendar')?.value),
      notification_defaults: asDefaults(byKey.get('notification_defaults')?.value),
      publish_note_templates: { new_report: '', correction: '', ...(byKey.get('publish_note_templates')?.value as Partial<Templates> ?? {}) },
    }
    const start: Draft = { ...saved, reporting_calendar: cal.value, publish_note_templates: tpl.value }
    return { saved, start, suggestedDays: cal.suggested, suggestedTpl: tpl.suggested }
  }, [res.data]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (loaded) { setDraft(loaded.start); setForced([]) } }, [loaded])

  usePageHeader({
    title: 'System settings',
    subtitle: 'How the platform is set up: what it reads, what it checks, when reports are due and who is told. TAO Admin only.',
  })

  if (!admin) return <StatePanel kind="no-access" message="System settings is for TAO Admin. Switch role in the sidebar to see it." />
  if (res.error) return <LoadError error={res.error} onRetry={res.reload} />
  if (!loaded || !draft) return <Card><p className="adm-muted">Loading settings…</p></Card>

  const changed = changedKeys(loaded.start, draft, forced)
  const force = (k: string) => setForced(f => (f.includes(k) ? f : [...f, k]))
  const dealName = (s: string) => deals.find(d => d.slug === s)?.name ?? s
  const programName = (s: string) => programs.find(p => p.slug === s)?.name ?? s
  const stamp = (key: string) => { const s = byKey.get(key); return s?.updated_at ? `Last changed ${formatDateTime(s.updated_at)}${s.updated_by ? ` by ${s.updated_by}` : ''}.` : 'Default; never changed.' }
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(d => (d ? { ...d, [k]: v } : d))

  const runExport = async (scope: AuditScope) => {
    const month = isoMonth(new Date())
    setExportBusy(scope)
    try {
      const blob = await adminApi.auditExport(scope, month)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `audit-${scope}-${month}.csv`
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0)
      toast({ tone: 'ok', title: 'Export downloaded', message: `audit-${scope}-${month}.csv. The export is recorded on the Platform tab.` })
    } catch (err) { toast({ tone: 'bad', title: 'Export failed', message: errorText(err as ApiError) }) }
    finally { setExportBusy(null) }
  }

  const roles = ROLES.map(r => r.id).filter(r => draft.notification_defaults[r]?.length)
  const kinds = KIND_ORDER.filter(k => roles.some(r => draft.notification_defaults[r]!.some(p => p.kind === k)))
    .concat([...new Set(roles.flatMap(r => draft.notification_defaults[r]!.map(p => p.kind)))].filter(k => !KIND_ORDER.includes(k)))

  return (
    <div className="adm-stack adm-settings">
      <div className="adm-settingsbar">
        <nav className="adm-toc" aria-label="Settings sections">
          {SECTIONS.map(([id, label], i) => <a key={id} href={`#set-${id}`}>{i + 1} {label}</a>)}
        </nav>
        <div className="adm-actions">
          <Button as="link" to="/admin/settings/users/audit?tab=platform&action=settings_change" variant="ghost">Settings history</Button>
          <Button variant="primary" disabled={changed.length === 0 || invalid(draft)} onClick={() => setSaving(true)}>Save changes</Button>
        </div>
      </div>
      {changed.length > 0 && (
        <div className="adm-note adm-note--warn adm-unsaved" role="status">
          Not saved yet: {changed.map(k => SETTING_LABEL[k]).join(', ')}.{invalid(draft) ? ' Fix the expected days marked in red first.' : ''}{' '}
          <Button size="sm" variant="ghost" onClick={() => { setDraft(loaded.start); setForced([]) }}>Discard</Button>
        </div>
      )}

      <Section id="programs" n={1} title="Programs and deals" tag="shows"
        subtitle={<>From master data. Limits and covenants are edited on the <TextLink to="/admin/partners">Program / facility record</TextLink>, not here. Extraction templates are locked.</>}>
        <div className="adm-scroll">
          <table className="adm-plain">
            <caption className="ds-visually-hidden">Programs</caption>
            <thead><tr><th scope="col">Program</th><th scope="col">Partners</th><th scope="col">Currency</th><th scope="col" className="adm-num">Program limit</th><th scope="col" className="adm-num">Warehouse limit</th><th scope="col" className="adm-num">Deals</th></tr></thead>
            <tbody>{programs.map(p => (
              <tr key={p.slug}>
                <th scope="row">{p.name}</th>
                <td>{programPartners(p).map(s => partners.find(x => x.slug === s)?.name ?? s).join(', ')}</td>
                <td>{p.currency}</td>
                <td className="adm-num">{formatCurrency(p.limit)}</td>
                <td className="adm-num">{p.warehouse_limit == null ? <span className="adm-muted">none</span> : formatCurrency(p.warehouse_limit)}</td>
                <td className="adm-num">{formatNumber(deals.filter(d => d.program_slug === p.slug).length)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <h3 className="adm-section-title">Deals and the extraction template each uses</h3>
        <div className="adm-scroll">
          <table className="adm-plain">
            <caption className="ds-visually-hidden">Deals and extraction templates</caption>
            <thead><tr><th scope="col">Deal</th><th scope="col">Program</th><th scope="col">Servicer</th><th scope="col">template_id</th><th scope="col">Template</th></tr></thead>
            <tbody>{deals.slice().sort((a, b) => programName(a.program_slug).localeCompare(programName(b.program_slug)) || a.name.localeCompare(b.name)).map(d => (
              <tr key={d.slug}>
                <th scope="row">{d.name}</th><td>{programName(d.program_slug)}</td><td>{d.servicer}</td><td className="adm-mono">{d.template_id}</td>
                <td><StatusPill tone="neutral" size="sm">Locked</StatusPill></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="adm-hint">A template decides how the PDF is read, so changing it would change extraction. Adding a deal or a template stays a developer task.</p>
      </Section>

      <Section id="rules" n={2} title="Validation rules" tag="shows"
        subtitle={`contracts/rules.yaml version ${RULES.version}. Severity: Block = cannot publish · Review = goes to the approval queue · Note = shown only.`}>
        <div className="adm-note">Rules, severities and tolerances are read-only here. To change one, request it from the Lead: it is a change to the controls, made in contracts/rules.yaml with the rules tests, and it shows here with its new version.</div>
        <div className="adm-grid-2">
          <table className="adm-plain">
            <caption className="adm-cap">Tolerances</caption>
            <thead><tr><th scope="col">Unit</th><th scope="col" className="adm-num">Value</th><th scope="col">Means</th></tr></thead>
            <tbody>{Object.entries(RULES.tolerances).map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td className="adm-num">{v}</td><td>{TOLERANCE_MEANS[k] ?? ''}</td></tr>)}</tbody>
          </table>
          <table className="adm-plain">
            <caption className="adm-cap">Reporting lag (R04)</caption>
            <thead><tr><th scope="col">Template</th><th scope="col" className="adm-num">Months</th></tr></thead>
            <tbody>
              {Object.entries(RULES.lags).map(([k, v]) => <tr key={k}><th scope="row" className="adm-mono">{k}</th><td className="adm-num">{v}</td></tr>)}
              <tr><th scope="row">Unknown template</th><td className="adm-num">1</td></tr>
            </tbody>
          </table>
        </div>
        <div className="adm-scroll">
          <table className="adm-plain">
            <caption className="adm-cap">Rule catalogue, {RULES.rules[0]?.id}–{RULES.rules[RULES.rules.length - 1]?.id}</caption>
            <thead><tr><th scope="col">Rule</th><th scope="col">Title</th><th scope="col">Layer</th><th scope="col">Severity</th><th scope="col">Tolerance</th><th scope="col" className="adm-num">Phase</th></tr></thead>
            <tbody>{RULES.rules.map(r => (
              <tr key={r.id}>
                <th scope="row" className="adm-mono">{r.id}</th><td>{r.title}</td><td>{cap(r.layer)}</td>
                <td><StatusPill size="sm" tone={r.severity === 'block' ? 'bad' : r.severity === 'review' ? 'warn' : 'blue'}>{cap(r.severity)}</StatusPill></td>
                <td>{r.tolerance ?? <span className="adm-muted">none</span>}</td><td className="adm-num">{r.phase}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="adm-hint">Phase 3 rules are listed so the catalogue is complete; they do not run in the POC.</p>
      </Section>

      <Section id="calendar" n={3} title="Reporting calendar" tag="new"
        subtitle={<>The day of the month each deal’s SetRep is expected. Feeds “next report due” and the overdue check (TAO only). {stamp('reporting_calendar')}</>}>
        {loaded.suggestedDays.length > 0 && (
          <div className="adm-note">
            Pre-filled from the settlement dates in the August 2026 reports for {formatNumber(loaded.suggestedDays.length)} deal{loaded.suggestedDays.length === 1 ? '' : 's'} not saved yet.
            Check them; editing a day, or <button type="button" className="adm-linkbtn" onClick={() => force('reporting_calendar')} disabled={changed.includes('reporting_calendar')}>using the suggested days</button>, adds the calendar to Save changes.
          </div>
        )}
        <div className="adm-scroll">
          <table className="adm-plain">
            <caption className="ds-visually-hidden">Reporting calendar</caption>
            <thead><tr><th scope="col">Deal</th><th scope="col">Program</th><th scope="col" className="adm-num">Expected report day</th><th scope="col">Source</th></tr></thead>
            <tbody>{deals.slice().sort((a, b) => (draft.reporting_calendar[a.slug] ?? 99) - (draft.reporting_calendar[b.slug] ?? 99) || a.name.localeCompare(b.name)).map(d => {
              const v = draft.reporting_calendar[d.slug]
              const bad = v != null && !validDay(v)
              return (
                <tr key={d.slug}>
                  <th scope="row">{d.name}</th><td>{programName(d.program_slug)}</td>
                  <td className="adm-num">
                    <Input numeric className="adm-day" aria-label={`${d.name} expected report day`} aria-invalid={bad || undefined} value={v == null || Number.isNaN(v) ? '' : String(v)}
                      onChange={e => { const t = e.target.value.trim(); const n = t === '' ? undefined : Number(t); const next = { ...draft.reporting_calendar }; if (n === undefined) delete next[d.slug]; else next[d.slug] = n; set('reporting_calendar', next) }} />
                    {bad && <span className="ds-field__error" role="alert">1 to 31</span>}
                  </td>
                  <td>{loaded.saved.reporting_calendar[d.slug] === v && v != null ? 'Saved'
                    : loaded.suggestedDays.includes(d.slug) && v === loaded.start.reporting_calendar[d.slug] ? <span className="adm-muted">Suggested, not saved</span>
                    : <span className="adm-muted">{v == null ? 'Not set' : 'Changed, not saved'}</span>}</td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
        <p className="adm-hint">Overdue alerts go to the TAO team only; partners are not told (S3). A day after the end of a short month means its last day.</p>
      </Section>

      <Section id="notifications" n={4} title="Notifications" tag="new" subtitle="Who is told, and what a new user gets before they change their Profile. Email is coming later; in-app only in phase 2.">
        <div className={`adm-switchrow${draft.partner_notifications_enabled ? ' is-on' : ''}`}>
          <label className="adm-check">
            <input type="checkbox" role="switch" checked={draft.partner_notifications_enabled} aria-describedby="set-pn-warn"
              onChange={e => set('partner_notifications_enabled', e.target.checked)} />
            <b>Partner notifications</b>
          </label>
          <StatusPill tone={draft.partner_notifications_enabled ? 'ok' : 'neutral'} size="sm">{draft.partner_notifications_enabled ? 'On' : 'Off'}</StatusPill>
          <span className="adm-muted">{stamp('partner_notifications_enabled')}</span>
        </div>
        <div id="set-pn-warn" className="adm-note adm-note--warn">
          Off by default. While off, no partner user is notified of anything; they still see every published report in their portal.
          Switching it on means investor and manager users subscribed to a deal are told in-app when its report or a correction is published, with the note from TAO.
          Check who receives what on <TextLink to="/admin/settings/users">User management</TextLink> first.
        </div>

        <h3 className="adm-section-title">Default notifications per role</h3>
        {roles.length === 0 ? <p className="adm-muted">The API returned no defaults yet.</p> : (
          <div className="adm-scroll">
            <table className="adm-plain">
              <caption className="ds-visually-hidden">Default notifications per role</caption>
              <thead><tr><th scope="col">Event</th>{roles.map(r => <th key={r} scope="col">{ROLES.find(x => x.id === r)!.label}</th>)}</tr></thead>
              <tbody>{kinds.map(k => (
                <tr key={k}>
                  <th scope="row">{KIND_LABEL[k] ?? k}</th>
                  {roles.map(r => {
                    const p = draft.notification_defaults[r]!.find(x => x.kind === k)
                    if (!p) return <td key={r} className="adm-muted">n/a</td>
                    if (isRequired(p)) return <td key={r}><StatusPill tone="blue" size="sm">Always</StatusPill></td>
                    return (
                      <td key={r}>
                        <label className="adm-check">
                          <input type="checkbox" checked={p.in_app} aria-label={`${KIND_LABEL[k] ?? k}, ${ROLES.find(x => x.id === r)!.label}, in-app`}
                            onChange={e => set('notification_defaults', setPref(draft.notification_defaults, r as Role, k, e.target.checked))} />
                          In-app
                        </label>
                      </td>
                    )
                  })}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="adm-hint">Defaults apply to new users and to “Reset to defaults” on Profile; changing one never overwrites choices people already made. “Always” rows cannot be switched off. {stamp('notification_defaults')}</p>

        <h3 className="adm-section-title">Publish note templates</h3>
        {loaded.suggestedTpl.length > 0 && (
          <div className="adm-note">
            Suggested wording shown where no template is saved yet. Editing it, or <button type="button" className="adm-linkbtn" onClick={() => force('publish_note_templates')} disabled={changed.includes('publish_note_templates')}>keeping the suggested wording</button>, adds the templates to Save changes.
          </div>
        )}
        <div className="adm-form">
          <Field label="Note to partners: new report" hint={`Fields in braces are filled when the publish dialog opens: ${TEMPLATE_FIELDS.slice(0, 4).join(' ')}. The reviewer can edit the note before publishing.`}>
            <Textarea rows={3} value={draft.publish_note_templates.new_report} onChange={e => set('publish_note_templates', { ...draft.publish_note_templates, new_report: e.target.value })} />
          </Field>
          <Field label="Note to partners: correction" hint={`Also ${TEMPLATE_FIELDS.slice(4).join(' ')}.`}>
            <Textarea rows={3} value={draft.publish_note_templates.correction} onChange={e => set('publish_note_templates', { ...draft.publish_note_templates, correction: e.target.value })} />
          </Field>
          <p className="adm-hint">The note is signed by TAO, not by the person who publishes. {stamp('publish_note_templates')}</p>
        </div>
      </Section>

      <Section id="retention" n={5} title="Data retention and audit" tag="shows" subtitle="Decided: kept indefinitely. TAO hosts the data; nothing here can delete it.">
        <table className="adm-plain">
          <caption className="ds-visually-hidden">Retention</caption>
          <thead><tr><th scope="col">Data</th><th scope="col">Kept for</th></tr></thead>
          <tbody>
            <tr><th scope="row">Uploaded SetRep PDFs and page images</th><td>Kept indefinitely</td></tr>
            <tr><th scope="row">Rejected and failed uploads</th><td>Kept indefinitely</td></tr>
            <tr><th scope="row">Published deal objects and every version</th><td>Kept indefinitely</td></tr>
            <tr><th scope="row">Audit log entries (Reports and Platform)</th><td>Kept indefinitely; never edited or removed</td></tr>
            <tr><th scope="row">Users</th><td>Kept indefinitely; deactivated, never deleted</td></tr>
            <tr><th scope="row">Notifications</th><td>12 months</td></tr>
          </tbody>
        </table>
        <div className="adm-actions">
          <Button loading={exportBusy === 'reports'} onClick={() => void runExport('reports')}>Export this month, Reports (CSV)</Button>
          <Button loading={exportBusy === 'platform'} onClick={() => void runExport('platform')}>Export this month, Platform (CSV)</Button>
          <TextLink to="/admin/settings/users/audit">Earlier months in the Audit log</TextLink>
        </div>
        <p className="adm-hint">Each export is itself recorded on the Platform tab.</p>
      </Section>

      <Section id="branding" n={6} title="Partner branding" tag="later" subtitle="Name, subtitle, logo and email footer per partner portal. Not built in phase 2.">
        <table className="adm-plain">
          <caption className="ds-visually-hidden">Partner branding</caption>
          <thead><tr><th scope="col">Partner</th><th scope="col">Portal name</th><th scope="col">Logo</th></tr></thead>
          <tbody>{partners.map(p => <tr key={p.slug}><th scope="row">{p.name}</th><td>{p.name} Portal</td><td className="adm-muted">TAO default</td></tr>)}</tbody>
        </table>
        <p className="adm-hint">Colours stay on the portal’s tokens: status colours carry meaning (OK, WATCH, BREACH) and do not change per partner.</p>
      </Section>

      <Section id="integrations" n={7} title="Integrations" tag="later" subtitle="API keys, webhooks and chat. After real sign-in exists.">
        <p className="adm-muted">No keys and no webhooks. The POC API trusts the role switcher and has no keys. Company data feeds (news and adverse media) arrive with wave D.</p>
      </Section>

      <Section id="maintenance" n={8} title="Maintenance" tag="shows" subtitle="Jobs that run by hand. None re-reads a PDF.">
        <table className="adm-plain">
          <caption className="ds-visually-hidden">Maintenance jobs</caption>
          <thead><tr><th scope="col">Job</th><th scope="col">What it does</th><th scope="col">Where</th></tr></thead>
          <tbody>
            <tr><th scope="row">Regenerate dashboards</th><td>Rebuilds program roll-ups from published reports, for one program or all</td><td><TextLink to="/admin/reports">Reports library, Regenerate</TextLink></td></tr>
            <tr><th scope="row">Reset demo</th><td>Wipes the database and file store and reloads master data</td><td>Script only: <code className="adm-mono">python scripts/reset_demo.py</code>. Not a button: it wipes a shared stack (S4).</td></tr>
            <tr><th scope="row">Contract and reference check</th><td>Validates the contracts and reference data</td><td>Developer task: <code className="adm-mono">make check</code></td></tr>
          </tbody>
        </table>
      </Section>

      {saving && (
        <SaveDialog keys={changed} before={loaded.saved} after={draft} dealName={dealName}
          onClose={() => setSaving(false)} onSaved={() => { setSaving(false); res.reload() }} />
      )}
    </div>
  )
}

/** Settings to save: those edited since the page loaded (`start`, which includes suggestions), plus `forced` ones. */
export function changedKeys(start: Draft, draft: Draft, forced: string[] = []): string[] {
  return EDITABLE.filter(k => forced.includes(k) || JSON.stringify(start[k as keyof Draft]) !== JSON.stringify(draft[k as keyof Draft]))
}
const invalid = (d: Draft) => Object.values(d.reporting_calendar).some(v => !validDay(v))

/** One reason for every changed setting; one PUT (and one audit entry) per setting. Stops at the first failure and
 * says which settings were saved. */
function SaveDialog({ keys, before, after, dealName, onClose, onSaved }: {
  keys: string[]; before: Draft; after: Draft; dealName: (s: string) => string; onClose: () => void; onSaved: () => void
}) {
  const { toast } = useToast()
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [done, setDone] = useState<string[]>([])
  const short = reason.trim().length < 3
  const rows = keys.flatMap(k => settingDiff(k, before[k as keyof Draft], after[k as keyof Draft], dealName).map(r => ({ ...r, key: k })))
  const go = async () => {
    setTouched(true)
    if (short) return
    setBusy(true); setError(undefined)
    const ok = [...done]
    try {
      for (const k of keys) {
        if (ok.includes(k)) continue
        await settingsApi.put(k, after[k as keyof Draft], reason.trim())
        ok.push(k); setDone([...ok])
      }
      toast({ tone: 'ok', title: `${keys.length} setting${keys.length === 1 ? '' : 's'} saved`, message: 'Each is recorded on the Platform tab of the Audit log.' })
      onSaved()
    } catch (err) {
      const failed = keys.find(k => !ok.includes(k))!
      setError(`${SETTING_LABEL[failed] ?? failed} was not saved: ${errorText(err as ApiError)}${ok.length ? ` Saved already: ${ok.map(k => SETTING_LABEL[k] ?? k).join(', ')}.` : ''}`)
    } finally { setBusy(false) }
  }
  return (
    <Dialog open onClose={done.length ? onSaved : onClose} dismissable={!busy} size="lg"
      title={`Save ${keys.length} setting${keys.length === 1 ? '' : 's'}`}
      description="Each setting goes to the Platform audit log as its own entry, with before, after and this reason."
      footer={<>
        <Button onClick={done.length ? onSaved : onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" form="adm-settings-save" loading={busy}>Save {keys.length} change{keys.length === 1 ? '' : 's'}</Button>
      </>}>
      <form id="adm-settings-save" className="adm-form" noValidate onSubmit={e => { e.preventDefault(); void go() }}>
        <div className="adm-scroll adm-savelist">
          <table className="adm-ba" aria-label="Changes to save">
            <thead><tr><th scope="col">Setting</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i}><td>{SETTING_LABEL[r.key]} · {r.field}{done.includes(r.key) && <> <StatusPill tone="ok" size="sm">Saved</StatusPill></>}</td><td className="adm-before">{r.before}</td><td className="adm-after">{r.after}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <Field label="Reason" required hint="At least three characters. Shown in each audit entry." error={touched && short ? 'Give a reason of at least three characters.' : undefined}>
          <Textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} />
        </Field>
        {error && <div className="adm-note adm-note--warn" role="alert">{error}</div>}
      </form>
    </Dialog>
  )
}

export type { Setting }
