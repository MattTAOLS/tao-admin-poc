import { expect, test } from '@playwright/test'
import { Api, findings, findUpload, tao } from '../lib/api'
import { EXTRACT_BUDGET_MS } from '../lib/env'
import { DEALS, PROGRAM, STEP6, samplePath } from '../lib/facts'
import { record } from '../lib/measure'
import { navTo, openReview, shot, signInAs, switchRole } from '../lib/ui'

const investor = new Api('investor_viewer')

/** Demo step 6. As TAO Analyst: upload the following month. Rule 11 confirms opening = prior closing; the program
 * dashboard shows the new period. Stride Capital 2026-08 follows its published 2026-07. (The build plan's covenant-change
 * toast was dropped from the demo, decision 2026-11-03.) */
test('step 6: analyst uploads the following month; R11 holds and the program dashboard shows the new period', async ({ page }) => {
  const slug = DEALS[STEP6.deal].slug
  const before = (await investor.get(`/published/programs/${PROGRAM}?period=${STEP6.period}`)).body
  // Every deal stays in the program month: before its August upload, Stride shows its July publication, flagged as behind.
  expect(before.deals_behind).toContainEqual(expect.objectContaining({ deal_slug: slug, as_of: '2026-07' }))
  const priorDeal = (await investor.get(`/published/programs/${PROGRAM}/deals/${slug}?period=2026-07`)).body

  await signInAs(page, 'tao_analyst')
  await navTo(page, 'Uploads')
  await page.getByRole('button', { name: 'Upload report' }).first().click()
  await page.getByLabel('Deal').selectOption(slug)
  await page.getByLabel('Collection period').fill(STEP6.period)
  await page.getByTestId('filedrop-input').setInputFiles(samplePath(STEP6.deal, STEP6.month))
  const t0 = Date.now()
  await page.getByRole('button', { name: 'Upload report', exact: true }).click()
  await expect(page.getByRole('list', { name: 'Upload progress' }).locator('[aria-current="step"]')).toContainText('Needs review', { timeout: EXTRACT_BUDGET_MS })
  const seconds = (Date.now() - t0) / 1000
  await shot(page, '06-next-month-needs-review')

  const u = await findUpload(STEP6.deal, STEP6.period)
  record('extraction', { deal: STEP6.deal, period: STEP6.period, pages: u.page_count, seconds, status: u.status, finding_counts: u.finding_counts, via: 'ui step 6' })
  expect(u.status).toBe('needs_review')
  expect(u.finding_counts.block).toBe(0)

  // R11: opening = prior published closing, so no R11 finding; the extraction's opening equals Jul's closing.
  const fs = await findings(u.id)
  expect(fs.filter(f => f.rule_id === 'R11'), 'R11 findings').toEqual([])
  const ex = (await tao.get(`/uploads/${u.id}/extraction`)).body
  expect(ex.deal.tranche_balance.opening).toBeCloseTo(priorDeal.tranche_balance.closing, 2)
  expect(ex.deal.contracts.opening).toBe(priorDeal.contracts.closing)

  // TAO Admin publishes it (two R14 review findings are accepted as shown).
  await switchRole(page, 'tao_admin')
  await openReview(page, u.id)
  await expect(page.getByRole('region', { name: 'Decision' })).toContainText('All block findings are resolved. Ready to publish.')
  await page.getByRole('button', { name: 'Publish to partner…' }).click()
  const dlg = page.getByRole('dialog', { name: 'Publish to partner' })
  await dlg.getByRole('button', { name: 'Approve and publish' }).click()
  await expect(page.getByText('Published to partner').first()).toBeVisible()

  // The program dashboard (investor) shows 2026-08 with Stride in it.
  await switchRole(page, 'investor_viewer')
  await page.goto(`/investor/portfolio/${PROGRAM}/dashboard`)
  const deals = page.getByRole('table', { name: 'Deal metrics' })
  await expect(deals).toContainText('Stride')
  await expect(page.getByText(/3 deals · Aug(ust)? 2026/)).toBeVisible()
  await shot(page, '06-program-dashboard')
  const after = (await investor.get(`/published/programs/${PROGRAM}`)).body
  expect(after.period).toBe(STEP6.period)
  expect(after.deal_count).toBe(3)
  expect(after.deals_behind.map((d: any) => d.deal_slug)).not.toContain(slug)
})
