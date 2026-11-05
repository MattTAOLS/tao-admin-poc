// @vitest-environment jsdom
/** Publication versions on the deal page (wave B, decisions B2 and B3). Fixture: the real Dynamic Capital July 2026
 * object with one deliberate change, a version 2 that corrects tranche_balance.recoveries by a TAO manual edit
 * (fixtures.ts apiCorrectedDeal). Every other deal is the reference object as published (no version, or version 1).
 * The fake API answers ?version=1 with the original and anything else with the current version. */
import '@/design/test-utils'
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { App } from '@/shell/App'
import { KEY } from '@/shell/roles'
import { headerStore } from '@/shell/header'
import { CorrectionsTable } from '../Corrections'
import { versionInfo } from '../Versions'
import type { Deal } from '../types'
import { CORRECTED, MANUAL_REASON, VERSIONS, apiCorrectedDeal, apiDeal, apiProgram, deals } from './fixtures'

let calls: string[] = []
/** Per test: what the plain reference deals carry (absent, or an explicit version 1). */
let plain: 'absent' | 'v1' = 'absent'

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}
function fakeFetch(input: RequestInfo | URL) {
  const u = new URL(String(input), 'http://x')
  calls.push(u.pathname.replace(/^.*\/api\/v1/, '') + u.search)
  const path = u.pathname.replace(/^.*\/api\/v1/, '')
  let m: RegExpMatchArray | null
  if ((m = path.match(/^\/published\/programs\/([^/]+)\/deals\/([^/]+)$/))) {
    const v = u.searchParams.get('version')
    if (m[2] === CORRECTED) return respond(200, apiCorrectedDeal(v ? Number(v) : undefined))
    const d = apiDeal(m[2])
    return respond(200, plain === 'v1' ? { ...d, version: 1, versions: [{ ...VERSIONS[0], current: true }] } : d)
  }
  if ((m = path.match(/^\/published\/programs\/([^/]+)$/))) return respond(200, apiProgram(m[1]))
  if (path === '/uploads') return respond(200, [])
  return respond(404, { code: 'not_found', message: path })
}

function Where() { const l = useLocation(); return <output data-testid="where">{l.pathname + l.search}</output> }
function renderAt(path: string, role: string) {
  localStorage.setItem(KEY, role)
  return render(<MemoryRouter initialEntries={[path]}><App /><Where /></MemoryRouter>)
}
const where = () => screen.getByTestId('where').textContent
const corrTable = () => screen.getByRole('table', { name: 'Data corrections' })
/** The first render cold-loads the lazy shell and route modules; other agents share this machine. */
const SLOW = { timeout: 20000 }
const dealCalls = () => calls.filter(c => c.startsWith('/published/programs/') && c.includes('/deals/'))

beforeAll(async () => { await Promise.all([import('@/shell/App'), import('../DealRoute')]) }, 30000)
vi.setConfig({ testTimeout: 40000 })
beforeEach(() => { calls = []; plain = 'absent'; localStorage.clear(); headerStore.clear(); vi.stubGlobal('fetch', vi.fn(fakeFetch)) })
afterEach(() => { vi.unstubAllGlobals() })

const INVESTOR = `/investor/portfolio/move-trust/deals/${CORRECTED}?period=2026-07`

describe('corrected deal, current version', () => {
  it('header shows a Corrected pill (dot plus word) and Version 2 of 2; no banner', async () => {
    renderAt(INVESTOR, 'investor_viewer')
    const btn = await screen.findByRole('button', { name: 'Version 2 of 2' }, SLOW)
    const pill = screen.getByText('Corrected', { selector: '.ds-pill' })
    expect(pill.querySelector('.ds-pill__dot')).toBeTruthy()
    expect(pill.className).toContain('ds-pill--blue')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('note', { name: 'Earlier version' })).toBeNull()
    expect(dealCalls()[0]).toBe(`/published/programs/move-trust/deals/${CORRECTED}?period=2026-07`)
  })

  it('the versions menu lists each version, newest first, with date, publisher and reason', async () => {
    renderAt(INVESTOR, 'investor_viewer')
    await userEvent.click(await screen.findByRole('button', { name: 'Version 2 of 2' }, SLOW))
    const menu = screen.getByRole('region', { name: 'Published versions' })
    const items = within(menu).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toContain('Version 2 (current)')
    expect(items[0].textContent).toContain('Published 4 Nov 2026 by tao_admin')
    expect(items[0].textContent).toContain(MANUAL_REASON)
    expect(items[1].textContent).toContain('Version 1 (original)')
    expect(items[1].textContent).toContain('Published 9 Oct 2026 by tao_admin')
    expect(items[1].textContent).toContain('Original publication')
    // The shown version is marked; the current one links without ?version.
    const v2 = within(items[0]).getByRole('link')
    expect(v2.getAttribute('aria-current')).toBe('page')
    expect(v2.getAttribute('href')).toBe(`/investor/portfolio/move-trust/deals/${CORRECTED}?period=2026-07`)
    expect(within(items[1]).getByRole('link').getAttribute('href')).toBe(`/investor/portfolio/move-trust/deals/${CORRECTED}?period=2026-07&version=1`)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('region', { name: 'Published versions' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Version 2 of 2' }))
  })

  it('data corrections: the manual edit reads Corrected by TAO with old → new, date and reason; the reference row is unchanged', async () => {
    renderAt(INVESTOR, 'investor_viewer')
    await screen.findByRole('button', { name: 'Version 2 of 2' }, SLOW)
    const rows = within(corrTable()).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    const ref = deals[CORRECTED].data_corrections![0]
    expect(rows[0].textContent).toContain('Balance history · Interest')
    expect(rows[0].textContent).toContain(ref.applied as string)
    expect(rows[0].textContent).not.toContain('Corrected by TAO')
    const manual = rows[1]
    expect(manual.textContent).toContain('Balance · Recoveries')
    const cells = within(manual).getAllByRole('cell')
    expect(cells[2].textContent).toBe('$0')
    expect(cells[3].textContent).toBe('$18,450')
    expect(manual.textContent).toContain(MANUAL_REASON)
    expect(manual.textContent).toContain('2026-11-04')
    const label = within(manual).getByText('Corrected by TAO')
    expect(label.querySelector('.ds-pill__dot')).toBeTruthy()
    expect(manual.textContent).toContain('version 2')
    expect(manual.textContent).not.toContain('kept')
  })
})

describe('an earlier version', () => {
  it('choosing version 1 opens ?period=…&version=1 with the banner, and its link goes back to the current version', async () => {
    renderAt(INVESTOR, 'investor_viewer')
    await userEvent.click(await screen.findByRole('button', { name: 'Version 2 of 2' }, SLOW))
    await userEvent.click(within(screen.getByRole('region', { name: 'Published versions' })).getByRole('link', { name: /Version 1/ }))
    expect(where()).toBe(`/investor/portfolio/move-trust/deals/${CORRECTED}?period=2026-07&version=1`)
    const banner = await screen.findByRole('note', { name: 'Earlier version' }, SLOW)
    expect(banner.textContent).toContain('You are looking at version 1. The current version is 2.')
    expect(dealCalls()).toContain(`/published/programs/move-trust/deals/${CORRECTED}?period=2026-07&version=1`)
    expect(screen.getByRole('button', { name: 'Version 1 of 2' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Published versions' })).toBeNull() // menu closes on navigation
    // Version 1 shows the original numbers: no manual row, recoveries as first published.
    expect(within(corrTable()).getAllByRole('row').slice(1)).toHaveLength(1)
    expect(screen.queryByText('Corrected by TAO')).toBeNull()
    const back = within(banner).getByRole('link', { name: 'Go to the current version' })
    expect(back.getAttribute('href')).toBe(`/investor/portfolio/move-trust/deals/${CORRECTED}?period=2026-07`)
    await userEvent.click(back)
    expect(where()).toBe(`/investor/portfolio/move-trust/deals/${CORRECTED}?period=2026-07`)
    await screen.findByRole('button', { name: 'Version 2 of 2' }, SLOW)
    expect(screen.queryByRole('note', { name: 'Earlier version' })).toBeNull()
  })

  it('program links and the breadcrumb never carry ?version', async () => {
    renderAt(`${INVESTOR}&version=1`, 'investor_viewer')
    await screen.findByRole('note', { name: 'Earlier version' }, SLOW)
    await waitFor(() => expect(calls.some(c => c.startsWith('/published/programs/move-trust?') || c === '/published/programs/move-trust')).toBe(true))
    const programCalls = calls.filter(c => /^\/published\/programs\/[^/]+(\?|$)/.test(c))
    expect(programCalls.every(c => !c.includes('version'))).toBe(true)
    await waitFor(() => expect(screen.getAllByRole('link').some(a => /Next deal|Previous deal/.test(a.getAttribute('aria-label') ?? ''))).toBe(true))
    const links = screen.getAllByRole('link').map(a => a.getAttribute('href') ?? '').filter(h => h.startsWith('/investor/portfolio') && !h.includes(CORRECTED))
    expect(links.length).toBeGreaterThan(0)
    expect(links.every(h => !h.includes('version'))).toBe(true)
  })

  it('works the same in the TAO Admin shell', async () => {
    renderAt(`/admin/portfolio/move-trust/deals/${CORRECTED}?period=2026-07`, 'tao_admin')
    await userEvent.click(await screen.findByRole('button', { name: 'Version 2 of 2' }, SLOW))
    await userEvent.click(within(screen.getByRole('region', { name: 'Published versions' })).getByRole('link', { name: /Version 1/ }))
    expect(where()).toBe(`/admin/portfolio/move-trust/deals/${CORRECTED}?period=2026-07&version=1`)
    const banner = await screen.findByRole('note', { name: 'Earlier version' }, SLOW)
    expect(within(banner).getByRole('link', { name: 'Go to the current version' }).getAttribute('href')).toBe(`/admin/portfolio/move-trust/deals/${CORRECTED}?period=2026-07`)
    expect(screen.getByRole('region', { name: 'Upload status' })).toBeTruthy()
  })
})

describe('nothing changes at version 1 or with no version', () => {
  for (const mode of ['absent', 'v1'] as const) {
    it(`reference deal with version ${mode === 'v1' ? '1' : 'absent'}: no pill, no menu, no banner, corrections as before`, async () => {
      plain = mode
      renderAt('/investor/portfolio/move-trust/deals/move-trust-vcc-iv-lp?period=2026-07', 'investor_viewer')
      expect(await screen.findByRole('heading', { level: 1, name: /VCC IV/ }, SLOW)).toBeTruthy()
      await screen.findByRole('table', { name: 'Data corrections' })
      expect(screen.queryByText('Corrected', { selector: '.ds-pill' })).toBeNull()
      expect(screen.queryByRole('button', { name: /^Version \d+ of \d+$/ })).toBeNull()
      expect(screen.queryByRole('note', { name: 'Earlier version' })).toBeNull()
      expect(screen.queryByText('Corrected by TAO')).toBeNull()
      expect(within(corrTable()).getAllByRole('row').slice(1)).toHaveLength(deals['move-trust-vcc-iv-lp'].data_corrections!.length)
    })
  }
})

describe('versionInfo and CorrectionsTable (unit)', () => {
  it('derives shown, current and total', () => {
    expect(versionInfo({})).toMatchObject({ shown: 1, current: 1, corrected: false, older: false })
    expect(versionInfo({ version: 1, versions: [{ ...VERSIONS[0], current: true }] })).toMatchObject({ corrected: false, older: false })
    expect(versionInfo({ version: 2, versions: VERSIONS })).toMatchObject({ shown: 2, current: 2, total: 2, corrected: true, older: false })
    expect(versionInfo({ version: 1, versions: VERSIONS })).toMatchObject({ shown: 1, current: 2, total: 2, corrected: true, older: true })
  })
  it('a manual row without `applied` falls back to the edit date; use_ours rows keep their "kept" line', () => {
    const d = apiCorrectedDeal() as Deal
    const manual = { ...d.data_corrections![1], applied: undefined }
    const ours = { period: '2026-07', record: 'tranche_balance', field: 'closing', old_value: 1, new_value: 2, applied: '2026-10-01', reason: 'R05 recomputed', rule_id: 'R05', choice: 'use_ours', finding_id: 'f1' }
    render(<MemoryRouter><CorrectionsTable rows={[ours, manual]} /></MemoryRouter>)
    const rows = within(screen.getByRole('table', { name: 'Data corrections' })).getAllByRole('row').slice(1)
    expect(rows[0].textContent).toContain('R05 · kept our recomputation')
    expect(rows[0].textContent).not.toContain('Corrected by TAO')
    expect(rows[1].textContent).toContain('Corrected by TAO')
    expect(rows[1].textContent).toContain('4 Nov 2026')
  })
})
