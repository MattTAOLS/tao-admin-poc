import { expect, type Page } from '@playwright/test'

/** Compares every number on a deal page ([data-field] elements written by web/src/portfolio/Num.tsx) with
 *  (a) the published object the page was served and (b) the shared dashboard reference for the same deal and period.
 *  Arrays are matched by row identity (period / vintage / legal_ref / ...), not by index, because the published object
 *  carries the POC's months while the shared dashboard carries the servicer's full history. */

const ROW_KEYS = ['period', 'month', 'vintage', 'legal_ref', 'name', 'label', 'tranche', 'ratio', 'key']

export type FieldCheck = {
  field: string; kind: string; shown: string; shownValue: number | null; published: unknown; reference: unknown
  displayOk: boolean; referenceOk: boolean; note?: string
}

function parseShown(text: string, kind: string): number | null {
  const t = text.trim()
  if (t === '—' || t === '') return null
  const n = Number(t.replace(/−/g, '-').replace(/[$,%x+\s]/g, ''))
  return kind === 'pct' ? n / 100 : n
}

function rowId(row: any): [string, unknown] | undefined {
  if (row === null || typeof row !== 'object') return undefined
  for (const k of ROW_KEYS) if (k in row && row[k] !== null && row[k] !== undefined) return [k, row[k]]
  return undefined
}

/** Resolves a dotted path in `pub`, and the same logical path in `ref` (array rows matched by identity). */
export function resolvePair(pub: any, ref: any, path: string): { p: unknown; r: unknown; note?: string } {
  let p = pub, r = ref
  for (const seg of path.split('.')) {
    if (Array.isArray(p) && /^\d+$/.test(seg)) {
      const row = p[Number(seg)]
      const id = rowId(row)
      if (Array.isArray(r)) {
        r = id ? r.find(x => x && x[id[0]] === id[1]) : (r.length === p.length ? r[Number(seg)] : undefined)
      } else r = undefined
      p = row
      if (r === undefined) return { p, r: undefined, note: `row ${id ? `${id[0]}=${id[1]}` : seg} not in reference` }
    } else {
      p = p == null ? undefined : p[seg]
      r = r == null ? undefined : r[seg]
    }
  }
  return { p, r }
}

const DISPLAY_TOL: Record<string, number> = { money: 0.5001, 'signed-money': 0.5001, pct: 0.0000501, count: 0, 'signed-count': 0, ratio: 0.005001 }
/** Acceptance: every metric within $1 / 0.01 pp (build plan); counts exact. */
const REF_TOL: Record<string, number> = { money: 1, 'signed-money': 1, pct: 0.0001, count: 0, 'signed-count': 0, ratio: 0.01 }

export async function readDealFields(page: Page): Promise<{ field: string; kind: string; text: string }[]> {
  return page.locator('[data-field]').evaluateAll(els => els.map(e => ({
    field: e.getAttribute('data-field')!, kind: e.getAttribute('data-kind') ?? 'money', text: (e.textContent ?? '').trim(),
  })))
}

export function compareFields(shown: { field: string; kind: string; text: string }[], published: any, reference: any): FieldCheck[] {
  return shown.map(s => {
    const v = parseShown(s.text, s.kind)
    const { p, r, note } = resolvePair(published, reference, s.field)
    const tolD = DISPLAY_TOL[s.kind] ?? 0.5001
    const tolR = REF_TOL[s.kind] ?? 1
    const displayOk = v === null ? (p === null || p === undefined) : typeof p === 'number' && Math.abs(v - p) <= tolD
    const referenceOk = note ? false : (p === null || p === undefined) ? (r === null || r === undefined)
      : typeof p === 'number' && typeof r === 'number' && Math.abs(p - r) <= tolR
    return { field: s.field, kind: s.kind, shown: s.text, shownValue: v, published: p, reference: r, displayOk, referenceOk, note }
  })
}

/** Max absolute money difference published vs reference among checked fields (for the acceptance table). */
export function maxMoneyDiff(checks: FieldCheck[]): number {
  return Math.max(0, ...checks.filter(c => c.kind.includes('money') && typeof c.published === 'number' && typeof c.reference === 'number')
    .map(c => Math.abs((c.published as number) - (c.reference as number))))
}

export function expectAllMatch(checks: FieldCheck[], label: string) {
  expect(checks.length, `${label}: numbers on the page`).toBeGreaterThan(30)
  const badDisplay = checks.filter(c => !c.displayOk)
  expect(badDisplay, `${label}: page shows a different number than the published object`).toEqual([])
  const badRef = checks.filter(c => !c.referenceOk)
  expect(badRef, `${label}: published number differs from the shared dashboard (docs/dashboard-json)`).toEqual([])
}
