import { expect, test, type Page, type Response } from '@playwright/test'
import { Api } from '../lib/api'
import { STEP12, STEP13, USERS } from '../lib/facts'
import { pageTitle, shot, signInAsUser } from '../lib/ui'

/** Demo step 13 (phase 2, wave E): news screening version 2. 13a System settings › News sources: five rows, Dow Jones and
 * LexisNexis not available, a fake Brave key stored write-only, Test connection, the key removed, switching on with no
 * key refused, the audit without the key; 13b Latest news on the company profile: "Date not confirmed", "Found by",
 * Show excluded and View as partner; 13c partners never see excluded stories or check reasons; 13d the news search
 * words on the company record; 13e Re-check stories; 13f the run's "Checks and calls". Runs after step 12 (feed on,
 * fixture run done, company pages on for partners). The stack must run the news worker on its fixture
 * (`-f scripts/compose.news-fixture.yml`), which also puts the Claude check in fixture mode (no API call). */
test.describe.configure({ mode: 'serial' })

type U = (typeof USERS)[keyof typeof USERS]
const as = (u: U) => new Api(u.role as any, undefined, u.id)
const patel = as(USERS.patel), alvarez = as(USERS.alvarez), haddad = as(USERS.haddad)
const S = STEP13
const B = S.brave

const section = (page: Page, id: string) => page.locator(`[id="${id}"]`)
const sourcesTable = (page: Page) => page.getByRole('table', { name: 'News sources' })
const sourceRow = (page: Page, provider: string) => sourcesTable(page).locator(`tr[data-provider="${provider}"]`)
const runsTable = (page: Page) => page.getByRole('table', { name: 'News runs, newest first' })
const newsList = (page: Page) => page.getByRole('list', { name: 'News items' })
const newsItem = (page: Page, title: string) => newsList(page).getByRole('listitem').filter({ hasText: title })

async function openSources(page: Page) {
  await page.goto('/admin/settings/system')
  await expect(pageTitle(page)).toHaveText('System settings')
  await sourcesTable(page).scrollIntoViewIfNeeded()
  await expect(sourcesTable(page).locator('tbody tr')).toHaveCount(S.providers.length)
}

async function openProfile(page: Page, shell: string, slug: string) {
  await page.goto(`/${shell}/companies/${slug}`)
  await expect(section(page, 'record')).toBeVisible()
  await section(page, 'news').scrollIntoViewIfNeeded()
}

/** Every API response body the page receives while `fn` runs, as text. */
async function responsesDuring(page: Page, fn: () => Promise<void>): Promise<string[]> {
  const pending: Promise<string>[] = []
  const on = (r: Response) => { if (r.url().includes('/api/')) pending.push(r.text().catch(() => '')) }
  page.on('response', on)
  try { await fn() } finally { page.off('response', on) }
  return Promise.all(pending)
}

/** Open a source's Edit dialog, let `change` fill it, add the reason and press Save. */
async function editSource(page: Page, label: string, change: (dlg: ReturnType<Page['getByRole']>) => Promise<void>, reason: string) {
  await page.getByRole('button', { name: `Edit ${label}`, exact: true }).click()
  const dlg = page.getByRole('dialog', { name: `Edit ${label}` })
  await expect(dlg).toBeVisible()
  await change(dlg)
  await dlg.getByLabel(/^Reason/).fill(reason)
  return dlg
}

test('step 13a: News sources: five rows, two not available, a fake Brave key write-only, Test connection, removed, no switch-on without a key, audited without the key', async ({ page }) => {
  test.setTimeout(5 * 60_000)
  const before = (await patel.get('/news/sources')).body
  expect(before.secret_key_set, 'NEWS_SECRET_KEY set in .env').toBe(true)
  expect(before.sources.map((s: any) => s.provider)).toEqual(S.providers)
  expect(before.sources.filter((s: any) => !s.available).map((s: any) => s.label)).toEqual(S.notAvailable)
  expect(before.sources.find((s: any) => s.provider === B.provider).secrets.api_key).toEqual({ set: false, last4: null })
  for (const p of [alvarez, haddad, new Api('tao_analyst')]) expect((await p.get('/news/sources')).status).toBe(403)

  await signInAsUser(page, USERS.patel)
  await openSources(page)
  for (const label of S.notAvailable) {
    const row = sourcesTable(page).getByRole('row').filter({ has: page.getByRole('rowheader', { name: new RegExp(`^${label.replace(/[()+.]/g, '\\$&')}`) }) })
    await expect(row).toContainText('Not available yet')
    await expect(row.getByRole('button', { name: /^Test connection/ })).toBeDisabled()
  }
  await expect(sourceRow(page, B.provider)).toContainText('Key not set')
  await shot(page, '13-news-sources')

  // Store the fake key. Only "ends in" plus the last four ever comes back: not in the page, not in any API response.
  const bodies = await responsesDuring(page, async () => {
    const dlg = await editSource(page, B.label, d => d.getByLabel(/^API key/).fill(B.key), S.keyReason)
    await expect(dlg.getByLabel('Changes to save')).toContainText('API key: set')
    await expect(dlg.getByLabel('Changes to save')).not.toContainText(B.key)
    await shot(page, '13-brave-key-dialog')
    await dlg.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dlg).toBeHidden()
    await expect(sourceRow(page, B.provider)).toContainText(`Set, ends in ••••${B.last4}`)
    await expect(sourceRow(page, B.provider)).toContainText('Off')
    await page.reload()
    await expect(sourceRow(page, B.provider)).toContainText(`Set, ends in ••••${B.last4}`)
  })
  expect(bodies.length).toBeGreaterThan(0)
  for (const b of bodies) expect(b).not.toContain(B.key)
  expect(await page.content()).not.toContain(B.key)
  const stored = (await patel.get('/news/sources'))
  expect(JSON.stringify(stored.body)).not.toContain(B.key)
  expect(stored.body.sources.find((s: any) => s.provider === B.provider)).toMatchObject({ enabled: false, secrets: { api_key: { set: true, last4: B.last4 } } })
  await shot(page, '13-brave-key-set')

  // Test connection: one small query with the fake key. The worker writes the result; expect Failed with the provider's
  // message (any clear result within 40 s passes: the fixture stack may or may not reach Brave).
  const prevAt = stored.body.sources.find((s: any) => s.provider === B.provider).last_test.at
  await sourceRow(page, B.provider).getByRole('button', { name: `Test connection, ${B.label}` }).click()
  const result = page.getByRole('status').filter({ hasText: new RegExp(`^${B.label}: (OK|Failed)`) })
  await expect(result).toBeVisible({ timeout: 45_000 })
  const tested = ((await patel.get('/news/sources')).body.sources as any[]).find(s => s.provider === B.provider)
  expect(tested.last_test.at).not.toBe(prevAt)
  expect(typeof tested.last_test.ok).toBe('boolean')
  expect(tested.last_test.message, 'the test result carries a message').toBeTruthy()
  expect(JSON.stringify(tested)).not.toContain(B.key)
  if (tested.last_test.ok === false) await expect(result).toContainText('Failed')
  test.info().annotations.push({ type: 'test connection', description: `${tested.last_test.ok ? 'OK' : 'Failed'}: ${tested.last_test.message}` })
  await expect(sourceRow(page, B.provider)).toContainText(tested.last_test.ok ? 'OK' : 'Failed')
  await expect(sourceRow(page, B.provider)).toContainText(tested.last_test.message)
  await shot(page, '13-brave-test-result')

  // Remove the key.
  let dlg = await editSource(page, B.label, d => d.getByRole('button', { name: 'Remove API key' }).click(), S.removeReason)
  await expect(dlg.getByLabel('Changes to save')).toContainText('API key: removed')
  await dlg.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dlg).toBeHidden()
  await expect(sourceRow(page, B.provider)).toContainText('Not set')
  await expect(sourceRow(page, B.provider)).toContainText('Key not set')
  expect(((await patel.get('/news/sources')).body.sources as any[]).find(s => s.provider === B.provider).secrets.api_key).toEqual({ set: false, last4: null })

  // Switch on with no key: refused in plain words; nothing changes.
  dlg = await editSource(page, B.label, d => d.getByRole('switch', { name: 'Use this source' }).check(), S.onReason)
  await expect(dlg).toContainText('Needs API key before it can be switched on')
  await dlg.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dlg.getByRole('alert')).toHaveText(S.missingCredentials)
  await shot(page, '13-brave-missing-key')
  await dlg.getByRole('button', { name: 'Cancel' }).click()
  await expect(dlg).toBeHidden()
  const refused = await patel.put(`/news/sources/${B.provider}`, { enabled: true, reason: S.onReason })
  expect(refused.status).toBe(409)
  expect(JSON.stringify(refused.body)).toContain('missing_credentials')
  expect(((await patel.get('/news/sources')).body.sources as any[]).find(s => s.provider === B.provider).enabled).toBe(false)

  // The Platform audit: news_source_change for the key set and the key removed, names only, never the key; the
  // refused switch-on wrote nothing.
  const changes = ((await patel.get('/audit?scope=platform&action=news_source_change')).body as any[]).filter(e => e.detail?.provider === B.provider)
  expect(JSON.stringify(changes)).not.toContain(B.key)
  expect(changes.find(e => e.reason === S.keyReason)?.detail).toMatchObject({ secrets_set: ['api_key'] })
  expect(changes.find(e => e.reason === S.removeReason)?.detail).toMatchObject({ secrets_removed: ['api_key'] })
  expect(changes.some(e => e.reason === S.onReason)).toBe(false)
  await page.goto('/admin/settings/users/audit?tab=platform')
  await expect(pageTitle(page)).toHaveText('Audit log')
  const log = page.getByRole('table').first()
  await expect(log).toContainText(S.keyReason)
  await expect(log).toContainText(S.removeReason)
  expect(await page.content()).not.toContain(B.key)
  await shot(page, '13-audit-news-source')
})

test('step 13b: Latest news: Date not confirmed, Found by, Show excluded with the reason, View as partner hides the check', async ({ page }) => {
  const X = S.xpedite, D = S.dynamic
  // API: the Xpedite story has no confirmed date and does not count in news_7d; the Dynamic Capital story is excluded and
  // only in TAO's include=excluded list.
  const xNews = (await patel.get(`/companies/${X.slug}/news`)).body as any[]
  const xItem = xNews.find(n => n.title === X.title)
  expect(xItem).toMatchObject({ date_status: 'source_only', published_at: null, sources: ['fixture'], check: expect.objectContaining({ status: 'kept' }) })
  expect(xItem.source_date).toBeTruthy()
  const dNews = (await patel.get(`/companies/${D.slug}/news`)).body as any[]
  expect(dNews.some(n => n.title === D.excludedTitle)).toBe(false)
  const dAll = (await patel.get(`/companies/${D.slug}/news?include=excluded`)).body as any[]
  expect(dAll.find(n => n.title === D.excludedTitle)).toMatchObject({ check: expect.objectContaining({ status: 'excluded', reason: D.excludedReason }) })
  const week = (list: any[]) => list.filter(n => n.check?.status === 'kept' && n.date_status === 'confirmed' && n.published_at
    && Date.now() - Date.parse(n.published_at) <= 7 * 864e5).length
  const rows = (await patel.get('/companies')).body as any[]
  const xRow = rows.find(r => r.slug === X.slug), dRow = rows.find(r => r.slug === D.slug)
  expect(xRow.news_7d, 'Xpedite news_7d leaves out the unconfirmed story').toBe(week(xNews))
  expect(xRow.news_7d).toBe(xNews.length - 1)
  expect(dRow.news_7d, 'Dynamic Capital news_7d leaves out the excluded story').toBe(week(dNews))
  // Neither story raised an alert for anyone.
  for (const u of [patel, as(USERS.okafor), as(USERS.moreau)]) {
    const n = JSON.stringify((await u.get('/notifications')).body)
    expect(n).not.toContain(X.title)
    expect(n).not.toContain(D.excludedTitle)
  }

  await signInAsUser(page, USERS.patel)
  await openProfile(page, 'admin', X.slug)
  const xi = newsItem(page, X.title)
  await expect(xi).toContainText('Date not confirmed')
  await expect(xi).toContainText('source says')
  await expect(xi).toContainText('Found by Test fixture')
  await expect(xi).toContainText('Kept by the news check')
  await shot(page, '13-date-not-confirmed')

  await openProfile(page, 'admin', D.slug)
  await expect(newsList(page)).not.toContainText(D.excludedTitle)
  await expect(newsList(page).getByRole('listitem')).toHaveCount(dNews.length)
  await page.getByLabel('Show excluded').check()
  const ex = newsItem(page, D.excludedTitle)
  await expect(ex).toContainText('Excluded by the news check')
  await expect(ex).toContainText(D.excludedReason)
  await expect(ex).toHaveAttribute('data-check', 'excluded')
  await expect(section(page, 'news')).toContainText('Showing excluded stories')
  await shot(page, '13-show-excluded')

  // View as partner: no toggle, no check lines, no excluded story.
  await page.getByRole('group', { name: 'View as' }).getByRole('button', { name: 'View as partner' }).click()
  await expect(page.getByLabel('Show excluded')).toHaveCount(0)
  await expect(newsList(page).getByRole('listitem')).toHaveCount(dNews.length)
  await expect(newsList(page)).not.toContainText(D.excludedTitle)
  await expect(section(page, 'news')).not.toContainText('by the news check')
  await shot(page, '13-view-as-partner')
  await page.getByRole('group', { name: 'View as' }).getByRole('button', { name: 'TAO view' }).click()
})

test('step 13c: partners never see excluded stories or check reasons, whatever they ask for', async ({ page }) => {
  const D = S.dynamic
  expect((await patel.get('/settings')).body, 'company pages on for partners (step 12e)').toEqual(
    expect.arrayContaining([expect.objectContaining({ key: 'company_profiles_partner_enabled', value: true })]))
  const slugs = ((await patel.get('/companies')).body as any[]).map(r => r.slug)
  for (const p of [alvarez, haddad]) {
    for (const slug of slugs) {
      for (const q of ['', '?include=excluded', '?include=all', '?include=pending']) {
        const r = await p.get(`/companies/${slug}/news${q}`)
        expect(r.status, `${p.role} ${slug}${q}`).toBe(200)
        for (const n of r.body as any[]) expect(n.check, `${p.role} ${slug}${q}: no check block`).toBeUndefined()
        const text = JSON.stringify(r.body)
        expect(text).not.toContain(D.excludedTitle)
        expect(text).not.toContain(D.excludedReason)
      }
    }
    const company = (await p.get(`/companies/${D.slug}`)).body
    expect(company.news_search).toBeUndefined()
    expect(JSON.stringify((await p.get(`/companies/${D.slug}/adverse`)).body)).not.toContain('Excluded by the news check')
  }

  await signInAsUser(page, USERS.alvarez)
  await openProfile(page, 'investor', D.slug)
  await expect(page.getByLabel('Show excluded')).toHaveCount(0)
  await expect(newsList(page).getByRole('listitem').first()).toBeVisible()
  await expect(newsList(page)).not.toContainText(D.excludedTitle)
  await expect(section(page, 'news')).not.toContainText('by the news check')
  await expect(page.getByText(D.excludedReason)).toHaveCount(0)
  await expect(page.getByTestId('news-search')).toHaveCount(0)
  await shot(page, '13-partner-news')
})

test('step 13d: Edit record: Dynamic Capital news search words and an exclusion, with a reason, shown in the record panel', async ({ page }) => {
  const D = S.dynamic, W = S.search
  await signInAsUser(page, USERS.patel)
  await openProfile(page, 'admin', D.slug)
  await page.getByRole('button', { name: 'Edit record' }).click()
  const dlg = page.getByRole('dialog', { name: `Edit record · ${D.name}` })
  const ns = dlg.getByTestId('news-search-edit')
  await ns.getByLabel('Context words').fill(W.context.join(', '))
  await ns.getByLabel('Exclusion phrases').fill(W.exclusion)
  await dlg.getByLabel(/^Reason/).fill(W.reason)
  await ns.scrollIntoViewIfNeeded()
  await shot(page, '13-edit-news-search')
  await dlg.getByRole('button', { name: 'Save record' }).click()
  await expect(dlg).toBeHidden()
  const panel = section(page, 'record').getByTestId('news-search')
  await expect(panel).toContainText(`Context words: ${W.context.join(', ')}`)
  await expect(panel).toContainText(`Exclusions: ${W.exclusion}`)
  await section(page, 'record').scrollIntoViewIfNeeded()
  await shot(page, '13-record-news-search')

  const c = (await patel.get(`/companies/${D.slug}`)).body
  expect(c.news_search).toMatchObject({ context_terms: W.context, exclusions: [W.exclusion] })
  const audit = ((await patel.get('/audit?scope=platform&action=company_change')).body as any[])
    .filter(e => e.detail?.company_slug === D.slug && e.reason === W.reason)
  expect(audit.length).toBe(1)
  expect(JSON.stringify(audit[0].detail)).toContain(W.exclusion)
  // Partners and analysts: no search settings in the company, and an analyst cannot change them.
  expect((await alvarez.get(`/companies/${D.slug}`)).body.news_search).toBeUndefined()
  const analyst = as(USERS.moreau)
  expect((await analyst.patch(`/companies/${D.slug}`, { news_search: { context_terms: ['x-analyst'], exclusions: [], languages: ['en'] }, reason: 'analyst trying to edit' })).status).toBe(403)
})

test('step 13e: Re-check stories from System settings finishes and lists a Re-check run with stats', async ({ page }) => {
  test.setTimeout(5 * 60_000)
  await signInAsUser(page, USERS.patel)
  await page.goto('/admin/settings/system')
  await expect(pageTitle(page)).toHaveText('System settings')
  const runs = runsTable(page)
  await runs.scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: 'Re-check stories', exact: true }).click()
  const dlg = page.getByRole('alertdialog', { name: 'Re-check stories?' })
  await expect(dlg).toBeVisible()
  await shot(page, '13-recheck-confirm')
  await dlg.getByRole('button', { name: 'Re-check stories' }).click()
  await expect(dlg).toBeHidden()
  await expect(page.getByRole('status').filter({ hasText: /^Re-check finished: Done\./ })).toBeVisible({ timeout: 120_000 })

  const run = ((await patel.get('/news/runs')).body as any[]).find(r => r.trigger === 'recheck')
  expect(run).toMatchObject({ trigger: 'recheck', status: 'ok', errors: [] })
  expect(run.stats && typeof run.stats).toBe('object')
  const audit = (await patel.get('/audit?scope=platform&action=news_run')).body as any[]
  expect(audit.some(e => e.detail?.run_id === run.id && e.detail?.trigger === 'recheck')).toBe(true)

  const row = runs.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Re-check' }) }).first()
  await expect(row).toContainText('Done')
  const n = (v: unknown) => String(v ?? 0)
  if (run.stats && Object.keys(run.stats).length) {
    await expect(row.locator('details summary')).toHaveText(`${n(run.stats.candidates)} candidates · ${n(run.stats.kept)} kept · ${n(run.stats.excluded)} excluded`)
  }
  await shot(page, '13-recheck-done')
})

test('step 13f: the fixture run row shows its Checks and calls stats', async ({ page }) => {
  const run = ((await patel.get('/news/runs')).body as any[]).find(r => r.trigger === 'manual' && r.status === 'ok')
  expect(run.items_added).toBe(STEP12.fixture.items)
  const st = run.stats
  expect(st, 'the manual fixture run has stats').toBeTruthy()
  expect(st.kept).toBeGreaterThanOrEqual(STEP12.fixture.items)
  expect(st.excluded, 'the Dynamic Capital story').toBeGreaterThanOrEqual(1)
  expect(st.candidates).toBeGreaterThanOrEqual(st.kept + st.excluded)

  await signInAsUser(page, USERS.patel)
  await page.goto('/admin/settings/system')
  const runs = runsTable(page)
  await runs.scrollIntoViewIfNeeded()
  await expect(runs.getByRole('columnheader', { name: 'Checks and calls' })).toBeVisible()
  const row = runs.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Manual' }) }).first()
  const cell = row.locator('details.adm-runstats')
  await expect(cell.locator('summary')).toHaveText(`${st.candidates} candidates · ${st.kept} kept · ${st.excluded} excluded`)
  await cell.locator('summary').click()
  const dl = cell.locator('dl')
  await expect(dl).toBeVisible()
  for (const t of ['Calls per source', 'Hit the daily cap', 'Candidates', 'Kept', 'Excluded', 'Pending', 'Dates confirmed', 'Claude tokens']) await expect(dl).toContainText(t)
  await shot(page, '13-run-stats')
})
