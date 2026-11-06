// @vitest-environment jsdom
/** Company profile (D6) against the fake API in companyApi.tsx: sections in order, partner view, the adverse media
 * dialogs, analyst note rights and @mentions, the TLFC deal picker, Edit record, contacts, partner Not found. */
import '@/design/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { headerStore } from '@/shell/header'
import { ADMIN, ANALYST } from './companyFixtures'
import { renderAt, setup, signIn, state } from './companyApi'

beforeEach(() => { setup(); headerStore.clear() })
afterEach(() => { vi.unstubAllGlobals() })

const ESSEX = '/admin/companies/essex-lease-financial-corp'
// The first render of a test file is slow on a loaded machine (fixtures parse 12 deal objects); allow 15 s here.
const ready = () => screen.findByRole('heading', { name: 'What to watch' }, { timeout: 15_000 })
const h2s = () => screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent!.replace('TAO only', '').trim())
const where = () => screen.getByTestId('where').textContent!
const ORDER = ['What to watch', 'Performance from the monthly reports', 'Rolling loss ratios', 'Interest coverage ratio', 'Pool balance',
  'Covenant status history', 'Top 10 obligor concentration', 'Restatements and corrections', 'Latest news', 'Adverse media screening',
  'Watchlist and alerts', 'Analyst notes', 'Key contacts', 'Documents']

describe('Company profile (TAO Admin)', () => {
  it('shows every section in D6 order with real figures, and "Not set" for empty record fields', async () => {
    renderAt(ESSEX, 'tao_admin')
    await ready()
    await screen.findByRole('heading', { name: 'Restatements and corrections' })
    const hs = h2s()
    const idx = ORDER.map(t => hs.indexOf(t))
    expect(idx.every(i => i >= 0)).toBe(true)
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
    // Header and record
    expect(hs[0]).toContain('Essex Lease Financial Corp.')
    expect(screen.getByText(/latest report Jul 2026 \(settlement August 24, 2026\)/)).toBeTruthy()
    expect(screen.getByText(/1 covenant at watch, 0 in breach/)).toBeTruthy()
    const record = document.getElementById('record')!
    expect(within(record).getAllByText('Not set').length).toBeGreaterThanOrEqual(2) // headquarters, website
    expect(within(record).getByText('J. Moreau')).toBeTruthy() // owner, TAO only
    expect(within(record).getByText(/Aug 2026 report, expected by 24 Sep 2026/)).toBeTruthy()
    // KPIs from the published deal object
    expect(document.querySelector('[data-field="tranche_balance.closing"]')!.textContent).toBe('$179,272,568')
    expect(document.querySelector('[data-field="program.program_utilization_pct"]')!.textContent).toBe('88.54%')
    // What to watch links to its anchor
    expect(screen.getByRole('link', { name: /Covenant MSA 8.1 \(h\) within 10% of its limit/ }).getAttribute('href')).toBe('#chart-interest_coverage_ratio')
    // The covenant at watch is drawn on its own, not again in Performance
    expect(screen.getByText('The covenant at watch · MSA 8.1 (h)')).toBeTruthy()
    expect(within(document.getElementById('performance')!).queryByRole('heading', { name: /Interest coverage/ })).toBeNull()
    // No industry average anywhere
    expect(document.body.textContent).not.toMatch(/industry average/i)
    // Pool balance: four months loaded, nine grey slots
    expect(screen.getAllByText(/4 of 13 months loaded/).length).toBeGreaterThan(0)
    expect(document.querySelectorAll('[data-empty]')).toHaveLength(9)
    // Restatements: two by the company, one TAO correction
    const rest = screen.getByRole('table', { name: 'Restatements and corrections' })
    expect(within(rest).getAllByText('Restated by company')).toHaveLength(2)
    expect(within(rest).getByText('TAO correction')).toBeTruthy()
    // Documents link to the Reports library
    expect(within(document.getElementById('documents')!).getByText('Essex_-_202607_-_SETTREP.pdf')).toBeTruthy()
    expect(within(document.getElementById('documents')!).getByRole('link', { name: 'Reports library' }).getAttribute('href')).toBe('/admin/reports')
    expect(screen.getByText(/cannot be uploaded here yet/)).toBeTruthy()
  }, 60_000)

  it('compares with the program median by default, the mean on request, or both; with the covenant limit line', async () => {
    renderAt(ESSEX, 'tao_admin')
    await ready()
    const chart = document.getElementById('chart-delinquency_ratio_pct')!
    expect(chart.querySelector('[data-line="median"]')).toBeTruthy()
    expect(chart.querySelector('[data-line="mean"]')).toBeNull()
    expect(chart.querySelector('.co-limit')).toBeTruthy()
    expect(within(chart).getAllByText(/Limit MSA 8.1 \(d\)/).length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('button', { name: 'Mean' }))
    expect(chart.querySelector('[data-line="median"]')).toBeNull()
    expect(chart.querySelector('[data-line="mean"]')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Both' }))
    expect(chart.querySelector('[data-line="median"]')).toBeTruthy()
    expect(chart.querySelector('[data-line="mean"]')).toBeTruthy()
  }, 60_000)

  it('lists loss peers far off scale instead of drawing them', async () => {
    renderAt(ESSEX, 'tao_admin')
    await ready()
    const loss = document.getElementById('loss-ratios')!
    expect(loss.querySelector('[data-line="peer-move-trust-dynamic-capital-rolling_12month_loss_ratio_pct"]')).toBeTruthy()
    expect(loss.querySelector('[data-line^="peer-move-trust-tpine"]')).toBeNull()
    expect(within(loss).getByTestId('peers-listed').textContent).toContain('MOVE Trust - TPine Leasing Capital Corporation 12-month')
  }, 60_000)

  it('marks published covenant cells and says which months are recomputed on hover and focus', async () => {
    renderAt(ESSEX, 'tao_admin')
    await ready()
    const hist = screen.getByRole('table', { name: 'Covenant status by month' })
    const published = hist.querySelectorAll('td.is-published')
    expect(published.length).toBeGreaterThan(0)
    const recomputed = hist.querySelector('td.is-recomputed') as HTMLElement
    expect(recomputed.getAttribute('title')).toMatch(/recomputed from ratio history/)
    expect(recomputed.getAttribute('tabindex')).toBe('0')
    expect(recomputed.getAttribute('aria-label')).toMatch(/recomputed/)
  }, 60_000)

  it('news filters to Negative, shows a sentiment word, source and a link out', async () => {
    renderAt(ESSEX, 'tao_admin')
    await ready()
    const news = await screen.findByRole('list', { name: 'News items' })
    expect(within(news).getAllByRole('listitem')).toHaveLength(3)
    expect(within(news).getByText('Positive')).toBeTruthy()
    expect(within(news).getAllByRole('link', { name: /Open source/ })[0].getAttribute('target')).toBe('_blank')
    await userEvent.click(within(document.getElementById('news')!).getByRole('button', { name: 'Negative' }))
    expect(within(screen.getByRole('list', { name: 'News items' })).getAllByRole('listitem')).toHaveLength(1)
    expect(within(screen.getByRole('list', { name: 'News items' })).getByText('Negative')).toBeTruthy()
  }, 60_000)

  it('Mark reviewed needs a note, posts it, and the item reads Reviewed', async () => {
    renderAt(ESSEX, 'tao_admin')
    await ready()
    const adverse = document.getElementById('adverse')!
    expect(within(adverse).getByText(/not a check against sanctions lists/)).toBeTruthy()
    expect(await within(adverse).findByText('1 to review')).toBeTruthy()
    await userEvent.click(within(adverse).getByRole('button', { name: /Mark reviewed: Fixture: name appears/ }))
    const dlg = screen.getByRole('dialog', { name: 'Mark reviewed' })
    await userEvent.click(within(dlg).getByRole('button', { name: 'Mark reviewed' }))
    expect(within(dlg).getByText(/Write at least 3 characters/)).toBeTruthy()
    expect(state.calls.some(c => c.path.includes('/review'))).toBe(false)
    fireEvent.change(within(dlg).getByLabelText(/Review note/), { target: { value: 'Checked the notice; not this company.' } })
    await userEvent.click(within(dlg).getByRole('button', { name: 'Mark reviewed' }))
    const post = state.calls.find(c => c.method === 'POST' && c.path.endsWith('/review'))!
    expect(post.path).toBe('/adverse/a0000000-0000-4000-8000-000000000001/review')
    expect(post.body).toEqual({ note: 'Checked the notice; not this company.' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(within(adverse).getAllByText('Reviewed')).toHaveLength(2)
    expect(within(adverse).getByText('Clear')).toBeTruthy()
  }, 60_000)

  it('Dismiss takes a reason', async () => {
    renderAt(ESSEX, 'tao_admin')
    await ready()
    const adverse = document.getElementById('adverse')!
    await userEvent.click(await within(adverse).findByRole('button', { name: /Dismiss: Fixture: name appears/ }))
    const dlg = screen.getByRole('dialog', { name: 'Dismiss item' })
    fireEvent.change(within(dlg).getByLabelText(/Reason/), { target: { value: 'Different entity' } })
    await userEvent.click(within(dlg).getByRole('button', { name: 'Dismiss' }))
    expect(state.calls.find(c => c.path.endsWith('/dismiss'))!.body).toEqual({ note: 'Different entity' })
    await waitFor(() => expect(within(adverse).getAllByText('Dismissed')).toHaveLength(2))
  }, 60_000)

  it('an analyst sees adverse items but cannot act on them', async () => {
    renderAt(ESSEX, 'tao_analyst')
    await ready()
    const adverse = document.getElementById('adverse')!
    expect(await within(adverse).findByText('Open')).toBeTruthy()
    expect(within(adverse).queryByRole('button', { name: /Mark reviewed/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit record' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add contact' })).toBeNull()
  }, 60_000)

  it('"View as partner" hides every TAO-only part', async () => {
    renderAt(ESSEX, 'tao_admin')
    await ready()
    expect(await screen.findByRole('list', { name: 'Analyst notes' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'View as partner' }))
    expect(screen.getByText(/Partner view: TAO-only sections are hidden/)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /Analyst notes/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit record' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add contact' })).toBeNull()
    expect(screen.queryByText('TAO relationship owner')).toBeNull()
    const adverse = document.getElementById('adverse')!
    expect(within(adverse).queryByText('Open')).toBeNull()
    expect(within(adverse).queryByText('Dismissed')).toBeNull()
    expect(within(adverse).getByText('Reviewed')).toBeTruthy()
    expect(within(adverse).getByText('Clear')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'TAO view' }))
    expect(screen.getByRole('heading', { name: /Analyst notes/ })).toBeTruthy()
  }, 60_000)
})

describe('Analyst notes', () => {
  it('needs a signed-in user to write', async () => {
    renderAt(ESSEX, 'tao_admin')
    await screen.findByRole('list', { name: 'Analyst notes' })
    expect(screen.queryByRole('combobox', { name: 'New note' })).toBeNull()
    expect(screen.getByText(/Adding a note needs a signed-in user/)).toBeTruthy()
  }, 60_000)

  it('an analyst edits and removes only their own note', async () => {
    signIn({ ...ANALYST, role: 'tao_analyst' })
    renderAt(ESSEX, 'tao_analyst')
    const list = await screen.findByRole('list', { name: 'Analyst notes' })
    const [admins, own] = within(list).getAllByRole('listitem')
    expect(within(admins).queryByRole('button')).toBeNull()
    expect(within(own).getByRole('button', { name: /^Edit note/ })).toBeTruthy()
    expect(within(own).getByRole('button', { name: /^Remove note/ })).toBeTruthy()
    expect(within(own).getByText('@A. Patel').tagName).toBe('B')
    expect(within(own).getByText(/Jul 2026 report/)).toBeTruthy()
    await userEvent.click(within(own).getByRole('button', { name: /^Edit note/ }))
    const box = within(own).getByRole('combobox', { name: 'Edit your note' })
    fireEvent.change(box, { target: { value: 'Updated after the call.' } })
    await userEvent.click(within(own).getByRole('button', { name: 'Save' }))
    const patch = state.calls.find(c => c.method === 'PATCH')!
    expect(patch.path).toBe('/company-notes/b0000000-0000-4000-8000-000000000001')
    expect(patch.body).toMatchObject({ body: 'Updated after the call.', collection_period: '2026-07' })
    expect(await within(list).findByText('Updated after the call.')).toBeTruthy()
  }, 60_000)

  it('a TAO Admin removes anyone’s note but edits only their own', async () => {
    signIn({ ...ADMIN, role: 'tao_admin' })
    renderAt(ESSEX, 'tao_admin')
    const list = await screen.findByRole('list', { name: 'Analyst notes' })
    const [own, analysts] = within(list).getAllByRole('listitem')
    expect(within(own).getByRole('button', { name: /^Edit note/ })).toBeTruthy()
    expect(within(analysts).queryByRole('button', { name: /^Edit note/ })).toBeNull()
    await userEvent.click(within(analysts).getByRole('button', { name: /^Remove note/ }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove note' }))
    expect(state.calls.some(c => c.method === 'DELETE' && c.path === '/company-notes/b0000000-0000-4000-8000-000000000001')).toBe(true)
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1))
  }, 60_000)

  it('adds a note with an @mention and a report month', async () => {
    signIn({ ...ADMIN, role: 'tao_admin' })
    renderAt(ESSEX, 'tao_admin')
    await screen.findByRole('list', { name: 'Analyst notes' })
    const box = screen.getByRole('combobox', { name: 'New note' })
    await userEvent.type(box, 'Ask @Mor')
    const opt = await screen.findByRole('option', { name: /J. Moreau/ })
    fireEvent.mouseDown(opt)
    expect((box as HTMLTextAreaElement).value).toBe('Ask @J. Moreau ')
    await userEvent.type(box, 'about July losses')
    await userEvent.selectOptions(within(document.getElementById('notes')!).getByLabelText('Report month'), '2026-07')
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }))
    const post = state.calls.find(c => c.method === 'POST' && c.path.endsWith('/notes'))!
    expect(post.body).toEqual({ body: 'Ask @J. Moreau about July losses', mentions: [ANALYST.id], collection_period: '2026-07' })
    expect(post.headers['X-User']).toBe(ADMIN.id)
    expect(await screen.findByText('about July losses', { exact: false })).toBeTruthy()
  }, 60_000)
})

describe('Record and contacts (TAO Admin)', () => {
  it('Edit record sends only the changed fields with a required reason', async () => {
    renderAt(ESSEX, 'tao_admin')
    await ready()
    await userEvent.click(screen.getByRole('button', { name: 'Edit record' }))
    const dlg = screen.getByRole('dialog', { name: /Edit record/ })
    fireEvent.change(within(dlg).getByLabelText('Headquarters'), { target: { value: 'Toronto, ON' } })
    await userEvent.selectOptions(within(dlg).getByLabelText('TAO relationship owner'), ADMIN.id)
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save record' }))
    expect(within(dlg).getByText(/Give a reason/)).toBeTruthy()
    expect(state.calls.some(c => c.method === 'PATCH')).toBe(false)
    expect((within(dlg).getByRole('checkbox', { name: /MOVE Trust - Essex Lease/ }) as HTMLInputElement).checked).toBe(true)
    fireEvent.change(within(dlg).getByLabelText(/Reason/), { target: { value: 'From the servicing agreement' } })
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save record' }))
    const patch = state.calls.find(c => c.method === 'PATCH')!
    expect(patch.path).toBe('/companies/essex-lease-financial-corp')
    expect(patch.body).toEqual({ headquarters: 'Toronto, ON', owner_user_id: ADMIN.id, reason: 'From the servicing agreement' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(within(document.getElementById('record')!).getByText('Toronto, ON')).toBeTruthy()
    expect(within(document.getElementById('record')!).getByText('A. Patel')).toBeTruthy()
  }, 60_000)

  it('adds, edits and removes a key contact, each with a reason', async () => {
    renderAt(ESSEX, 'tao_admin')
    await ready()
    await userEvent.click(screen.getByRole('button', { name: 'Add contact' }))
    let dlg = screen.getByRole('dialog', { name: 'Add contact' })
    fireEvent.change(within(dlg).getByLabelText(/Name/), { target: { value: 'L. Martin' } })
    fireEvent.change(within(dlg).getByLabelText(/Reason/), { target: { value: 'New servicing manager' } })
    await userEvent.click(within(dlg).getByRole('button', { name: 'Add contact' }))
    expect(state.calls.find(c => c.method === 'POST' && c.path.endsWith('/contacts'))!.body).toEqual({ name: 'L. Martin', role: null, email: null, receives: null, reason: 'New servicing manager' })
    expect(await screen.findByRole('cell', { name: 'L. Martin' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Remove R. Singh' }))
    dlg = screen.getByRole('alertdialog')
    fireEvent.change(within(dlg).getByLabelText(/Reason/), { target: { value: 'Left the company' } })
    await userEvent.click(within(dlg).getByRole('button', { name: 'Remove contact' }))
    expect(state.calls.find(c => c.method === 'DELETE')!.path).toBe('/company-contacts/c0000000-0000-4000-8000-000000000001?reason=Left%20the%20company')
    await waitFor(() => expect(screen.queryByRole('cell', { name: 'R. Singh' })).toBeNull())
  }, 60_000)
})

describe('Deal picker (TLFC, one company with three deals)', () => {
  it('defaults to the first deal and switches with ?deal=', async () => {
    renderAt('/admin/companies/tlfc', 'tao_admin')
    await ready()
    const picker = screen.getByLabelText('Deal') as HTMLSelectElement
    expect([...picker.options].map(o => o.textContent)).toEqual(['TLFC (Leases) · MOVE Trust', 'TLFC (Loans) · MOVE Trust', 'TLFC LP (Leases) · MOVE Trust'])
    expect(state.calls.some(c => c.path === '/companies/tlfc/deals/move-trust-tlfc-leases/insights')).toBe(true)
    expect(document.querySelector('[data-field="tranche_balance.closing"]')!.textContent).toBe('$8,471,550')
    await userEvent.selectOptions(picker, 'move-trust-tlfc-loans')
    expect(where()).toBe('/admin/companies/tlfc?deal=move-trust-tlfc-loans')
    await waitFor(() => expect(document.querySelector('[data-field="tranche_balance.closing"]')?.textContent).toBe('$15,505,814'))
    expect(state.calls.some(c => c.path === '/companies/tlfc/deals/move-trust-tlfc-loans/insights')).toBe(true)
  }, 60_000)

  it('opens straight at the deal named in the URL', async () => {
    renderAt('/admin/companies/tlfc?deal=move-trust-tlfc-lp-leases', 'tao_admin')
    await ready()
    expect((screen.getByLabelText('Deal') as HTMLSelectElement).value).toBe('move-trust-tlfc-lp-leases')
    expect(document.querySelector('[data-field="tranche_balance.closing"]')!.textContent).toBe('$136,932,543')
  }, 60_000)
})

describe('Company profile (partners)', () => {
  it('has no TAO-only parts, never asks for notes, and sees reviewed adverse items only', async () => {
    renderAt('/investor/companies/essex-lease-financial-corp', 'investor_viewer')
    await ready()
    await screen.findByRole('heading', { name: 'Documents' })
    expect(screen.queryByRole('button', { name: 'View as partner' })).toBeNull()
    expect(screen.queryByRole('heading', { name: /Analyst notes/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit record' })).toBeNull()
    expect(screen.queryByText('TAO relationship owner')).toBeNull()
    expect(state.calls.some(c => c.path.includes('/notes') || c.path.startsWith('/users'))).toBe(false)
    const adverse = document.getElementById('adverse')!
    expect(await within(adverse).findByText('Reviewed')).toBeTruthy()
    expect(within(adverse).queryByText('Open')).toBeNull()
    expect(within(document.getElementById('documents')!).getByRole('link', { name: 'Data room' }).getAttribute('href')).toBe('/investor/data-room')
  }, 60_000)

  it('gets Not found for a company outside its programs', async () => {
    state.shared = ['f-pil-2-0']
    renderAt('/manager/companies/essex-lease-financial-corp', 'manager_admin')
    expect(await screen.findByText('Company not found')).toBeTruthy()
  }, 60_000)

  it('gets Not found while company profiles are off', async () => {
    state.partnerFeature = false
    renderAt('/investor/companies/stride-capital', 'investor_admin')
    expect(await screen.findByText('Company not found')).toBeTruthy()
    expect(state.calls.some(c => c.path.startsWith('/companies'))).toBe(false)
  }, 60_000)

  it('shows "Not screened yet" when the news search has not covered the company', async () => {
    renderAt('/investor/companies/vcc-iv-lp', 'investor_viewer')
    expect(await screen.findByText(/Not screened yet. The daily news search/)).toBeTruthy()
  }, 60_000)

  it('shows "No news in 30 days" for a screened company with no items', async () => {
    renderAt('/investor/companies/stride-capital', 'investor_viewer')
    expect(await screen.findByText('No news in 30 days.')).toBeTruthy()
  }, 60_000)
})
