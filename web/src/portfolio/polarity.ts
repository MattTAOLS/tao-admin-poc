/** Trend colour rules for the portfolio pages, in one place (phase 2 wave A item 5, decisions A2 and A3).
 *
 * Colour says whether a move is good or bad for that metric; the arrow says which way it moved. Nothing here
 * recomputes a trend or a change: covenant colours follow the published `trend` word, KPI colours follow the
 * direction of the published change. Flat and n/a are always grey. */
import type { Covenant } from './types'

export type Tone = 'good' | 'bad' | 'neutral'
/** Which direction is better for a metric. */
export type Better = 'lower' | 'higher' | 'neutral'
export type Direction = 'up' | 'down' | 'flat'

/** KPI metrics the portfolio pages show, and which way is better. Every KpiTile with a delta takes its tone from here. */
export const METRIC_POLARITY = {
  delinquency_ratio: 'lower',
  loss_ratio: 'lower',
  cnl_ratio: 'lower',
  coverage_ratio: 'higher',
  leverage_ratio: 'lower',
  tranche_balance: 'neutral',
  contracts: 'neutral',
  warehouse_advances: 'neutral',
} as const satisfies Record<string, Better>
export type Metric = keyof typeof METRIC_POLARITY

function toneOf(better: Better, dir: Direction): Tone {
  if (better === 'neutral' || dir === 'flat') return 'neutral'
  return (dir === 'down') === (better === 'lower') ? 'good' : 'bad'
}

/** Direction of a published change value (positive up, negative down, zero or missing flat). */
export const dirOf = (v: number | null | undefined): Direction => (v ?? 0) > 0 ? 'up' : (v ?? 0) < 0 ? 'down' : 'flat'

/** The tone of a KPI delta for `metric`, given the published change. */
export function deltaTone(metric: Metric, dir: Direction): Tone {
  return toneOf(METRIC_POLARITY[metric], dir)
}

/** Direction and tone for a KpiTile delta, from the published change value. */
export function kpiDelta(metric: Metric, change: number | null | undefined) {
  const direction = dirOf(change)
  return { direction, tone: deltaTone(metric, direction) }
}

/** A covenant's polarity comes from its own `kind`: a ceiling (max test) is better lower, a floor (min test) better
 * higher, a binary (yes / no) test has no direction. */
export function kindPolarity(kind: Covenant['kind'] | string | undefined): Better {
  return kind === 'ceiling' ? 'lower' : kind === 'floor' ? 'higher' : 'neutral'
}

const TREND_DIR: Record<string, Direction> = { rising: 'up', falling: 'down', flat: 'flat' }

/** Tone of a covenant's published trend word; undefined when the trend is not one of rising / falling / flat (n/a). */
export function covenantTrendTone(kind: Covenant['kind'] | string | undefined, trend: string): Tone | undefined {
  const dir = TREND_DIR[trend]
  return dir ? toneOf(kindPolarity(kind), dir) : undefined
}
