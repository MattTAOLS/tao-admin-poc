import { formatCurrency, formatNumber, formatPercent, formatSigned } from '@/design/components'
import type { NumKind } from './fmt'

/** Formats a published number for display. Money to the dollar, percentages to 0.01 pp, ratios to 2 dp. */
export function fmtNum(v: number | null | undefined, kind: NumKind): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  switch (kind) {
    case 'money': return formatCurrency(v, { decimals: 0 })
    case 'pct': return formatPercent(v)
    case 'count': return formatNumber(v)
    case 'ratio': return formatNumber(v, 2) + 'x'
    case 'signed-count': return formatSigned(v, 0)
    case 'signed-money': {
      const s = formatSigned(v, 0)
      return s[0] === '+' || s[0] === '−' ? s[0] + '$' + s.slice(1) : '$' + s
    }
  }
}

/** One published number on screen. `field` is its path in the published object (e.g. "tranche_balance.closing"):
 * the reference-data test reads every [data-field] back and compares it with the file. */
export function Num({ v, kind, field, className }: { v: number | null | undefined; kind: NumKind; field?: string; className?: string }) {
  return <span className={['pf-num', className].filter(Boolean).join(' ')} data-field={field} data-kind={kind}>{fmtNum(v, kind)}</span>
}

/** Parses text produced by fmtNum back to a number (tests). */
export function parseNum(text: string, kind: NumKind): number | null {
  const t = text.trim()
  if (t === '—') return null
  const n = Number(t.replace(/−/g, '-').replace(/[$,%x+\s]/g, ''))
  return kind === 'pct' ? n / 100 : n
}
