/** Display rules for the portfolio pages, ported from docs/dashboard-renderer.reference.js. Nothing here computes a
 * number the published object already carries; these only decide the unit a value is shown in, labels, and the
 * client-side WATCH re-classification behind the watch threshold control. */
import type { Covenant, Deal, Terminology } from './types'

export type NumKind = 'money' | 'pct' | 'count' | 'ratio' | 'signed-money' | 'signed-count'

/** The unit a covenant TEST is written in, read from its own wording (reference covUnit). */
export function covUnit(c: Pick<Covenant, 'description' | 'threshold' | 'current_value'>): 'ratio' | 'pct' | 'money' {
  const d = (c.description || '').toLowerCase()
  const t = Math.abs(c.threshold || 0), v = Math.abs(c.current_value || 0)
  if (/:1\b|coverage ratio|leverage ratio|debt\s*\/\s*equity|debt[- ]to[- ]equity/.test(d)) return 'ratio'
  if (d.includes('%') && t < 1) return 'pct'
  if (/total equity|net worth|required equity|deferred (account|amount)|tranche balance|\$\s?\d/.test(d) || t >= 1000 || v >= 1000) return 'money'
  return 'pct'
}

export function covKind(c: Covenant): NumKind {
  const u = covUnit(c)
  return u === 'money' ? 'money' : u === 'ratio' ? 'ratio' : 'pct'
}

/** financial_ratios[].format → display kind. */
export function ratioKind(format: string): NumKind {
  return format === 'pct' ? 'pct' : format === 'dollar' ? 'money' : 'ratio'
}

/** ratio_history column → display kind. */
export function historyKind(key: string): NumKind {
  if (key.endsWith('_pct')) return 'pct'
  if (key === 'total_equity') return 'money'
  return 'ratio'
}

export const HISTORY_LABELS: Record<string, string> = {
  delinquency_ratio_pct: 'Delinquency ratio',
  monthly_delinquency_ratio_pct: 'Monthly delinquency ratio',
  rolling_3month_loss_ratio_pct: 'Rolling 3-month loss ratio',
  rolling_12month_loss_ratio_pct: 'Rolling 12-month loss ratio',
  loss_ratio_pct: 'Loss ratio',
  rvl_ratio_pct: 'RVL ratio',
  interest_coverage_ratio: 'Interest coverage ratio',
  debt_equity_ratio: 'Debt / equity ratio',
  total_equity: 'Total equity',
}

/** Balance / amount / unit labels: F-PIL deals are loan facilities, MOVE Trust deals are tranches (reference TERM). */
export function terms(t: Terminology | undefined) {
  return {
    balance: t?.balance_label || 'Tranche Balance',
    amount: t?.amount_label || 'Tranche Amount',
    unit: t?.unit_label || 'Tranche',
  }
}

/** Shared "X - " prefix of deal names in one program, so deal rows can drop it (reference commonDealNamePrefix). */
export function commonDealNamePrefix(names: string[]): string {
  if (!names.length) return ''
  let prefix = names[0]
  for (const name of names.slice(1)) {
    let i = 0
    while (i < prefix.length && i < name.length && prefix[i] === name[i]) i++
    prefix = prefix.slice(0, i)
  }
  const m = prefix.match(/^(.*?)(\s*-\s*|\s+)$/)
  if (m) return m[1].trim()
  if (names.length === 1) {
    const m2 = names[0].match(/^(.*?)\s+-\s+.+$/)
    if (m2) return m2[1].trim()
  }
  return ''
}
export function shortName(name: string, prefix: string) {
  return prefix && name.startsWith(prefix) ? name.slice(prefix.length).replace(/^\s*-\s*/, '').trim() : name
}

/** WATCH re-classification at a viewer-chosen buffer (reference recomputeStatus). Display only: at the deal's own
 * published watch_buffer_pct the published status is shown unchanged. */
export function displayStatus(c: Covenant, bufferFrac: number, publishedBuffer: number): string {
  if (Math.abs(bufferFrac - publishedBuffer) < 1e-9) return c.status
  if (c.kind === 'binary' || c.threshold === null || c.threshold === undefined || c.current_value === null || c.current_value === undefined) return c.status
  if (c.kind === 'ceiling') {
    const util = c.current_value / c.threshold
    if (c.current_value > c.threshold) return 'BREACH'
    return util >= 1 - bufferFrac ? 'WATCH' : 'OK'
  }
  if (c.kind === 'floor') {
    const util = c.threshold / c.current_value
    if (c.current_value < c.threshold) return 'BREACH'
    return util >= 1 - bufferFrac ? 'WATCH' : 'OK'
  }
  return c.status
}

const RANK: Record<string, number> = { BREACH: 3, WATCH: 1, AVAILABLE: 0, OK: 0 }
/** Worst status across displayed covenants, skipping Clean-Up Provision (reference dealWorstStatus). Used only when
 * the viewer moves the watch threshold off the published value; otherwise the published worst_status is shown. */
export function worstOf(statuses: { category: string; status: string }[]) {
  let r = 0
  for (const s of statuses) if (s.category !== 'Clean-Up Provision') r = Math.max(r, RANK[s.status] ?? 0)
  return r === 3 ? 'BREACH' : r === 1 ? 'WATCH' : 'OK'
}

/** Matches a covenant to last period's entry: legal ref + description before any parenthetical (reference stableKey). */
export function stableKey(c: Pick<Covenant, 'legal_ref' | 'description'>) {
  return c.legal_ref + '::' + (c.description || '').split('(')[0].trim()
}

/** The YYYY-MM period of a published deal: the API's published_period, else the latest period_history row. */
export function dealPeriod(d: Deal): string | undefined {
  if (typeof d.published_period === 'string') return d.published_period
  const ph = d.period_history || []
  return ph.length ? ph[ph.length - 1].period : undefined
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "Jul-26" → sortable month index; unknown → NaN. */
export function monthIndex(m: string | undefined) {
  const [a, b] = String(m ?? '').split('-')
  const i = MON.indexOf(a)
  return i < 0 || !/^\d{2}$/.test(b ?? '') ? NaN : (2000 + Number(b)) * 12 + i
}

export const TREND: Record<string, { arrow: string; word: string }> = {
  rising: { arrow: '▲', word: 'Rising' },
  falling: { arrow: '▼', word: 'Falling' },
  flat: { arrow: '■', word: 'Flat' },
}

/** Vintage label of a CNL row and which key carried it. */
export function cnlVintage(r: Record<string, unknown>): string {
  if (typeof r.period === 'string') return r.period
  if (typeof r.annual_period === 'string') return r.annual_period + (typeof r.tranches_originated === 'string' ? ` (${r.tranches_originated})` : '')
  if (r.semi_annual_period !== undefined) return `Half ${r.semi_annual_period}` + (typeof r.tranches === 'string' ? ` (${r.tranches})` : '')
  return '—'
}
const firstKey = (r: Record<string, unknown>, keys: string[]) => keys.find(k => typeof r[k] === 'number')
/** Which field carries a CNL row's original balance and its cumulative net losses (deals name them differently). */
export const cnlBaseKey = (r: Record<string, unknown>) =>
  firstKey(r, ['original_finance_contract_npv', 'original_finance_contract_nbv', 'period_original_balance', 'tranche_balance_funded'])
export const cnlLossKey = (r: Record<string, unknown>) => firstKey(r, ['cumulative_net_losses', 'period_cumulative_net_losses'])
