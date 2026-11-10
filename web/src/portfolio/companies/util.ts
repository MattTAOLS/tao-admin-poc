/** Pure helpers for the company pages: who may do what, list filters (kept in the URL), CSV, display words. */
import { useEffect, useState } from 'react'
import { formatPeriod } from '@/design/components'
import { api } from '@/shell/api'
import { loadRole, type Role } from '@/shell/roles'
import { useSession } from '@/shell/session'
import { fmtNum } from '../Num'
import type { ShellId } from '../nav'
import type { CompanyRow, Month, WorstStatus } from './types'

export const isTaoRole = (r: string) => r === 'tao_admin' || r === 'tao_analyst'

/** Where the company pages live in each shell. */
export function companyLinks(shell: ShellId) {
  const base = shell === 'admin' ? '/admin/companies' : `/${shell}/companies`
  return {
    list: () => base,
    profile: (slug: string, deal?: string) => `${base}/${encodeURIComponent(slug)}${deal ? `?deal=${encodeURIComponent(deal)}` : ''}`,
    profileSettings: () => (shell === 'admin' ? '/admin/settings/profile' : `/${shell}/settings/profile`),
    reports: () => (shell === 'admin' ? '/admin/reports' : `/${shell}/reports`),
    dataRoom: () => `/${shell}/data-room`,
  }
}

/** The caller as the company pages need it: role, whether a person is signed in (follow and notes need one), who. */
export function useCaller() {
  const session = useSession()
  const role: Role = (session.me?.role as Role | undefined) ?? loadRole()
  const user = session.mode === 'user' ? session.me?.user ?? null : null
  return { role, tao: isTaoRole(role), admin: role === 'tao_admin', user, signedIn: !!user }
}

/** Me.features.companies: always true for TAO roles; for partners the setting company_profiles_partner_enabled. Read
 * from the session when a user is signed in, else from GET /me (role-only mode still answers with features). Unknown
 * (older API, error) counts as off. */
export function useCompaniesEnabled(): boolean | null {
  const session = useSession()
  const role = (session.me?.role as string | undefined) ?? loadRole()
  const fromSession = (session.me as { features?: { companies?: boolean } } | null)?.features?.companies
  const [fetched, setFetched] = useState<boolean | null>(null)
  const tao = isTaoRole(role)
  useEffect(() => {
    if (tao || typeof fromSession === 'boolean') return
    let live = true
    api<{ features?: { companies?: boolean } }>('/me').then(
      m => { if (live) setFetched(!!m?.features?.companies) },
      () => { if (live) setFetched(false) },
    )
    return () => { live = false }
  }, [tao, fromSession, role])
  if (tao) return true
  if (typeof fromSession === 'boolean') return fromSession
  return fetched
}

// ---- List filters (all in the URL) ----

export type StatusFilter = '' | 'breach' | 'watch' | 'ok' | 'flagged'
export type AdverseFilter = '' | 'to_review' | 'clear' | 'not_screened'
export type Filters = { q: string; program: string; industry: string; status: StatusFilter; adverse: AdverseFilter; following: boolean }

export function readFilters(s: URLSearchParams): Filters {
  const st = s.get('status') ?? ''
  const ad = s.get('adverse') ?? ''
  return {
    q: s.get('q') ?? '',
    program: s.get('program') ?? '',
    industry: s.get('industry') ?? '',
    status: (['breach', 'watch', 'ok', 'flagged'].includes(st) ? st : '') as StatusFilter,
    adverse: (['to_review', 'clear', 'not_screened'].includes(ad) ? ad : '') as AdverseFilter,
    following: s.get('following') === '1',
  }
}

export function writeFilters(f: Filters): URLSearchParams {
  const s = new URLSearchParams()
  if (f.q) s.set('q', f.q)
  if (f.program) s.set('program', f.program)
  if (f.industry) s.set('industry', f.industry)
  if (f.status) s.set('status', f.status)
  if (f.adverse) s.set('adverse', f.adverse)
  if (f.following) s.set('following', '1')
  return s
}

export const anyFilter = (f: Filters) => !!(f.q || f.program || f.industry || f.status || f.adverse || f.following)

export function applyFilters(rows: CompanyRow[], f: Filters): CompanyRow[] {
  const q = f.q.trim().toLowerCase()
  return rows.filter(r => {
    if (q && !r.name.toLowerCase().includes(q) && !r.deals.some(d => d.deal_name.toLowerCase().includes(q))) return false
    if (f.program && !r.deals.some(d => d.program_slug === f.program)) return false
    if (f.industry && r.industry !== f.industry) return false
    if (f.status === 'breach' && r.status !== 'BREACH') return false
    if (f.status === 'watch' && r.status !== 'WATCH') return false
    if (f.status === 'ok' && r.status !== 'OK') return false
    if (f.status === 'flagged' && r.status !== 'BREACH' && r.status !== 'WATCH') return false
    if (f.adverse && r.adverse.state !== f.adverse) return false
    if (f.following && !r.following) return false
    return true
  })
}

export const STATUS_FILTER_LABEL: Record<Exclude<StatusFilter, ''>, string> = { breach: 'Breach', watch: 'Watch', ok: 'OK', flagged: 'Breach or watch' }
export const ADVERSE_FILTER_LABEL: Record<Exclude<AdverseFilter, ''>, string> = { to_review: 'To review', clear: 'Clear', not_screened: 'Not screened' }

// ---- Row values ----

export const programsOf = (r: { deals: { program_slug: string; program_name: string }[] }) =>
  [...new Map(r.deals.map(d => [d.program_slug, d.program_name])).values()]

/** The newest latest_period across a company's deals. */
export function latestMonth(r: { deals: { latest_period: Month | null }[] }): Month | null {
  const ms = r.deals.map(d => d.latest_period).filter((m): m is Month => !!m).sort()
  return ms.length ? ms[ms.length - 1] : null
}

export const STATUS_WORD: Record<string, string> = { BREACH: 'Breach', WATCH: 'Watch', OK: 'OK' }
export const STATUS_TONE: Record<string, 'bad' | 'warn' | 'ok'> = { BREACH: 'bad', WATCH: 'warn', OK: 'ok' }
export const statusRank = (s: WorstStatus) => (s === 'BREACH' ? 3 : s === 'WATCH' ? 2 : s === 'OK' ? 1 : 0)

export function delinquencyText(d: CompanyRow['delinquency']): string {
  if (d.min === null && d.max === null) return '—'
  const lo = d.min ?? d.max, hi = d.max ?? d.min
  return lo === hi ? fmtNum(lo, 'pct') : `${fmtNum(lo, 'pct')}–${fmtNum(hi, 'pct')}`
}

export const ADVERSE_WORD = (a: CompanyRow['adverse']) =>
  a.state === 'to_review' ? `${a.to_review} to review` : a.state === 'clear' ? 'Clear' : 'Not screened'

export const dealCount = (n: number) => `${n} deal${n === 1 ? '' : 's'}`

/** CompanyNewsSearch.languages in words. */
export const LANGUAGE_WORD: Record<string, string> = { en: 'English', fr: 'French' }

/** What CompanyRow.news_7d counts (decision E3), for the column tooltip and the list notes. */
export const NEWS_7D_MEANING = 'Checked stories with a confirmed date in the last 7 days'

// ---- CSV ----

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/** CSV of the rows shown, raw numbers (fractions for delinquency), one company per line. Notes only for TAO. */
export function companiesCsv(rows: CompanyRow[], withNotes: boolean): string {
  const head = ['Company', 'Deals', 'Programs', 'Industry', 'Latest month', 'Status', 'Breach covenants', 'Watch covenants', 'Balance',
    'Delinquency min', 'Delinquency max', 'Delinquency direction', 'News 7 days', 'Adverse media', ...(withNotes ? ['Notes'] : [])]
  const lines = rows.map(r => [
    r.name, r.deals.map(d => d.deal_name).join('; '), programsOf(r).join('; '), r.industry ?? '', latestMonth(r) ?? '',
    r.status ? STATUS_WORD[r.status] : 'Not published', r.breach, r.watch, r.balance ?? '',
    r.delinquency.min ?? '', r.delinquency.max ?? '', r.delinquency.direction ?? '', r.news_7d, ADVERSE_WORD(r.adverse),
    ...(withNotes ? [r.notes ?? 0] : []),
  ])
  return [head, ...lines].map(l => l.map(cell).join(',')).join('\r\n') + '\r\n'
}

export function downloadText(name: string, text: string, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

// ---- Dates ----

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "2026-09-24" or an ISO time → "24 Sep 2026". */
export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  return `${Number(m[3])} ${MON[Number(m[2]) - 1]} ${m[1]}`
}
/** "2026-07" → "Jul-26" (chart axis). */
export function shortMonth(m: Month): string {
  const x = /^(\d{4})-(\d{2})$/.exec(m)
  return x ? `${MON[Number(x[2]) - 1]}-${x[1].slice(2)}` : m
}
export const longMonth = (m: Month | null | undefined) => formatPeriod(m ?? null)

/** The 13 months ending at `last` (YYYY-MM), oldest first. */
export function monthsEnding(last: Month, n = 13): Month[] {
  const x = /^(\d{4})-(\d{2})$/.exec(last)
  if (!x) return []
  let y = Number(x[1]), mo = Number(x[2])
  const out: Month[] = []
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}-${String(mo).padStart(2, '0')}`)
    mo -= 1; if (mo === 0) { mo = 12; y -= 1 }
  }
  return out
}

// ---- @mentions (same behaviour as the review comment composer) ----

export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at < 0) return null
  if (at > 0 && !/\s/.test(before[at - 1])) return null
  const query = before.slice(at + 1)
  if (/[\n\r]/.test(query) || query.length > 40) return null
  return { start: at, query }
}
export function insertMention(text: string, start: number, caret: number, name: string) {
  const ins = '@' + name + ' '
  return { text: text.slice(0, start) + ins + text.slice(caret), caret: start + ins.length }
}
export function mentionIds(text: string, picked: Map<string, string>): string[] {
  const ids: string[] = []
  for (const [id, name] of picked) if (text.includes('@' + name) && !ids.includes(id)) ids.push(id)
  return ids
}
export function splitMentions(body: string, names: string[]): { text: string; mention: boolean }[] {
  const sorted = [...new Set(names)].filter(Boolean).sort((a, b) => b.length - a.length)
  if (!sorted.length) return [{ text: body, mention: false }]
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp('(@(?:' + sorted.map(esc).join('|') + '))', 'g')
  return body.split(re).filter(s => s !== '').map(s => ({ text: s, mention: sorted.some(n => s === '@' + n) }))
}

export type ApiErr = { code?: string; message?: string; status?: number }
export const errText = (e: unknown) => (e as ApiErr)?.message || 'The request failed. Try again.'
