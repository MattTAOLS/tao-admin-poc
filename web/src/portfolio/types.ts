/** Shapes of the /published/* responses. The contract types them as plain objects; these mirror
 * docs/dashboard-json/SCHEMA.md (deal and program objects) and the PublishedPortfolio shape the API returns
 * (docs/requests.md, Data & API). Every field is optional because the published object is the source of truth
 * and some deals do not carry some paths. Extra fields are tolerated. */

export type CovStatus = 'OK' | 'WATCH' | 'BREACH' | 'AVAILABLE' | string

export type Covenant = {
  category: string
  legal_ref: string
  description: string
  current_value: number | null
  threshold: number | null
  kind: 'ceiling' | 'floor' | 'binary' | string
  utilization_pct: number | null
  trend: string
  status: CovStatus
  note: string | null
  worst_vintage?: string
}

export type FinancialRatio = { key: string; label: string; format: 'pct' | 'ratio' | 'dollar' | string; group: string; value: number; vintage?: string }

export type CnlRow = {
  period?: string; annual_period?: string; semi_annual_period?: number; tranches?: string; tranches_originated?: string
  advance_range?: string | null
  original_finance_contract_npv?: number; original_finance_contract_nbv?: number; period_original_balance?: number; tranche_balance_funded?: number
  cumulative_net_losses?: number; period_cumulative_net_losses?: number
  gross_losses?: number
  cnl_ratio_pct: number
  cnl_limit: number | null
  cnl_within_limit: boolean | null
  [k: string]: unknown
}

export type AgingRow = {
  period: string; collection_period: string
  current_0_30: number; days_31_60: number; days_61_90: number
  written_off: number; written_off_bucket_label: string
  cumulative_net_losses: number; closing_balance: number
  reconciles: boolean
}

export type PeriodRow = {
  period: string; collection_period: string
  opening_balance: number; closing_balance: number
  principal: number; principal_prepayments: number; losses: number; interest: number; recoveries: number
  charge_off?: number | null
  opening_contracts: number; closing_contracts: number
}

export type RatioHistoryRow = { month?: string; [k: string]: number | string | undefined }

export type DataCorrection = {
  period: string; record: string; field: string
  old_value: number | string | boolean | null; new_value: number | string | boolean | null
  applied?: string | boolean; reason?: string | null; rule_id?: string; choice?: 'use_ours' | 'use_report' | 'manual' | string; finding_id?: string
  /** Manual edits (choice `manual`, contracts/openapi.yaml ValueEdit): when, by whom, and the version they belong to. */
  at?: string; actor_role?: string; actor_label?: string | null; edit_id?: string; correction_id?: string | null; version?: number
}

/** contracts/openapi.yaml PublicationVersion: one publication of a deal month (1 = original, 2+ = corrections). */
export type PublicationVersion = {
  version: number; published_at: string; published_by: string
  correction_id?: string | null; reason?: string | null; current?: boolean
}

/** One row of top10_obligors (SCHEMA.md). Finloc also carries the CAD / USD split of the contract amount. */
export type Obligor = {
  rank: number; obligor_name: string
  aggregate_contract_amount?: number | null; aggregate_cad_contract_amount?: number | null; aggregate_usd_contract_amount?: number | null
  obligor_concentration_pct?: number | null; concentration_limit_pct?: number | null; concentration_limit_desc?: string | null
  concentration_limit_per_obligor?: number | null; excess_concentration_amount?: number | null
}

export type Terminology = { balance_label?: string; amount_label?: string; unit_label?: string } | null

export type Deal = {
  deal_slug: string
  deal_name: string
  collection_period: string
  settlement_date?: string
  prior_period?: string
  source_file?: string
  terminology?: Terminology
  tranche_balance: {
    opening: number; closing: number; change_abs: number; change_pct: number
    principal: number; principal_prepayments: number; losses: number; interest: number; recoveries: number
    charge_off?: number | null
  }
  tranche_amount?: { opening: number; closing: number }
  contracts: { opening: number; closing: number; change_abs: number; change_pct: number | null }
  program?: { program_limit: number; program_amount: number; unused_facility: number | null; program_utilization_pct: number; maximum_program_limit: number | null }
  warehouse?: { opening_advances_outstanding: number | null; closing_advances_outstanding: number | null; maximum_warehouse_facility_limit: number | null } | null
  total_enhancement?: { total_enhancement_amount: number; total_enhancement_pct: number }
  covenant_summary: Record<'OK' | 'WATCH' | 'BREACH' | 'AVAILABLE', number>
  covenants: Covenant[]
  prior_covenants?: Covenant[]
  watch_buffer_pct: number
  worst_status: CovStatus
  financial_ratios: FinancialRatio[]
  ratio_history: RatioHistoryRow[]
  cnl_by_period: CnlRow[]
  aging_history: AgingRow[]
  period_history: PeriodRow[]
  data_corrections?: DataCorrection[]
  top10_obligors?: Obligor[]
  source_pages?: Record<string, number | null>
  // Publication metadata and extras the API adds (not in the contract yet; see docs/requests.md, UI-Partner).
  published_at?: string
  published_by?: string
  upload_id?: string
  published_period?: string
  available_periods?: string[]
  /** The publication version shown and every version of this month (PublishedDeal, wave B). */
  version?: number
  versions?: PublicationVersion[]
  [k: string]: unknown
}

export type PortfolioTotals = {
  opening_tranche_balance: number | null; closing_tranche_balance: number | null
  opening_contracts: number | null; closing_contracts: number | null
  total_program_limit: number | null; total_program_amount: number | null
  program_utilization_pct: number | null
  tranche_balance_change_abs: number | null; tranche_balance_change_pct: number | null
  contracts_change_abs: number | null; contracts_change_pct: number | null
  total_warehouse_closing_advances: number | null; total_warehouse_opening_advances?: number | null
  warehouse_advances_change_abs?: number | null
  deals_with_warehouse?: string[]
  [k: string]: unknown
}

export type ProgramMaster = { slug: string; name: string; partner_slug?: string; partner_slugs?: string[]; currency?: string; limit?: number | null; warehouse_limit?: number | null }

type ProgramAggregateBase = {
  period: string
  deal_count: number
  portfolio_totals: PortfolioTotals
  covenant_totals: Record<'OK' | 'WATCH' | 'BREACH' | 'AVAILABLE', number>
  deals_with_escalations: string[]
  terminology?: Terminology
  /** Extras from the API (master record, published periods). */
  program?: ProgramMaster
  available_periods?: string[]
  /** Deals whose newest publication is earlier than `period`; the aggregate uses their latest publication at or
   * before it (contracts/openapi.yaml PublishedProgram.deals_behind). Absent or empty: every deal is current. */
  deals_behind?: DealBehind[]
}

export type DealBehind = { deal_slug: string; deal_name?: string; as_of: string }

export type ProgramAggregate = ProgramAggregateBase & { deals: Deal[] }

export type DealIndex = {
  deal_slug: string; deal_name: string; collection_period?: string
  worst_status: CovStatus; covenant_summary?: Record<string, number>; closing_tranche_balance?: number | null
}
export type PortfolioProgram = ProgramAggregateBase & { deals: DealIndex[] }
export type Portfolio = { partner?: string | null; programs: PortfolioProgram[] }

export type UploadSummary = {
  id: string; deal_slug: string; collection_period: string; status: string; uploaded_at?: string; published_at?: string | null
  finding_counts?: { block?: number; review?: number; note?: number }
}
