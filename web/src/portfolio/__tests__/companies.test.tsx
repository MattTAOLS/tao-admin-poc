// @vitest-environment jsdom
/** Companies list (D5 screens B and C) and the Companies section of the Portfolio Executive Summary (D5 screen A),
 * against the fake API in companyApi.tsx. Figures are the real dashboard objects; see companyFixtures.ts. */
import '@/design/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { headerStore } from '@/shell/header'
import { ANALYST } from './companyFixtures'
import { renderAt, setup, signIn, state } from './companyApi'

beforeEach(() => { setup(); headerStore.clear() })
afterEach(() => { vi.unstubAllGlobals() })

const table = () => screen.findByRole('table', { name: 'Lending companies' }, { timeout: 15_000 })
const bodyRows = (t: HTMLElement) => within(t).getAllByRole('row').slice(1)
const names = (t: HTMLElement) => bodyRows(t).map(r => within(r).getAllByRole('link')[0].textContent)
const headers = (t: HTMLElement) => within(t).getAllByRole('columnheader').map(h => h.textContent?.trim())
const where = () => screen.getByTestId('where').textContent!

describe('Companies list (TAO)', () => {
  it('lists one row per company with real figures; TLFC is one company with three deals and a delinquency range', async () => {
    renderAt('/admin/companies', 'tao_admin')
    const t = await table()
    expect(bodyRows(t)).toHaveLength(10)
    expect(headers(t)).toContain('Notes')
    const essex = bodyRows(t).find(r => r.textContent!.includes('Essex Lease Financial Corp.'))!
    expect(essex.textContent).toContain('$179,272,568')
    expect(essex.textContent).toContain('1.31%')
    expect(essex.textContent).toContain('Up')
    expect(essex.textContent).toContain('0 breach · 1 watch')
    expect(essex.textContent).toContain('1 to review')
    const tlfc = bodyRows(t).find(r => r.textContent!.includes('TLFC'))!
    expect(tlfc.textContent).toContain('3 deals')
    expect(tlfc.textContent).toContain('0.35%–0.43%')
    expect(tlfc.textContent).toContain('$160,909,907')
    // Rising delinquency is bad: red with the arrow and the word.
    expect(within(essex).getByText(/Up/).className).toContain('pf-trend--bad')
    const finloc = bodyRows(t).find(r => r.textContent!.includes('Finloc'))!
    expect(within(finloc).getByText(/Down/).className).toContain('pf-trend--good')
    expect(finloc.textContent).toContain('Breach')
    expect(finloc.textContent).toContain('6 breach · 0 watch')
    expect(bodyRows(t).find(r => r.textContent!.includes('VCC IV LP'))!.textContent).toContain('Not screened')
    expect(screen.getByText('Adverse media to review')).toBeTruthy()
  }, 60_000)

  it('keeps every filter in the URL and reads them back from it', async () => {
    renderAt('/admin/companies?program=f-pil-2-0', 'tao_admin')
    let t = await table()
    expect(names(t)).toEqual(['Moneda Capital Corp.', 'Stride Capital', 'Xpedite Leasing'])
    expect((screen.getByLabelText('Program') as HTMLSelectElement).value).toBe('f-pil-2-0')

    await userEvent.selectOptions(screen.getByLabelText('Program'), '')
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'flagged')
    expect(where()).toBe('/admin/companies?status=flagged')
    t = await table()
    expect(names(t)).toEqual(['Essex Lease Financial Corp.', 'Finloc 2000 Inc.', 'Moneda Capital Corp.', 'TPine Leasing Capital Corporation', 'Xpedite Leasing'])
    expect(screen.getByText(/5 of 10 companies · Status: Breach or watch/)).toBeTruthy()

    await userEvent.selectOptions(screen.getByLabelText('Adverse media'), 'to_review')
    expect(where()).toBe('/admin/companies?status=flagged&adverse=to_review')
    expect(names(await table())).toEqual(['Essex Lease Financial Corp.'])

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(where()).toBe('/admin/companies')
    expect(names(await table())).toHaveLength(10)

    // Search covers deal names: "loans" finds TLFC through its "TLFC (Loans)" deal.
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'loans' } })
    expect(where()).toBe('/admin/companies?q=loans')
    expect(names(await table())).toEqual(['TLFC'])

    await userEvent.clear(screen.getByLabelText('Search'))
    await userEvent.selectOptions(screen.getByLabelText('Industry'), 'Equipment leasing')
    expect(where()).toBe('/admin/companies?industry=Equipment+leasing')
    expect(names(await table())).toEqual(['Dynamic Capital', 'Essex Lease Financial Corp.'])
  }, 60_000)

  it('sorts every column; balance sorts by the number', async () => {
    renderAt('/admin/companies', 'tao_admin')
    const t = await table()
    const sortable = within(t).getAllByRole('columnheader').filter(h => within(h).queryByRole('button'))
    expect(sortable).toHaveLength(within(t).getAllByRole('columnheader').length)
    await userEvent.click(within(t).getByRole('button', { name: /Balance/ }))
    expect(names(t)[0]).toBe('Stride Capital')
    await userEvent.click(within(t).getByRole('button', { name: /Balance/ }))
    expect(names(t)[0]).toBe('Meridian OneCap LP')
  }, 60_000)

  it('follow needs a signed-in user: disabled with a hint in role-only mode', async () => {
    renderAt('/admin/companies', 'tao_admin')
    await table()
    const star = screen.getByRole('button', { name: 'Follow Essex Lease Financial Corp.' })
    expect((star as HTMLButtonElement).disabled).toBe(true)
    expect(star.getAttribute('title')).toBe('Sign in as a user to follow companies')
    expect(screen.getByText(/Following needs a signed-in user/)).toBeTruthy()
  }, 60_000)

  it('follows and unfollows with PUT and DELETE, and the following filter narrows the list', async () => {
    signIn({ ...ANALYST, role: 'tao_analyst' })
    renderAt('/admin/companies', 'tao_analyst')
    await table()
    await userEvent.click(screen.getByRole('button', { name: 'Follow Essex Lease Financial Corp.' }))
    const put = state.calls.find(c => c.method === 'PUT')!
    expect(put.path).toBe('/companies/essex-lease-financial-corp/follow')
    expect(put.headers['X-User']).toBe(ANALYST.id)
    const star = await screen.findByRole('button', { name: 'Stop following Essex Lease Financial Corp.' })
    expect(star.getAttribute('aria-pressed')).toBe('true')
    await userEvent.click(screen.getByLabelText('Only companies I follow'))
    expect(where()).toBe('/admin/companies?following=1')
    expect(names(await table())).toEqual(['Essex Lease Financial Corp.'])
    await userEvent.click(star)
    expect(state.calls.some(c => c.method === 'DELETE' && c.path === '/companies/essex-lease-financial-corp/follow')).toBe(true)
    expect(await screen.findByText('No companies match')).toBeTruthy()
  }, 60_000)

  it('a row opens the company profile', async () => {
    renderAt('/admin/companies', 'tao_admin')
    const t = await table()
    await userEvent.click(bodyRows(t).find(r => r.textContent!.includes('TLFC'))!)
    expect(where()).toBe('/admin/companies/tlfc')
  }, 60_000)

  it('exports the rows shown as CSV, Notes included for TAO', async () => {
    let blob: Blob | undefined
    const create = vi.fn((b: Blob) => { blob = b; return 'blob:x' })
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderAt('/admin/companies?program=f-pil-2-0', 'tao_admin')
    await table()
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(click).toHaveBeenCalled()
    const text = await new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(blob!) })
    const lines = text.trim().split('\r\n')
    expect(lines[0]).toContain('Company,Deals,Programs')
    expect(lines[0].endsWith(',Notes')).toBe(true)
    expect(lines).toHaveLength(4)
    expect(lines[1]).toContain('Moneda Capital Corp.')
    expect(lines[1]).toContain('15019971.52')
    click.mockRestore()
  }, 60_000)
})

describe('Companies list (partners)', () => {
  it('shows the same columns minus Notes, only shared programs, and no to-review counts', async () => {
    state.shared = ['move-trust']
    renderAt('/investor/companies', 'investor_viewer')
    const t = await table()
    expect(headers(t)).not.toContain('Notes')
    expect(names(t)).toHaveLength(7)
    expect(names(t)).not.toContain('Moneda Capital Corp.')
    expect(screen.queryByText('Adverse media to review')).toBeNull()
    expect(bodyRows(t).find(r => r.textContent!.includes('Essex'))!.textContent).toContain('Clear')
    const program = screen.getByLabelText('Program') as HTMLSelectElement
    expect([...program.options].map(o => o.textContent)).toEqual(['All shared programs', 'MOVE Trust'])
    expect(state.calls.every(c => c.headers['X-Partner'] === 'investor')).toBe(true)
  }, 60_000)

  it('is not found while company profiles are off for partners', async () => {
    state.partnerFeature = false
    renderAt('/manager/companies', 'manager_admin')
    expect(await screen.findByText(/not switched on for your organisation/)).toBeTruthy()
    expect(state.calls.some(c => c.path === '/companies')).toBe(false)
  }, 60_000)
})

describe('Companies section on the Portfolio Executive Summary', () => {
  it('sits between the program cards and Flagged deals, one row per company; a row opens the profile (TAO)', async () => {
    renderAt('/admin/portfolio', 'tao_admin')
    const t = await table()
    expect(bodyRows(t)).toHaveLength(10)
    const headings = screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)
    expect(headings.indexOf('Companies')).toBeGreaterThan(headings.indexOf('MOVE Trust'))
    expect(headings.indexOf('Companies')).toBeLessThan(headings.indexOf('Flagged deals'))
    expect(screen.getByText(/10 lending companies across 2 programs/)).toBeTruthy()
    expect(headers(t)).toEqual(['Company', 'Program(s)', 'Industry', 'Latest month', 'Covenant status', 'Delinquency', 'News this week', 'Adverse media'])
    await userEvent.click(bodyRows(t).find(r => r.textContent!.includes('Essex'))!)
    expect(where()).toBe('/admin/companies/essex-lease-financial-corp')
  }, 60_000)

  it('shows for partners while Me.features.companies is true', async () => {
    state.shared = ['f-pil-2-0']
    renderAt('/investor/portfolio', 'investor_admin')
    const t = await table()
    expect(names(t)).toEqual(['Moneda Capital Corp.', 'Stride Capital', 'Xpedite Leasing'])
    expect(screen.getByRole('link', { name: 'All companies' }).getAttribute('href')).toBe('/investor/companies')
  }, 60_000)

  it('is absent for partners while the feature is off, and /companies is never called', async () => {
    state.partnerFeature = false
    renderAt('/manager/portfolio', 'manager_viewer')
    expect(await screen.findByRole('heading', { name: 'Flagged deals' })).toBeTruthy()
    await waitFor(() => expect(state.calls.some(c => c.path === '/me')).toBe(true))
    expect(screen.queryByRole('heading', { name: 'Companies' })).toBeNull()
    expect(state.calls.some(c => c.path.startsWith('/companies'))).toBe(false)
  }, 60_000)

  it('uses the signed-in user’s features without calling /me', async () => {
    signIn({ id: '00000000-0000-4000-8000-000000000005', name: 'M. Chen', role: 'investor_admin' }, 'investor')
    const { sessionStore } = await import('@/shell/session')
    sessionStore.set({ me: { ...sessionStore.get().me!, features: { companies: true } } as never })
    renderAt('/investor/portfolio', 'investor_admin')
    await table()
    expect(state.calls.some(c => c.path === '/me')).toBe(false)
  }, 60_000)
})
