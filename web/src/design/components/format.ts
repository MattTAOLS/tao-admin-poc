/** Display formatting for numbers. Pages pass raw numbers from the API and format here so every screen agrees.
 * Rounding is display-only; never feed a formatted value back into a calculation. */

const cache = new Map<string, Intl.NumberFormat>()
function nf(key: string, opts: Intl.NumberFormatOptions) {
  let f = cache.get(key)
  if (!f) { f = new Intl.NumberFormat('en-US', opts); cache.set(key, f) }
  return f
}
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const DASH = '—'

/** 1234567.891 → "$1,234,567.89"; `compact` → "$1.23M"; `decimals: 0` → "$1,234,568"; `symbol: false` drops "$". Null → "—". */
export function formatCurrency(v: number | null | undefined, opts: { decimals?: number; compact?: boolean; symbol?: boolean } = {}) {
  if (!isNum(v)) return DASH
  const { decimals = 2, compact = false, symbol = true } = opts
  const style: Intl.NumberFormatOptions = symbol ? { style: 'currency', currency: 'USD' } : {}
  if (compact) return nf(`cc${symbol}`, { ...style, notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(v)
  return nf(`c${decimals}${symbol}`, { ...style, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v)
}

/** Percent from a ratio or from points. formatPercent(0.0412) → "4.12%"; formatPercent(4.12, { points: true }) → "4.12%". */
export function formatPercent(v: number | null | undefined, opts: { decimals?: number; points?: boolean } = {}) {
  if (!isNum(v)) return DASH
  const { decimals = 2, points = false } = opts
  return nf(`n${decimals}`, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(points ? v : v * 100) + '%'
}

/** Plain number with grouping: 1234 → "1,234". */
export function formatNumber(v: number | null | undefined, decimals = 0) {
  if (!isNum(v)) return DASH
  return nf(`n${decimals}`, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v)
}

/** Signed difference: 12.5 → "+12.50", -3 → "−3.00" (a true minus sign so columns align), 0 → "0.00". */
export function formatSigned(v: number | null | undefined, decimals = 2) {
  if (!isNum(v)) return DASH
  const s = nf(`n${decimals}`, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Math.abs(v))
  if (Number(s.replace(/,/g, '')) === 0) return s
  return v > 0 ? '+' + s : '−' + s
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "2026-08" → "Aug 2026". Anything else is returned unchanged. */
export function formatPeriod(p: string | null | undefined) {
  if (!p) return DASH
  const m = /^(\d{4})-(\d{2})$/.exec(p)
  if (!m) return p
  const i = Number(m[2]) - 1
  return i >= 0 && i < 12 ? `${MONTHS[i]} ${m[1]}` : p
}

/** finding.schema.json `unit`. */
export type ValueUnit = 'currency' | 'percent_points' | 'count' | 'ratio' | 'months' | 'text' | null | undefined
/** Formats a finding value by its unit. Booleans read Yes / No, strings pass through. */
export function formatByUnit(v: number | string | boolean | null | undefined, unit: ValueUnit) {
  if (v === null || v === undefined) return DASH
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'string') return v
  switch (unit) {
    case 'currency': return formatCurrency(v)
    case 'percent_points': return formatPercent(v, { points: true })
    case 'count': return formatNumber(v)
    case 'ratio': return formatNumber(v, 4)
    case 'months': return formatNumber(v, Number.isInteger(v) ? 0 : 1) + ' mo'
    default: return String(v)
  }
}

/** Signed difference by unit: currency → "+$12.50", percent_points → "+0.25 pp". */
export function formatDiffByUnit(v: number | null | undefined, unit: ValueUnit) {
  if (!isNum(v)) return DASH
  switch (unit) {
    case 'currency': { const s = formatSigned(v, 2); return s[0] === '+' || s[0] === '−' ? s[0] + '$' + s.slice(1) : '$' + s }
    case 'percent_points': return formatSigned(v, 2) + ' pp'
    case 'count': return formatSigned(v, 0)
    case 'ratio': return formatSigned(v, 4)
    case 'months': return formatSigned(v, Number.isInteger(v) ? 0 : 1) + ' mo'
    default: return formatSigned(v)
  }
}
