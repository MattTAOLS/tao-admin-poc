/** Pure helpers for the master-data pages (partners, programs, deals, covenant definitions). */
import { formatCurrency, formatNumber, formatPercent } from '@/design/components'
import { programPartners, type CovenantDefinition, type Partner, type Program, type ThresholdUnit } from './data'

/** Fallback display name when a slug is not in /master/partners ("investor" → "Investor"). */
export const partnerName = (slug: string) => slug.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
export const partnerLabel = (partners: Partner[], slug: string) => partners.find(p => p.slug === slug)?.name ?? partnerName(slug)

export type PartnerRow = { slug: string; name: string; kind: string; status: string; programs: Program[]; dealCount: number }
/** One row per partner from /master/partners (partners without programs included); a program counts for every
 * partner in its partner_slugs. */
export function partnerRows(partners: Partner[], programs: Program[], dealCountByProgram: Record<string, number>): PartnerRow[] {
  return partners.map(pt => {
    const ps = programs.filter(p => programPartners(p).includes(pt.slug))
    return { slug: pt.slug, name: pt.name, kind: pt.kind, status: pt.status, programs: ps,
      dealCount: ps.reduce((n, p) => n + (dealCountByProgram[p.slug] ?? 0), 0) }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

/** Sum of limits per currency, e.g. "$2,066,709,163 CAD". */
export function limitsByCurrency(programs: Program[]) {
  const by = new Map<string, number>()
  for (const p of programs) by.set(p.currency, (by.get(p.currency) ?? 0) + (p.limit ?? 0))
  return [...by.entries()].map(([cur, v]) => `${formatCurrency(v, { decimals: 0 })} ${cur}`).join(' · ')
}

/** Display of a threshold number by its unit. With no unit (older definitions) the page guesses: below 1 is a
 * percentage, 1 000 or more is currency, anything else a ratio (1.10×). */
export function formatThreshold(v: number | null | undefined, unit?: ThresholdUnit | null) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const u = unit ?? (Math.abs(v) < 1 ? 'fraction' : Math.abs(v) >= 1000 ? 'currency' : 'ratio')
  if (u === 'fraction') return formatPercent(v)
  if (u === 'currency') return formatCurrency(v, { decimals: 0 })
  return formatNumber(v, 2) + '×'
}

/** "≤ 6.00% if ≤ $10,000,000; ≤ 4.00% if > $10,000,000". Band thresholds use the covenant's unit; band bounds are
 * values of the measured field (the `on` pointer), which has no unit in the contract, so they keep the guess. */
export function thresholdText(c: CovenantDefinition): string {
  const op = c.kind === 'floor' ? '≥' : '≤'
  if (c.threshold_rule && c.threshold_rule.bands?.length) {
    return c.threshold_rule.bands.map(b => {
      const cond = b.lte !== undefined && b.lte !== null ? `if ≤ ${formatThreshold(b.lte)}` : b.gt !== undefined && b.gt !== null ? `if > ${formatThreshold(b.gt)}` : 'otherwise'
      return `${op} ${formatThreshold(b.threshold, c.unit)} ${cond}`
    }).join('; ')
  }
  return `${op} ${formatThreshold(c.threshold, c.unit)}`
}

export type VersionState = 'in_force' | 'superseded' | 'scheduled'
/** For each (deal, legal_ref): the latest effective_from on or before `today` is in force; earlier ones are
 * superseded; later ones are scheduled (an amendment not yet effective). */
export function versionStates(defs: CovenantDefinition[], today: string): Map<CovenantDefinition, VersionState> {
  const out = new Map<CovenantDefinition, VersionState>()
  const groups = new Map<string, CovenantDefinition[]>()
  for (const d of defs) { const k = d.deal_slug + '|' + d.legal_ref; groups.set(k, [...(groups.get(k) ?? []), d]) }
  for (const g of groups.values()) {
    const past = g.filter(d => d.effective_from <= today).sort((a, b) => b.effective_from.localeCompare(a.effective_from))
    for (const d of g) out.set(d, d.effective_from > today ? 'scheduled' : d === past[0] ? 'in_force' : 'superseded')
  }
  return out
}

/** "1,000,000" or "0.035" → number; blank → undefined; anything else → NaN. */
export function parseNumber(s: string): number | undefined {
  const t = s.trim().replace(/,/g, '')
  if (t === '') return undefined
  return /^-?\d*\.?\d+(e-?\d+)?$/i.test(t) ? Number(t) : NaN
}
