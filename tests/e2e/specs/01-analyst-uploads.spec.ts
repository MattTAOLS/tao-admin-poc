import { expect, test } from '@playwright/test'
import { findUpload, waitSettled } from '../lib/api'
import { EXTRACT_BUDGET_MS } from '../lib/env'
import { DEALS, PROGRAM_NAME, STEP1, samplePath } from '../lib/facts'
import { record } from '../lib/measure'
import { navTo, pageTitle, shot, signInAs } from '../lib/ui'

/** Demo step 1. As TAO Analyst: Uploads > Upload report, pick the F-PIL 2.0 deal and period 2026-08, drop the sample
 * PDF. Status moves received > extracting > needs review while you watch; the Approval queue shows it with its
 * finding count. (Xpedite Leasing 2026-08: a clean report, no findings, with May-Jul already published.) */
test('step 1: analyst uploads a SetRep and watches it reach needs review', async ({ page }) => {
  await signInAs(page, 'tao_analyst')
  await navTo(page, 'Uploads')
  await expect(pageTitle(page)).toHaveText('Uploads')
  await page.getByRole('button', { name: 'Upload report' }).first().click()
  await expect(pageTitle(page)).toHaveText('Upload report')

  await page.getByLabel('Deal').selectOption(DEALS[STEP1.deal].slug)
  await page.getByLabel('Collection period').fill(STEP1.period)
  await page.getByTestId('filedrop-input').setInputFiles(samplePath(STEP1.deal, STEP1.month))
  await shot(page, '01-upload-form')
  const t0 = Date.now()
  await page.getByRole('button', { name: 'Upload report', exact: true }).click()

  // Watch the progress steps: the current one carries aria-current="step".
  const progress = page.getByRole('list', { name: 'Upload progress' })
  await expect(progress).toBeVisible()
  const seen: string[] = []
  await expect(async () => {
    const cur = (await progress.locator('[aria-current="step"]').textContent().catch(() => null))?.replace('›', '').trim() ?? ''
    if (cur && seen[seen.length - 1] !== cur) seen.push(cur)
    if (seen.length === 1 && seen[0] !== 'Needs review') await page.waitForTimeout(500)
    expect(cur).toBe('Needs review')
  }).toPass({ timeout: EXTRACT_BUDGET_MS, intervals: [500] })
  const seconds = (Date.now() - t0) / 1000
  const order = ['Received', 'Extracting', 'Needs review']
  expect(seen.map(s => order.indexOf(s)), `steps seen ${seen.join(' > ')}`).toEqual([...seen.map(s => order.indexOf(s))].sort())
  expect(seen.length, `an in-flight step was shown before needs review (${seen.join(' > ')})`).toBeGreaterThan(1)
  await expect(page.getByText('Reporting period')).toBeVisible()
  await expect(page.getByText('July 2026').or(page.getByText('Jul 2026')).first()).toBeVisible()
  await shot(page, '01-upload-needs-review')

  // API state: the upload is needs_review with zero findings.
  const u = await findUpload(STEP1.deal, STEP1.period)
  expect(u.status).toBe('needs_review')
  expect(u.uploaded_by).toBe('tao_analyst')
  expect(u.reporting_period).toBe('2026-07')
  const fc = u.finding_counts ?? {}
  expect((fc.block ?? 0) + (fc.review ?? 0) + (fc.note ?? 0)).toBe(0)
  record('extraction', { deal: STEP1.deal, period: STEP1.period, pages: u.page_count, seconds, status: u.status, via: 'ui step 1' })

  // The Approval queue lists it with its finding count.
  await page.goto('/admin/uploads/queue')
  await expect(pageTitle(page)).toHaveText('Approval queue')
  const row = page.getByRole('row', { name: /Xpedite/ })
  await expect(row).toBeVisible()
  await expect(row).toContainText(PROGRAM_NAME)
  await expect(row).toContainText('Needs review')
  await expect(row).toContainText('No findings')
  await shot(page, '01-approval-queue')
  void waitSettled
})
