/** Story data, read from the real reference objects (never invented): the shared dashboard JSON in
 * docs/dashboard-json and the R05 finding fixture the Rules agent keeps in rules/tests/fixtures. Loaded as raw text
 * so the TypeScript build needs no JSON module support. */
import programMoveRaw from '../../../../docs/dashboard-json/program-move-trust.dashboard.json?raw'
import programFpilRaw from '../../../../docs/dashboard-json/program-f-pil-2-0.dashboard.json?raw'
import r05Raw from '../../../../rules/tests/fixtures/findings/r05-example.json?raw'
import type { FindingView } from '../components'

export type Covenant = {
  category: string; legal_ref: string; description: string; current_value: number | null; threshold: number | null
  kind: 'ceiling' | 'floor'; utilization_pct: number | null; trend: string | null; status: string; note: string | null
}
export type DealDash = {
  deal_slug: string; deal_name: string; collection_period: string; settlement_date: string; source_file: string; worst_status: string
  tranche_balance: { opening: number; closing: number; change_abs: number; change_pct: number }
  covenants: Covenant[]
}
export type ProgramDash = {
  period: string; deal_count: number
  portfolio_totals: Record<string, number | null | unknown[]>
  covenant_totals: { BREACH: number; WATCH: number; OK: number; AVAILABLE: number }
  deals_with_escalations: string[]
  deals: DealDash[]
}

export const programMove = JSON.parse(programMoveRaw) as ProgramDash
export const programFpil = JSON.parse(programFpilRaw) as ProgramDash
/** Real R05 finding: F-PIL 2.0 Moneda, Aug 2026, with the seeded $1,000 roll-forward error. */
export const r05Finding = JSON.parse(r05Raw) as FindingView
export const num = (v: unknown) => (typeof v === 'number' ? v : null)
