/// <reference types="node" />
import '@/design/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ToastProvider } from '@/design/components'
import { headerStore } from '@/shell/header'
import { KEY } from '@/shell/roles'
import type { Deal, Partner, Program, Upload, CovenantDefinition, AuditEntry, PublishedPortfolio } from '../data'

/** A route table: [pattern, element]. Renders at `path` with the shell's providers. */
export function renderPage(path: string, routes: [string, ReactElement][], role = 'tao_admin') {
  localStorage.setItem(KEY, role)
  headerStore.clear()
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>{routes.map(([p, el]) => <Route key={p} path={p} element={el} />)}<Route path="*" element={<Where />} /></Routes>
        <Where testid="loc" />
      </ToastProvider>
    </MemoryRouter>,
  )
}
function Where({ testid = 'elsewhere' }: { testid?: string }) {
  const l = useLocation()
  return <output data-testid={testid}>{l.pathname + l.search}</output>
}
export const header = () => headerStore.get()

export type ApiFn = (path: string, init?: RequestInit) => Promise<unknown>
export const httpError = (status: number, code: string, message = code) => Object.assign(new Error(message), { status, code })

/** Route-matching fake for api(): `{ 'GET /uploads': [...] }`; a function value gets (path, init). Unmatched → 404. */
export function fakeApi(table: Record<string, unknown | ((path: string, init?: RequestInit) => unknown)>): ApiFn {
  return async (path, init) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const bare = path.split('?')[0]
    const hit = [`${method} ${path}`, `${method} ${bare}`].find(k => k in table)
    if (!hit) throw httpError(404, 'not_found', `no fake for ${method} ${path}`)
    const v = table[hit]
    const out = typeof v === 'function' ? await (v as (p: string, i?: RequestInit) => unknown)(path, init) : v
    if (out instanceof Error) throw out
    return structuredClone(out)
  }
}
export const never = () => new Promise<never>(() => {})

// ---- fixtures: copies of the seed master data (seed/*.json) and contract-shaped uploads ----
export const PARTNERS: Partner[] = [
  { slug: 'investor', name: 'Investor', kind: 'investor', status: 'active' },
  { slug: 'manager', name: 'Manager', kind: 'manager', status: 'active' },
]
export const PROGRAMS: Program[] = [
  { slug: 'f-pil-2-0', name: 'F-PIL 2.0', partner_slug: 'investor', partner_slugs: ['investor', 'manager'], currency: 'CAD', limit: 150000000, warehouse_limit: 5000000 },
  { slug: 'move-trust', name: 'MOVE Trust', partner_slug: 'investor', partner_slugs: ['investor', 'manager'], currency: 'CAD', limit: 1916709163, warehouse_limit: null },
]
export const DEALS: Deal[] = [
  { slug: 'f-pil-2-0-moneda-capital-corp', name: 'Moneda Capital Corp.', program_slug: 'f-pil-2-0', servicer: 'Moneda Capital Corp.', template_id: 'fpil-2.0-settrep-v1' },
  { slug: 'f-pil-2-0-stride-capital', name: 'Stride Capital', program_slug: 'f-pil-2-0', servicer: 'Stride Capital', template_id: 'fpil-2.0-settrep-v1' },
  { slug: 'move-trust-dynamic-capital', name: 'Dynamic Capital', program_slug: 'move-trust', servicer: 'Dynamic Capital', template_id: 'move-trust-settrep-v1' },
]
export const COVENANTS: CovenantDefinition[] = [
  { id: '7d1f0a8e-0000-4000-8000-000000000001', deal_slug: 'f-pil-2-0-moneda-capital-corp', legal_ref: 'SLFA 9.1 (c)', description: 'Rolling Three Month Loss Ratio', kind: 'ceiling', threshold: null, unit: 'fraction',
    threshold_rule: { on: '/tranche_balance/closing', bands: [{ lte: 10000000, threshold: 0.06 }, { gt: 10000000, threshold: 0.04 }] }, watch_buffer_pct: 0.1, effective_from: '2022-12-09',
    source: 'SLFA 2022-12-09, as printed on page 14 of the 2026-08 report; UNVERIFIED against the executed agreement' },
  { id: '7d1f0a8e-0000-4000-8000-000000000002', deal_slug: 'f-pil-2-0-moneda-capital-corp', legal_ref: 'SLFA 9.1 (h)', description: 'Interest Coverage Ratio', kind: 'floor', threshold: 1.1, unit: 'ratio',
    threshold_rule: null, watch_buffer_pct: 0.1, effective_from: '2023-12-09', source: 'as above (applies after first anniversary)' },
]
export function upload(over: Partial<Upload> = {}): Upload {
  return {
    id: '3f6c1e2a-5b7d-4c8e-9f01-23456789abcd', deal_slug: 'f-pil-2-0-moneda-capital-corp', program_slug: 'f-pil-2-0', partner_slug: 'investor',
    collection_period: '2026-08', reporting_period: null, status: 'received', file_name: 'Moneda-202608 -SETTREP.pdf', page_count: 16,
    uploaded_by: 'tao_admin', uploaded_at: '2026-11-03T15:00:00Z', finding_counts: { block: 0, review: 0, note: 0 }, latest_extraction_id: null, published_at: null,
    ...over,
  }
}
export const AUDIT: AuditEntry[] = [
  { id: 'a1', at: '2026-11-03T15:00:05Z', actor_role: 'system', actor_label: 'worker', action: 'extract', upload_id: '3f6c1e2a-5b7d-4c8e-9f01-23456789abcd', finding_id: null, reason: null, detail: { pass: 1 } },
  { id: 'a2', at: '2026-11-03T15:00:00Z', actor_role: 'tao_admin', actor_label: 'tao_admin', action: 'upload', upload_id: '3f6c1e2a-5b7d-4c8e-9f01-23456789abcd', finding_id: null, reason: null, detail: { file_name: 'Moneda-202608 -SETTREP.pdf', page_count: 16 } },
  { id: 'a3', at: '2026-11-02T10:00:00Z', actor_role: 'tao_admin', actor_label: 'tao_admin', action: 'master_change', upload_id: null, finding_id: null, reason: null, detail: { entity: 'program', key: 'f-pil-2-0' } },
]
/** Real API shape built from the real program files (docs/dashboard-json/program-*.dashboard.json), the way
 * api/app/main.py: published_portfolio trims them (deals -> index). */
function realProgram(file: string, slug: string, name: string) {
  const d = JSON.parse(readFileSync(resolve(__dirname, '../../../../docs/dashboard-json', file), 'utf8'))
  return { program: { slug, name }, period: d.period, deal_count: d.deal_count, covenant_totals: d.covenant_totals, deals_with_escalations: d.deals_with_escalations,
    deals: d.deals.map((x: Record<string, unknown>) => ({ deal_slug: x.deal_slug, deal_name: x.deal_name, collection_period: x.collection_period, worst_status: x.worst_status })) }
}
export const PORTFOLIO: PublishedPortfolio = {
  partner: null,
  programs: [realProgram('program-f-pil-2-0.dashboard.json', 'f-pil-2-0', 'F-PIL 2.0'), realProgram('program-move-trust.dashboard.json', 'move-trust', 'MOVE Trust')],
}
