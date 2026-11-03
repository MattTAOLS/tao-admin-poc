/** Where an extracted value came from: a page of this upload (extraction.sources, keyed by JSON pointer), or an
 * earlier publication (meta.history.carried names the pointers carried over; those have no source entry). */
import { formatPeriod } from '@/design/components'
import type { Extraction, Source } from './types'
import type { Box } from '../components/PageImage'

export type Provenance =
  | { kind: 'pages'; pages: { page: number; pointer: string; source: Source }[] }
  | { kind: 'carried'; label: string }
  | { kind: 'none' }

export function getPointer(obj: unknown, pointer: string): unknown {
  if (pointer === '' || pointer === '/') return obj
  let cur: unknown = obj
  for (const raw of pointer.split('/').slice(1)) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

const within = (p: string, prefix: string) => p === prefix || p.startsWith(prefix + '/')

export function carriedLabel(ex: Extraction): string {
  const from = ex.meta?.history?.extended_from
  const m = from ? /(\d{4}-\d{2})/.exec(from) : null
  return m ? `from published ${formatPeriod(m[1])}` : 'from an earlier publication'
}

export function isCarried(ex: Extraction, pointer: string): boolean {
  const carried = ex.meta?.history?.carried ?? []
  return carried.some(c => within(pointer, c) || within(c, pointer))
}

/** Provenance of one leaf (exact pointer) or of a row / object (every source under the pointer, one entry per page). */
export function provenance(ex: Extraction, pointer: string): Provenance {
  const exact = ex.sources?.[pointer]
  if (exact) return { kind: 'pages', pages: [{ page: exact.page, pointer, source: exact }] }
  const byPage = new Map<number, { page: number; pointer: string; source: Source }>()
  for (const [p, s] of Object.entries(ex.sources ?? {})) {
    if (within(p, pointer) && s && typeof s.page === 'number' && !byPage.has(s.page)) byPage.set(s.page, { page: s.page, pointer: p, source: s })
  }
  if (byPage.size > 0) return { kind: 'pages', pages: [...byPage.values()].sort((a, b) => a.page - b.page) }
  if (isCarried(ex, pointer)) return { kind: 'carried', label: carriedLabel(ex) }
  return { kind: 'none' }
}

/** The bboxes on `page` for a finding's fields (JSON pointers into deal; `master:` / `prior:` pointers are skipped). */
export function findingBoxes(ex: Extraction | undefined, fields: string[] | undefined, page: number | null | undefined): Box[] {
  if (!ex || !fields || page == null) return []
  const out: Box[] = []
  for (const f of fields) {
    if (!f.startsWith('/')) continue
    const s = ex.sources?.[f]
    if (s && s.page === page && Array.isArray(s.bbox) && s.bbox.length === 4) out.push(s.bbox)
  }
  return out
}

/** The box to centre a crop on: the field whose extracted value is the finding's report value (the figure the
 * reviewer is checking), else the first box. A lookup for display; nothing is recomputed. */
export function focusBox(ex: Extraction | undefined, fields: string[] | undefined, page: number | null | undefined, reportValue: unknown): Box | undefined {
  if (!ex || !fields || page == null) return undefined
  let first: Box | undefined
  for (const f of fields) {
    if (!f.startsWith('/')) continue
    const s = ex.sources?.[f]
    if (!s || s.page !== page || !Array.isArray(s.bbox) || s.bbox.length !== 4) continue
    first ??= s.bbox
    if (reportValue !== undefined && reportValue !== null && getPointer(ex.deal, f) === reportValue) return s.bbox
  }
  return first
}
