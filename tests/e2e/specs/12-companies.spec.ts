import { expect, test, type Locator, type Page } from '@playwright/test'
import { Api } from '../lib/api'
import { DEALS, MOVE, STEP9, STEP12, USERS, referenceDeal } from '../lib/facts'
import { programPartners } from '../lib/tenancy'
import { pageTitle, shot, signInAsUser } from '../lib/ui'

/** Demo step 12 (phase 2, wave D): companies. 12a the Companies list; 12b the Essex profile and TLFC's deal picker;
 * 12c the news feed on, Run now on the test fixture, news and adverse media; 12d an analyst note with an @mention;
 * 12e the partner view behind company_profiles_partner_enabled; 12f the company record and a contact; 12g the news
 * runs in System settings. Runs after step 11 (Essex published to July 2026). The stack must run the news worker on
 * its fixture: add `-f scripts/compose.news-fixture.yml` to the compose command. */
test.describe.configure({ mode: 'serial' })

type U = (typeof USERS)[keyof typeof USERS]
const as = (u: U) => new Api(u.role as any, undefined, u.id)
const patel = as(USERS.patel), moreau = as(USERS.moreau), alvarez = as(USERS.alvarez)
const S = STEP12
const essexDeal = DEALS[S.essex.deal].slug

/** Money as the Companies list and the KPI tiles print it (whole dollars). */
const dollars = (v: number) => '$' + Math.round(v).toLocaleString('en-US')
const pct = (v: number) => (v * 100).toFixed(2) + '%'
const STATUS_WORD: Record<string, string> = { BREACH: 'Breach', WATCH: 'Watch', OK: 'OK' }

const companiesTable = (page: Page) => page.getByRole('table', { name: 'Lending companies' })
const companyRow = (page: Page, name: string) =>
  companiesTable(page).getByRole('row').filter({ has: page.getByRole('link', { name, exact: true }) })
const countLine = (page: Page) => page.locator('.co-count')
const section = (page: Page, id: string) => page.locator(`[id="${id}"]`)
const published = (deal: string) => patel.get(`/published/programs/${MOVE.program}/deals/${deal}`)

/** System settings: change the switches, then Save changes with one reason. */
async function saveSetting(page: Page, change: () => Promise<void>, reason: string) {
  await page.goto('/admin/settings/system')
  await expect(pageTitle(page)).toHaveText('System settings')
  await change()
  await page.getByRole('button', { name: 'Save changes' }).click()
  const save = page.getByRole('dialog', { name: /^Save 1 setting/ })
  await save.getByLabel(/^Reason/).fill(reason)
  await save.getByRole('button', { name: 'Save 1 change' }).click()
  await expect(save).toBeHidden()
}

async function openProfile(page: Page, shell: string, slug: string, query = '') {
  await page.goto(`/${shell}/companies/${slug}${query}`)
  await expect(section(page, 'record')).toBeVisible()
}

test('step 12a: companies list: 10 companies, TLFC one row with 3 deals, filter in the URL, search by deal, follow, figures', async ({ page }) => {
  const rows = (await patel.get('/companies')).body as any[]
  expect(rows.length).toBe(S.companies)
  const tlfc = rows.find(r => r.slug === S.tlfc.slug)
  expect(tlfc.deals.map((d: any) => d.deal_slug).sort()).toEqual([...S.tlfc.deals].sort())

  await signInAsUser(page, USERS.patel)
  await page.locator('aside').getByRole('link', { name: 'Companies' }).first().click()
  await expect(page).toHaveURL(/\/admin\/companies$/)
  await expect(pageTitle(page)).toHaveText('Companies')
  await expect(companiesTable(page).locator('tbody tr')).toHaveCount(S.companies)
  await expect(countLine(page)).toContainText(`${S.companies} of ${S.companies} companies`)
  await expect(companyRow(page, S.tlfc.name)).toHaveCount(1)
  await expect(companyRow(page, S.tlfc.name)).toContainText('3 deals')
  await shot(page, '12-companies-list')

  // Status "Breach or watch": the count is the companies whose worst status is BREACH or WATCH, and the URL holds it.
  const flagged = rows.filter(r => r.status === 'BREACH' || r.status === 'WATCH')
  expect(flagged.length, 'at least one company at watch or breach after steps 1-11').toBeGreaterThan(0)
  await page.getByRole('combobox', { name: 'Status' }).selectOption('flagged')
  await expect(page).toHaveURL(/[?&]status=flagged/)
  await expect(countLine(page)).toContainText(`${flagged.length} of ${S.companies} companies`)
  await expect(companiesTable(page).locator('tbody tr')).toHaveCount(flagged.length)
  for (const r of flagged) await expect(companyRow(page, r.name)).toHaveCount(1)
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveValue('flagged')
  await expect(countLine(page)).toContainText(`${flagged.length} of ${S.companies} companies`)
  await shot(page, '12-companies-filtered')

  // Search covers deal names: "Loans" is only in the deal "TLFC (Loans)".
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await page.getByRole('searchbox', { name: 'Search' }).fill(S.searchByDeal.q)
  await expect(page).toHaveURL(new RegExp(`[?&]q=${S.searchByDeal.q}`))
  await expect(countLine(page)).toContainText(`1 of ${S.companies} companies`)
  await expect(companyRow(page, S.searchByDeal.finds)).toHaveCount(1)
  await page.getByRole('button', { name: 'Clear filters' }).click()

  // Follow Essex with the star; the API lists it under following=true.
  await companyRow(page, S.essex.name).getByRole('button', { name: `Follow ${S.essex.name}` }).click()
  await expect(companyRow(page, S.essex.name).getByRole('button', { name: `Stop following ${S.essex.name}` })).toHaveAttribute('aria-pressed', 'true')
  expect(((await patel.get('/companies?following=true')).body as any[]).map(r => r.slug)).toEqual([S.essex.slug])

  // Balance and status on two rows against the published deal objects: Essex (MOVE Trust, July 2026) and Xpedite
  // (F-PIL 2.0, August 2026).
  const checks = [
    { name: S.essex.name, program: MOVE.program, deal: essexDeal },
    { name: 'Xpedite Leasing', program: 'f-pil-2-0', deal: DEALS.xpedite.slug },
  ]
  for (const c of checks) {
    const d = (await patel.get(`/published/programs/${c.program}/deals/${c.deal}`)).body
    const r = rows.find(x => x.name === c.name)
    expect(r.balance, `${c.name} balance`).toBeCloseTo(d.tranche_balance.closing, 2)
    expect(r.status, `${c.name} status`).toBe(d.worst_status)
    const row = companyRow(page, c.name)
    await expect(row).toContainText(dollars(d.tranche_balance.closing))
    await expect(row).toContainText(STATUS_WORD[d.worst_status])
    await expect(row).toContainText(`${d.covenant_summary.BREACH} breach · ${d.covenant_summary.WATCH} watch`)
  }
})

test('step 12b: Essex profile: KPIs from the July 2026 object, what to watch, median and mean, covenant history, restatements; TLFC deal picker', async ({ page }) => {
  const d = (await published(essexDeal)).body
  const ref = referenceDeal(S.essex.deal)
  expect(d.published_period ?? d.collection_period).toMatch(/2026-07|July 2026/)
  const ins = (await patel.get(`/companies/${S.essex.slug}/deals/${essexDeal}/insights`)).body
  expect(ins.collection_period).toBe(S.essex.period)

  await signInAsUser(page, USERS.patel)
  await openProfile(page, 'admin', S.essex.slug)
  await expect(pageTitle(page)).toHaveText(S.essex.name)
  await expect(section(page, 'record')).toContainText('latest report Jul 2026')

  // KPIs: the published object, which equals the shared dashboard object for Essex July 2026.
  for (const [field, text] of [
    ['tranche_balance.closing', dollars(d.tranche_balance.closing)],
    ['contracts.closing', d.contracts.closing.toLocaleString('en-US')],
    ['program.program_utilization_pct', pct(d.program.program_utilization_pct)],
    ['covenant_summary.WATCH', String(d.covenant_summary.WATCH)],
    ['covenant_summary.BREACH', String(d.covenant_summary.BREACH)],
  ] as const) await expect(page.locator(`[data-field="${field}"]`).first(), field).toHaveText(text)
  expect(d.tranche_balance.closing).toBeCloseTo(ref.tranche_balance.closing, 2)
  expect(d.contracts.closing).toBe(ref.contracts.closing)
  expect(d.covenant_summary).toEqual(ref.covenant_summary)

  // What to watch: at least the covenant at watch (MSA 8.1 (h), interest coverage, in the published object).
  expect(d.covenants.filter((c: any) => c.status === 'WATCH').map((c: any) => c.legal_ref)).toEqual(['MSA 8.1 (h)'])
  const near = (ins.signals as any[]).find(s => s.kind === 'covenant_near_limit')
  expect(near, 'covenant_near_limit signal').toBeTruthy()
  await expect(section(page, 'what-to-watch')).toContainText(near.title)
  await shot(page, '12-essex-profile')

  // Delinquency: Essex's own line plus the program median by default; Mean swaps the median for the mean.
  const dq = (ins.series as any[]).find(s => s.metric === 'delinquency_ratio_pct')
  const jul = dq.deal.find((p: any) => p.month === '2026-07')
  expect(jul.value).toBeCloseTo(ref.ratio_history.find((r: any) => r.month === 'Jul-26').delinquency_ratio_pct, 6)
  const chart = page.locator('#chart-delinquency_ratio_pct')
  await chart.scrollIntoViewIfNeeded()
  await expect(chart.locator('[data-line="deal"]').first()).toBeAttached()
  const compare = page.getByRole('group', { name: 'Compare with the program' })
  await expect(compare.getByRole('button', { name: 'Median' })).toHaveAttribute('aria-pressed', 'true')
  await expect(chart.locator('.co-legend')).toContainText('Program median')
  await expect(chart.locator('.co-legend')).not.toContainText('Program mean')
  if (dq.program_median.some((p: any) => p.value !== null)) await expect(chart.locator('[data-line="median"]').first()).toBeAttached()
  await shot(page, '12-delinquency-median')
  await compare.getByRole('button', { name: 'Mean' }).click()
  await expect(compare.getByRole('button', { name: 'Mean' })).toHaveAttribute('aria-pressed', 'true')
  await expect(chart.locator('.co-legend')).toContainText('Program mean')
  await expect(chart.locator('.co-legend')).not.toContainText('Program median')
  await expect(chart.locator('[data-line="median"]')).toHaveCount(0)
  await compare.getByRole('button', { name: 'Median' }).click()

  // The program median is the median over the other MOVE Trust companies' latest publications, one point per company.
  // On this stack those are Finloc (July 2026) and TLFC (its LP deal, June 2026): check every month where both report.
  const others = await Promise.all([DEALS.finloc.slug, DEALS.tlfcLp.slug].map(async s => (await published(s)).body))
  const label = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }) + '-' + m.slice(2, 4)
  let compared = 0
  for (const p of dq.program_median as any[]) {
    const vals = others.map(o => (o.ratio_history ?? []).find((r: any) => r.month === label(p.month))?.delinquency_ratio_pct).filter((v: any) => typeof v === 'number')
    if (vals.length < 2) { expect(p.value, `${p.month}: fewer than 2 peers`).toBeNull(); continue }
    vals.sort((a: number, b: number) => a - b)
    expect(p.value, `${p.month} median`).toBeCloseTo((vals[0] + vals[1]) / 2, 6)
    compared++
  }
  expect(compared, 'months with two peers').toBeGreaterThan(0)

  // Covenant history: the published months are outlined.
  const hist = section(page, 'covenant-history')
  await hist.scrollIntoViewIfNeeded()
  const pubCells = hist.locator('td.is-published')
  expect(await pubCells.count()).toBeGreaterThan(0)
  const pubMonths = [...new Set((ins.covenant_history as any[]).flatMap(r => r.cells.filter((c: any) => c.source === 'published').map((c: any) => c.month)))].sort()
  expect(pubMonths).toEqual(expect.arrayContaining(['2026-04', '2026-05', '2026-06', '2026-07']))
  const border = await pubCells.first().evaluate(el => {
    const probe = document.createElement('span'); probe.style.color = 'var(--indigo)'; document.body.appendChild(probe)
    const indigo = getComputedStyle(probe).color; probe.remove()
    const cs = getComputedStyle(el)
    return { color: cs.borderTopColor, style: cs.borderTopStyle, width: cs.borderTopWidth, indigo }
  })
  expect(border.style).not.toBe('none')
  expect(border.color).toBe(border.indigo)
  await shot(page, '12-covenant-history')

  // Restatements: Essex May 2026 restated April's interest coverage and debt to equity (step 9).
  const rest = section(page, 'restatements')
  for (const x of STEP9.essex.restated) {
    expect(ins.restatements).toContainEqual(expect.objectContaining({ field: x.field, month: x.month, first_reported: x.was, now: x.now, type: 'restated_by_company' }))
    const row = rest.getByRole('row').filter({ hasText: /Apr/ }).filter({ hasText: x.was.toFixed(2) })
    await expect(row.first()).toContainText(x.now.toFixed(2))
    await expect(row.first()).toContainText('Restated by company')
  }

  // TLFC: three deals behind one company; the picker switches between them (?deal=). Only TLFC LP is published.
  await openProfile(page, 'admin', S.tlfc.slug)
  const picker = page.getByRole('combobox', { name: 'Deal' })
  await expect(picker.locator('option')).toHaveCount(3)
  expect((await picker.locator('option').evaluateAll(os => os.map(o => (o as HTMLOptionElement).value))).sort()).toEqual([...S.tlfc.deals].sort())
  const lp = (await published(DEALS.tlfcLp.slug)).body
  await picker.selectOption(DEALS.tlfcLp.slug)
  await expect(page).toHaveURL(new RegExp(`[?&]deal=${DEALS.tlfcLp.slug}`))
  await expect(page.locator('[data-field="tranche_balance.closing"]').first()).toHaveText(dollars(lp.tranche_balance.closing))
  await shot(page, '12-tlfc-deal-picker')
  const unpublished = S.tlfc.deals.filter(s => s !== DEALS.tlfcLp.slug)
  for (const s of unpublished) {
    await picker.selectOption(s)
    await expect(page).toHaveURL(new RegExp(`[?&]deal=${s}`))
    await expect(page.getByRole('heading', { name: 'Not published yet' })).toBeVisible()
  }
})

test('step 12c: news and adverse media: feed on, Run now on the fixture, sentiment, review and dismiss, audit, analyst 403', async ({ page }) => {
  test.setTimeout(6 * 60_000)
  // The feed is off by default: Run now is refused.
  const off = await patel.post('/news/runs')
  expect(off.status).toBe(409)
  expect(JSON.stringify(off.body)).toContain('feeds_off')

  await signInAsUser(page, USERS.patel)
  await saveSetting(page, () => page.getByRole('switch', { name: /Daily news search/ }).check(), S.feedReason)
  expect((await patel.get('/settings')).body).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'company_feeds', value: expect.objectContaining({ enabled: true }) })]))

  // Run now: the list refreshes until the run finishes.
  await page.getByRole('button', { name: 'Run now' }).click()
  await expect(page.getByRole('status').filter({ hasText: /^Run (queued|finished)/ })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: /^Run finished: Done\. 10 news items and 7 adverse items added\./ })).toBeVisible({ timeout: 120_000 })
  // The worker also starts the day's scheduled run once the feed is on and 06:00 Toronto has passed; it finds nothing new.
  const run = ((await patel.get('/news/runs')).body as any[]).find(r => r.trigger === 'manual')
  expect(run).toMatchObject({ trigger: 'manual', status: 'ok', companies: S.companies, items_added: S.fixture.items, adverse_added: S.fixture.adverse, errors: [] })
  await shot(page, '12-news-run-ok')

  // Every item is a fixture item; the false friends matched nobody.
  const all: any[] = [], adverse: any[] = []
  for (const c of (await patel.get('/companies')).body as any[]) {
    all.push(...(await patel.get(`/companies/${c.slug}/news`)).body)
    adverse.push(...(await patel.get(`/companies/${c.slug}/adverse`)).body)
  }
  expect(all.length).toBe(S.fixture.items)
  expect(all.every(n => n.title.startsWith(S.fixture.prefix) && n.source === 'fixture')).toBe(true)
  for (const f of S.fixture.falseFriends) expect(all.some(n => n.title.includes(f))).toBe(false)
  expect(adverse.length).toBe(S.fixture.adverse)
  expect(adverse.every(a => a.state === 'open')).toBe(true)

  // The Essex profile: the fixture item with its sentiment word, and the adverse item open.
  const essexNews = (await patel.get(`/companies/${S.essex.slug}/news`)).body as any[]
  expect(essexNews.map(n => n.title)).toEqual([S.fixture.essexTitle])
  await openProfile(page, 'admin', S.essex.slug)
  const news = page.getByRole('list', { name: 'News items' })
  await expect(news.getByRole('listitem')).toHaveCount(essexNews.length)
  const word = { positive: 'Positive', neutral: 'Neutral', negative: 'Negative' } as Record<string, string>
  for (const n of essexNews) await expect(news.getByRole('listitem').filter({ hasText: n.title })).toContainText(word[n.sentiment])
  const adv = section(page, 'adverse')
  await expect(adv).toContainText('1 to review')
  const essexItem = adverse.find(a => a.company_slug === S.essex.slug)
  await expect(adv.getByRole('row').filter({ hasText: essexItem.title })).toContainText('Open')
  await shot(page, '12-news-and-adverse')

  // Mark the Essex item reviewed, with a note.
  await adv.getByRole('button', { name: `Mark reviewed: ${essexItem.title}` }).click()
  let dlg = page.getByRole('dialog', { name: 'Mark reviewed' })
  await dlg.getByLabel(/^Review note/).fill(S.reviewNote)
  await dlg.getByRole('button', { name: 'Mark reviewed' }).click()
  await expect(dlg).toBeHidden()
  await expect(adv.getByRole('row').filter({ hasText: essexItem.title })).toContainText('Reviewed')
  await expect(adv.getByRole('row').filter({ hasText: essexItem.title })).toContainText(S.reviewNote)
  await expect(adv).toContainText('Clear')
  await shot(page, '12-adverse-reviewed')

  // Dismiss the Moneda item with a reason.
  const monedaItem = adverse.find(a => a.company_slug === S.moneda.slug)
  expect(monedaItem.title).toBe(S.fixture.monedaTitle)
  await openProfile(page, 'admin', S.moneda.slug)
  const madv = section(page, 'adverse')
  await madv.getByRole('button', { name: `Dismiss: ${monedaItem.title}` }).click()
  dlg = page.getByRole('dialog', { name: 'Dismiss item' })
  await dlg.getByLabel(/^Reason/).fill(S.dismissReason)
  await dlg.getByRole('button', { name: 'Dismiss' }).click()
  await expect(dlg).toBeHidden()
  await expect(madv.getByRole('row').filter({ hasText: monedaItem.title })).toContainText('Dismissed')

  const states = Object.fromEntries(((await patel.get(`/companies/${S.essex.slug}/adverse`)).body as any[]).map(a => [a.id, a]))
  expect(states[essexItem.id]).toMatchObject({ state: 'reviewed', note: S.reviewNote, state_by: expect.objectContaining({ id: USERS.patel.id }) })
  expect(((await patel.get(`/companies/${S.moneda.slug}/adverse`)).body as any[])[0]).toMatchObject({ id: monedaItem.id, state: 'dismissed', note: S.dismissReason })

  // A. Patel follows Essex (12a), so its open adverse item reached her as an adverse_media notification.
  await expect.poll(async () => ((await patel.get('/notifications')).body as any[]).some(n => n.kind === 'adverse_media')).toBe(true)

  // The Platform audit: two adverse_change entries and the news_run.
  const changes = (await patel.get('/audit?scope=platform&action=adverse_change')).body as any[]
  expect(changes.map(e => e.detail?.adverse_id).sort()).toEqual([essexItem.id, monedaItem.id].sort())
  expect(changes.map(e => e.detail?.state).sort()).toEqual(['dismissed', 'reviewed'])
  const runs = (await patel.get('/audit?scope=platform&action=news_run')).body as any[]
  expect(runs.some(e => e.detail?.run_id === run.id && e.detail?.trigger === 'manual')).toBe(true)
  await page.goto('/admin/settings/users/audit?tab=platform')
  await expect(pageTitle(page)).toHaveText('Audit log')
  await expect(page.getByRole('table').first()).toContainText(S.reviewNote)
  await expect(page.getByRole('table').first()).toContainText(S.dismissReason)
  await shot(page, '12-audit-adverse')

  // An analyst cannot review or dismiss, and sees no buttons for it.
  const stillOpen = adverse.find(a => a.company_slug === S.vcc.slug)
  const refused = await moreau.post(`/adverse/${stillOpen.id}/review`, { note: 'analyst trying to review' })
  expect(refused.status).toBe(403)
  expect((await moreau.post(`/adverse/${stillOpen.id}/dismiss`, { note: 'analyst trying to dismiss' })).status).toBe(403)
  await signInAsUser(page, USERS.moreau)
  await openProfile(page, 'admin', S.vcc.slug)
  await expect(section(page, 'adverse').getByRole('row').filter({ hasText: stillOpen.title }).first()).toContainText('Open')
  await expect(section(page, 'adverse').getByRole('button', { name: /^Mark reviewed: / })).toHaveCount(0)
})

test('step 12d: notes: the analyst adds a note mentioning A. Patel; Open lands on ?note=; partners never see it', async ({ page }) => {
  await signInAsUser(page, USERS.moreau)
  await openProfile(page, 'admin', S.essex.slug)
  const notes = section(page, 'notes')
  await notes.scrollIntoViewIfNeeded()
  const box = notes.getByRole('combobox', { name: 'New note' })
  await box.fill(`${S.note} `)
  await box.pressSequentially('@Pa')
  await notes.getByRole('listbox', { name: 'Mention a TAO user' }).getByRole('option', { name: /Patel/ }).click()
  await expect(box).toHaveValue(new RegExp(`@${USERS.patel.name.replace('.', '\\.')}`))
  await notes.getByRole('button', { name: 'Add note' }).click()
  const list = notes.getByRole('list', { name: 'Analyst notes' })
  await expect(list).toContainText(S.note)
  await shot(page, '12-analyst-note')

  const note = ((await moreau.get(`/companies/${S.essex.slug}/notes`)).body as any[]).find(n => n.body.startsWith(S.note))
  expect(note).toMatchObject({ author: expect.objectContaining({ id: USERS.moreau.id }), mentions: [expect.objectContaining({ id: USERS.patel.id })] })
  const audit = (await patel.get('/audit?scope=platform&action=company_note')).body as any[]
  expect(audit.some(e => e.detail?.note_id === note.id)).toBe(true)

  // A. Patel: the mention, and Open lands on the profile with ?note=.
  await signInAsUser(page, USERS.patel)
  const mine = (await patel.get('/notifications')).body as any[]
  const m = mine.find(n => n.kind === 'mention' && String(n.link ?? '').includes(`?note=${note.id}`))
  expect(m, 'mention notification for the note').toBeTruthy()
  await page.goto('/admin/notifications')
  await page.getByRole('tab', { name: /^Mentions/ }).click()
  const row = page.getByTestId('notification').filter({ hasText: S.essex.name }).first()
  await expect(row).toBeVisible()
  await shot(page, '12-note-mention')
  await row.getByRole('button', { name: /^Open/ }).click()
  await expect(page).toHaveURL(new RegExp(`/admin/companies/${S.essex.slug}\\?note=${note.id}`))
  await expect(page.locator(`[id="note-${note.id}"]`)).toHaveAttribute('aria-current', 'true')

  // Partners: the notes route is closed (404 while company profiles are off for partners, 403 once on: step 12e).
  for (const p of [alvarez, new Api('investor_viewer'), new Api('manager_viewer')]) {
    expect([403, 404]).toContain((await p.get(`/companies/${S.essex.slug}/notes`)).status)
  }
})

/** Every partner read a viewer can make on the company pages and around them. */
async function partnerReads(p: Api): Promise<string> {
  const out: unknown[] = []
  for (const r of ['/companies', `/companies/${S.essex.slug}`, `/companies/${S.essex.slug}/news`, `/companies/${S.essex.slug}/adverse`,
    `/companies/${S.essex.slug}/deals/${essexDeal}/insights`, '/notifications', '/published/portfolio', `/published/programs/${MOVE.program}/deals/${essexDeal}`]) {
    out.push((await p.get(r)).body)
  }
  return JSON.stringify(out)
}

test('step 12e: partner: no Companies while off; on with a reason, the investor sees shared companies, no notes, reviewed adverse only', async ({ page }) => {
  const note = ((await patel.get(`/companies/${S.essex.slug}/notes`)).body as any[]).find(n => n.body.startsWith(S.note))
  expect(note).toBeTruthy()

  // Off (the default): no nav entry, Not found by URL, 404 from the API.
  expect((await patel.get('/settings')).body).not.toEqual(expect.arrayContaining([expect.objectContaining({ key: 'company_profiles_partner_enabled', value: true })]))
  await signInAsUser(page, USERS.alvarez)
  await expect(page.locator('aside').getByRole('link', { name: 'Portfolio Executive Summary' }).first()).toBeVisible()
  await expect(page.locator('aside').getByRole('link', { name: 'Companies' })).toHaveCount(0)
  await page.goto('/investor/companies')
  await expect(page.getByText('Page not found').first()).toBeVisible()
  await shot(page, '12-partner-off')
  expect((await alvarez.get('/companies')).status).toBe(404)
  expect((await alvarez.get(`/companies/${S.essex.slug}`)).status).toBe(404)
  expect(await partnerReads(alvarez)).not.toContain(S.note)

  // On, with a reason.
  await signInAsUser(page, USERS.patel)
  await saveSetting(page, () => page.getByRole('switch', { name: /Partners can see company pages/ }).check(), S.partnerReason)
  expect((await patel.get('/settings')).body).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'company_profiles_partner_enabled', value: true })]))
  expect(((await patel.get('/audit?scope=platform&action=settings_change')).body as any[]).some(e => e.reason === S.partnerReason)).toBe(true)

  // Which companies the investor may see: those with a deal in a program shared with it. In the seed both programs are
  // shared with both partners, so no company is outside its programs; the hidden adverse states are the check instead.
  const sharing = await programPartners()
  const shared = Object.entries(sharing).filter(([, ps]) => ps.includes('investor')).map(([p]) => p)
  const taoRows = (await patel.get('/companies')).body as any[]
  const expected = taoRows.filter(r => r.deals.some((d: any) => shared.includes(d.program_slug))).map(r => r.slug).sort()
  const rows = (await alvarez.get('/companies')).body as any[]
  expect(rows.map(r => r.slug).sort()).toEqual(expected)
  expect(rows.every(r => !('notes' in r))).toBe(true)
  expect(rows.every(r => r.adverse.to_review === 0 && r.adverse.state !== 'to_review')).toBe(true)
  for (const r of rows) for (const d of r.deals) expect(shared).toContain(d.program_slug)
  if (Object.values(sharing).every(ps => ps.includes('investor') && ps.includes('manager'))) {
    test.info().annotations.push({ type: 'sharing', description: 'Both programs are shared with both partners: no company is outside the investor\'s programs.' })
  }
  expect((await alvarez.get('/companies/no-such-company')).status).toBe(404)

  await signInAsUser(page, USERS.alvarez)
  await page.locator('aside').getByRole('link', { name: 'Companies' }).first().click()
  await expect(page).toHaveURL(/\/investor\/companies$/)
  await expect(companiesTable(page).locator('tbody tr')).toHaveCount(expected.length)
  await expect(companiesTable(page).getByRole('columnheader', { name: 'Notes' })).toHaveCount(0)
  await shot(page, '12-partner-companies')

  // The Essex profile as the investor: no TAO-only parts, the reviewed adverse item only.
  await openProfile(page, 'investor', S.essex.slug)
  await expect(page.locator('[data-field="tranche_balance.closing"]').first()).toBeVisible()
  await expect(section(page, 'notes')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Edit record' })).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'View as' })).toHaveCount(0)
  await expect(section(page, 'record')).not.toContainText('TAO relationship owner')
  await expect(page.getByText('TAO only')).toHaveCount(0)
  const adv = section(page, 'adverse')
  await expect(adv.getByRole('row').filter({ hasText: S.fixture.essexTitle })).toContainText('Reviewed')
  await expect(adv.getByRole('button', { name: /^(Mark reviewed|Dismiss): / })).toHaveCount(0)
  await expect(page.getByText(S.note)).toHaveCount(0)
  await shot(page, '12-partner-profile', { fullPage: true })

  // Adverse states through the API: reviewed only. Moneda's item is dismissed and VCC IV's two are open: none shows.
  expect(((await alvarez.get(`/companies/${S.essex.slug}/adverse`)).body as any[]).map(a => a.state)).toEqual(['reviewed'])
  expect((await alvarez.get(`/companies/${S.moneda.slug}/adverse`)).body).toEqual([])
  expect((await alvarez.get(`/companies/${S.vcc.slug}/adverse`)).body).toEqual([])
  expect((await alvarez.get(`/companies/${S.essex.slug}`)).body.owner).toBeNull()
  expect((await alvarez.get(`/companies/${S.essex.slug}/notes`)).status).toBe(403)
  expect(await partnerReads(alvarez)).not.toContain(S.note)
  expect(await partnerReads(new Api('manager_viewer'))).not.toContain(S.note)
})

test('step 12f: record: A. Patel edits industry and HQ with a reason and adds a contact; audit before and after; analyst refused', async ({ page }) => {
  const r = S.record, c = S.contact
  const before = (await patel.get(`/companies/${S.essex.slug}`)).body
  await signInAsUser(page, USERS.patel)
  await openProfile(page, 'admin', S.essex.slug)
  await page.getByRole('button', { name: 'Edit record' }).click()
  const dlg = page.getByRole('dialog', { name: `Edit record · ${S.essex.name}` })
  await dlg.getByLabel('Industry').fill(r.industry)
  await dlg.getByLabel('Headquarters').fill(r.headquarters)
  await dlg.getByLabel(/^Reason/).fill(r.reason)
  await shot(page, '12-edit-record')
  await dlg.getByRole('button', { name: 'Save record' }).click()
  await expect(dlg).toBeHidden()
  const rec = section(page, 'record')
  await expect(rec).toContainText(r.industry)
  await expect(rec).toContainText(r.headquarters)

  const contacts = section(page, 'contacts')
  await contacts.getByRole('button', { name: 'Add contact' }).click()
  const cd = page.getByRole('dialog', { name: 'Add contact' })
  await cd.getByLabel(/^Name/).fill(c.name)
  await cd.getByLabel('Role').fill(c.role)
  await cd.getByLabel('Email').fill(c.email)
  await cd.getByLabel('Receives').fill(c.receives)
  await cd.getByLabel(/^Reason/).fill(c.reason)
  await cd.getByRole('button', { name: 'Add contact' }).click()
  await expect(cd).toBeHidden()
  await expect(contacts.getByRole('row').filter({ hasText: c.name })).toContainText(c.email)
  await shot(page, '12-record-and-contact')

  const after = (await patel.get(`/companies/${S.essex.slug}`)).body
  expect(after).toMatchObject({ industry: r.industry, headquarters: r.headquarters })
  expect(after.contacts).toContainEqual(expect.objectContaining({ name: c.name, role: c.role, email: c.email, receives: c.receives }))

  // The Platform audit: company_change with before and after (changed fields only), and the contact.
  const changes = ((await patel.get('/audit?scope=platform&action=company_change')).body as any[]).filter(e => e.detail?.company_slug === S.essex.slug)
  const record = changes.find(e => e.detail.change === 'record')
  expect(record).toMatchObject({ reason: r.reason, actor_user_id: USERS.patel.id })
  expect(record.detail.before).toEqual({ industry: before.industry, headquarters: before.headquarters })
  expect(record.detail.after).toEqual({ industry: r.industry, headquarters: r.headquarters })
  expect(changes.find(e => e.detail.change === 'contact_added')).toMatchObject({ reason: c.reason })
  await page.goto('/admin/settings/users/audit?tab=platform')
  await expect(page.getByRole('table').first()).toContainText(r.reason)
  await shot(page, '12-audit-company-change')

  // An analyst: no Edit record or Add contact, and 403 from the API.
  await signInAsUser(page, USERS.moreau)
  await openProfile(page, 'admin', S.essex.slug)
  await expect(section(page, 'record')).toContainText(r.industry)
  await expect(page.getByRole('button', { name: 'Edit record' })).toHaveCount(0)
  await expect(section(page, 'contacts').getByRole('button', { name: 'Add contact' })).toHaveCount(0)
  expect((await moreau.patch(`/companies/${S.essex.slug}`, { industry: 'analyst edit', reason: 'analyst trying to edit' })).status).toBe(403)
  expect((await moreau.post(`/companies/${S.essex.slug}/contacts`, { name: 'X', reason: 'analyst trying to add' })).status).toBe(403)
})

test('step 12g: System settings lists the news runs, with the manual run from 12c', async ({ page }) => {
  const run = ((await patel.get('/news/runs')).body as any[]).find(r => r.trigger === 'manual' && r.status === 'ok')
  expect(run).toBeTruthy()
  expect((await moreau.get('/news/runs')).status).toBe(200)
  expect((await alvarez.get('/news/runs')).status).toBe(403)
  await signInAsUser(page, USERS.patel)
  await page.goto('/admin/settings/system')
  const runs = page.getByRole('table', { name: 'News runs, newest first' })
  await runs.scrollIntoViewIfNeeded()
  const row = runs.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Manual' }) }).first()
  await expect(row).toContainText('Done')
  await expect(row.getByRole('cell')).toContainText([String(S.companies), String(S.fixture.items), String(S.fixture.adverse), 'None'])
  await shot(page, '12-news-runs')
})
