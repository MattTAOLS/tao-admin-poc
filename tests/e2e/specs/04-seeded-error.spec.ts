import { expect, test } from '@playwright/test'
import { findings, findUpload, tao } from '../lib/api'
import { EXTRACT_BUDGET_MS } from '../lib/env'
import { DEALS, SEEDED, STEP4 } from '../lib/facts'
import { record } from '../lib/measure'
import { cents, navTo, pageTitle, shot, signInAs } from '../lib/ui'

/** Demo step 4. As TAO Analyst: upload the seeded-error report (a digit changed in principal collected). Status becomes
 * needs review with a Block finding on rule 5; the card shows the roll-forward, the $ difference and the page crop;
 * the second pass has already run once. (Moneda 2026-08 with page 2 scheduled principal 646,926.71 -> 646,826.71.) */
test('step 4: analyst uploads the seeded-error report and gets one R05 block', async ({ page }) => {
  await signInAs(page, 'tao_analyst')
  await navTo(page, 'Uploads')
  await page.getByRole('button', { name: 'Upload report' }).first().click()
  await page.getByLabel('Deal').selectOption(DEALS[STEP4.deal].slug)
  await page.getByLabel('Collection period').fill(STEP4.period)
  await page.getByTestId('filedrop-input').setInputFiles(SEEDED.file)
  const t0 = Date.now()
  await page.getByRole('button', { name: 'Upload report', exact: true }).click()
  const progress = page.getByRole('list', { name: 'Upload progress' })
  await expect(progress.locator('[aria-current="step"]')).toContainText('Needs review', { timeout: EXTRACT_BUDGET_MS })
  const seconds = (Date.now() - t0) / 1000
  await expect(page.getByText(/1 block/)).toBeVisible()
  await shot(page, '04-seeded-needs-review')

  const u = await findUpload(STEP4.deal, STEP4.period)
  expect(u.status).toBe('needs_review')
  expect(u.finding_counts.block).toBe(1)
  record('extraction', { deal: STEP4.deal, period: STEP4.period, pages: u.page_count, seconds, status: u.status, finding_counts: u.finding_counts, via: 'ui step 4 (seeded)' })
  const fs = await findings(u.id)
  const blocks = fs.filter(f => f.severity === 'block')
  expect(blocks.map(f => f.rule_id)).toEqual(['R05'])
  const r05 = blocks[0]
  expect(r05.our_value).toBeCloseTo(SEEDED.ours, 2)
  expect(r05.report_value).toBeCloseTo(SEEDED.reportClosing, 2)
  expect(r05.difference).toBeCloseTo(SEEDED.difference, 2)
  expect(r05.source_page).toBe(2)

  // The second pass has already run once: a pass-1 and a pass-2 extraction exist and the latest is pass 2.
  const latest = (await tao.get(`/uploads/${u.id}/extraction`)).body
  const pass1 = await tao.get(`/uploads/${u.id}/extraction?pass=1`)
  record('second_pass', { deal: STEP4.deal, latest_pass: latest.pass ?? latest.meta?.pass, pass1_status: pass1.status, pages_reread: latest.meta?.pages_reread })
  expect(pass1.status, 'pass-1 extraction').toBe(200)
  expect(latest.pass ?? latest.meta?.pass, 'latest extraction pass').toBe(2)

  // The Review report, read only for the analyst: the R05 card with the roll-forward, the difference and the page crop.
  await page.getByRole('link', { name: /Review 1 finding|Open in approval queue/ }).click()
  await expect(pageTitle(page)).toContainText('Moneda')
  const card = page.locator('article.ds-finding', { hasText: 'R05' })
  await expect(card).toBeVisible()
  await expect(card).toContainText(/block/i)
  await expect(card).toContainText(cents(SEEDED.ours))
  await expect(card).toContainText(cents(SEEDED.reportClosing))
  await expect(card).toContainText(/[−-]\$?100\.00/)
  await expect(card).toContainText(/opening/i)
  const crop = card.getByRole('button', { name: 'Zoom page 2' })
  await expect(crop).toBeVisible()
  await expect.poll(() => crop.locator('img').first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true)
  await expect(page.getByRole('region', { name: 'Report' })).toContainText('Pass 2')
  await expect(page.getByRole('region', { name: 'Decision' })).toContainText('Read only')
  await expect(page.getByRole('button', { name: /Use ours for R05/ })).toHaveCount(0)
  await card.scrollIntoViewIfNeeded()
  await shot(page, '04-r05-finding-card')
})
