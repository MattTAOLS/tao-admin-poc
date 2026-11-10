/** Wave D shapes, copied from contracts/openapi.yaml (CompanyDealRef onwards). Field names and nullability follow the
 * contract exactly; the UI never adds a figure the API does not send. */

export type WorstStatus = 'BREACH' | 'WATCH' | 'OK' | null
export type Month = string // YYYY-MM

export type NextReport = { period: Month; due_on: string; late: boolean; business_days_late: number } | null

export type CompanyDealRef = {
  deal_slug: string
  deal_name: string
  program_slug: string
  program_name: string
  latest_period: Month | null
  worst_status: WorstStatus
  next_report: NextReport
}

export type CompanyRow = {
  slug: string
  name: string
  deals: CompanyDealRef[]
  industry: string | null
  status: WorstStatus
  breach: number
  watch: number
  balance: number | null
  delinquency: { min: number | null; max: number | null; direction: 'up' | 'down' | 'flat' | null }
  news_7d: number
  adverse: { state: 'clear' | 'to_review' | 'not_screened'; to_review: number }
  /** TAO only; absent for partners. */
  notes?: number
  following: boolean
}

export type Person = { id: string; name: string }

export type CompanyContact = { id: string; name: string; role: string | null; email: string | null; receives: string | null }

export type Company = {
  slug: string
  name: string
  aliases: string[]
  industry: string | null
  naics: string | null
  headquarters: string | null
  website: string | null
  relationship_since: Month | null
  relationship_since_source: 'record' | 'first_vintage' | null
  /** Absent for partners. */
  owner?: Person | null
  deals: CompanyDealRef[]
  contacts: CompanyContact[]
  following: boolean
  updated_at: string
  /** TAO only (absent for partners): how the news search treats this company (wave E, decision E7). */
  news_search?: CompanyNewsSearch
}

export type NewsLanguage = 'en' | 'fr'
export type CompanyNewsSearch = {
  /** For a generic name: a story must mention at least one. Empty = no context rule. */
  context_terms: string[]
  /** Phrases that always mean the wrong company. */
  exclusions: string[]
  /** At least one. */
  languages: NewsLanguage[]
}

export type CompanyPatch = {
  name?: string; aliases?: string[]; industry?: string | null; naics?: string | null; headquarters?: string | null
  website?: string | null; relationship_since?: Month | null; owner_user_id?: string | null; deal_slugs?: string[]
  news_search?: CompanyNewsSearch; reason: string
}

export type ContactInput = { name: string; role: string | null; email: string | null; receives: string | null; reason: string }

export type SeriesPoint = { month: Month; value: number | null }
export type SeriesMetric = 'delinquency_ratio_pct' | 'rolling_3month_loss_ratio_pct' | 'rolling_12month_loss_ratio_pct' | 'loss_ratio_pct'
  | 'interest_coverage_ratio' | 'debt_equity_ratio' | 'total_equity'
export type MetricSeries = {
  metric: SeriesMetric | string
  label: string
  unit: 'fraction' | 'ratio' | 'currency'
  deal: SeriesPoint[]
  program_median: SeriesPoint[]
  program_mean: SeriesPoint[]
  peers_in_month: { month: Month; count: number }[]
  limit: { legal_ref: string; threshold: number; kind: 'ceiling' | 'floor' } | null
}
export type LossPeer = { deal_slug: string; deal_name: string; metric: string; series: SeriesPoint[]; drawn: boolean }
export type WatchSignal = {
  kind: 'covenant_near_limit' | 'rising_3m' | 'obligor_near_limit' | 'losses_high' | 'utilization_high' | 'restated' | 'report_late' | string
  severity: 'watch' | 'rising' | 'info'
  title: string
  detail: string
  anchor: string
}
export type CovenantHistoryRow = {
  legal_ref: string
  description: string
  cells: { month: Month; status: 'BREACH' | 'WATCH' | 'OK' | 'AVAILABLE' | null; source: 'published' | 'recomputed' | null }[]
}
export type Restatement = {
  month: string; field: string; first_reported: number | null; now: number | null; changed_in: string
  type: 'restated_by_company' | 'tao_correction'
}
export type CompanyInsights = {
  deal_slug: string
  collection_period: string
  signals: WatchSignal[]
  series: MetricSeries[]
  loss_peers: LossPeer[]
  balance_median_change?: SeriesPoint[]
  covenant_history: CovenantHistoryRow[]
  restatements: Restatement[]
}

export type NewsSourceName = 'google_news' | 'gdelt' | 'event_registry' | 'newscatcher' | 'brave_news' | 'brave_web' | 'dow_jones'
  | 'lexisnexis' | 'fixture'
/** TAO only (absent for partners): the Claude check on one story. */
export type NewsCheck = {
  status: 'kept' | 'excluded' | 'pending' | 'unchecked'
  confidence: number | null
  reason: string | null
  model: string | null
  checked_at: string | null
}
export type NewsItem = {
  id: string; company_slug: string; title: string; url: string; publisher: string | null
  /** Confirmed publish date only (decision E3); null when not confirmed. */
  published_at: string | null
  /** The date the search source gave; never used for counts or alerts. */
  source_date: string | null
  date_status: 'confirmed' | 'source_only' | 'unknown'
  source: NewsSourceName
  sources: NewsSourceName[]
  language: NewsLanguage | null
  sentiment: 'positive' | 'neutral' | 'negative'; found_at: string
  check?: NewsCheck
}
/** GET /companies/{slug}/news include (TAO only). */
export type NewsInclude = 'excluded' | 'pending' | 'all'

export type AdverseCategory = 'litigation' | 'regulatory' | 'fraud' | 'insolvency' | 'sanctions'
export type AdverseItem = {
  id: string; company_slug: string; news_item_id?: string | null; category: AdverseCategory; title: string; url: string
  publisher: string | null; found_at: string; state: 'open' | 'reviewed' | 'dismissed'; note: string | null
  state_by: Person | null; state_at: string | null
}

export type CompanyNote = {
  id: string; company_slug: string; author: Person; body: string; mentions: Person[]
  collection_period: Month | null; created_at: string; edited_at: string | null
}
export type NoteInput = { body: string; mentions?: string[]; collection_period?: Month | null }

/** GET /users?partner_slug=tao&status=active: the TAO people for @mentions and the owner picker. */
export type TaoUser = { id: string; name: string; email: string; role: string; status: string }

/** A news worker run (contract NewsRun), as far as the company profile's Run now needs it. */
export type NewsRun = {
  id: string; trigger: 'schedule' | 'manual' | 'recheck'; status: 'queued' | 'running' | 'ok' | 'partial' | 'failed'
  company_slug?: string | null; items_added: number; adverse_added: number
  errors: { company_slug?: string | null; source: string; message: string }[]
  stats?: { kept?: number; excluded?: number; pending?: number; candidates?: number }
}
