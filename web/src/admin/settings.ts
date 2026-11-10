/** Wave C system settings (contracts/openapi.yaml Setting, SettingChange, NotificationPref) and the read-only rule
 * catalogue from contracts/rules.yaml. */
import { api } from '@/shell/api'
import type { Role } from '@/shell/roles'
import { SOURCE_NAME, type RunStats } from './newsSources'

export type SettingKey = 'partner_notifications_enabled' | 'reporting_calendar' | 'notification_defaults' | 'publish_note_templates' | 'company_feeds'
  | 'company_profiles_partner_enabled'
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

/** The keys this page edits, in page order. */
export const EDITABLE: SettingKey[] = ['partner_notifications_enabled', 'reporting_calendar', 'notification_defaults', 'publish_note_templates',
  'company_feeds', 'company_profiles_partner_enabled']
export const SETTING_LABEL: Record<string, string> = {
  partner_notifications_enabled: 'Partner notifications',
  reporting_calendar: 'Reporting calendar',
  notification_defaults: 'Notification defaults',
  publish_note_templates: 'Publish note templates',
  company_feeds: 'News search',
  company_profiles_partner_enabled: 'Partner company pages',
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

// ---- Wave D: company_feeds (contracts/openapi.yaml Setting) and the news runs ----
export type FeedSource = 'google_news' | 'gdelt'
export type Feeds = { enabled: boolean; run_at: string; time_zone: string; sources: FeedSource[]; daily_cap: number }
export const FEED_SOURCES: { id: FeedSource; label: string }[] = [{ id: 'google_news', label: 'Google News RSS' }, { id: 'gdelt', label: 'GDELT' }]
export const FEEDS_DEFAULT: Feeds = { enabled: false, run_at: '06:00', time_zone: 'America/Toronto', sources: ['google_news', 'gdelt'], daily_cap: 200 }
export const DAILY_CAP_MAX = 5000
/** The saved value with the contract defaults for anything missing (an empty object reads as the defaults). */
export function asFeeds(v: unknown): Feeds {
  const o = (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Partial<Feeds>
  const sources = Array.isArray(o.sources) ? FEED_SOURCES.map(s => s.id).filter(id => o.sources!.includes(id)) : FEEDS_DEFAULT.sources
  return {
    enabled: o.enabled === true,
    run_at: typeof o.run_at === 'string' ? o.run_at : FEEDS_DEFAULT.run_at,
    time_zone: typeof o.time_zone === 'string' && o.time_zone ? o.time_zone : FEEDS_DEFAULT.time_zone,
    sources,
    daily_cap: typeof o.daily_cap === 'number' ? o.daily_cap : FEEDS_DEFAULT.daily_cap,
  }
}
export const validCap = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= DAILY_CAP_MAX
export const validRunAt = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)
/** Problems that block saving, by field. */
export function feedsErrors(f: Feeds): { run_at?: string; sources?: string; time_zone?: string; daily_cap?: string } {
  const out: { run_at?: string; sources?: string; time_zone?: string; daily_cap?: string } = {}
  if (!validCap(f.daily_cap)) out.daily_cap = 'A whole number from 1 to 5,000.'
  if (!validRunAt(f.run_at)) out.run_at = 'Use 24-hour HH:MM, e.g. 06:00.'
  if (!f.sources.length) out.sources = 'Pick at least one source.'
  if (!f.time_zone) out.time_zone = 'Pick a time zone.'
  return out
}
/** IANA zones for the select: the runtime's list when it has one, always including `current`. */
export function timeZones(current?: string): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
  let list: string[] = []
  try { list = intl.supportedValuesOf?.('timeZone') ?? [] } catch { list = [] }
  if (!list.length) list = ['America/Toronto', 'America/Vancouver', 'America/Edmonton', 'America/Winnipeg', 'America/Halifax', 'America/St_Johns', 'America/New_York', 'Europe/London', 'UTC']
  const out = new Set(list)
  out.add(FEEDS_DEFAULT.time_zone)
  if (current) out.add(current)
  return [...out].sort()
}
export const sourceLabel = (s: string) => FEED_SOURCES.find(x => x.id === s)?.label ?? SOURCE_NAME[s] ?? s

export type NewsRunStatus = 'queued' | 'running' | 'ok' | 'partial' | 'failed'
export type NewsRun = {
  id: string; trigger: 'schedule' | 'manual' | 'recheck' | string; status: NewsRunStatus | string
  queued_at: string; started_at: string | null; finished_at: string | null
  companies: number; items_added: number; adverse_added: number
  errors: { company_slug?: string | null; source: string; message: string }[]
  /** Wave E (E10); {} or absent for runs from before wave E. */
  stats?: RunStats
  /** A manual run for one company (Run now on its profile); null or absent = every company. */
  company_slug?: string | null
}
export const RUN_STATUS: Record<string, { tone: 'ok' | 'warn' | 'bad' | 'blue' | 'neutral'; label: string }> = {
  queued: { tone: 'neutral', label: 'Queued' },
  running: { tone: 'blue', label: 'Running' },
  ok: { tone: 'ok', label: 'Done' },
  partial: { tone: 'warn', label: 'Partial' },
  failed: { tone: 'bad', label: 'Failed' },
}
export const runFinished = (r: Pick<NewsRun, 'status'>) => r.status === 'ok' || r.status === 'partial' || r.status === 'failed'
export const newsApi = {
  runs: (limit = 10) => api<NewsRun[]>(`/news/runs?limit=${limit}`),
  runNow: () => api<NewsRun>('/news/runs', { method: 'POST' }),
}
/** Plain words for the two Run now conflicts; anything else falls back to the API message. */
export const RUN_CONFLICT: Record<string, string> = {
  feeds_off: 'The news search is switched off. Switch it on and save first.',
  run_active: 'A run is already queued or running. Wait for it to finish.',
}
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
  if (key === 'partner_notifications_enabled' || key === 'company_profiles_partner_enabled') return v === true ? 'On' : 'Off'
  if (key === 'company_feeds') { const f = asFeeds(v); return f.enabled ? `On, ${f.run_at} ${f.time_zone}` : 'Off' }
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
  if (key === 'company_feeds') {
    const b = asFeeds(before), a = asFeeds(after)
    const src = (f: Feeds) => f.sources.map(sourceLabel).join(', ') || 'none'
    const rows: [string, string, string][] = [
      ['Search', b.enabled ? 'On' : 'Off', a.enabled ? 'On' : 'Off'], ['Run time', b.run_at, a.run_at], ['Time zone', b.time_zone, a.time_zone], ['Sources', src(b), src(a)],
      ['Daily request cap per source', String(b.daily_cap), String(a.daily_cap)],
    ]
    return rows.filter(([, x, y]) => x !== y).map(([field, x, y]) => ({ field, before: x, after: y }))
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
