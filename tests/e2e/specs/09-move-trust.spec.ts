import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { analyst, Api, findings, findUpload, tao, waitSettled } from '../lib/api'
import { compareFields, expectAllMatch, maxMoneyDiff, readDealFields } from '../lib/deal'
import { CACHE, EXTRACT_BUDGET_MS } from '../lib/env'
import { DEALS, MOVE, STEP9, period, referenceDeal, samplePath, type DealKey } from '../lib/facts'
import { record } from '../lib/measure'
import { navTo, openReview, pageTitle, shot, signInAs, switchRole } from '../lib/ui'

const investor = new Api('investor_viewer')

/** Demo step 9. MOVE Trust, month by month from April 2026: the TAO Analyst uploads, the TAO Admin publishes. Two
 * reports restate an earlier month (R11 Blocks a reviewer meets on real data): Essex May 2026 restates April's interest
 * coverage 1.15 -> 1.12 and debt-to-equity 6.35 -> 6.22; TLFC LP June 2026 restates the April and May RVL ratio
 * 0 -> 0.112487%. The reviewer accepts each as a restatement with a reason and publishes. Finloc's multi-currency months
 * May-July raise no R11: the CAD-equivalent gap is USD revaluation, not a break. Essex May is published before the other
 * two deals' May, so the MOVE program page shows them "As of Apr 2026". Finloc reaches July, the reference objects'
 * period, and its investor deal page matches docs/dashboard-json the way step 3 does for Xpedite.
 * The three tests run in order on the state the earlier ones leave. */
test.describe.configure({ mode: 'serial' })

const restatementReason = (deal: DealKey) => (deal === 'essex' ? STEP9.essex : STEP9.tlfcLp).reason

/** Analyst uploads one month through the API and waits for needs review. */
async function analystUploads(deal: DealKey, month: string) {
  const per = period(month)
  const r = await analyst.upload(DEALS[deal].slug, per, samplePath(deal, month))
  expect(r.status, `upload ${deal} ${per}: ${JSON.stringify(r.body)}`).toBe(201)
  const { upload, seconds } = await waitSettled(r.body.id)
  record('extraction', { deal, period: per, pages: upload.page_count, seconds, status: upload.status, finding_counts: upload.finding_counts, via: 'api step 9' })
  expect(upload.status, `${deal} ${per}`).toBe('needs_review')
  expect(upload.uploaded_by).toBe('tao_analyst')
  return upload
}

/** TAO Admin approves and publishes through the API (no block finding may be open). */
async function adminPublishes(uploadId: string) {
  const a = await tao.post(`/uploads/${uploadId}/approve`)
  expect(a.status, `approve: ${JSON.stringify(a.body)}`).toBe(200)
  expect(a.body.status).toBe('published')
}

/** The R11 Blocks are exactly the expected restatements: field, month, prior and new value. */
async function expectRestatementFindings(uploadId: string, restated: typeof STEP9.essex.restated) {
  const r11 = (await findings(uploadId)).filter(f => f.rule_id === 'R11')
  expect(r11.length, 'R11 findings').toBe(restated.length)
  for (const x of restated) {
    const f = r11.find(f => f.context?.field === `ratio_history.${x.field}` && f.context?.month === x.month)
    expect(f, `R11 for ${x.field} ${x.month}`).toBeTruthy()
    expect(f.severity).toBe('block')
    expect(f.status).toBe('open')
    expect(f.context.restatement).toBe(true)
    expect(f.context.prior_value).toBeCloseTo(x.was, 8)
    expect(f.context.value).toBeCloseTo(x.now, 8)
  }
  const otherBlocks = (await findings(uploadId)).filter(f => f.severity === 'block' && f.rule_id !== 'R11')
  expect(otherBlocks, 'block findings other than R11').toEqual([])
}

/** On the review page: Accept as restatement for each R11 card, with a reason, then publish. */
async function acceptRestatementsAndPublish(page: Page, deal: DealKey, uploadId: string, restated: typeof STEP9.essex.restated, shots: { cards: string; dialog?: string; publish?: string }) {
  await openReview(page, uploadId)
  const decision = page.getByRole('region', { name: 'Decision' })
  await expect(decision).toContainText('2 block findings are open')
  const first = page.locator('article.ds-finding', { hasText: `ratio_history.${restated[0].field} for ${restated[0].month}` })
  await first.scrollIntoViewIfNeeded()
  await shot(page, shots.cards)
  for (const [i, x] of restated.entries()) {
    const card = page.locator('article.ds-finding', { hasText: `ratio_history.${x.field} for ${x.month}` })
    await expect(card).toContainText('Restatement')
    await card.getByRole('button', { name: 'Accept as restatement for R11' }).click()
    const dlg = page.getByRole('dialog', { name: /Resolve R11/ })
    await expect(dlg.getByRole('radio', { name: /Accept as restatement/ })).toBeChecked()
    await dlg.getByLabel(/Reason/).fill(restatementReason(deal))
    if (i === 0 && shots.dialog) await shot(page, shots.dialog)
    await dlg.getByRole('button', { name: 'Save and re-run rules' }).click()
    await expect(dlg).toBeHidden()
    await expect(card).toContainText('Accepted as restatement')
  }
  await expect(page.getByText('Rules re-ran. No block findings open.').first()).toBeVisible()
  await expect(decision).toContainText('All block findings are resolved. Ready to publish.')
  await decision.getByRole('button', { name: 'Publish to partner…' }).click()
  const pub = page.getByRole('dialog', { name: 'Publish to partner' })
  await expect(pub).toContainText('2 findings resolved with a reason')
  await expect(pub).toContainText('the Investor and Manager portals')
  if (shots.publish) await shot(page, shots.publish)
  await pub.getByRole('button', { name: 'Approve and publish' }).click()
  await expect(page.getByText('Published to partner').first()).toBeVisible()
  expect((await tao.get(`/uploads/${uploadId}`)).body.status).toBe('published')

  // Each R11 carries the restatement choice and the reason, and the audit log a Restate row per finding.
  for (const f of (await findings(uploadId)).filter(f => f.rule_id === 'R11')) {
    expect(f.status).toBe('accepted_as_restatement')
    expect(f.resolution).toMatchObject({ choice: 'restatement', reason: restatementReason(deal), by: 'tao_admin' })
  }
  const restates = ((await tao.get(`/audit?upload_id=${uploadId}`)).body as any[]).filter(e => e.action === 'restate')
  expect(restates.length).toBe(restated.length)
  for (const e of restates) expect(e).toMatchObject({ reason: restatementReason(deal), actor_role: 'tao_admin' })
}

/** The published deal carries the restated values in its ratio history and in `restatements`, as the reference does. */
async function expectPublishedRestatements(deal: DealKey, per: string, restated: typeof STEP9.essex.restated) {
  const pub = (await investor.get(`/published/programs/${MOVE.program}/deals/${DEALS[deal].slug}?period=${per}`)).body
  const ref = referenceDeal(deal)
  for (const x of restated) {
    const row = (pub.ratio_history as any[]).find(r => r.month === x.row)
    const refRow = (ref.ratio_history as any[]).find(r => r.month === x.row)
    expect(row?.[x.field], `published ${x.row} ${x.field}`).toBeCloseTo(x.now, 8)
    expect(refRow?.[x.field], `reference ${x.row} ${x.field}`).toBeCloseTo(x.now, 8)
    const pr = (pub.restatements as any[]).find(r => r.field === x.field && r.month === x.row)
    const rr = (ref.restatements as any[]).find(r => r.field === x.field && r.month === x.row)
    expect(pr, `published restatements ${x.row} ${x.field}`).toBeTruthy()
    // What the published object has seen so far is the start of the reference's as-reported list (which runs to July).
    expect(rr.as_reported.slice(0, pr.as_reported.length).map((a: any) => [a.source_period, a.value]))
      .toEqual(pr.as_reported.map((a: any) => [a.source_period, a.value]))
    expect(pr.as_reported.at(-1)).toMatchObject({ source_period: per })
  }
}

/** Finloc: no R11 although the CAD-equivalent opening differs from the prior published closing by the revaluation;
 * each currency's native opening equals its prior closing. */
async function expectFinlocNoR11(uploadId: string, per: string) {
  const fs_ = await findings(uploadId)
  expect(fs_.filter(f => f.rule_id === 'R11'), `Finloc ${per}: R11 findings`).toEqual([])
  expect(fs_.filter(f => f.severity === 'block'), `Finloc ${per}: block findings`).toEqual([])
  const prevPer = period(String(Number(per.replace('-', '')) - 1))
  const prior = (await investor.get(`/published/programs/${MOVE.program}/deals/${DEALS.finloc.slug}?period=${prevPer}`)).body
  const ex = (await tao.get(`/uploads/${uploadId}/extraction`)).body.deal
  const gap = ex.tranche_balance.opening - prior.tranche_balance.closing
  expect(gap, `Finloc ${per}: CAD-equivalent opening minus prior closing (USD revaluation)`).toBeCloseTo(STEP9.finloc.revaluation[per], 2)
  const cur = (ex.period_history as any[]).find(r => r.period === per).by_currency
  const prv = (prior.period_history as any[]).find(r => r.period === prevPer).by_currency
  expect(cur.cad_opening, `Finloc ${per}: CAD opening = prior CAD closing`).toBeCloseTo(prv.cad_closing, 2)
  record('finloc_fx', { period: per, revaluation: Math.round(gap * 100) / 100, r11: 0 })
}

test('step 9a: MOVE Trust April for three deals; Essex May restates April, the reviewer accepts and publishes; two deals show as of April', async ({ page }) => {
  test.setTimeout(8 * 60_000)
  for (const [d, m] of STEP9.order) {
    expect(fs.existsSync(samplePath(d, m)), `sample PDF ${samplePath(d, m)}`).toBe(true)
    const u = await findUpload(d, period(m))
    expect(u, `${d} ${period(m)} already uploaded (${u?.status}): step 9 needs a fresh stack; see docs/demo.md "Reset"`).toBeUndefined()
  }

  // April for Essex, TLFC LP and Finloc: the analyst uploads, the admin publishes. MOVE reports name their own month.
  for (const [d, m] of STEP9.order.slice(0, 3)) {
    const u = await analystUploads(d, m)
    expect(u.reporting_period, `${d} reporting period`).toBe(period(m))
    expect(u.finding_counts.block).toBe(0)
    await adminPublishes(u.id)
  }

  // Essex May through the upload form: needs review with two R11 Blocks.
  const { month, period: per, restated } = STEP9.essex
  await signInAs(page, 'tao_analyst')
  await navTo(page, 'Uploads')
  await page.getByRole('button', { name: 'Upload report' }).first().click()
  await page.getByLabel('Deal').selectOption(DEALS.essex.slug)
  await page.getByLabel('Collection period').fill(per)
  await page.getByTestId('filedrop-input').setInputFiles(samplePath('essex', month))
  const t0 = Date.now()
  await page.getByRole('button', { name: 'Upload report', exact: true }).click()
  await expect(page.getByRole('list', { name: 'Upload progress' }).locator('[aria-current="step"]')).toContainText('Needs review', { timeout: EXTRACT_BUDGET_MS })
  const u = await findUpload('essex', per)
  record('extraction', { deal: 'essex', period: per, pages: u.page_count, seconds: (Date.now() - t0) / 1000, status: u.status, finding_counts: u.finding_counts, via: 'ui step 9' })
  expect(u.status).toBe('needs_review')
  expect(u.finding_counts.block).toBe(2)
  await shot(page, '09-essex-may-needs-review')
  await expectRestatementFindings(u.id, restated)

  // TAO Admin accepts both restatements with a reason and publishes.
  await switchRole(page, 'tao_admin')
  await acceptRestatementsAndPublish(page, 'essex', u.id, restated,
    { cards: '09-essex-r11-restatements', dialog: '09-restatement-dialog', publish: '09-essex-publish-dialog' })
  await expectPublishedRestatements('essex', per, restated)

  // The program month is now May; TLFC LP and Finloc still contribute April, flagged "As of Apr 2026".
  const prog = (await investor.get(`/published/programs/${MOVE.program}`)).body
  expect(prog.period).toBe('2026-05')
  expect(prog.deals_behind.map((d: any) => [d.deal_slug, d.as_of]).sort()).toEqual(
    [[DEALS.finloc.slug, '2026-04'], [DEALS.tlfcLp.slug, '2026-04']].sort())
  await switchRole(page, 'investor_viewer')
  const card = page.locator('.ds-card', { hasText: MOVE.name }).filter({ has: page.getByRole('link', { name: 'Executive summary' }) }).first()
  await card.getByRole('link', { name: 'Executive summary' }).click()
  await expect(page).toHaveURL(new RegExp(`/investor/portfolio/${MOVE.program}$`))
  await expect(pageTitle(page)).toContainText(MOVE.name)
  await page.reload()   // drops the admin's "Published to partner" toast, which outlives the role switch
  await expect(pageTitle(page)).toContainText(MOVE.name)
  const dealCard = (name: RegExp) => page.locator('.ds-card').filter({ has: page.getByRole('link', { name }) }).last()
  await expect(dealCard(/^Open deal .*TLFC LP/)).toContainText('As of Apr 2026')
  await expect(dealCard(/^Open deal .*Finloc/)).toContainText('As of Apr 2026')
  await expect(dealCard(/^Open deal .*Essex/)).not.toContainText('As of')
  await expect(page.getByText(/are behind; their May 2026 reports are not published yet/)).toBeVisible()
  await shot(page, '09-program-deals-behind')
})

test('step 9b: TLFC LP June restates the April and May RVL ratio; Finloc May raises no R11', async ({ page }) => {
  test.setTimeout(6 * 60_000)
  const tlfcMay = await analystUploads('tlfcLp', '202605')
  expect((await findings(tlfcMay.id)).filter(f => f.severity === 'block')).toEqual([])
  await adminPublishes(tlfcMay.id)

  const finlocMay = await analystUploads('finloc', '202605')
  await expectFinlocNoR11(finlocMay.id, '2026-05')
  await adminPublishes(finlocMay.id)

  const { month, period: per, restated } = STEP9.tlfcLp
  const u = await analystUploads('tlfcLp', month)
  expect(u.finding_counts.block).toBe(2)
  await expectRestatementFindings(u.id, restated)
  await signInAs(page, 'tao_admin')
  await acceptRestatementsAndPublish(page, 'tlfcLp', u.id, restated,
    { cards: '09-tlfc-r11-restatements' })
  await expectPublishedRestatements('tlfcLp', per, restated)
})

test('step 9c: Finloc June and July raise no R11; the Finloc July deal page matches the shared dashboard', async ({ page }) => {
  test.setTimeout(6 * 60_000)
  for (const m of ['202606', '202607']) {
    const u = await analystUploads('finloc', m)
    await expectFinlocNoR11(u.id, period(m))
    await adminPublishes(u.id)
  }

  // Program month July: Essex is as of May, TLFC LP as of June.
  const prog = (await investor.get(`/published/programs/${MOVE.program}`)).body
  expect(prog.period).toBe('2026-07')
  expect(prog.deal_count).toBe(3)
  expect(prog.deals_behind.map((d: any) => [d.deal_slug, d.as_of]).sort()).toEqual(
    [[DEALS.essex.slug, '2026-05'], [DEALS.tlfcLp.slug, '2026-06']].sort())

  await signInAs(page, 'investor_viewer')
  const card = page.locator('.ds-card', { hasText: MOVE.name }).filter({ has: page.getByRole('link', { name: 'Executive summary' }) }).first()
  await card.getByRole('link', { name: 'Executive summary' }).click()
  await expect(page).toHaveURL(new RegExp(`/investor/portfolio/${MOVE.program}$`))
  await expect(page.locator('.ds-card').filter({ has: page.getByRole('link', { name: /^Open deal .*Essex/ }) }).last()).toContainText('As of May 2026')
  await shot(page, '09-program-july')
  await page.getByRole('link', { name: /^Open deal .*Finloc/ }).click()
  const slug = DEALS.finloc.slug
  await expect(page).toHaveURL(new RegExp(`/investor/portfolio/${MOVE.program}/deals/${slug}(\\?period=2026-07)?$`))
  await expect(pageTitle(page)).toContainText('Finloc')
  await expect(page.locator('[data-field="tranche_balance.closing"]').first()).toBeVisible()
  await shot(page, '09-finloc-deal-page', { fullPage: true })

  const published = (await investor.get(`/published/programs/${MOVE.program}/deals/${slug}`)).body
  expect(published.published_period).toBe('2026-07')
  expect(published.available_periods).toEqual(['2026-07', '2026-06', '2026-05', '2026-04'])
  const ref = referenceDeal('finloc')
  const checks = compareFields(await readDealFields(page), published, ref)
  fs.mkdirSync(CACHE, { recursive: true })
  fs.writeFileSync(path.join(CACHE, 'step9-finloc-fields.json'), JSON.stringify(checks, null, 2))
  record('numbers_match', { deal: 'finloc', period: '2026-07', fields: checks.length, display_mismatches: checks.filter(c => !c.displayOk).length,
    reference_mismatches: checks.filter(c => !c.referenceOk).length, max_money_diff: maxMoneyDiff(checks) })
  expectAllMatch(checks, 'Finloc 2000 Inc. 2026-07 (investor)')
  for (const k of ['opening', 'closing'] as const)
    expect(published.tranche_balance[k], `tranche_balance.${k}`).toBeCloseTo(ref.tranche_balance[k], 2)
})
