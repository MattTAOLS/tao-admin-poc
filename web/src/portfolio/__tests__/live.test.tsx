// @vitest-environment jsdom
/** Over HTTP against a running API seeded with the reference publications (skipped unless PF_LIVE_API is set):
 *   PF_LIVE_API=http://localhost:18300 npx vitest run src/portfolio/__tests__/live.test.tsx
 * Fetches every published deal and both programs as the owning partner, renders them through the same views
 * (server-side), and checks each displayed number against the reference dashboard.json. Also checks the other
 * partner gets 404 (shown as "You don't have access"). */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { DealView } from '../DealPage'
import { ProgramDashboardView } from '../ProgramDashboard'
import { parseNum } from '../Num'
import type { NumKind } from '../fmt'
import type { Deal, Portfolio, ProgramAggregate } from '../types'
import { at, deals, programOf, programs } from './fixtures'

const API = process.env.PF_LIVE_API
const TOL: Record<NumKind, number> = { money: 1, 'signed-money': 1, pct: 0.0001, ratio: 0.005, count: 0.5, 'signed-count': 0.5 }

async function get<T>(path: string, h: Record<string, string>): Promise<{ status: number; body: T }> {
  const r = await fetch(`${API}/api/v1${path}`, { headers: h })
  return { status: r.status, body: (await r.json()) as T }
}
const TAO = { 'X-Role': 'tao_admin' }

function compare(html: string, reference: unknown) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const bad: string[] = []
  let n = 0
  doc.querySelectorAll<HTMLElement>('[data-field]').forEach(el => {
    const kind = el.dataset.kind as NumKind, path = el.dataset.field!
    const exp = at(reference, path), got = parseNum(el.textContent ?? '', kind)
    if (typeof exp !== 'number') { if (got !== null) bad.push(`${path}: ${el.textContent} vs none`); return }
    n++
    if (got === null || Math.abs(got - exp) > TOL[kind] + 1e-9) bad.push(`${path}: shows ${el.textContent}, reference ${exp}`)
  })
  return { bad, n }
}

describe.skipIf(!API)('live API: screen numbers equal the reference files', () => {
  it('portfolio lists what each partner owns', async () => {
    const tao = await get<Portfolio>('/published/portfolio', TAO)
    expect(tao.body.programs.map(p => p.program?.slug).sort()).toEqual(['f-pil-2-0', 'move-trust'])
  })
  for (const slug of Object.keys(deals)) {
    it(`deal ${slug}`, async () => {
      const prog = programOf(slug)
      const r = await get<Deal>(`/published/programs/${prog}/deals/${slug}`, TAO)
      expect(r.status).toBe(200)
      const html = renderToStaticMarkup(<MemoryRouter><DealView d={r.body} /></MemoryRouter>)
      const { bad, n } = compare(html, deals[slug])
      expect(bad).toEqual([])
      expect(n).toBeGreaterThan(40)
    })
  }
  for (const slug of Object.keys(programs)) {
    it(`program ${slug} dashboard`, async () => {
      const r = await get<ProgramAggregate>(`/published/programs/${slug}`, TAO)
      expect(r.status).toBe(200)
      // The roll-up orders deals by slug; compare by deal, not by index.
      const html = renderToStaticMarkup(<MemoryRouter><ProgramDashboardView p={r.body} /></MemoryRouter>)
      const ref = { ...programs[slug], deals: r.body.deals.map(d => programs[slug].deals.find(x => x.deal_slug === d.deal_slug)) }
      const { bad, n } = compare(html, ref)
      expect(bad).toEqual([])
      expect(n).toBeGreaterThan(60)
    })
  }
  it('both partners see both programs', async () => {
    for (const [role, partner] of [['investor_viewer', 'investor'], ['manager_viewer', 'manager']]) {
      const pf = await get<Portfolio>('/published/portfolio', { 'X-Role': role, 'X-Partner': partner })
      expect(pf.body.programs.map(p => p.program?.slug).sort()).toEqual(['f-pil-2-0', 'move-trust'])
      for (const slug of Object.keys(programs)) expect((await get(`/published/programs/${slug}`, { 'X-Role': role, 'X-Partner': partner })).status).toBe(200)
    }
  })
  it('an unknown program, or a partner that owns nothing, gets 404 / 403 (shown as no access)', async () => {
    const h = { 'X-Role': 'manager_viewer', 'X-Partner': 'manager' }
    expect((await get('/published/programs/no-such-program', h)).status).toBe(404)
    const stranger = await get('/published/programs/f-pil-2-0', { 'X-Role': 'manager_viewer', 'X-Partner': 'nobody' })
    expect([403, 404]).toContain(stranger.status)
  })
})
