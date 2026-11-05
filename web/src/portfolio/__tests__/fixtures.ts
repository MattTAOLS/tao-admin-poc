/// <reference types="node" />
/** The 14 reference objects in docs/dashboard-json, and API-shaped responses built from them the way the real API
 * returns them (api/app/main.py: published_portfolio / published_program / published_deal). */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Deal, Portfolio, ProgramAggregate } from '../types'

const dir = resolve(__dirname, '../../../../docs/dashboard-json')
const read = (f: string) => JSON.parse(readFileSync(resolve(dir, f), 'utf8'))

export const DEAL_FILES = readdirSync(dir).filter(f => f.endsWith('.dashboard.json') && !f.startsWith('program-')).sort()
export const deals: Record<string, Deal> = Object.fromEntries(DEAL_FILES.map(f => { const d = read(f) as Deal; return [d.deal_slug, d] }))
export const programs: Record<string, ProgramAggregate> = {
  'f-pil-2-0': read('program-f-pil-2-0.dashboard.json'),
  'move-trust': read('program-move-trust.dashboard.json'),
}
const NAMES: Record<string, string> = { 'f-pil-2-0': 'F-PIL 2.0', 'move-trust': 'MOVE Trust' }
// Matt's decision (wave 3): both partners see both programs (program_partner; Program.partner_slugs).
const OWNER: Record<string, string[]> = { 'f-pil-2-0': ['investor', 'manager'], 'move-trust': ['investor', 'manager'] }

export function apiProgram(slug: string): ProgramAggregate {
  const p = programs[slug]
  return { program: { slug, name: NAMES[slug], partner_slugs: OWNER[slug] }, available_periods: [p.period], ...p }
}
export function apiPortfolio(partner: string | null): Portfolio {
  const slugs = Object.keys(programs).filter(s => partner === null || OWNER[s].includes(partner)).sort()
  return {
    partner,
    programs: slugs.map(s => {
      const { deals: ds, ...rest } = apiProgram(s)
      return { ...rest, deals: ds.map(d => ({ deal_slug: d.deal_slug, deal_name: d.deal_name, collection_period: d.collection_period, worst_status: d.worst_status, covenant_summary: d.covenant_summary, closing_tranche_balance: d.tranche_balance.closing })) }
    }),
  }
}
export function apiDeal(slug: string): Deal {
  const d = deals[slug]
  const period = d.period_history[d.period_history.length - 1].period
  return { ...d, published_at: '2026-11-03T12:00:00Z', published_by: 'tao_admin', upload_id: '11111111-2222-3333-4444-555555555555', published_period: period, available_periods: [period] }
}
export const programOf = (dealSlug: string) => dealSlug.startsWith('f-pil-2-0') ? 'f-pil-2-0' : 'move-trust'
export const OWNERS = OWNER

/** Resolves "a.0.b" in an object. */
export function at(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj)
}

/** Wave B (decision B2): a deal month corrected after publication. The real Dynamic Capital July 2026 object with one
 * deliberate change: version 2 is a TAO manual correction of tranche_balance.recoveries (0 → 18,450), appended to
 * data_corrections with choice `manual` next to the reference row that is already there. Version 1 is the reference
 * object as published. Both carry the same versions list, as the API returns it for either version. */
export const CORRECTED = 'move-trust-dynamic-capital'
export const MANUAL_REASON = 'Recoveries on the July report were left at zero; the servicer confirmed 18,450.00 received.'
export const VERSIONS = [
  { version: 1, published_at: '2026-10-09T14:00:00Z', published_by: 'tao_admin', correction_id: null, reason: null, current: false },
  { version: 2, published_at: '2026-11-04T15:30:00Z', published_by: 'tao_admin', correction_id: 'cccccccc-0000-0000-0000-000000000002', reason: MANUAL_REASON, current: true },
]
export function apiCorrectedDeal(version?: number): Deal {
  const base = apiDeal(CORRECTED)
  if (version === 1) return { ...base, version: 1, versions: VERSIONS }
  const manual = {
    period: base.published_period as string, record: 'tranche_balance', field: 'recoveries', old_value: 0, new_value: 18450,
    applied: '2026-11-04', reason: MANUAL_REASON, choice: 'manual', at: '2026-11-04T15:30:00Z', actor_role: 'tao_admin',
    actor_label: 'tao_admin', edit_id: 'eeeeeeee-0000-0000-0000-000000000001', correction_id: VERSIONS[1].correction_id, version: 2,
  }
  return {
    ...base, version: 2, versions: VERSIONS, published_at: VERSIONS[1].published_at,
    tranche_balance: { ...base.tranche_balance, recoveries: 18450 },
    data_corrections: [...(base.data_corrections ?? []), manual],
  }
}
