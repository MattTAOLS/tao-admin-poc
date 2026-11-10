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

  it('opens a chart full screen, redrawn larger in a dialog with the same lines and legend, and closes it', async () => {
    renderAt(ESSEX, 'tao_admin')
    await ready()
    const loss = document.getElementById('loss-ratios')!
    await userEvent.click(within(loss).getByRole('button', { name: /^Full screen: Rolling loss ratios/ }))
    const dialog = screen.getByRole('dialog', { name: /Rolling loss ratios/ })
    expect(dialog.querySelector('[data-line="peer-move-trust-dynamic-capital-rolling_12month_loss_ratio_pct"]')).toBeTruthy()
    expect(dialog.querySelector('.co-legend')?.textContent).toContain('12-month')
    expect(dialog.querySelector('svg[role="img"]')?.getAttribute('viewBox')).toBe('0 0 1100 440')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
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
    expect(within(news).getAllByRole('listitem')).toHaveLength(4) // kept and unchecked; excluded and pending only on request
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

describe('Latest news (wave E: confirmed dates, sources, the news check)', () => {
  const newsList = () => screen.findByRole('list', { name: 'News items' }, { timeout: 15_000 })
  const item = (list: HTMLElement, title: RegExp) => within(list).getAllByRole('listitem').find(li => title.test(li.textContent!))!
  const newsCalls = () => state.calls.filter(c => c.path.startsWith('/companies/essex-lease-financial-corp/news'))

  it('shows the confirmed date, or "Date not confirmed" with the source date; the sources by name; FR for French', async () => {
    renderAt(ESSEX, 'tao_admin')
    const list = await newsList()
    const lis = within(list).getAllByRole('listitem')
    // API order: published_at, else source_date, else found_at.
    expect(lis[0].textContent).toContain('Fixture : liste des dépôts')
    const fr = item(list, /liste des dépôts/)
    expect(fr.querySelector('[data-date="not-confirmed"]')!.textContent).toBe('Date not confirmedsource says 6 Nov 2026')
    expect(within(fr).getByText('FR').getAttribute('title')).toBe('French')
    expect(within(fr).getByText('Found by Google News')).toBeTruthy()
    const office = item(list, /regional office/)
    expect(within(office).getByText('5 Nov 2026')).toBeTruthy()
    expect(within(office).getByText('Found by Google News, NewsCatcher')).toBeTruthy()
    expect(within(office).queryByText('FR')).toBeNull()
    expect(within(office).queryByText('Date not confirmed')).toBeNull()
    const sub = document.getElementById('news')!.textContent!
    expect(sub).toContain('Counts and alerts use only checked stories with a confirmed date.')
    expect(newsCalls().map(c => c.path)).toEqual(['/companies/essex-lease-financial-corp/news?days=30'])
  }, 60_000)

  it('TAO sees the check: kept with its reason on hover and expanded, "Not checked yet" for older stories', async () => {
    renderAt(ESSEX, 'tao_admin')
    const list = await newsList()
    const office = item(list, /regional office/)
    expect(office.getAttribute('data-check')).toBe('kept')
    expect(within(office).getByText('Kept by the news check')).toBeTruthy()
    const details = office.querySelector('details.co-check') as HTMLDetailsElement
    expect(details.querySelector('summary')!.getAttribute('title')).toBe('Names Essex Lease Financial and its new office')
    expect(details.open).toBe(false)
    await userEvent.click(within(details).getByText('Why'))
    expect(details.open).toBe(true)
    expect(within(details).getByText(/Names Essex Lease Financial and its new office/).textContent).toContain('confidence 94%')
    const old = item(list, /registry annual filing list/)
    expect(old.getAttribute('data-check')).toBe('unchecked')
    expect(within(old).getByText('Not checked yet')).toBeTruthy()
    expect(within(list).queryByText('Excluded by the news check')).toBeNull()
    expect(within(list).queryByText('Awaiting check')).toBeNull()
  }, 60_000)

  it('"Show excluded" refetches with include and lists excluded stories muted with the reason, and pending ones as "Awaiting check"', async () => {
    renderAt(ESSEX, 'tao_admin')
    await newsList()
    const box = within(document.getElementById('news')!).getByRole('checkbox', { name: 'Show excluded' })
    expect(within(document.getElementById('news')!).getByText('TAO only')).toBeTruthy()
    await userEvent.click(box)
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'News items' })).getAllByRole('listitem')).toHaveLength(6))
    expect(newsCalls().map(c => c.path)).toContain('/companies/essex-lease-financial-corp/news?days=30&include=all')
    const list = screen.getByRole('list', { name: 'News items' })
    const ex = item(list, /property market cools/)
    expect(ex.className).toContain('is-excluded')
    expect(within(ex).getByText('Excluded by the news check')).toBeTruthy()
    expect(within(ex).getByText('About Essex County property, not the lender')).toBeTruthy()
    expect(within(ex).getByText('Found by Brave, Event Registry')).toBeTruthy()
    const pend = item(list, /third-quarter volumes/)
    expect(pend.getAttribute('data-check')).toBe('pending')
    expect(within(pend).getByText('Awaiting check')).toBeTruthy()
    expect(within(pend).getByText('Date not confirmed')).toBeTruthy()
    expect(within(pend).queryByText(/source says/)).toBeNull()
    expect(within(pend).getByText('Found by Dow Jones, LexisNexis')).toBeTruthy()
    expect(document.getElementById('news')!.textContent).toContain('Showing excluded stories and those awaiting the check (TAO only).')
    // Off again: back to kept and unchecked.
    await userEvent.click(box)
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'News items' })).getAllByRole('listitem')).toHaveLength(4))
  }, 60_000)

  it('"View as partner" drops the check, the toggle and the extra stories, and asks without include', async () => {
    renderAt(ESSEX, 'tao_admin')
    await newsList()
    await userEvent.click(within(document.getElementById('news')!).getByRole('checkbox', { name: 'Show excluded' }))
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'News items' })).getAllByRole('listitem')).toHaveLength(6))
    const before = newsCalls().length
    await userEvent.click(screen.getByRole('button', { name: 'View as partner' }))
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'News items' })).getAllByRole('listitem')).toHaveLength(3))
    expect(newsCalls().slice(before).map(c => c.path)).toEqual(['/companies/essex-lease-financial-corp/news?days=30'])
    const news = document.getElementById('news')!
    expect(within(news).queryByRole('checkbox', { name: 'Show excluded' })).toBeNull()
    expect(within(news).queryByText(/Kept by the news check|Not checked yet|Awaiting check|Excluded by the news check/)).toBeNull()
    expect(news.querySelector('[data-check]')).toBeNull()
    expect(within(document.getElementById('record')!).queryByTestId('news-search')).toBeNull()
  }, 60_000)

  it('partners get kept stories only, with dates, sources and FR, and nothing TAO-only', async () => {
    renderAt('/investor/companies/essex-lease-financial-corp', 'investor_viewer')
    const list = await newsList()
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(within(list).queryByText(/registry annual filing list/)).toBeNull() // unchecked: TAO only
    expect(within(item(list, /liste des dépôts/)).getByText('FR')).toBeTruthy()
    expect(within(item(list, /liste des dépôts/)).getByText('source says 6 Nov 2026')).toBeTruthy()
    expect(within(item(list, /regional office/)).getByText('Found by Google News, NewsCatcher')).toBeTruthy()
    const news = document.getElementById('news')!
    expect(within(news).queryByRole('checkbox')).toBeNull()
    expect(within(news).queryByText('TAO only')).toBeNull()
    expect(within(news).queryByText(/Kept by the news check|Not checked yet|Awaiting check|Excluded/)).toBeNull()
    expect(newsCalls().every(c => !c.path.includes('include'))).toBe(true)
    expect(within(document.getElementById('record')!).queryByText(/News search|Context words/)).toBeNull()
  }, 60_000)
})

describe('News search settings (TAO Admin, decision E7)', () => {
  it('shows the settings read-only in the record panel for TAO', async () => {
    renderAt(ESSEX, 'tao_analyst')
    await ready()
    const s = within(document.getElementById('record')!).getByTestId('news-search')
    expect(s.textContent).toContain('Context words: None')
    expect(s.textContent).toContain('Exclusions: Essex County Council')
    expect(s.textContent).toContain('Languages: English, French')
  }, 60_000)

  it('Edit record validates the news search and sends it, whole, only when changed', async () => {
    renderAt(ESSEX, 'tao_admin')
    await ready()
    await userEvent.click(screen.getByRole('button', { name: 'Edit record' }))
    const dlg = screen.getByRole('dialog', { name: /Edit record/ })
    const group = within(dlg).getByTestId('news-search-edit')
    expect(within(group).getByText(/For a generic name: a story must mention at least one of these, e.g. leasing, equipment, finance/)).toBeTruthy()
    expect(within(group).getByText(/Phrases that always mean a different company/)).toBeTruthy()
    expect((within(group).getByLabelText('Exclusion phrases') as HTMLTextAreaElement).value).toBe('Essex County Council')
    fireEvent.change(within(dlg).getByLabelText(/Reason/), { target: { value: 'Generic name in French press' } })
    // Too-short context word, no language: blocked.
    fireEvent.change(within(group).getByLabelText('Context words'), { target: { value: 'leasing, x' } })
    await userEvent.click(within(group).getByRole('checkbox', { name: 'English' }))
    await userEvent.click(within(group).getByRole('checkbox', { name: 'French' }))
    expect(within(group).getByText('Each context word needs at least 2 characters.')).toBeTruthy()
    expect(within(group).getByText('Choose at least one language.')).toBeTruthy()
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save record' }))
    expect(state.calls.some(c => c.method === 'PATCH')).toBe(false)
    // Fixed: duplicates and blanks dropped, languages in contract order.
    fireEvent.change(within(group).getByLabelText('Context words'), { target: { value: 'leasing, equipment, , Leasing' } })
    await userEvent.click(within(group).getByRole('checkbox', { name: 'French' }))
    fireEvent.change(within(group).getByLabelText('Exclusion phrases'), { target: { value: 'Essex County Council\nEssex Police' } })
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save record' }))
    const patch = state.calls.find(c => c.method === 'PATCH')!
    expect(patch.body).toEqual({
      news_search: { context_terms: ['leasing', 'equipment'], exclusions: ['Essex County Council', 'Essex Police'], languages: ['fr'] },
      reason: 'Generic name in French press',
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const s = within(document.getElementById('record')!).getByTestId('news-search')
    expect(s.textContent).toContain('Context words: leasing, equipment')
    expect(s.textContent).toContain('Exclusions: Essex County Council; Essex Police')
    expect(s.textContent).toContain('Languages: French')
  }, 60_000)

  it('putting the news search back as it was sends nothing for it', async () => {
    renderAt(ESSEX, 'tao_admin')
    await ready()
    await userEvent.click(screen.getByRole('button', { name: 'Edit record' }))
    const dlg = screen.getByRole('dialog', { name: /Edit record/ })
    const group = within(dlg).getByTestId('news-search-edit')
    await userEvent.click(within(group).getByRole('checkbox', { name: 'English' }))
    await userEvent.click(within(group).getByRole('checkbox', { name: 'English' })) // back on: now French, English
    fireEvent.change(within(group).getByLabelText('Exclusion phrases'), { target: { value: ' Essex County Council \n' } })
    fireEvent.change(within(dlg).getByLabelText('Website'), { target: { value: 'essexlease.example.com' } })
    fireEvent.change(within(dlg).getByLabelText(/Reason/), { target: { value: 'Website from the CFO' } })
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save record' }))
    expect(state.calls.find(c => c.method === 'PATCH')!.body).toEqual({ website: 'essexlease.example.com', reason: 'Website from the CFO' })
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
