import fs from 'node:fs'
import path from 'node:path'
import { CACHE, REPO, SAMPLES } from './env'

/** The three F-PIL 2.0 deals with real SetRep PDFs in data/samples/, and the three MOVE Trust deals step 9 uploads
 * from data/samples/move-trust/. */
export const DEALS = {
  moneda: { slug: 'f-pil-2-0-moneda-capital-corp', file: (m: string) => `Moneda-${m} -SETTREP.pdf` },
  stride: { slug: 'f-pil-2-0-stride-capital', file: (m: string) => `Stride Capital - ${m} - SETTREP.pdf` },
  xpedite: { slug: 'f-pil-2-0-xpedite-leasing', file: (m: string) => `Xpedite Leasing - ${m} - SETTREP.pdf` },
  essex: { slug: 'move-trust-essex-lease-financial-corp', file: (m: string) => `move-trust/Essex - ${m} - SETTREP.pdf` },
  tlfcLp: { slug: 'move-trust-tlfc-lp-leases', file: (m: string) => `move-trust/TLFC_LP-${m}-SETTREP.pdf` },
  finloc: { slug: 'move-trust-finloc-2000-inc', file: (m: string) => `move-trust/Finloc-${m}-SETTREP.pdf` },
} as const
export type DealKey = keyof typeof DEALS
export const PROGRAM = 'f-pil-2-0'
export const PROGRAM_NAME = 'F-PIL 2.0'

/** Months published by the setup project before the demo starts, oldest first. Moneda and Xpedite carry May-Jul (the
 * deal pages show four months and Xpedite's Jun/Jul restatements are part of its history); Stride needs only July, the
 * prior month step 6 checks R11 against. Fewer uploads keep the full demo under 10 minutes. */
export const HISTORY: [DealKey, string][] = [
  ['moneda', '202605'], ['xpedite', '202605'],
  ['moneda', '202606'], ['xpedite', '202606'],
  ['moneda', '202607'], ['xpedite', '202607'], ['stride', '202607'],
]
/** Demo journey uploads, in order. */
export const STEP1 = { deal: 'xpedite' as DealKey, month: '202608', period: '2026-08' }  // clean report, published in step 2
export const STEP4 = { deal: 'moneda' as DealKey, month: '202608', period: '2026-08' }  // seeded error, one R05 block
export const STEP6 = { deal: 'stride' as DealKey, month: '202608', period: '2026-08' }  // the following month after Jul

/** The seeded copy of Moneda 202608: page 2 scheduled principal 646,926.71 -> 646,826.71 (R05 fails by -100.00). */
export const SEEDED = {
  file: path.join(CACHE, 'seeded', 'Moneda-202608 -SETTREP.pdf'),
  ours: 15_020_071.52,
  reportClosing: 15_019_971.52,
  difference: -100.0,
  reason: 'servicer typo, confirmed by email',
}
/** Step 7: a corrected re-issue of month one (Moneda 2026-05, the same real PDF uploaded again with replace=true). */
export const STEP7 = { deal: 'moneda' as DealKey, month: '202605', period: '2026-05', reason: 'servicer re-sent the May report; replaces the published one' }

/** Step 9: MOVE Trust, month by month from April 2026 (the month in a MOVE file name is the collection period and the
 * reporting period). Nine uploads: the fewest that show both real R11 restatements, Finloc's three multi-currency
 * months with no R11, a deal behind the program month, and one deal (Finloc) at the reference objects' period, July. */
export const MOVE = { program: 'move-trust', name: 'MOVE Trust' }
export const STEP9 = {
  /** Upload order. Essex May goes before TLFC LP's and Finloc's May, so the program shows those two as of April. */
  order: [
    ['essex', '202604'], ['tlfcLp', '202604'], ['finloc', '202604'],
    ['essex', '202605'],                                   // R11 x2: restates April's ratios
    ['tlfcLp', '202605'], ['finloc', '202605'],
    ['tlfcLp', '202606'],                                  // R11 x2: restates the April and May RVL ratio
    ['finloc', '202606'], ['finloc', '202607'],
  ] as [DealKey, string][],
  /** Essex May 2026 restates April 2026 (ratio_history; the reference object's `restatements` records both). */
  essex: {
    month: '202605', period: '2026-05',
    restated: [
      { field: 'interest_coverage_ratio', month: '2026-04', row: 'Apr-26', was: 1.15, now: 1.12 },
      { field: 'debt_equity_ratio', month: '2026-04', row: 'Apr-26', was: 6.35, now: 6.22 },
    ],
    reason: 'servicer restated the April ratios in the May report',
  },
  /** TLFC LP (Leases) June 2026 restates the RVL ratio for April and May: 0.000000% became 0.112487%. */
  tlfcLp: {
    month: '202606', period: '2026-06',
    restated: [
      { field: 'rvl_ratio_pct', month: '2026-04', row: 'Apr-26', was: 0, now: 0.00112487 },
      { field: 'rvl_ratio_pct', month: '2026-05', row: 'May-26', was: 0, now: 0.00112487 },
    ],
    reason: 'servicer restated the April and May RVL ratio in the June report',
  },
  /** Finloc carries CAD and USD tranches. The CAD-equivalent opening differs from the prior closing by the USD
   * revaluation; each currency's native opening equals its prior closing, so R11 raises nothing. */
  finloc: { revaluation: { '2026-05': 64_124.04, '2026-06': 106_968.53, '2026-07': -47_609.31 } as Record<string, number> },
}

/** Step 10 (phase 2 wave B): editing. Every edited value is a real extracted value moved by $100.00, the size of the
 * seeded R05 error, so the change is easy to spot; nothing else is invented. */
export const STEP10 = {
  /** 10a: Essex June 2026 (the month after step 9's May) in review. The closing edit raises R05 (page 2 closing no longer
   * equals the roll-forward row); it is reverted, then interest (read by no block rule) is edited and published. */
  edit: {
    deal: 'essex' as DealKey, month: '202606', period: '2026-06',
    raise: { label: 'Tranche balance, Closing', pointer: '/tranche_balance/closing', delta: 100 },
    keep: { label: 'Tranche balance, Interest', pointer: '/tranche_balance/interest', delta: 100 },
    reason: 'QA demo: value edited by hand to show the rules re-run',
    revertReason: 'QA demo: edit reverted',
  },
  /** 10b: corrections of published months. TLFC LP June interest publishes at once as version 2; Finloc July closing opens
   * an R05 block, waits in the queue while version 1 stays live, and is acknowledged and approved. */
  correctClean: { deal: 'tlfcLp' as DealKey, period: '2026-06', name: 'TLFC LP (Leases)', pointer: '/tranche_balance/interest', search: 'Interest', pick: /^Tranche balance · interest/i, delta: 100 },
  correctBlock: { deal: 'finloc' as DealKey, period: '2026-07', name: 'Finloc 2000 Inc.', pointer: '/tranche_balance/closing', search: 'Closing', pick: /^Tranche balance · closing/i, delta: 100 },
  correctionReason: 'QA demo: correction after publication, no new PDF',
  noteToPartners: 'QA demo note: one value corrected after publication.',
  ackReason: 'QA demo: acknowledged, the corrected closing is intended',
  /** 10c: a new version of Moneda SLFA 9.1 (e) from 2026-09-01, after every published month, with the threshold
   * unchanged and the watch buffer widened. A test change, not a real amendment. */
  covenant: {
    deal: 'moneda' as DealKey, dealName: 'Moneda Capital Corp.', legalRef: 'SLFA 9.1 (e)', currentFrom: '2022-12-09',
    newFrom: '2026-09-01', watchBuffer: 0.15, reason: 'QA demo: watch buffer widened from Sep 2026 (test change, not a real amendment)',
  },
}

export const samplePath = (deal: DealKey, month: string) => path.join(SAMPLES, DEALS[deal].file(month))
export const period = (month: string) => `${month.slice(0, 4)}-${month.slice(4)}`

/** The shared dashboard object for a deal (docs/dashboard-json), the reference the published page must match. */
export function referenceDeal(deal: DealKey): any {
  return JSON.parse(fs.readFileSync(path.join(REPO, 'docs', 'dashboard-json', `${DEALS[deal].slug}.dashboard.json`), 'utf8'))
}
