/** Value edits (before publish) and corrections (after publish): contracts/openapi.yaml › ValueEdit, Correction.
 * Edits are stored beside the extraction, which is not rewritten, so the page lays the edits over the extracted values
 * for display. Display only: the API applies the edits and re-runs the rules. */
import { formatCurrency, formatNumber } from '@/design/components'
import { getPointer } from './provenance'
import { pointerLabel } from './corrections'
import { count, covenantValue, money, pct, ratio } from './format'
import type { Correction, Extraction, Finding, ValueEdit } from './types'

/** Edit and correction reasons: at least 10 characters (decision B6). Reverts keep the override minimum of 3. */
export const MIN_EDIT_REASON = 10
export const MIN_REVERT_REASON = 3

export type ValueKind = 'money' | 'pct' | 'ratio' | 'count'

const last = (ptr: string) => ptr.split('/').pop() ?? ''
const parent = (ptr: string) => ptr.split('/').slice(0, -1).join('/')

/** How a value is shown and typed, from its place in the deal object. Fractions (0.0179) are percentages. */
export function valueKind(deal: Record<string, unknown> | undefined, ptr: string): ValueKind {
  const key = last(ptr)
  if (/^\/financial_ratios\/\d+\/value$/.test(ptr)) {
    const f = (getPointer(deal, parent(ptr)) as Record<string, unknown> | undefined)?.format
    return f === 'pct' ? 'pct' : f === 'dollar' ? 'money' : 'ratio'
  }
  if (/^\/covenants\/\d+\/(current_value|threshold)$/.test(ptr)) {
    const t = (getPointer(deal, parent(ptr)) as Record<string, unknown> | undefined)?.threshold
    const v = typeof t === 'number' ? Math.abs(t) : Math.abs(Number(getPointer(deal, ptr)) || 0)
    return v < 1 ? 'pct' : v >= 100000 ? 'money' : 'ratio'
  }
  if (/_pct$/.test(key) || key === 'cnl_limit') return 'pct'
  if (/ratio$/.test(key)) return 'ratio'
  if (/contracts|count/.test(key) || /^\/contracts\//.test(ptr)) return 'count'
  return 'money'
}

/** The formatter the Extracted values section uses for this value. */
export function fmtFor(deal: Record<string, unknown> | undefined, ptr: string): (v: unknown) => string {
  if (/^\/covenants\/\d+\/(current_value|threshold)$/.test(ptr)) {
    const t = (getPointer(deal, parent(ptr)) as Record<string, unknown> | undefined)?.threshold
    return v => covenantValue(v, t)
  }
  const k = valueKind(deal, ptr)
  if (k === 'pct') return pct
  if (k === 'ratio') return ratio
  if (k === 'count') return count
  if (/^\/financial_ratios\//.test(ptr)) return v => (typeof v === 'number' ? formatCurrency(v, { decimals: 0 }) : money(v))
  return money
}

export const KIND_HINT: Record<ValueKind, string> = {
  money: 'Currency amount. Type it as printed; separators are optional.',
  pct: 'Percentage as printed, e.g. 1.79 for 1.79%.',
  ratio: 'Ratio as printed, e.g. 7.57.',
  count: 'Whole number as printed.',
}

/** The number a reviewer typed, in the deal object's scale (a percentage becomes a fraction). Null when it does not parse. */
export function parseValue(input: string, kind: ValueKind): number | null {
  let s = input.trim()
  if (!s) return null
  let neg = false
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1) }
  s = s.replace(/^CAD/i, '').replace(/\s*:\s*1$/, '').replace(/[x×]$/i, '').replace(/[\s,$%]/g, '').replace(/^−/, '-')
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return null
  let n = Number(s)
  if (!Number.isFinite(n)) return null
  if (neg) n = -n
  if (kind === 'count' && !Number.isInteger(n)) return null
  if (kind === 'pct') n = Number((n / 100).toPrecision(12))
  return n
}

export const sameNumber = (a: number, b: number) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b))

/** "+90.00 (0.001%)": new minus current, in the value's own format, plus the relative change. */
export function changeText(deal: Record<string, unknown> | undefined, ptr: string, current: number, next: number): string {
  const d = next - current
  const kind = valueKind(deal, ptr)
  const abs = kind === 'pct' ? `${formatNumber(Math.abs(d) * 100, 2)} pts` : fmtFor(deal, ptr)(Math.abs(d))
  const rel = current !== 0 ? ` (${formatNumber((d / Math.abs(current)) * 100, 3)}%)` : ''
  return `${d < 0 ? '−' : '+'}${abs.replace(/^[-−]/, '')}${rel}`
}

/** A value's edits in force, oldest first. `original` is the extracted value; `current` the edit now shown. */
export type EditState = { pointer: string; original: number; current: ValueEdit; chain: ValueEdit[] }

/** Edits that apply to the values shown: not reverted, and either made in review or part of a published correction. */
export function appliedEdits(edits: ValueEdit[] | undefined, corrections?: Correction[]): ValueEdit[] {
  const published = new Set((corrections ?? []).filter(c => c.status === 'published').map(c => c.id))
  return (edits ?? []).filter(e => !e.reverted_at && (!e.correction_id || published.has(e.correction_id)))
}

export function editsByPointer(ex: Extraction | undefined, edits: ValueEdit[] | undefined, corrections?: Correction[]): Map<string, EditState> {
  const out = new Map<string, EditState>()
  const list = [...appliedEdits(edits, corrections)].sort((a, b) => a.at.localeCompare(b.at))
  for (const e of list) {
    const s = out.get(e.pointer)
    if (s) { s.chain.push(e); s.current = e }
    else {
      const x = ex ? getPointer(ex.deal, e.pointer) : undefined
      out.set(e.pointer, { pointer: e.pointer, original: typeof x === 'number' ? x : e.old_value, current: e, chain: [e] })
    }
  }
  return out
}

/** Edits made in review that publishing will write (not reverted, not part of a correction), oldest first. */
export const reviewEdits = (edits: ValueEdit[] | undefined) =>
  (edits ?? []).filter(e => !e.reverted_at && !e.correction_id).sort((a, b) => a.at.localeCompare(b.at))

/** The value shown for a pointer: the edit in force, else the extraction. */
export function shownValue(ex: Extraction | undefined, states: Map<string, EditState>, ptr: string): unknown {
  const s = states.get(ptr)
  return s ? s.current.new_value : ex ? getPointer(ex.deal, ptr) : undefined
}

const touches = (field: string, ptr: string) => field === ptr || ptr.startsWith(field + '/') || field.startsWith(ptr + '/')

/** Rule ids whose findings on this upload name the value in `fields` or `targets`. Only what the findings say; a
 * rule that passed leaves no finding, so the list can be short. */
export function rulesReading(findings: Finding[] | undefined, ptr: string): string[] {
  const ids = new Set<string>()
  for (const f of findings ?? []) {
    if ([...(f.fields ?? []), ...(f.targets ?? [])].some(x => x.startsWith('/') && touches(x, ptr))) ids.add(f.rule_id)
  }
  return [...ids].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
}

/** Every number the extraction read from a page, for the correction value picker: pointer, label and page. */
export type Candidate = { pointer: string; label: string; page: number | null }
export function numericCandidates(ex: Extraction | undefined): Candidate[] {
  if (!ex) return []
  const out: Candidate[] = []
  for (const [ptr, src] of Object.entries(ex.sources ?? {})) {
    if (typeof getPointer(ex.deal, ptr) !== 'number') continue
    out.push({ pointer: ptr, label: pointerLabel(ex.deal, ptr), page: typeof src?.page === 'number' ? src.page : null })
  }
  return out.sort((a, b) => (a.page ?? 999) - (b.page ?? 999) || a.label.localeCompare(b.label))
}

export function searchCandidates(list: Candidate[], q: string, max = 12): Candidate[] {
  const t = q.trim().toLowerCase()
  if (!t) return []
  const page = /^(?:p\.?|page)\s*(\d+)$/.exec(t)
  return list.filter(c => (page ? c.page === Number(page[1]) : c.label.toLowerCase().includes(t))).slice(0, max)
}

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

/** Blocks / reviews / notes open, as words: "2 block findings", "no block findings". */
export function blockText(n: number | undefined) {
  const k = n ?? 0
  return k === 0 ? 'no block findings' : plural(k, 'block finding')
}

/** Label for a pointer in tables and dialogs. */
export const labelFor = (ex: Extraction | undefined, ptr: string) => pointerLabel(ex?.deal, ptr)
