import fs from 'node:fs'
import path from 'node:path'
import { CACHE, REPO, SAMPLES } from './env'

/** The three F-PIL 2.0 deals with real SetRep PDFs in data/samples/. */
export const DEALS = {
  moneda: { slug: 'f-pil-2-0-moneda-capital-corp', file: (m: string) => `Moneda-${m} -SETTREP.pdf` },
  stride: { slug: 'f-pil-2-0-stride-capital', file: (m: string) => `Stride Capital - ${m} - SETTREP.pdf` },
  xpedite: { slug: 'f-pil-2-0-xpedite-leasing', file: (m: string) => `Xpedite Leasing - ${m} - SETTREP.pdf` },
} as const
export type DealKey = keyof typeof DEALS
export const PROGRAM = 'f-pil-2-0'
export const PROGRAM_NAME = 'F-PIL 2.0'

/** Months published by the setup project before the demo starts (the demo needs a prior month for R11). */
export const HISTORY_MONTHS = ['202605', '202606', '202607']
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

export const samplePath = (deal: DealKey, month: string) => path.join(SAMPLES, DEALS[deal].file(month))
export const period = (month: string) => `${month.slice(0, 4)}-${month.slice(4)}`

/** The shared dashboard object for a deal (docs/dashboard-json), the reference the published page must match. */
export function referenceDeal(deal: DealKey): any {
  return JSON.parse(fs.readFileSync(path.join(REPO, 'docs', 'dashboard-json', `${DEALS[deal].slug}.dashboard.json`), 'utf8'))
}
