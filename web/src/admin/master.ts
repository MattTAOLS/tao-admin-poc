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

// ---- Covenant changes and version history (wave B, D2) ----

/** Current rows only: the ones no correction or seed run replaced. */
export const isCurrent = (c: CovenantDefinition) => !c.superseded_at
export const covenantKey = (c: Pick<CovenantDefinition, 'deal_slug' | 'legal_ref'>) => c.deal_slug + '|' + c.legal_ref

const ROLE_NAME: Record<string, string> = { tao_admin: 'TAO Admin', tao_analyst: 'TAO Analyst', system: 'System', seed: 'System' }
export const changedByLabel = (by?: string | null) => (by ? ROLE_NAME[by] ?? by : 'System')

const DAY = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
const day = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : DAY.format(d) }

export type HistoryKind = 'seed' | 'add' | 'new_version' | 'correct'
export const HISTORY_KIND: Record<HistoryKind, string> = { seed: 'Created', add: 'Added', new_version: 'New version', correct: 'Correction' }
export type FieldChange = { field: string; before: string; after: string }
export type HistoryEntry = {
  row: CovenantDefinition
  kind: HistoryKind
  /** When the row was written: changed_at, or for a correction the superseded row's superseded_at. */
  at?: string | null
  who: string
  /** Field changes against the row it corrected (correct) or the version before it (new_version). */
  changes: FieldChange[]
  /** For created / added rows: what was created, e.g. "Ceiling, ≤ 10.00×, ratio, watch buffer 10%". */
  created?: string
  reason: string
  /** Set when a later correction or seed run replaced this row. */
  replacedAt?: string | null
}

const KIND_WORD = { ceiling: 'Ceiling', floor: 'Floor' } as const
const UNIT_WORD: Record<string, string> = { fraction: 'fraction', ratio: 'ratio', currency: 'currency' }
const bufferText = (c: CovenantDefinition) => formatPercent(c.watch_buffer_pct ?? null, { decimals: 0 })
/** The comparable fields of a definition, as the page shows them. */
function fields(c: CovenantDefinition): [string, string][] {
  return [
    ['Direction', KIND_WORD[c.kind] ?? c.kind],
    ['Threshold', thresholdText(c)],
    ['Unit', c.unit ? UNIT_WORD[c.unit] ?? c.unit : 'not set'],
    ['Watch buffer', bufferText(c)],
    ['Description', c.description],
    ['Source', c.source ?? '—'],
  ]
}
export function fieldChanges(before: CovenantDefinition, after: CovenantDefinition): FieldChange[] {
  const a = new Map(fields(after))
  return fields(before).filter(([k, v]) => a.get(k) !== v).map(([k, v]) => ({ field: k, before: v, after: a.get(k)! }))
}
export const createdText = (c: CovenantDefinition) =>
  [KIND_WORD[c.kind] ?? c.kind, thresholdText(c), c.unit ? UNIT_WORD[c.unit] ?? c.unit : null, `watch buffer ${bufferText(c)}`].filter(Boolean).join(', ')

/** Every change to one covenant (all rows of one deal + legal ref, superseded ones included), newest first.
 * A row with supersedes_id is a correction of that row; a ui row with an earlier version is a new version; a ui row
 * without one was added; a seed row was created by the seed load. */
export function covenantHistory(rows: CovenantDefinition[]): HistoryEntry[] {
  const byId = new Map(rows.filter(r => r.id).map(r => [r.id!, r]))
  const corrected = new Set(rows.map(r => r.supersedes_id).filter(Boolean))
  const out = rows.map((r): HistoryEntry => {
    const prev = r.supersedes_id ? byId.get(r.supersedes_id) : undefined
    const seed = r.origin === 'seed' || (r.origin === undefined && !r.changed_by && !r.supersedes_id)
    const replacedAt = r.superseded_at && !corrected.has(r.id) ? r.superseded_at : null
    const base = { row: r, who: seed ? 'System' : changedByLabel(r.changed_by), replacedAt }
    if (r.supersedes_id) {
      return { ...base, kind: 'correct', at: r.changed_at ?? prev?.superseded_at, changes: prev ? fieldChanges(prev, r) : [], reason: r.change_reason ?? '—' }
    }
    if (seed) return { ...base, kind: 'seed', at: r.changed_at, changes: [], created: createdText(r), reason: r.change_reason ?? 'Loaded from seed/covenant_definitions.json' }
    // The version this one followed: the latest earlier effective date, a current row before a replaced one.
    const earlier = rows.filter(x => x !== r && x.effective_from < r.effective_from)
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from) || Number(!!a.superseded_at) - Number(!!b.superseded_at))[0]
    return earlier
      ? { ...base, kind: 'new_version', at: r.changed_at, changes: fieldChanges(earlier, r), reason: r.change_reason ?? '—' }
      : { ...base, kind: 'add', at: r.changed_at, changes: [], created: createdText(r), reason: r.change_reason ?? '—' }
  })
  // Newest first: timed entries by time, then untimed ui changes by effective date, seed loads last.
  const rank = (e: HistoryEntry) => (e.kind === 'seed' ? 0 : 1)
  return out.sort((a, b) => rank(b) - rank(a) || (b.at ?? '').localeCompare(a.at ?? '') || b.row.effective_from.localeCompare(a.row.effective_from))
}

/** The Last change cell: "Seed load", or "Nov 5, 2026 · TAO Admin" (the date only when the API gives it). */
export function lastChangeText(c: CovenantDefinition, all: CovenantDefinition[]): string {
  const seed = c.origin === 'seed' || (c.origin === undefined && !c.changed_by && !c.supersedes_id)
  if (seed) return 'Seed load'
  const at = c.changed_at ?? (c.supersedes_id ? all.find(x => x.id === c.supersedes_id)?.superseded_at : undefined)
  return [at ? day(at) : null, changedByLabel(c.changed_by)].filter(Boolean).join(' · ')
}

/** The first collection period (YYYY-MM) a version applies to. R14 picks the version in force on the last day of the
 * collection period, and every month's last day falls on or after any date in that month, so it is the date's month. */
export function firstPeriodFrom(effective: string): string {
  return effective.slice(0, 7)
}
