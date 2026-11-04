/** What approve will write for resolved use_ours / use_report findings (contracts/openapi.yaml › OverrideRequest):
 * the chosen value goes to every pointer in the finding's `targets`; a pointer that already holds it is left alone.
 * This previews the API's write for the reviewer; the API does the write and re-runs the rules. */
import { formatPeriod } from '@/design/components'
import { getPointer } from './provenance'
import type { Extraction, Finding, OverrideChoice } from './types'

export const VALUE_CHOICES: readonly OverrideChoice[] = ['use_ours', 'use_report']
export const isValueChoice = (c: unknown): c is OverrideChoice => VALUE_CHOICES.includes(c as OverrideChoice)
export const hasTargets = (f: Finding) => Array.isArray(f.targets) && f.targets.length > 0

const SECTION: Record<string, string> = {
  tranche_balance: 'Tranche balance', tranche_amount: 'Tranche amount', period_history: 'Roll-forward', aging_history: 'Aging',
  contracts: 'Contracts', program: 'Facility', warehouse: 'Warehouse', total_enhancement: 'Enhancement', cnl_by_period: 'CNL',
  covenants: 'Covenant', ratio_history: 'Ratio history', financial_ratios: 'Financial ratio', covenant_summary: 'Covenant summary',
}
const words = (t: string) => t.replace(/_pct$/, ' %').replace(/_/g, ' ')

/** "/period_history/3/closing_balance" → "Roll-forward Aug 2026 · closing balance"; "/tranche_balance/closing" →
 * "Tranche balance · closing". Array rows are named by their period, month, legal ref, label or tranche. */
export function pointerLabel(deal: Record<string, unknown> | undefined, ptr: string): string {
  const toks = ptr.split('/').slice(1).map(t => t.replace(/~1/g, '/').replace(/~0/g, '~'))
  if (toks.length === 0) return ptr
  const parts: string[] = []
  let head = SECTION[toks[0]] ?? words(toks[0])
  let path = '/' + toks[0]
  const rest: string[] = []
  for (const t of toks.slice(1)) {
    path += '/' + t
    if (/^\d+$/.test(t)) {
      const row = deal ? (getPointer(deal, path) as Record<string, unknown> | undefined) : undefined
      const name = row && typeof row === 'object'
        ? (typeof row.period === 'string' ? formatPeriod(row.period) : row.month ?? row.legal_ref ?? row.label ?? (row.tranche != null ? `tranche ${row.tranche}` : undefined))
        : undefined
      head += ' ' + (name != null ? String(name) : `row ${Number(t) + 1}`)
    } else rest.push(words(t))
  }
  parts.push(head)
  if (rest.length) parts.push(rest.join(' › '))
  return parts.join(' · ')
}

export type PlannedWrite = { finding: Finding; choice: OverrideChoice; pointer: string; label: string; old: unknown; value: unknown; changed: boolean }

/** Every pointer a value choice writes, with the value the extraction holds now. */
export function writesFor(ex: Extraction | undefined, f: Finding, choice: OverrideChoice): PlannedWrite[] {
  if (!isValueChoice(choice) || !hasTargets(f)) return []
  const value = choice === 'use_ours' ? f.our_value : f.report_value
  return f.targets!.map(pointer => {
    const old = ex ? getPointer(ex.deal, pointer) : undefined
    return { finding: f, choice, pointer, label: pointerLabel(ex?.deal, pointer), old, value, changed: old !== value }
  })
}

/** The writes approve will make for the resolved findings, in finding order. */
export function plannedCorrections(ex: Extraction | undefined, findings: Finding[]): PlannedWrite[] {
  return findings.flatMap(f => {
    const choice = f.resolution?.choice
    return f.status === 'overridden' && isValueChoice(choice) ? writesFor(ex, f, choice) : []
  })
}

export function listLabels(labels: string[], max = 3): string {
  if (labels.length <= max) return labels.join(', ')
  return `${labels.slice(0, max).join(', ')} and ${labels.length - max} more`
}

/** Rules whose target is the closing balance, where a misread component means the report's closing is right. */
export const CLOSING_RULES = new Set(['R05', 'R07'])
