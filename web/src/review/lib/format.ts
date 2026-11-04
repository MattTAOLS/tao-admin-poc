/** Display helpers local to the review pages. Formatting only: nothing here recomputes a value. */
import { formatCurrency, formatNumber, formatPercent } from '@/design/components'

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** ISO 8601 date-times inside rule-engine text, e.g. "2026-11-04T01:33:28.285866+00:00" in R12's message. */
const ISO_DATETIME = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g

/** A finding message for display: every ISO date-time in it is shown like the rest of the review pages
 * (formatDateTime). The words and numbers are the rule engine's; only the timestamp's format changes. */
export function formatMessage(message: string | null | undefined) {
  if (!message) return message ?? ''
  return message.replace(ISO_DATETIME, m => formatDateTime(m))
}

export const money =(v: unknown) => (typeof v === 'number' ? formatCurrency(v) : v == null ? '—' : String(v))
/** Fractions as stored in the deal object: 0.0179 → 1.79%. */
export const pct = (v: unknown) => (typeof v === 'number' ? formatPercent(v) : v == null ? '—' : String(v))
export const count = (v: unknown) => (typeof v === 'number' ? formatNumber(v) : v == null ? '—' : String(v))
export const ratio = (v: unknown) => (typeof v === 'number' ? formatNumber(v, 2) : v == null ? '—' : String(v))
export const yesNo = (v: unknown) => (v === true ? 'Yes' : v === false ? 'No' : v == null ? '—' : String(v))
export const text = (v: unknown) => (v == null || v === '' ? '—' : String(v))

/** financial_ratios[].format: pct | ratio | dollar. */
export function byFormat(v: unknown, format: unknown) {
  if (format === 'pct') return pct(v)
  if (format === 'dollar') return typeof v === 'number' ? formatCurrency(v, { decimals: 0 }) : text(v)
  return ratio(v)
}

/** A covenant's value and threshold share a scale that the deal object does not name: fractions below 1 are
 * percentages (0.035), multiples are ratios (1.10, 10.0), large amounts are dollars (2,500,000). Display only. */
export function covenantValue(v: unknown, threshold: unknown) {
  if (typeof v !== 'number') return text(v)
  const t = typeof threshold === 'number' ? Math.abs(threshold) : Math.abs(v)
  if (t < 1) return pct(v)
  if (t >= 100000) return formatCurrency(v, { decimals: 0 })
  return ratio(v)
}
