/// <reference types="node" />
/** Wave D fixtures. Companies are seed/companies.json; every figure (status, covenant counts, balance, delinquency, ratio
 * series, program median and mean, loss peers, covenant history, restatements, period history) is taken or computed
 * from the real objects in docs/dashboard-json, the way contracts/openapi.yaml says the API computes it. News, adverse
 * media items, notes, contacts, industry and news search settings are test records (no report carries them). News items
 * follow the wave E shape (confirmed dates, sources, language, the TAO-only check). */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { apiDeal, deals, programOf } from './fixtures'
import { displayStatus } from '../fmt'
import type { Covenant, Deal } from '../types'
import type {
  AdverseItem, Company, CompanyDealRef, CompanyInsights, CompanyNote, CompanyRow, CovenantHistoryRow, LossPeer, MetricSeries,
  NewsCheck, NewsInclude, NewsItem, SeriesPoint, TaoUser, WatchSignal,
} from '../companies/types'

type SeedCompany = { slug: string; name: string; aliases: string[]; deal_slugs: string[] }
export const SEED_COMPANIES: SeedCompany[] = JSON.parse(readFileSync(resolve(__dirname, '../../../../seed/companies.json'), 'utf8'))
const PROGRAM_NAME: Record<string, string> = { 'f-pil-2-0': 'F-PIL 2.0', 'move-trust': 'MOVE Trust' }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "Jul-26" → "2026-07". */
export const ym = (m: string) => { const [a, b] = m.split('-'); return `20${b}-${String(MON.indexOf(a) + 1).padStart(2, '0')}` }
const periodOf = (slug: string) => apiDeal(slug).published_period as string

/** Test records: the people (seed/users.json ids). */
export const ADMIN = { id: '00000000-0000-4000-8000-000000000001', name: 'A. Patel' }
export const ADMIN2 = { id: '00000000-0000-4000-8000-000000000002', name: 'R. Okafor' }
export const ANALYST = { id: '00000000-0000-4000-8000-000000000003', name: 'J. Moreau' }
export const TAO_USERS: TaoUser[] = [
  { ...ADMIN, email: 'tao.admin@example.com', role: 'tao_admin', status: 'active' },
  { ...ADMIN2, email: 'tao.admin2@example.com', role: 'tao_admin', status: 'active' },
  { ...ANALYST, email: 'tao.analyst@example.com', role: 'tao_analyst', status: 'active' },
]

/** Test records: industry for two companies only (the rest stay null so "Not set" shows). */
const INDUSTRY: Record<string, string> = { 'essex-lease-financial-corp': 'Equipment leasing', 'dynamic-capital': 'Equipment leasing', 'finloc-2000-inc': 'Equipment finance' }
const NEWS_7D: Record<string, number> = { 'essex-lease-financial-corp': 3, 'finloc-2000-inc': 2 }
const NOT_SCREENED = 'vcc-iv-lp'

export function dealRef(slug: string): CompanyDealRef {
  const d = deals[slug]
  const p = programOf(slug)
  // Next report from the reporting calendar (D8): Essex expects day 24; MOVE Trust settles the month after the period.
  const next = slug === 'move-trust-essex-lease-financial-corp' ? { period: '2026-08', due_on: '2026-09-24', late: false, business_days_late: 0 } : null
  return { deal_slug: slug, deal_name: d.deal_name, program_slug: p, program_name: PROGRAM_NAME[p], latest_period: periodOf(slug), worst_status: d.worst_status as CompanyDealRef['worst_status'], next_report: next }
}

const RANK: Record<string, number> = { BREACH: 3, WATCH: 2, OK: 1 }
const lastDelinquency = (d: Deal) => {
  const rows = d.ratio_history.filter(r => typeof r.delinquency_ratio_pct === 'number')
  return { now: rows.length ? rows[rows.length - 1].delinquency_ratio_pct as number : null, prior: rows.length > 1 ? rows[rows.length - 2].delinquency_ratio_pct as number : null }
}

export function companyRow(c: SeedCompany, tao: boolean, following = false): CompanyRow {
  const ds = c.deal_slugs.map(s => deals[s])
  const status = ds.map(d => String(d.worst_status)).sort((a, b) => (RANK[b] ?? 0) - (RANK[a] ?? 0))[0] as CompanyRow['status']
  const del = ds.map(d => ({ d, ...lastDelinquency(d) })).filter(x => x.now !== null)
  const vals = del.map(x => x.now as number)
  const top = [...del].sort((a, b) => (b.now as number) - (a.now as number))[0]
  const direction = !top || top.prior === null ? null : top.now! > top.prior ? 'up' : top.now! < top.prior ? 'down' : 'flat'
  const toReview = c.slug === 'essex-lease-financial-corp' ? 1 : 0
  const row: CompanyRow = {
    slug: c.slug, name: c.name, deals: c.deal_slugs.map(dealRef), industry: INDUSTRY[c.slug] ?? null, status,
    breach: ds.reduce((n, d) => n + d.covenant_summary.BREACH, 0), watch: ds.reduce((n, d) => n + d.covenant_summary.WATCH, 0),
    balance: ds.reduce((n, d) => n + d.tranche_balance.closing, 0),
    delinquency: { min: vals.length ? Math.min(...vals) : null, max: vals.length ? Math.max(...vals) : null, direction },
    news_7d: NEWS_7D[c.slug] ?? 0,
    adverse: c.slug === NOT_SCREENED ? { state: 'not_screened', to_review: 0 } : tao && toReview ? { state: 'to_review', to_review: toReview } : { state: 'clear', to_review: 0 },
    following,
  }
  if (tao) row.notes = c.slug === 'essex-lease-financial-corp' ? 2 : 0
  return row
}

/** GET /companies for a caller: TAO sees all; a partner sees companies with a deal in a shared program, those deals only. */
export function apiCompanies(tao: boolean, shared: string[] = ['f-pil-2-0', 'move-trust'], following: string[] = []): CompanyRow[] {
  return SEED_COMPANIES
    .map(c => ({ ...c, deal_slugs: c.deal_slugs.filter(s => tao || shared.includes(programOf(s))) }))
    .filter(c => c.deal_slugs.length)
    .map(c => companyRow(c, tao, following.includes(c.slug)))
}

export function apiCompany(slug: string, tao: boolean, extra: Partial<Company> = {}): Company {
  const c = SEED_COMPANIES.find(x => x.slug === slug)!
  const first = Math.min(...c.deal_slugs.flatMap(s => (deals[s].cnl_by_period ?? []).map(r => (typeof r.period === 'string' ? r.period : '')).filter(Boolean).map(p => p.slice(0, 7)).filter(p => /^\d{4}-\d{2}$/.test(p)).map(p => Number(p.replace('-', '')))))
  const co: Company = {
    slug, name: c.name, aliases: c.aliases, industry: INDUSTRY[slug] ?? null, naics: null, headquarters: null, website: null,
    relationship_since: Number.isFinite(first) ? `${String(first).slice(0, 4)}-${String(first).slice(4)}` : null,
    relationship_since_source: Number.isFinite(first) ? 'first_vintage' : null,
    owner: slug === 'essex-lease-financial-corp' ? ANALYST : null,
    deals: c.deal_slugs.map(dealRef),
    contacts: slug === 'essex-lease-financial-corp' ? [{ id: 'c0000000-0000-4000-8000-000000000001', name: 'R. Singh', role: 'Chief Financial Officer', email: 'r.singh@example.com', receives: 'Covenant queries' }] : [],
    following: false, updated_at: '2026-11-05T15:00:00Z',
    // Test records (decision E7): Dynamic Capital is the generic name that needs context words; Essex has one exclusion.
    news_search: slug === 'dynamic-capital' ? { context_terms: ['leasing', 'equipment', 'finance'], exclusions: [], languages: ['en', 'fr'] }
      : slug === 'essex-lease-financial-corp' ? { context_terms: [], exclusions: ['Essex County Council'], languages: ['en', 'fr'] }
      : { context_terms: [], exclusions: [], languages: ['en', 'fr'] },
    ...extra,
  }
  if (!tao) { delete co.owner; delete co.news_search }
  return co
}

// ---- Insights (computed from the real deal objects) ----

const METRICS: { metric: MetricSeries['metric']; label: string; unit: MetricSeries['unit']; match: RegExp }[] = [
  { metric: 'delinquency_ratio_pct', label: 'Delinquency ratio', unit: 'fraction', match: /delinquency ratio/i },
  { metric: 'rolling_3month_loss_ratio_pct', label: 'Rolling 3-month loss ratio', unit: 'fraction', match: /rolling three month loss/i },
  { metric: 'rolling_12month_loss_ratio_pct', label: 'Rolling 12-month loss ratio', unit: 'fraction', match: /rolling twelve month loss/i },
  { metric: 'loss_ratio_pct', label: 'Loss ratio', unit: 'fraction', match: /^(?!.*rolling).*\bloss ratio/i },
  { metric: 'interest_coverage_ratio', label: 'Interest coverage ratio', unit: 'ratio', match: /interest coverage/i },
  { metric: 'debt_equity_ratio', label: 'Leverage', unit: 'ratio', match: /leverage ratio|debt.{0,3}equity/i },
  { metric: 'total_equity', label: 'Total equity', unit: 'currency', match: /total equity/i },
]
const series = (d: Deal, key: string): SeriesPoint[] =>
  d.ratio_history.filter(r => typeof r.month === 'string').map(r => ({ month: ym(r.month as string), value: typeof r[key] === 'number' ? r[key] as number : null }))
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const covFor = (d: Deal, re: RegExp): Covenant | undefined => d.covenants.find(c => c.kind !== 'binary' && re.test(c.description))

export function apiInsights(dealSlug: string): CompanyInsights {
  const d = apiDeal(dealSlug)
  const program = programOf(dealSlug)
  const others = Object.values(deals).filter(x => x.deal_slug !== dealSlug && programOf(x.deal_slug) === program)
  const out: MetricSeries[] = []
  for (const m of METRICS) {
    if (!d.ratio_history.some(r => typeof r[m.metric] === 'number')) continue
    const own = series(d, m.metric).slice(-13)
    const per = own.map(p => others.map(o => series(o, m.metric).find(x => x.month === p.month)?.value).filter((v): v is number => typeof v === 'number'))
    const cov = covFor(d, m.match)
    out.push({
      metric: m.metric, label: m.label, unit: m.unit, deal: own,
      program_median: own.map((p, i) => ({ month: p.month, value: per[i].length >= 2 ? median(per[i]) : null })),
      program_mean: own.map((p, i) => ({ month: p.month, value: per[i].length >= 2 ? per[i].reduce((a, b) => a + b, 0) / per[i].length : null })),
      peers_in_month: own.map((p, i) => ({ month: p.month, count: per[i].length })),
      limit: cov && cov.threshold !== null && (cov.kind === 'ceiling' || cov.kind === 'floor') ? { legal_ref: cov.legal_ref, threshold: cov.threshold, kind: cov.kind } : null,
    })
  }
  const range = (pts: SeriesPoint[]) => { const v = pts.map(p => p.value).filter((x): x is number => x !== null); return v.length ? Math.max(...v) - Math.min(...v) : 0 }
  const own12 = out.find(s => s.metric === 'rolling_12month_loss_ratio_pct')
  const loss_peers: LossPeer[] = own12 ? others.filter(o => o.ratio_history.some(r => typeof r.rolling_12month_loss_ratio_pct === 'number')).map(o => {
    const s = series(o, 'rolling_12month_loss_ratio_pct').slice(-13)
    return { deal_slug: o.deal_slug, deal_name: o.deal_name, metric: 'rolling_12month_loss_ratio_pct', series: s, drawn: range(s) <= 10 * range(own12.deal) }
  }) : []
  // Covenant history: published statuses for the latest and prior publication, earlier months recomputed from the
  // ratio history with today's limits and the deal's watch buffer (the API uses the definitions in force each month).
  const months = (out[0]?.deal ?? []).map(p => p.month)
  const last = d.published_period as string
  const prior = d.period_history.length > 1 ? d.period_history[d.period_history.length - 2].period : null
  const history: CovenantHistoryRow[] = d.covenants.map(c => {
    const m = METRICS.find(x => x.match.test(c.description))
    const pts = m && c.kind !== 'binary' ? series(d, m.metric) : []
    const priorCov = (d.prior_covenants ?? []).find(p => p.legal_ref === c.legal_ref)
    const cells = [...new Set([...months, ...(prior ? [prior] : []), last])].sort().map(month => {
      if (month === last) return { month, status: c.status as CovenantHistoryRow['cells'][number]['status'], source: 'published' as const }
      if (month === prior && priorCov) return { month, status: priorCov.status as CovenantHistoryRow['cells'][number]['status'], source: 'published' as const }
      const v = pts.find(p => p.month === month)?.value
      if (typeof v !== 'number') return { month, status: null, source: null }
      // displayStatus recomputes when the buffer differs from the 'published' one; -1 forces that, at the deal's own buffer.
      return { month, status: displayStatus({ ...c, current_value: v }, d.watch_buffer_pct, -1) as 'OK' | 'WATCH' | 'BREACH', source: 'recomputed' as const }
    })
    return { legal_ref: c.legal_ref, description: c.description, cells }
  })
  const restatements: CompanyInsights['restatements'] = [
    ...((d.restatements as { month: string; field: string; as_reported: { source_period: string; value: number }[] }[] | undefined) ?? []).map(r => ({
      month: ym(r.month), field: r.field, first_reported: r.as_reported[0].value, now: r.as_reported[r.as_reported.length - 1].value,
      changed_in: r.as_reported.find(a => a.value !== r.as_reported[0].value)?.source_period ?? r.as_reported[0].source_period, type: 'restated_by_company' as const,
    })),
    ...(d.data_corrections ?? []).filter(c => typeof c.old_value === 'number' && typeof c.new_value === 'number').map(c => ({
      month: c.period, field: `${c.field} (${c.record})`, first_reported: c.old_value as number, now: c.new_value as number,
      changed_in: String(c.applied ?? ''), type: 'tao_correction' as const,
    })),
  ]
  const signals: WatchSignal[] = d.covenants.filter(c => c.status === 'WATCH').map(c => ({
    kind: 'covenant_near_limit', severity: 'watch', title: `Covenant ${c.legal_ref} within ${d.watch_buffer_pct * 100}% of its limit`, detail: c.description,
    anchor: (() => { const m = METRICS.find(x => x.match.test(c.description)); return m ? `chart-${m.metric}` : 'covenant-history' })(),
  }))
  if ((d.program?.program_utilization_pct ?? 0) > 0.85) signals.push({ kind: 'utilization_high', severity: 'info', title: 'Utilization high', detail: 'Above 85% of the program limit.', anchor: 'pool-balance' })
  if (restatements.length) signals.push({ kind: 'restated', severity: 'info', title: 'Earlier figures restated', detail: 'See Restatements and corrections.', anchor: 'restatements' })
  const balance_median_change: SeriesPoint[] = d.period_history.map(p => {
    const ch = others.map(o => o.period_history.find(x => x.period === p.period)).filter(Boolean).map(x => x!.closing_balance / x!.opening_balance - 1)
    return { month: p.period, value: ch.length >= 2 ? median(ch) : null }
  })
  return { deal_slug: dealSlug, collection_period: d.published_period as string, signals, series: out, loss_peers, balance_median_change, covenant_history: history, restatements }
}

// ---- Test records: news, adverse media, notes ----

const check = (status: NewsCheck['status'], reason: string | null = null, confidence: number | null = null): NewsCheck => ({
  status, confidence, reason, model: status === 'kept' || status === 'excluded' ? 'claude-haiku-4-5' : null,
  checked_at: status === 'kept' || status === 'excluded' ? '2026-11-07T06:10:00Z' : null,
})

/** All news on file for a company, every check status, newest first by published_at, else source_date, else found_at. */
export function newsOnFile(slug: string): NewsItem[] {
  if (slug !== 'essex-lease-financial-corp') return []
  const n = (i: number, title: string, sentiment: NewsItem['sentiment'], day: string, more: Partial<NewsItem> = {}): NewsItem => ({
    id: `n0000000-0000-4000-8000-00000000000${i}`, company_slug: slug, title, url: `https://example.com/news/${i}`, publisher: 'Fixture publisher',
    published_at: `${day}T11:00:00Z`, source_date: `${day}T09:00:00Z`, date_status: 'confirmed', source: 'fixture', sources: ['fixture'],
    language: 'en', sentiment, found_at: `${day}T11:00:00Z`, check: check('kept', 'Names the lessor in the story', 0.9), ...more,
  })
  const items = [
    n(1, 'Fixture headline: lessor opens a regional office', 'positive', '2026-11-05',
      { source: 'google_news', sources: ['google_news', 'newscatcher'], check: check('kept', 'Names Essex Lease Financial and its new office', 0.94) }),
    n(2, 'Fixture headline: higher funding costs for independent lessors', 'negative', '2026-10-31', { source: 'gdelt', sources: ['gdelt'] }),
    // The one deliberate change for wave E: a French story whose only date is the one Google News gave.
    n(3, 'Fixture : liste des dépôts annuels au registre', 'neutral', '2026-11-06',
      { published_at: null, date_status: 'source_only', source: 'google_news', sources: ['google_news'], language: 'fr' }),
    n(4, 'Fixture headline: registry annual filing list', 'neutral', '2026-10-29', { check: check('unchecked') }),
    n(5, 'Fixture headline: Essex County property market cools', 'negative', '2026-11-02',
      { source: 'brave_news', sources: ['brave_news', 'event_registry'], check: check('excluded', 'About Essex County property, not the lender', 0.97) }),
    n(6, 'Fixture headline: equipment lessors report third-quarter volumes', 'neutral', '2026-11-04',
      { published_at: null, source_date: null, date_status: 'unknown', source: 'dow_jones', sources: ['dow_jones', 'lexisnexis'], language: null, check: check('pending') }),
  ]
  const key = (x: NewsItem) => x.published_at ?? x.source_date ?? x.found_at
  return items.sort((a, b) => key(b).localeCompare(key(a)))
}

/** GET /companies/{slug}/news: kept and unchecked stories; TAO adds excluded and / or pending with include; partners
 * get kept stories only, without the check block. */
export function apiNews(slug: string, tao = true, include: NewsInclude | null = null): NewsItem[] {
  const all = newsOnFile(slug)
  if (!tao) return all.filter(x => x.check?.status === 'kept').map(({ check: _c, ...x }) => x)
  const extra = new Set(include === 'all' ? ['excluded', 'pending'] : include ? [include] : [])
  return all.filter(x => x.check?.status === 'kept' || x.check?.status === 'unchecked' || extra.has(x.check!.status))
}

export function apiAdverse(slug: string, tao: boolean): AdverseItem[] {
  if (slug !== 'essex-lease-financial-corp') return []
  const a = (i: number, category: AdverseItem['category'], title: string, state: AdverseItem['state'], by: { id: string; name: string } | null, note: string | null): AdverseItem => ({
    id: `a0000000-0000-4000-8000-00000000000${i}`, company_slug: slug, news_item_id: null, category, title, url: `https://example.com/adverse/${i}`,
    publisher: 'Fixture register', found_at: `2026-1${i - 1}-04T11:00:00Z`, state, note, state_by: by, state_at: by ? '2026-10-05T12:00:00Z' : null,
  })
  const all = [
    a(1, 'regulatory', 'Fixture: name appears in a regulator notice', 'open', null, null),
    a(2, 'litigation', 'Fixture: civil claim names a similar company', 'dismissed', ADMIN, 'Different entity: registry number does not match'),
    a(3, 'insolvency', 'Fixture: supplier insolvency notice lists the company as a creditor', 'reviewed', ADMIN, 'Creditor, not debtor. No action.'),
  ]
  return tao ? all : all.filter(x => x.state === 'reviewed')
}

export function apiNotes(slug: string): CompanyNote[] {
  if (slug !== 'essex-lease-financial-corp') return []
  return [
    { id: 'b0000000-0000-4000-8000-000000000002', company_slug: slug, author: ADMIN, body: 'Call booked with the servicer.', mentions: [], collection_period: null, created_at: '2026-10-29T14:00:00Z', edited_at: null },
    { id: 'b0000000-0000-4000-8000-000000000001', company_slug: slug, author: ANALYST, body: 'Interest coverage inside the watch band. @A. Patel to raise at the call.', mentions: [ADMIN], collection_period: '2026-07', created_at: '2026-10-28T14:00:00Z', edited_at: null },
  ]
}
