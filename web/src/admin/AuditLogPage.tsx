import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, Card, DataTable, Field, Input, Select, StatusPill, formatNumber, formatPeriod, icons, useToast, type Column } from '@/design/components'
import { usePageHeader } from '@/shell/header'
import {
  adminApi, PLATFORM_ACTIONS, REPORT_ACTIONS, auditScope,
  type AuditEntry, type AuditQuery, type AuditScope, type Deal, type Program, type Upload,
} from './data'
import { useResource, useRole } from './hooks'
import { LoadError, TextLink, dealOptions, errorText, uploadTarget } from './ui'
import { ROLE_LABEL, USER_CHANGE_LABEL, subsText, usersApi, type AppUser } from './users'
import { SETTING_LABEL, cap } from './settings'

const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i
export const ACTION_LABEL: Record<string, string> = {
  upload: 'Upload', extract: 'Extract', reextract: 'Re-extract', override: 'Override', restate: 'Restatement accepted', approve: 'Approve',
  reject: 'Reject', publish: 'Publish', regenerate: 'Regenerate', master_change: 'Master data change', export: 'Export',
  value_edit: 'Value edited', value_edit_revert: 'Value edit reverted', correction: 'Correction',
  correction_approve: 'Correction approved', correction_reject: 'Correction rejected',
  // wave C: Platform
  user_change: 'User change', prefs_change: 'Own settings changed', settings_change: 'Settings change',
  // wave C: Reports (internal comment threads)
  comment: 'Comment', comment_edit: 'Comment edited', thread_resolve: 'Thread resolved', thread_reopen: 'Thread reopened',
  // wave D: Platform (companies and news)
  company_change: 'Company change', company_note: 'Company note', company_note_edit: 'Company note edited',
  adverse_change: 'Adverse media decision', news_run: 'News run',
}
/** Actions whose detail carries before → after values (shown in the Detail cell and the expanded row). */
const CHANGE_ACTIONS: readonly string[] = ['master_change', 'value_edit', 'value_edit_revert', 'correction', 'correction_approve', 'correction_reject',
  'user_change', 'prefs_change', 'settings_change', 'comment_edit', 'company_change', 'company_note_edit']
const MODE_LABEL: Record<string, string> = { new_version: 'new version', correct: 'correction', add: 'added' }
/** The User filter: the actor roles the API writes (`system` is the extraction worker, `seed` the reference data). */
export const ACTOR_LABEL: Record<string, string> = {
  tao_admin: 'TAO Admin', tao_analyst: 'TAO Analyst', investor_admin: 'Investor · Company Admin', manager_admin: 'Manager · Company Admin',
  investor_viewer: 'Investor · Viewer', manager_viewer: 'Manager · Viewer', system: 'System (extraction worker)', seed: 'Reference data',
}
const TAB_LABEL: Record<AuditScope, string> = { reports: 'Reports', platform: 'Platform' }
const FIRST = { current: 100, history: 50 }
const SEARCH_LIMIT = 500
/** Search pages at most this many pages per tab (2,000 rows); a broader search asks to be narrowed. */
const SEARCH_PAGES = 4
const SEARCH_ROWS = 5
const SEARCH_OPEN_GROUPS = 3

// ---- Months and times in Toronto (decision A5: everyone sees the same month) ----
export const TZ = 'America/Toronto'
const MONTH_PARTS = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' })
const TIME = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
const MONTH_NAME = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', month: 'long', year: 'numeric' })
/** "YYYY-MM" of an instant, in Toronto: 23:30 on 31 October Toronto time stays in October. */
export function torontoMonth(at: Date | string): string {
  const d = typeof at === 'string' ? new Date(at) : at
  const parts = MONTH_PARTS.formatToParts(d)
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}`
}
/** "2026-11" → "November 2026". */
export const monthName = (m: string) => MONTH_NAME.format(new Date(`${m}-15T12:00:00Z`))
const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : TIME.format(d) }

// ---- Context: uploads, deals and programs name the Report column ----
type Ctx = { uploads: Map<string, Upload>; deals: Deal[]; programs: Program[]; users?: AppUser[] }
const dealName = (c: Ctx, slug?: unknown) => (typeof slug === 'string' ? c.deals.find(d => d.slug === slug)?.name ?? slug : undefined)
const programName = (c: Ctx, slug?: unknown) => (typeof slug === 'string' ? c.programs.find(p => p.slug === slug)?.name ?? slug : undefined)

/** Highlights every case-insensitive match of `q` in `text`. */
export function Highlight({ text, q }: { text: string; q?: string }) {
  if (!q || q.length < 2) return <>{text}</>
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${esc})`, 'gi'))
  return <>{parts.map((p, i) => (i % 2 === 1 ? <mark key={i} className="adm-hit">{p}</mark> : p))}</>
}

type Change = { field: string; before: unknown; after: unknown }
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v))
/** Field-level changes from an entry's detail. `before` / `after` (master_change, covenant changes): objects are
 * compared key by key, scalars give one row named by `field` or `pointer`. Value edits may instead carry
 * `old_value` / `new_value` with a `pointer`, and corrections an `edits` list of those; each gives one row. */
export function changes(d: Record<string, unknown>): Change[] {
  const fieldOf = (x: Record<string, unknown>) => (typeof x.field === 'string' ? x.field : typeof x.pointer === 'string' ? x.pointer : 'value')
  if (Array.isArray(d.edits)) {
    return (d.edits as Record<string, unknown>[]).filter(x => x && typeof x === 'object').map(x => ({
      field: fieldOf(x), before: x.old_value ?? x.before, after: x.new_value ?? x.after ?? x.value,
    }))
  }
  if (!('before' in d) && !('after' in d)) {
    if ('old_value' in d || 'new_value' in d) return JSON.stringify(d.old_value) === JSON.stringify(d.new_value) ? [] : [{ field: fieldOf(d), before: d.old_value, after: d.new_value }]
    return []
  }
  const b = d.before, a = d.after
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  if (isObj(b) || isObj(a)) {
    const bo = isObj(b) ? b : {}, ao = isObj(a) ? a : {}
    const keys = [...new Set([...Object.keys(bo), ...Object.keys(ao)])]
    return keys.filter(k => JSON.stringify(bo[k]) !== JSON.stringify(ao[k])).map(k => ({ field: k, before: bo[k], after: ao[k] }))
  }
  return JSON.stringify(b) === JSON.stringify(a) ? [] : [{ field: fieldOf(d), before: b, after: a }]
}

// ---- Wave D: companies, notes, adverse media and news runs (all Platform). Detail shapes as requested in
// docs/requests.md (UI-Admin, wave D); every field is read defensively. ----
const COMPANY_FIELD: Record<string, string> = {
  name: 'Name', aliases: 'Aliases', industry: 'Industry', naics: 'NAICS', headquarters: 'Headquarters', website: 'Website',
  relationship_since: 'Relationship since', owner_user_id: 'Owner', owner: 'Owner', deal_slugs: 'Deals', role: 'Role', email: 'Email', receives: 'Receives',
}
export const COMPANY_CHANGE_LABEL: Record<string, string> = {
  created: 'Company created', updated: 'Record updated', contact_added: 'Contact added', contact_updated: 'Contact edited', contact_removed: 'Contact removed',
}
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})
const isContact = (d: Record<string, unknown>) => typeof d.change === 'string' && d.change.startsWith('contact')
const contactName = (d: Record<string, unknown>) => str(obj(d.after).name) ?? str(obj(d.before).name)
/** Deals linked and unlinked by a company_change (deal_slugs before → after), as names when the context has them. */
export function dealLinks(d: Record<string, unknown>, c?: Pick<Ctx, 'deals' | 'programs'>): { linked: string[]; unlinked: string[] } {
  const b = obj(d.before).deal_slugs, a = obj(d.after).deal_slugs
  if (!Array.isArray(a) && !Array.isArray(b)) return { linked: [], unlinked: [] }
  const bs = (Array.isArray(b) ? b : []) as string[], as = (Array.isArray(a) ? a : []) as string[]
  const name = (s: string) => (c ? dealName(c as Ctx, s)! : s)
  return { linked: as.filter(s => !bs.includes(s)).map(name), unlinked: bs.filter(s => !as.includes(s)).map(name) }
}
function companyValue(field: string, v: unknown, c?: Pick<Ctx, 'deals' | 'programs'>, users?: AppUser[]): unknown {
  if (v === null || v === undefined) return v
  if (field === 'deal_slugs' && Array.isArray(v)) return v.length ? v.map(s => (c ? dealName(c as Ctx, s) : s)).join(', ') : 'none'
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'none'
  if (field === 'owner' && typeof v === 'object') return str((v as Record<string, unknown>).name) ?? JSON.stringify(v)
  if (field === 'owner_user_id' && typeof v === 'string') return users?.find(u => u.id === v)?.name ?? v
  return v
}
export function companyChanges(e: AuditEntry, c?: Pick<Ctx, 'deals' | 'programs' | 'users'>): Change[] {
  const d = (e.detail ?? {}) as Record<string, unknown>
  const contact = isContact(d)
  return changes(d).filter(x => x.field !== 'id' && x.field !== 'company_slug' && !(x.before == null && x.after == null)).map(x => ({
    field: contact ? `Contact · ${COMPANY_FIELD[x.field] ?? x.field}` : COMPANY_FIELD[x.field] ?? x.field,
    before: companyValue(x.field, x.before, c, c?.users), after: companyValue(x.field, x.after, c, c?.users),
  }))
}
export function noteEditChanges(e: AuditEntry): Change[] {
  const d = (e.detail ?? {}) as Record<string, unknown>
  const removed = d.change === 'removed' || d.after === null || d.removed === true
  const before = str(d.before) ?? str(d.old_body) ?? str(obj(d.before).body)
  const after = removed ? 'removed' : str(d.after) ?? str(d.new_body) ?? str(obj(d.after).body)
  return before === after ? [] : [{ field: 'Note', before, after }]
}
const ADVERSE_STATE: Record<string, { tone: 'ok' | 'neutral' | 'warn'; label: string }> = {
  reviewed: { tone: 'ok', label: 'Reviewed' }, dismissed: { tone: 'neutral', label: 'Dismissed' }, open: { tone: 'warn', label: 'Open' },
}
export function adverseDecision(e: AuditEntry): { state: string; label: string; tone: 'ok' | 'neutral' | 'warn'; note?: string; item?: string } {
  const d = (e.detail ?? {}) as Record<string, unknown>
  const state = str(d.state) ?? str(obj(d.after).state) ?? str(d.decision) ?? 'changed'
  const s = ADVERSE_STATE[state] ?? { tone: 'neutral' as const, label: cap(state) }
  const note = str(d.note) ?? str(obj(d.after).note) ?? e.reason ?? undefined
  const item = [str(d.category) && cap(str(d.category)!), str(d.title)].filter(Boolean).join(' · ') || undefined
  return { state, ...s, note, item }
}
const actorName = (e: AuditEntry) => (e.actor_label && e.actor_label !== e.actor_role ? e.actor_label : ACTOR_LABEL[e.actor_role] ?? e.actor_role)
export function newsRunText(e: AuditEntry): string {
  const d = (e.detail ?? {}) as Record<string, unknown>
  return d.trigger === 'schedule' ? 'Scheduled run' : `Manual run by ${actorName(e)}`
}
const clip = (s: string, n = 80) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/** changes() with names from the context: a subscription list reads as programs and deals, a calendar row as the
 * deal, and a one-value setting as the setting's name. */
export function entryChanges(e: AuditEntry, c: Pick<Ctx, 'deals' | 'programs'> & { users?: AppUser[] }): Change[] {
  const d = (e.detail ?? {}) as Record<string, unknown>
  if (e.action === 'company_change') return companyChanges(e, c)
  if (e.action === 'company_note_edit') return noteEditChanges(e)
  if (e.action === 'user_change' && d.change === 'subscriptions') {
    const b = subsText(d.before, c.programs, c.deals), a = subsText(d.after, c.programs, c.deals)
    return b === a ? [] : [{ field: 'Reports received', before: b, after: a }]
  }
  const ch = changes(d)
  if (e.action === 'user_change') {
    const role = (v: unknown) => (typeof v === 'string' ? ROLE_LABEL[v as AppUser['role']] ?? v : v)
    return ch.map(x => (x.field === 'role' ? { ...x, before: role(x.before), after: role(x.after) } : x))
  }
  if (e.action === 'settings_change') {
    const label = SETTING_LABEL[String(d.key)] ?? String(d.key ?? 'value')
    return ch.map(x => ({ ...x, field: x.field === 'value' ? label : d.key === 'reporting_calendar' ? `${dealName(c as Ctx, x.field)} expected day` : x.field }))
  }
  return ch
}

/** One line from `detail` for the table; the full detail is in the expanded row. */
export function summary(e: AuditEntry, c?: Pick<Ctx, 'deals' | 'programs'> & { users?: AppUser[] }): string {
  const d = (e.detail ?? {}) as Record<string, unknown>
  if (e.action === 'company_change') {
    const kind = str(d.change) ?? 'updated'
    const head = COMPANY_CHANGE_LABEL[kind] ?? cap(kind)
    if (isContact(d)) return [head, contactName(d)].filter(Boolean).join(' · ')
    const links = dealLinks(d, c)
    const ch = companyChanges(e, c).filter(x => x.field !== 'Deals')
    return [head, links.linked.length ? `Linked ${links.linked.join(', ')}` : null, links.unlinked.length ? `Unlinked ${links.unlinked.join(', ')}` : null,
      ...ch.slice(0, 2).map(x => `${x.field} ${show(x.before)} → ${show(x.after)}`), ch.length > 2 ? `+${ch.length - 2} more` : null].filter(Boolean).join(' · ')
  }
  if (e.action === 'company_note') {
    const per = str(d.collection_period)
    return [per ? monthName(per) : null, str(d.body) ? clip(str(d.body)!) : 'Note added'].filter(Boolean).join(' · ')
  }
  if (e.action === 'company_note_edit') {
    const ch = noteEditChanges(e)[0]
    if (ch?.after === 'removed') return `Note removed · ${clip(show(ch.before))}`
    return ch ? `Note ${clip(show(ch.before), 40)} → ${clip(show(ch.after), 40)}` : 'Note edited'
  }
  if (e.action === 'adverse_change') {
    const a = adverseDecision(e)
    return [a.label, a.item, a.note ? `Note: ${a.note}` : null].filter(Boolean).join(' · ')
  }
  if (e.action === 'news_run') return newsRunText(e)
  if (e.action === 'upload') return [d.file_name, d.page_count != null ? `${d.page_count} pages` : null, d.collection_period].filter(Boolean).join(' · ')
  if (e.action === 'user_change') {
    const kind = typeof d.change === 'string' ? d.change : 'updated'
    const head = USER_CHANGE_LABEL[kind] ?? kind
    if (kind === 'subscriptions') return `${head} · ${subsText(d.before, [], [])} → ${subsText(d.after, [], [])}`
    const ch = kind === 'updated' ? changes(d) : []
    return [head, ...ch.slice(0, 2).map(c => `${c.field} ${show(c.before)} → ${show(c.after)}`), ch.length > 2 ? `+${ch.length - 2} more` : null].filter(Boolean).join(' · ')
  }
  if (e.action === 'settings_change') {
    const ch = changes(d)
    const head = SETTING_LABEL[String(d.key)] ?? String(d.key ?? 'Setting')
    return ch.length === 1 && ch[0].field === 'value' ? `${head} ${show(ch[0].before)} → ${show(ch[0].after)}`
      : `${head}${ch.length ? ` · ${ch.slice(0, 2).map(c => `${c.field} ${show(c.before)} → ${show(c.after)}`).join(' · ')}${ch.length > 2 ? ` · +${ch.length - 2} more` : ''}` : ''}`
  }
  if (e.action === 'comment') return typeof d.body === 'string' ? (d.body.length > 80 ? d.body.slice(0, 79) + '…' : d.body) : 'Comment'
  if (e.action === 'thread_resolve') return 'Thread resolved'
  if (e.action === 'thread_reopen') return 'Thread reopened'
  if (e.action === 'master_change') {
    const ch = changes(d)
    const head = [d.entity, d.key, typeof d.mode === 'string' ? MODE_LABEL[d.mode] ?? d.mode : null, d.effective_from ? `effective ${d.effective_from}` : null].filter(Boolean).join(' ')
    return ch.length ? `${head} · ${ch.slice(0, 2).map(c => `${c.field} ${show(c.before)} → ${show(c.after)}`).join(' · ')}${ch.length > 2 ? ` · +${ch.length - 2} more` : ''}` : head
  }
  if (CHANGE_ACTIONS.includes(e.action)) {
    const ch = changes(d)
    const vs = typeof d.version === 'number' ? `version ${d.version}` : null
    const list = ch.slice(0, 2).map(c => `${c.field} ${show(c.before)} → ${show(c.after)}`).join(' · ') + (ch.length > 2 ? ` · +${ch.length - 2} more` : '')
    return [vs, list || null].filter(Boolean).join(' · ') || '—'
  }
  if (e.action === 'regenerate') return [d.program_slug ?? 'all programs', d.publications != null ? `${d.publications} publications` : null, d.trigger].filter(Boolean).join(' · ')
  if (e.action === 'override' || e.action === 'restate') return [d.rule_id, d.choice].filter(Boolean).join(' · ')
  if (e.action === 'publish') return d.replaced_upload_id ? 'Re-issue published; replaces the earlier publication' : 'Published to partners'
  if (e.action === 'export') return [d.scope, d.month, d.rows != null ? `${d.rows} rows` : null].filter(Boolean).join(' · ')
  if (typeof d.status === 'string') return d.status
  const keys = Object.keys(d)
  return keys.length ? keys.slice(0, 3).map(k => `${k}: ${typeof d[k] === 'object' ? '…' : String(d[k])}`).join(' · ') : '—'
}

/** The Report (or Subject) of an entry: the deal and collection period, linking to the report the way the Uploads
 * table does (Review, the deal page at that period, or upload details). Deal and period come from the entry itself
 * (`deal_slug`, `deal_name`, `collection_period`, set by the API from the upload), never from the file name: MOVE
 * Trust's collection month is the file month, F-PIL's is the settlement month. The upload record, when loaded, adds the
 * program, the re-issue tag and the status that picks the link target. */
function subject(e: AuditEntry, c: Ctx): { title: string; sub?: string; href?: string } | null {
  const d = (e.detail ?? {}) as Record<string, unknown>
  const u = e.upload_id ? c.uploads.get(e.upload_id) : undefined
  const slug = e.deal_slug ?? u?.deal_slug ?? (typeof d.deal_slug === 'string' ? d.deal_slug : undefined)
  const per = e.collection_period ?? u?.collection_period ?? (typeof d.collection_period === 'string' ? d.collection_period : undefined)
  if (e.action === 'news_run') return { title: 'Company news', sub: 'News run', href: '/admin/settings/system#set-companies' }
  if (e.action === 'company_change' || e.action === 'company_note' || e.action === 'company_note_edit' || e.action === 'adverse_change') {
    const cs = str(d.company_slug)
    const name = str(d.company_name) ?? (e.action === 'company_change' && !isContact(d) ? str(obj(d.after).name) ?? str(obj(d.before).name) : undefined) ?? (cs ? cap(cs) : 'Company')
    const note = str(d.note_id)
    const sub = e.action === 'adverse_change' ? 'Company · adverse media' : e.action === 'company_change' ? 'Company' : 'Company · note'
    return { title: name, sub, href: cs ? `/admin/companies/${encodeURIComponent(cs)}${note && e.action !== 'company_change' ? `?note=${encodeURIComponent(note)}` : ''}` : undefined }
  }
  if (slug) {
    const name = e.deal_name ?? dealName(c, slug)!
    const period = per ? formatPeriod(per) : undefined
    const deal = c.deals.find(x => x.slug === slug)
    const program = programName(c, u?.program_slug ?? deal?.program_slug)
    return { title: name, href: u ? uploadTarget(u, name, period ?? '').href : undefined,
      sub: [program, period, u?.replaces_upload_id ? 're-issue' : null].filter(Boolean).join(' · ') || undefined }
  }
  if (e.action === 'regenerate') return { title: programName(c, d.program_slug) ?? 'All programs', sub: 'Program' }
  if (e.action === 'master_change' && typeof d.key === 'string') {
    if (d.entity === 'deal') {
      const deal = c.deals.find(x => x.slug === d.key)
      return { title: dealName(c, d.key)!, sub: ['Deal', deal && programName(c, deal.program_slug)].filter(Boolean).join(' · ') }
    }
    if (d.entity === 'program') return { title: programName(c, d.key)!, sub: 'Program' }
    return { title: d.key, sub: typeof d.entity === 'string' ? d.entity : undefined }
  }
  if (e.action === 'export') return { title: 'Audit log', sub: 'CSV export' }
  if (e.action === 'user_change' || e.action === 'prefs_change') {
    const after = (d.after ?? {}) as Record<string, unknown>, before = (d.before ?? {}) as Record<string, unknown>
    const id = typeof d.user_id === 'string' ? d.user_id : undefined
    const who = [after.name, before.name, c.users?.find(u => u.id === id)?.name, after.email, before.email].find(v => typeof v === 'string') as string | undefined
    const where = typeof d.partner_slug === 'string' ? cap(d.partner_slug) : 'TAO'
    return { title: who ?? (e.action === 'prefs_change' ? e.actor_label ?? 'Own settings' : id?.slice(0, 8) ?? 'User'),
      sub: e.action === 'prefs_change' ? 'Own settings' : `User · ${where}`, href: id && e.action === 'user_change' ? `/admin/settings/users?user=${encodeURIComponent(id)}` : undefined }
  }
  if (e.action === 'settings_change') return { title: SETTING_LABEL[String(d.key)] ?? String(d.key ?? 'Setting'), sub: 'System settings', href: '/admin/settings/system' }
  return null
}

function SubjectCell({ e, c, q }: { e: AuditEntry; c: Ctx; q?: string }) {
  const s = subject(e, c)
  if (!s) {
    return e.upload_id
      ? <TextLink to={`?upload_id=${e.upload_id}`} label={`Show only upload ${e.upload_id}`}><span className="adm-mono">{e.upload_id.slice(0, 8)}</span></TextLink>
      : <span className="adm-muted">—</span>
  }
  return (
    <span className="adm-subject">
      {s.href ? <TextLink to={s.href} label={`${s.title}${s.sub ? `, ${s.sub}` : ''}`}><Highlight text={s.title} q={q} /></TextLink> : <b><Highlight text={s.title} q={q} /></b>}
      {s.sub && <small><Highlight text={s.sub} q={q} /></small>}
    </span>
  )
}

function ActorCell({ e, q }: { e: AuditEntry; q?: string }) {
  const name = e.actor_label && e.actor_label !== e.actor_role ? e.actor_label : ACTOR_LABEL[e.actor_role] ?? e.actor_role
  return <span className="adm-actor"><Highlight text={name} q={q} /><small>{e.actor_role}</small></span>
}

function DetailCell({ e, q, c }: { e: AuditEntry; q?: string; c: Ctx }) {
  const ch = CHANGE_ACTIONS.includes(e.action) ? entryChanges(e, c) : []
  if (ch.length === 1) {
    const x = ch[0]
    return <span><Highlight text={x.field} q={q} /> <span className="adm-before"><Highlight text={show(x.before)} q={q} /></span><span className="adm-arrow" aria-label="changed to">→</span><span className="adm-after"><Highlight text={show(x.after)} q={q} /></span></span>
  }
  if (e.action === 'adverse_change') {
    const a = adverseDecision(e)
    const rest = [a.item, a.note ? `Note: ${a.note}` : null].filter(Boolean).join(' · ')
    return <span><StatusPill tone={a.tone} size="sm">{a.label}</StatusPill>{rest && <> <Highlight text={rest} q={q} /></>}</span>
  }
  return <Highlight text={summary(e, c)} q={q} />
}

/** The expanded entry: before → after per field, the reason, the report and every id. */
function EntryDetail({ e, c }: { e: AuditEntry; c: Ctx }) {
  const d = { ...((e.detail ?? {}) as Record<string, unknown>) }
  const ch = entryChanges(e, c)
  if (ch.length) { delete d.before; delete d.after; delete d.old_value; delete d.new_value; delete d.edits }
  const rest = Object.entries(d)
  const u = e.upload_id ? c.uploads.get(e.upload_id) : undefined
  const s = subject(e, c)
  return (
    <div className="adm-exp">
      <div className="adm-exp__main">
        {ch.length > 0 && (
          <table className="adm-ba" aria-label="Before and after">
            <thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
            <tbody>{ch.map(x => <tr key={x.field}><td>{x.field}</td><td className="adm-before">{show(x.before)}</td><td className="adm-after">{show(x.after)}</td></tr>)}</tbody>
          </table>
        )}
        {e.action === 'company_change' && (() => {
          const l = dealLinks((e.detail ?? {}) as Record<string, unknown>, c)
          return l.linked.length || l.unlinked.length ? (
            <div className="adm-reason">
              {l.linked.length > 0 && <><b>Deals linked</b>: {l.linked.join(', ')}</>}
              {l.linked.length > 0 && l.unlinked.length > 0 && ' · '}
              {l.unlinked.length > 0 && <><b>Deals unlinked</b>: {l.unlinked.join(', ')}</>}
            </div>
          ) : null
        })()}
        {e.reason && <div className="adm-reason"><b>Reason</b>: {e.reason}</div>}
        {rest.length > 0 && (
          <dl className="adm-dl">
            {rest.map(([k, v]) => (
              <span key={k} style={{ display: 'contents' }}>
                <dt>{k}</dt>
                <dd>{typeof v === 'object' && v !== null ? <pre className="adm-pre">{JSON.stringify(v, null, 2)}</pre> : String(v)}</dd>
              </span>
            ))}
          </dl>
        )}
        {!ch.length && !e.reason && !rest.length && <span className="adm-muted">No further detail recorded.</span>}
      </div>
      <dl className="adm-dl">
        {s && <><dt>{e.upload_id ? 'Report' : 'Subject'}</dt><dd>{s.href ? <TextLink to={s.href}>{s.title}</TextLink> : s.title}{s.sub ? ` · ${s.sub}` : ''}</dd></>}
        {u && <><dt>Collection period</dt><dd>{formatPeriod(u.collection_period)}{u.reporting_period ? ` (reporting period ${formatPeriod(u.reporting_period)})` : ''}</dd></>}
        {u && <><dt>File</dt><dd>{u.file_name}</dd></>}
        <dt>Tab</dt><dd>{TAB_LABEL[auditScope(e)]}</dd>
        {e.upload_id && <><dt>Upload id</dt><dd className="adm-mono">{e.upload_id}</dd></>}
        {e.finding_id && <><dt>Finding id</dt><dd className="adm-mono">{e.finding_id}</dd></>}
        <dt>Entry id</dt><dd className="adm-mono">{e.id}</dd>
        {e.upload_id && <><dt>Trail</dt><dd><TextLink to={`?upload_id=${e.upload_id}`}>All entries for this upload</TextLink></dd></>}
      </dl>
    </div>
  )
}

/** The entries table used by every view. Clicking a row (or Enter on it) expands it; links inside never do. */
function EntryTable({ rows, caption, c, q, showTab, subjectHeader, loading, empty }: {
  rows: AuditEntry[]; caption: string; c: Ctx; q?: string; showTab?: boolean; subjectHeader: string; loading?: boolean
  empty: { title: string; message?: string; action?: ReactNode }
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const toggle = (id: string) => setOpen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const columns: Column<AuditEntry>[] = [
    { key: 'at', header: 'When', width: 150, render: e => <time className="adm-nowrap" dateTime={e.at}>{when(e.at)}</time> },
    ...(showTab ? [{ key: 'tab', header: 'Tab', render: (e: AuditEntry) => <span className={`adm-tabchip adm-tabchip--${auditScope(e)}`}>{TAB_LABEL[auditScope(e)]}</span> }] : []),
    { key: 'action', header: 'Action', emphasis: true, render: e => <Highlight text={ACTION_LABEL[e.action] ?? e.action} q={q} /> },
    { key: 'actor', header: 'Actor', render: e => <ActorCell e={e} q={q} /> },
    { key: 'subject', header: subjectHeader, render: e => <SubjectCell e={e} c={c} q={q} /> },
    { key: 'reason', header: 'Reason', render: e => (e.reason ? <Highlight text={e.reason} q={q} /> : <span className="adm-muted">—</span>) },
    { key: 'detail', header: 'Detail', render: e => <DetailCell e={e} q={q} c={c} /> },
  ]
  return (
    <div className="adm-scroll">
      <DataTable columns={columns} rows={rows} rowKey={e => e.id} caption={caption} captionHidden loading={loading} density="compact"
        renderExpanded={e => <EntryDetail e={e} c={c} />} expandedKeys={open} onExpandedChange={setOpen} onRowClick={e => toggle(e.id)}
        rowLabel={e => `${ACTION_LABEL[e.action] ?? e.action} at ${when(e.at)}`} empty={empty} />
    </div>
  )
}

type Filters = Pick<AuditQuery, 'action' | 'actor_role' | 'deal_slug'>
const newestFirst = (rows: AuditEntry[]) => rows.slice().sort((a, b) => b.at.localeCompare(a.at))

/** Every page of a query: /audit returns at most `limit` rows (max 500), so page with offset until a short page. */
export async function fetchAll(f: AuditQuery, maxPages = Infinity): Promise<AuditEntry[]> {
  const out: AuditEntry[] = []
  for (let page = 0, offset = 0; page < maxPages; page++, offset += SEARCH_LIMIT) {
    const rows = await adminApi.audit({ ...f, limit: SEARCH_LIMIT, offset })
    out.push(...rows)
    if (rows.length < SEARCH_LIMIT) break
  }
  return out
}

/** Downloads one month of one tab. The API logs the export itself (decision A6). */
function useExport() {
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const run = async (scope: AuditScope, month: string) => {
    const key = `${scope}-${month}`
    setBusy(key)
    try {
      const blob = await adminApi.auditExport(scope, month)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `audit-${scope}-${month}.csv`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 0)
      toast.toast({ tone: 'ok', title: 'Export downloaded', message: `audit-${scope}-${month}.csv. The export is recorded on the Platform tab.` })
    } catch (err) {
      toast.toast({ tone: 'bad', title: 'Export failed', message: errorText(err as Error) })
    } finally { setBusy(null) }
  }
  return { run, busy }
}

function ExportButton({ scope, month, exp }: { scope: AuditScope; month: string; exp: ReturnType<typeof useExport> }) {
  const busy = exp.busy === `${scope}-${month}`
  return (
    <Button size="sm" loading={busy} onClick={ev => { ev.stopPropagation(); void exp.run(scope, month) }}
      aria-label={`Export CSV, ${TAB_LABEL[scope]}, ${monthName(month)}`}>Export CSV</Button>
  )
}

/** One month of one tab: the first `first` entries, then Show all. */
function MonthEntries({ scope, month, filters, first, c, caption, onClear, filtered, count }: {
  scope: AuditScope; month: string; filters: Filters; first: number; c: Ctx; caption: string; onClear: () => void; filtered: boolean; count?: number
}) {
  const [all, setAll] = useState(false)
  const res = useResource(() => (all ? fetchAll({ scope, month, ...filters }) : adminApi.audit({ scope, month, ...filters, limit: first })),
    [scope, month, filters.action, filters.actor_role, filters.deal_slug, all, first])
  if (res.error) return <LoadError error={res.error} onRetry={res.reload} />
  const rows = newestFirst(res.data ?? [])
  const more = !all && rows.length >= first
  return (
    <>
      <EntryTable rows={rows} caption={caption} c={c} subjectHeader={scope === 'reports' ? 'Report' : 'Subject'} loading={res.loading && !res.data}
        empty={filtered
          ? { title: 'No entries match these filters', action: <Button onClick={onClear}>Clear filters</Button> }
          : { title: `No ${TAB_LABEL[scope]} entries in ${monthName(month)}`, message: scope === 'reports' ? 'Entries appear as soon as someone uploads, reviews or publishes a report.' : 'Entries appear when master data changes or someone exports the log.' }} />
      {more && (
        <div className="adm-more">
          Showing the newest {formatNumber(rows.length)}{count != null && !filtered ? ` of ${formatNumber(count)}` : ''}.{' '}
          <Button size="sm" variant="ghost" onClick={() => setAll(true)}>Show all {monthName(month).split(' ')[0]} entries</Button>
        </div>
      )}
    </>
  )
}

/** History: earlier months of the tab, newest first, each opening in place. */
function History({ scope, months, filters, c, onClear, filtered, exp }: {
  scope: AuditScope; months: { month: string; count: number }[]; filters: Filters; c: Ctx; onClear: () => void; filtered: boolean
  exp: ReturnType<typeof useExport>
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  useEffect(() => setOpen(new Set()), [scope])
  const toggle = (m: string) => setOpen(s => { const n = new Set(s); if (n.has(m)) n.delete(m); else n.add(m); return n })
  return (
    <Card title="History" subtitle={`Earlier months of the ${TAB_LABEL[scope]} tab. Click a month to open it. Counts are for the whole month.`} padding="flush">
      {months.length === 0 ? <div className="adm-more">No earlier months yet.</div> : (
        <ul className="adm-hist">
          {months.map(m => {
            const isOpen = open.has(m.month)
            const id = `hist-${scope}-${m.month}`
            return (
              <li key={m.month}>
                <div className="adm-hist__head">
                  <button type="button" className="adm-hist__toggle" aria-expanded={isOpen} aria-controls={isOpen ? id : undefined} onClick={() => toggle(m.month)}>
                    <icons.IconChevronRight width={14} height={14} className="adm-hist__chev" />
                    {monthName(m.month)} <span className="adm-hist__n">{formatNumber(m.count)} entr{m.count === 1 ? 'y' : 'ies'}</span>
                  </button>
                  <ExportButton scope={scope} month={m.month} exp={exp} />
                </div>
                {isOpen && (
                  <div id={id}>
                    <MonthEntries scope={scope} month={m.month} filters={filters} first={FIRST.history} c={c} count={m.count}
                      caption={`${TAB_LABEL[scope]} entries, ${monthName(m.month)}`} onClear={onClear} filtered={filtered} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

/** Search: every month and every tab the role can read, grouped by month (Toronto), newest first. */
function SearchResults({ q, scopes, filters, c, onClearSearch }: { q: string; scopes: AuditScope[]; filters: Filters; c: Ctx; onClearSearch: () => void }) {
  const res = useResource(() => Promise.all(scopes.map(scope => fetchAll({ scope, q, ...filters }, SEARCH_PAGES))),
    [q, scopes.join(), filters.action, filters.actor_role, filters.deal_slug])
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set())
  const [full, setFull] = useState<Set<string>>(() => new Set())
  useEffect(() => { setOpenGroups(new Set()); setFull(new Set()) }, [q])
  if (res.error) return <LoadError error={res.error} onRetry={res.reload} />
  const capped = (res.data ?? []).some(r => r.length >= SEARCH_LIMIT * SEARCH_PAGES)
  const rows = newestFirst((res.data ?? []).flat())
  const groups = new Map<string, AuditEntry[]>()
  for (const e of rows) { const m = torontoMonth(e.at); groups.set(m, [...(groups.get(m) ?? []), e]) }
  const list = [...groups.entries()]
  const filtered = !!(filters.action || filters.actor_role || filters.deal_slug)
  const isOpen = (m: string, i: number) => i < SEARCH_OPEN_GROUPS ? !openGroups.has(m) : openGroups.has(m)
  const flip = (m: string) => setOpenGroups(s => { const n = new Set(s); if (n.has(m)) n.delete(m); else n.add(m); return n })
  const loading = res.loading && !res.data
  return (
    <>
      <div className="adm-searchsum" role="status">
        {loading ? 'Searching…' : `${formatNumber(rows.length)} result${rows.length === 1 ? '' : 's'} in ${formatNumber(list.length)} month${list.length === 1 ? '' : 's'} · ${scopes.length > 1 ? 'both tabs' : 'Reports tab'}${filtered ? ' · filters applied' : ''}${capped ? ` · newest ${SEARCH_LIMIT * SEARCH_PAGES} per tab, narrow the search to see older ones` : ''}`}
        <Button size="sm" onClick={onClearSearch}>Clear search</Button>
      </div>
      <Card padding="flush" aria-label={`Search results for ${q}`}>
        {loading ? <EntryTable rows={[]} caption="Search results" c={c} subjectHeader="Report or subject" loading empty={{ title: '' }} /> : list.length === 0 ? (
          <div className="adm-more"><b>Nothing matches “{q}”.</b> Search looks at the deal, person, action, reason, detail and upload id in every month.</div>
        ) : list.map(([m, es], i) => {
          const o = isOpen(m, i)
          const shown = full.has(m) ? es : es.slice(0, SEARCH_ROWS)
          return (
            <section key={m} aria-label={`Results in ${monthName(m)}`}>
              <div className="adm-group">
                <h3>{monthName(m)}</h3><span className="adm-group__n">{formatNumber(es.length)} result{es.length === 1 ? '' : 's'}</span>
                <Button size="sm" variant="ghost" aria-expanded={o} onClick={() => flip(m)}>{o ? 'Hide' : 'Open'}</Button>
              </div>
              {o && (
                <>
                  <EntryTable rows={shown} caption={`Results in ${monthName(m)}`} c={c} q={q} showTab subjectHeader="Report or subject" empty={{ title: 'No results' }} />
                  {shown.length < es.length && (
                    <div className="adm-more">{formatNumber(es.length - shown.length)} more in {monthName(m).split(' ')[0]}.{' '}
                      <Button size="sm" variant="ghost" onClick={() => setFull(s => new Set(s).add(m))}>Show all {formatNumber(es.length)}</Button>
                    </div>
                  )}
                </>
              )}
            </section>
          )
        })}
      </Card>
    </>
  )
}

/** Audit log (D3). Two tabs, Reports and Platform, each opening on the current month (Toronto time) with earlier
 * months under History; one search across every month and both tabs; action, user and deal filters; the
 * `?upload_id=` trail from an upload's Audit link. TAO Analyst reads the Reports tab only (decision A4); the API
 * enforces the same. Every filter lives in the URL. */
export default function AuditLogPage() {
  const role = useRole()
  const admin = role === 'tao_admin'
  const [params, setParams] = useSearchParams()
  const get = (k: string) => params.get(k) ?? ''
  const scope: AuditScope = admin && get('tab') === 'platform' ? 'platform' : 'reports'
  const scopes: AuditScope[] = admin ? ['reports', 'platform'] : ['reports']
  const uploadId = get('upload_id')
  const q = get('q')
  const filters: Filters = useMemo(() => ({ action: get('action') || undefined, actor_role: get('actor') || undefined, deal_slug: get('deal') || undefined }),
    [params]) // eslint-disable-line react-hooks/exhaustive-deps
  const filtered = !!(filters.action || filters.actor_role || filters.deal_slug)
  const [draft, setDraft] = useState(q)
  useEffect(() => setDraft(q), [q])
  const exp = useExport()
  const month = torontoMonth(new Date())

  usePageHeader({
    title: 'Audit log',
    subtitle: admin
      ? 'Everything that happens to a report, and every change to the platform. This month first; earlier months under History.'
      : 'Everything that happens to a report. This month first; earlier months under History.',
  })

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) { if (v) next.set(k, v); else next.delete(k) }
    setParams(next, { replace: true })
  }
  // Search as you type (debounced); fewer than two characters is no search.
  useEffect(() => {
    const t = draft.trim()
    const want = t.length >= 2 ? t : ''
    if (want === q) return
    const h = setTimeout(() => update({ q: want || null, upload_id: null }), 300)
    return () => clearTimeout(h)
  }, [draft]) // eslint-disable-line react-hooks/exhaustive-deps

  const ctxRes = useResource(() => Promise.all([
    adminApi.uploads().catch(() => [] as Upload[]), adminApi.deals().catch(() => [] as Deal[]), adminApi.programs().catch(() => [] as Program[]),
    // names the person in a user_change entry (TAO Admin only; the API answers 403 to anyone else)
    admin ? usersApi.list().catch(() => [] as AppUser[]) : Promise.resolve([] as AppUser[]),
  ]), [role])
  const c: Ctx = useMemo(() => {
    const [uploads, deals, programs, users] = ctxRes.data ?? [[], [], [], []]
    return { uploads: new Map(uploads.map(u => [u.id, u])), deals, programs, users }
  }, [ctxRes.data])
  const monthsRes = useResource(() => Promise.all(scopes.map(s => adminApi.auditMonths(s))), [role])
  const counts = (s: AuditScope) => monthsRes.data?.[scopes.indexOf(s)] ?? []
  const clearFilters = () => update({ action: null, actor: null, deal: null })
  const setTab = (s: AuditScope) => {
    const keep = filters.action && (s === 'platform' ? PLATFORM_ACTIONS : REPORT_ACTIONS).includes(filters.action)
    update({ tab: s === 'platform' ? 'platform' : null, action: keep ? filters.action! : null })
  }

  const actionGroups = [
    { group: 'Reports', options: REPORT_ACTIONS.map(a => ({ value: a, label: ACTION_LABEL[a] ?? a })) },
    ...(admin ? [{ group: 'Platform', options: PLATFORM_ACTIONS.map(a => ({ value: a, label: ACTION_LABEL[a] ?? a })) }] : []),
  ]
  const searchLabel = admin ? 'Search every month and both tabs' : 'Search every month'

  const filterCard = (
    <Card>
      <form className="adm-auditsearch" role="search" aria-label="Search and filter the audit log" onSubmit={ev => { ev.preventDefault(); update({ q: draft.trim().length >= 2 ? draft.trim() : null, upload_id: null }) }}>
        <div className="adm-searchbox">
          <icons.IconSearch width={16} height={16} />
          <Input type="search" aria-label={searchLabel} value={draft} onChange={e => setDraft(e.target.value)}
            placeholder={`${searchLabel}: deal, person, action, reason, detail or upload id`} />
        </div>
        <div className="adm-auditfilters">
          <Field label="Action">
            <Select value={filters.action ?? ''} onChange={e => update({ action: e.target.value || null })}>
              <option value="">All actions</option>
              {actionGroups.map(g => <optgroup key={g.group} label={g.group}>{g.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>)}
            </Select>
          </Field>
          <Field label="User">
            <Select value={filters.actor_role ?? ''} onChange={e => update({ actor: e.target.value || null })}>
              <option value="">Everyone</option>
              {Object.entries(ACTOR_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Deal">
            <Select value={filters.deal_slug ?? ''} onChange={e => update({ deal: e.target.value || null })}>
              <option value="">All deals</option>
              {dealOptions(c.deals, c.programs).map(g => <optgroup key={g.group} label={g.group}>{g.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>)}
            </Select>
          </Field>
          <Button onClick={clearFilters} disabled={!filtered}>Clear filters</Button>
        </div>
      </form>
    </Card>
  )

  // The trail of one upload, across every month (the Audit link on an upload, or "All entries for this upload").
  if (uploadId) {
    return (
      <div className="adm-stack">
        {filterCard}
        <UploadTrail uploadId={uploadId} filters={filters} c={c} onClear={() => update({ upload_id: null })} />
      </div>
    )
  }

  return (
    <div className="adm-stack">
      {filterCard}
      {q ? <SearchResults q={q} scopes={scopes} filters={filters} c={c} onClearSearch={() => { setDraft(''); update({ q: null }) }} /> : (
        <>
          <nav className="adm-tabs" aria-label="Audit log sections">
            {scopes.map(s => {
              const n = counts(s).find(m => m.month === month)?.count
              return (
                <button key={s} type="button" className="adm-tabs__tab" aria-current={s === scope ? 'page' : undefined} onClick={() => setTab(s)}>
                  {TAB_LABEL[s]}{n != null && <span className="adm-count" aria-label={`${formatNumber(n)} this month`}>{formatNumber(n)}</span>}
                </button>
              )
            })}
          </nav>
          <Card title={monthName(month)} padding="flush"
            subtitle={`${TAB_LABEL[scope]} · this month, Toronto time · newest first${filtered ? ' · filters applied' : ''}`}
            actions={<ExportButton scope={scope} month={month} exp={exp} />}>
            <MonthEntries key={`${scope}-${month}`} scope={scope} month={month} filters={filters} first={FIRST.current} c={c}
              count={counts(scope).find(m => m.month === month)?.count} caption="Audit log" onClear={clearFilters} filtered={filtered} />
          </Card>
          {monthsRes.error ? <LoadError error={monthsRes.error} onRetry={monthsRes.reload} /> : (
            <History scope={scope} months={counts(scope).filter(m => m.month < month).sort((a, b) => b.month.localeCompare(a.month))}
              filters={filters} c={c} onClear={clearFilters} filtered={filtered} exp={exp} />
          )}
          {!admin && <div className="adm-note">The Platform tab (master data and exports) is for TAO Admin.</div>}
        </>
      )}
    </div>
  )
}

function UploadTrail({ uploadId, filters, c, onClear }: { uploadId: string; filters: Filters; c: Ctx; onClear: () => void }) {
  const valid = UUID.test(uploadId)
  const res = useResource(() => (valid ? fetchAll({ scope: 'reports', upload_id: uploadId, ...filters }) : Promise.resolve([] as AuditEntry[])),
    [uploadId, filters.action, filters.actor_role, filters.deal_slug])
  const u = c.uploads.get(uploadId)
  const s = u ? subject({ id: '', at: '', actor_role: '', action: 'upload', upload_id: uploadId }, c) : null
  return (
    <>
      <div className="adm-note">
        {valid ? <>Showing every entry for upload <span className="adm-mono">{uploadId}</span>{s ? <> ({s.title}{s.sub ? ` · ${s.sub}` : ''})</> : null}, across all months.{' '}
          <TextLink to={s?.href ?? `/admin/uploads/queue/${uploadId}`}>Open the upload</TextLink> · </> : <>“{uploadId}” is not an upload id. </>}
        <button type="button" className="adm-linkbtn" onClick={onClear}>Back to this month</button>
      </div>
      {res.error ? <LoadError error={res.error} onRetry={res.reload} /> : (
        <Card title="Upload trail" subtitle={res.loading && !res.data ? 'Loading' : `${formatNumber(res.data?.length ?? 0)} entr${res.data?.length === 1 ? 'y' : 'ies'}, newest first`} padding="flush">
          <EntryTable rows={newestFirst(res.data ?? [])} caption="Audit log" c={c} subjectHeader="Report" loading={res.loading && !res.data}
            empty={{ title: 'No entries for this upload', message: valid ? 'Nothing matches the filters for this upload.' : 'Paste a full upload id, or use the Audit link on an upload.' }} />
        </Card>
      )}
    </>
  )
}
