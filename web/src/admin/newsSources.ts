/** Wave E: paid news sources (contracts/openapi.yaml NewsSource, NewsSourceUpdate, /news/sources*, /news/recheck),
 * decisions E1, E8, E9 and E10 in docs/phase2/tao-admin-poc-news_Architecture_v1.md. TAO Admin only. */
import { api } from '@/shell/api'
import type { NewsRun } from './settings'

export type NewsProvider = 'event_registry' | 'newscatcher' | 'brave' | 'dow_jones' | 'lexisnexis'
export type FieldKind = 'text' | 'url' | 'boolean' | 'integer'
export type SourceField = { name: string; label: string; secret: boolean; required: boolean; kind?: FieldKind; help?: string | null }
export type SecretState = { set: boolean; last4: string | null }
export type LastTest = { at: string | null; ok: boolean | null; message: string | null }
export type NewsSource = {
  provider: NewsProvider | string; label: string; available: boolean; note?: string | null; enabled: boolean
  fields: SourceField[]; secrets: Record<string, SecretState>; config: Record<string, unknown>; last_test: LastTest
  updated_at?: string | null; updated_by?: { id?: string; name?: string; display_name?: string } | null
}
export type NewsSources = { secret_key_set: boolean; sources: NewsSource[] }
export type NewsSourceUpdate = { enabled?: boolean; config?: Record<string, unknown>; secrets?: Record<string, string | null>; reason: string }

export const sourcesApi = {
  list: () => api<NewsSources>('/news/sources'),
  put: (provider: string, body: NewsSourceUpdate) => api<NewsSource>(`/news/sources/${encodeURIComponent(provider)}`, { method: 'PUT', body: JSON.stringify(body) }),
  test: (provider: string) => api<NewsSource>(`/news/sources/${encodeURIComponent(provider)}/test`, { method: 'POST' }),
  recheck: () => api<NewsRun>('/news/recheck', { method: 'POST' }),
}

export const NO_SECRET_KEY = 'The server has no NEWS_SECRET_KEY, so keys cannot be stored. Ask IT to set it in .env (see docs/hosting.md).'
/** Plain words for the wave E conflicts; anything else falls back to errorText. */
export const SOURCE_CONFLICT: Record<string, string> = {
  no_secret_key: NO_SECRET_KEY,
  not_available: 'This source cannot be switched on or tested yet: its connection is built only once the client supplies the provider’s API documentation. Its keys can still be stored.',
  missing_credentials: 'A required key is not set. Enter every required key and save before switching this source on or testing it.',
  run_active: 'A news run is already in progress.',
  invalid: 'The API refused one of the values. Check the fields and try again.',
}

/** Required secret fields that have no stored value. */
export const missingSecrets = (s: NewsSource) => s.fields.filter(f => f.secret && f.required && !s.secrets[f.name]?.set)

export type SourceStatus = { tone: 'ok' | 'warn' | 'neutral'; label: 'On' | 'Off' | 'Not available yet' | 'Key not set' }
/** One status per row: not available first, then a missing required key, then on or off. */
export function sourceStatus(s: NewsSource): SourceStatus {
  if (!s.available) return { tone: 'neutral', label: 'Not available yet' }
  if (missingSecrets(s).length) return { tone: 'warn', label: 'Key not set' }
  return s.enabled ? { tone: 'ok', label: 'On' } : { tone: 'neutral', label: 'Off' }
}
export const secretText = (st: SecretState | undefined) => (st?.set ? `Set, ends in ••••${st.last4 ?? ''}` : 'Not set')
export const kindOf = (f: SourceField): FieldKind => f.kind ?? 'text'

/** The edit dialog's state: new secret values typed (never the stored ones), secrets marked for removal, the
 * non-secret values as typed, and the switch. */
export type SourceDraft = { enabled: boolean; config: Record<string, string | boolean>; secrets: Record<string, string>; remove: string[] }
export function draftOf(s: NewsSource): SourceDraft {
  const config: Record<string, string | boolean> = {}
  for (const f of s.fields) if (!f.secret) {
    const v = s.config[f.name]
    config[f.name] = kindOf(f) === 'boolean' ? v === true : v == null ? '' : String(v)
  }
  return { enabled: s.enabled, config, secrets: {}, remove: [] }
}
/** The typed value of a non-secret field as it would be sent; `undefined` for an empty text field. */
function typed(f: SourceField, v: string | boolean): unknown {
  if (kindOf(f) === 'boolean') return v === true
  const t = String(v).trim()
  if (t === '') return undefined
  return kindOf(f) === 'integer' ? Number(t) : t
}
/** Problems that block saving, by field name. */
export function draftErrors(s: NewsSource, d: SourceDraft): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of s.fields) {
    if (f.secret) continue
    const t = String(d.config[f.name] ?? '').trim()
    if (kindOf(f) === 'integer' && t !== '' && !/^-?\d+$/.test(t)) out[f.name] = 'A whole number.'
    if (kindOf(f) === 'url' && t !== '') {
      let ok = false
      try { const u = new URL(t); ok = u.protocol === 'https:' || u.protocol === 'http:' } catch { ok = false }
      if (!ok) out[f.name] = 'A full address starting with https://'
    }
  }
  return out
}
/** Only what changed: the switch, changed non-secret fields, new secrets (string) and removed ones (null).
 * Null when nothing changed. The reason is added by the caller. */
export function buildUpdate(s: NewsSource, d: SourceDraft): Omit<NewsSourceUpdate, 'reason'> | null {
  const out: Omit<NewsSourceUpdate, 'reason'> = {}
  if (d.enabled !== s.enabled) out.enabled = d.enabled
  const config: Record<string, unknown> = {}
  for (const f of s.fields) {
    if (f.secret) continue
    const next = typed(f, d.config[f.name] ?? '')
    const prev = s.config[f.name]
    if (kindOf(f) === 'boolean' ? next !== (prev === true) : next !== (prev ?? undefined)) config[f.name] = next ?? null
  }
  if (Object.keys(config).length) out.config = config
  const secrets: Record<string, string | null> = {}
  for (const f of s.fields) {
    if (!f.secret) continue
    const v = (d.secrets[f.name] ?? '').trim()
    if (v) secrets[f.name] = v
    else if (d.remove.includes(f.name) && s.secrets[f.name]?.set) secrets[f.name] = null
  }
  if (Object.keys(secrets).length) out.secrets = secrets
  return Object.keys(out).length ? out : null
}
/** What the save will change, in words. Never shows a secret value. */
export function updateSummary(s: NewsSource, u: Omit<NewsSourceUpdate, 'reason'>): string[] {
  const label = (n: string) => s.fields.find(f => f.name === n)?.label ?? n
  const out: string[] = []
  if (u.enabled !== undefined) out.push(`Switch: ${s.enabled ? 'On' : 'Off'} → ${u.enabled ? 'On' : 'Off'}`)
  for (const [k, v] of Object.entries(u.config ?? {})) {
    const show = (x: unknown) => (x === true ? 'On' : x === false ? 'Off' : x == null || x === '' ? 'empty' : String(x))
    out.push(`${label(k)}: ${show(s.config[k])} → ${show(v)}`)
  }
  for (const [k, v] of Object.entries(u.secrets ?? {})) out.push(`${label(k)}: ${v === null ? 'removed' : s.secrets[k]?.set ? 'replaced' : 'set'}`)
  return out
}

export const TEST_POLL_MS = 2000
export const TEST_MAX_MS = 40000

// ---- Run stats (NewsRun.stats, E10) ----
export type RunStats = {
  calls?: Record<string, number>; capped?: string[]; candidates?: number; kept?: number; excluded?: number; pending?: number
  date_confirmed?: number; claude_input_tokens?: number; claude_output_tokens?: number
}
export const hasStats = (s: RunStats | undefined | null): s is RunStats => !!s && Object.keys(s).length > 0
/** Names for every NewsSourceName and NewsSource provider. */
export const SOURCE_NAME: Record<string, string> = {
  google_news: 'Google News RSS', gdelt: 'GDELT', event_registry: 'Event Registry', newscatcher: 'NewsCatcher', brave: 'Brave',
  brave_news: 'Brave News', brave_web: 'Brave Web', dow_jones: 'Dow Jones', lexisnexis: 'LexisNexis', fixture: 'Test fixture',
}
export const TRIGGER_LABEL: Record<string, string> = { manual: 'Manual', schedule: 'Scheduled', recheck: 'Re-check' }
