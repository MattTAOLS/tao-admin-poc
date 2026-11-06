/** Wave C system settings (contracts/openapi.yaml Setting, SettingChange, NotificationPref) and the read-only rule
 * catalogue from contracts/rules.yaml. */
import { api } from '@/shell/api'
import type { Role } from '@/shell/roles'

export type SettingKey = 'partner_notifications_enabled' | 'reporting_calendar' | 'notification_defaults' | 'publish_note_templates' | 'company_feeds'
export type Setting = { key: SettingKey | string; value: unknown; updated_at: string | null; updated_by: string | null }
export type NotificationKind = 'mention' | 'reply' | 'report_needs_review' | 'report_published' | 'correction_published' | 'covenant_changed' | 'report_rejected' | 'user_change' | 'system'
export type NotificationPref = { kind: NotificationKind | string; in_app: boolean; digest: 'instant' | 'daily'; required?: boolean }
export type Calendar = Record<string, number>
export type Defaults = Partial<Record<Role, NotificationPref[]>>
export type Templates = { new_report: string; correction: string }

export const settingsApi = {
  list: () => api<Setting[]>('/settings'),
  put: (key: string, value: unknown, reason: string) => api<Setting>(`/settings/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ value, reason }) }),
}

/** The keys this page edits, in page order. company_feeds is a wave D placeholder and is not edited here. */
export const EDITABLE: SettingKey[] = ['partner_notifications_enabled', 'reporting_calendar', 'notification_defaults', 'publish_note_templates']
export const SETTING_LABEL: Record<string, string> = {
  partner_notifications_enabled: 'Partner notifications',
  reporting_calendar: 'Reporting calendar',
  notification_defaults: 'Notification defaults',
  publish_note_templates: 'Publish note templates',
  company_feeds: 'Company data feeds',
}

/** Expected report day per deal: the settlement day of each deal's August 2026 report (docs/dashboard-json,
 * settlement_date). Pre-fills the calendar until a TAO Admin saves it. */
export const SUGGESTED_DAYS: Calendar = {
  'f-pil-2-0-moneda-capital-corp': 7,
  'f-pil-2-0-stride-capital': 5,
  'f-pil-2-0-xpedite-leasing': 5,
  'move-trust-dynamic-capital': 20,
  'move-trust-essex-lease-financial-corp': 24,
  'move-trust-finloc-2000-inc': 13,
  'move-trust-meridian-onecap-lp': 24,
  'move-trust-tlfc-leases': 17,
  'move-trust-tlfc-loans': 17,
  'move-trust-tlfc-lp-leases': 17,
  'move-trust-tpine-leasing-capital-corporation': 24,
  'move-trust-vcc-iv-lp': 20,
}
/** D10's sample wording; used only when the setting is empty. Fields in braces are filled when the publish dialog opens. */
export const SUGGESTED_TEMPLATES: Templates = {
  new_report: 'The {collection_period} settlement report for {deal_name} ({program_name}) is now available in your portal. Covenant summary: {covenant_summary}.',
  correction: 'We have corrected the {collection_period} report for {deal_name}. What changed: {change_list}. Reason: {reason}. The earlier version stays in your history.',
}
export const TEMPLATE_FIELDS = ['{deal_name}', '{collection_period}', '{program_name}', '{covenant_summary}', '{change_list}', '{reason}']

export const KIND_LABEL: Record<string, string> = {
  report_needs_review: 'Report waiting for approval',
  report_rejected: 'Report rejected',
  system: 'System (e.g. extraction failed)',
  report_published: 'Report published',
  correction_published: 'Correction published',
  covenant_changed: 'Covenant WATCH / BREACH',
  mention: '@mention',
  reply: 'Reply in a thread you are in',
  user_change: 'Your account or reports changed',
}
export const KIND_ORDER = Object.keys(KIND_LABEL)
/** Kinds people cannot switch off (the API refuses in_app false with 422 `required`). */
export const REQUIRED_KINDS = ['covenant_changed', 'correction_published']

export const asBool = (v: unknown) => v === true
export function asCalendar(v: unknown): Calendar {
  const out: Calendar = {}
  if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, d] of Object.entries(v)) if (typeof d === 'number') out[k] = d
  return out
}
/** The saved calendar, with the suggested day for any deal not saved yet. `suggested` lists those deals. */
export function prefillCalendar(saved: Calendar, dealSlugs: string[]): { value: Calendar; suggested: string[] } {
  const value: Calendar = { ...saved }, suggested: string[] = []
  for (const s of dealSlugs) if (value[s] == null && SUGGESTED_DAYS[s] != null) { value[s] = SUGGESTED_DAYS[s]; suggested.push(s) }
  return { value, suggested }
}
export function asTemplates(v: unknown): { value: Templates; suggested: (keyof Templates)[] } {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Templates>
  const suggested: (keyof Templates)[] = []
  const pick = (k: keyof Templates) => { if (typeof o[k] === 'string' && o[k]!.trim()) return o[k]!; suggested.push(k); return SUGGESTED_TEMPLATES[k] }
  return { value: { new_report: pick('new_report'), correction: pick('correction') }, suggested }
}
export function asDefaults(v: unknown): Defaults {
  const out: Defaults = {}
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [role, list] of Object.entries(v)) if (Array.isArray(list)) out[role as Role] = list.filter(p => p && typeof p.kind === 'string') as NotificationPref[]
  }
  return out
}
export const validDay = (d: unknown) => typeof d === 'number' && Number.isInteger(d) && d >= 1 && d <= 31
export const isRequired = (p: NotificationPref) => !!p.required || REQUIRED_KINDS.includes(p.kind)
export function setPref(d: Defaults, role: Role, kind: string, in_app: boolean): Defaults {
  return { ...d, [role]: (d[role] ?? []).map(p => (p.kind === kind ? { ...p, in_app } : p)) }
}

/** A short "before / after" text for the save dialog. */
export function describe(key: string, v: unknown, dealName: (s: string) => string = s => s): string {
  if (key === 'partner_notifications_enabled') return v === true ? 'On' : 'Off'
  if (key === 'reporting_calendar') {
    const c = asCalendar(v); const n = Object.keys(c).length
    return n ? `${n} deal${n === 1 ? '' : 's'} set` : 'Not set'
  }
  if (key === 'publish_note_templates') { const o = (v ?? {}) as Partial<Templates>; return [o.new_report ? 'new report set' : 'new report empty', o.correction ? 'correction set' : 'correction empty'].join(', ') }
  if (key === 'notification_defaults') { const d = asDefaults(v); return `${Object.keys(d).length} roles` }
  void dealName
  return JSON.stringify(v)
}
/** Field-level differences between two values of one setting, for the save dialog. */
export function settingDiff(key: string, before: unknown, after: unknown, dealName: (s: string) => string = s => s): { field: string; before: string; after: string }[] {
  if (key === 'reporting_calendar') {
    const b = asCalendar(before), a = asCalendar(after)
    return [...new Set([...Object.keys(b), ...Object.keys(a)])].filter(k => b[k] !== a[k])
      .map(k => ({ field: `${dealName(k)} expected day`, before: b[k] == null ? 'not set' : String(b[k]), after: a[k] == null ? 'not set' : String(a[k]) }))
  }
  if (key === 'notification_defaults') {
    const b = asDefaults(before), a = asDefaults(after), out: { field: string; before: string; after: string }[] = []
    for (const role of Object.keys(a) as Role[]) for (const p of a[role] ?? []) {
      const q = b[role]?.find(x => x.kind === p.kind)
      if (!q || q.in_app !== p.in_app) out.push({ field: `${role} · ${KIND_LABEL[p.kind] ?? p.kind}`, before: q ? (q.in_app ? 'In-app' : 'Off') : 'not set', after: p.in_app ? 'In-app' : 'Off' })
    }
    return out
  }
  if (key === 'publish_note_templates') {
    const b = (before ?? {}) as Partial<Templates>, a = (after ?? {}) as Partial<Templates>
    return (['new_report', 'correction'] as const).filter(k => (b[k] ?? '') !== (a[k] ?? ''))
      .map(k => ({ field: k === 'new_report' ? 'Template: new report' : 'Template: correction', before: b[k] || 'empty', after: a[k] || 'empty' }))
  }
  return [{ field: SETTING_LABEL[key] ?? key, before: describe(key, before), after: describe(key, after) }]
}

// ---- contracts/rules.yaml, read-only (S1). A line scan: the file is data with a fixed layout. ----
export type RuleRow = { id: string; title: string; layer: string; severity: string; phase: number; tolerance: string | null }
export type RulesCatalogue = { version: string; tolerances: Record<string, string>; lags: Record<string, number>; rules: RuleRow[] }
export function parseRules(yaml: string): RulesCatalogue {
  const out: RulesCatalogue = { version: '', tolerances: {}, lags: {}, rules: [] }
  let block = ''
  let cur: RuleRow | null = null
  for (const raw of yaml.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '')
    if (!line.trim() || line.trim().startsWith('#')) continue
    const top = /^([a-z_]+):\s*(.*)$/.exec(line)
    if (top) { block = top[1]; if (block === 'version') out.version = top[2].trim(); continue }
    if (block === 'tolerances') { const m = /^\s+([\w]+):\s*(\S+)/.exec(line); if (m) out.tolerances[m[1]] = m[2] }
    else if (block === 'reporting_lag_months') { const m = /^\s+([\w.-]+):\s*(-?\d+)/.exec(line); if (m) out.lags[m[1]] = Number(m[2]) }
    else if (block === 'rules') {
      const id = /^\s+- id:\s*(R\d+)/.exec(line)
      if (id) { cur = { id: id[1], title: '', layer: '', severity: '', phase: 0, tolerance: null }; out.rules.push(cur); continue }
      if (!cur) continue
      const f = /^ {4}(title|layer|severity|phase):\s*(.+)$/.exec(line)
      if (f) {
        const v = f[2].trim().replace(/^["']|["']$/g, '')
        if (f[1] === 'phase') cur.phase = Number(v); else cur[f[1] as 'title' | 'layer' | 'severity'] = v
      }
      const t = /^ {4}tolerance:\s*\{\s*unit:\s*([\w]+)/.exec(line)
      if (t) cur.tolerance = t[1]
    }
  }
  return out
}
export const TOLERANCE_MEANS: Record<string, string> = { currency: '$1 per line', percent_points: '0.01 pp', count: 'exact', ratio: 'leverage, coverage' }
export const cap = (s: string) => s.replace(/(^|[-_ ])(\w)/g, (_m, p, c) => (p ? ' ' : '') + c.toUpperCase())
