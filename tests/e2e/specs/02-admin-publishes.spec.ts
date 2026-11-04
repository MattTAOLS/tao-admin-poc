import { expect, test } from '@playwright/test'
import { audit, mustFindUpload, tao } from '../lib/api'
import { STEP1 } from '../lib/facts'
import { record } from '../lib/measure'
import { auditRow, openAuditFor, pageTitle, shot, signInAs } from '../lib/ui'

/** Demo step 2. As TAO Admin: open Review report. Every extracted field is shown with its page crop; the finding cards
 * are empty for a clean report. Approve > Publish to partner. Status becomes published; the audit log has the entry. */
test('step 2: admin reviews the clean report and publishes it', async ({ page }) => {
  const u = await mustFindUpload(STEP1.deal, STEP1.period, 'needs_review')
  await signInAs(page, 'tao_admin')
  await page.goto('/admin/uploads/queue')
  await expect(pageTitle(page)).toHaveText('Approval queue')
  await page.getByRole('row', { name: /Xpedite/ }).getByRole('link').first().click()
  await expect(pageTitle(page)).toHaveText('Xpedite Leasing')
  await expect(page).toHaveURL(new RegExp(`/admin/uploads/queue/${u.id}$`))

  // Clean report: no finding cards.
  await expect(page.getByText('No findings. Every rule passed for this extraction.')).toBeVisible()

  // Every extracted value carries its page (or says which earlier publication it was carried from).
  const values = page.locator('section.rv-section')
  await expect(values.first()).toBeVisible()
  const pageLinks = page.locator('.rv-srclink')
  const linked = await pageLinks.count()
  const carried = await page.locator('.rv-carried').filter({ hasNotText: 'no source' }).count()
  const missing = await page.locator('.rv-carried', { hasText: 'no source' }).count()
  const kvRows = await page.locator('.rv-kv__row').count()
  const kvWithRef = await page.locator('.rv-kv__row').filter({ has: page.locator('.rv-srclink, .rv-carried') }).count()
  record('page_refs', { deal: STEP1.deal, period: STEP1.period, page_links: linked, carried, no_source: missing, kv_rows: kvRows, kv_rows_with_ref: kvWithRef })
  expect(linked).toBeGreaterThan(20)
  expect(missing, 'values shown with "no source"').toBe(0)
  expect(kvWithRef).toBe(kvRows)
  await shot(page, '02-review-clean')

  // A page reference opens the page image at that value.
  await pageLinks.first().click()
  const viewer = page.getByRole('dialog')
  await expect(viewer).toBeVisible()
  await expect(viewer.locator('img').first()).toBeVisible()
  await expect.poll(() => viewer.locator('img').first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true)
  await shot(page, '02-page-viewer')
  await viewer.getByRole('button', { name: 'Close' }).last().click()
  await expect(viewer).toBeHidden()

  // Approve > Publish to partner.
  await page.getByRole('button', { name: 'Publish to partner…' }).click()
  const dlg = page.getByRole('dialog', { name: 'Publish to partner' })
  await expect(dlg).toContainText('the Investor portal')
  await shot(page, '02-publish-dialog')
  await dlg.getByRole('button', { name: 'Approve and publish' }).click()
  await expect(page.getByText('Published to partner').first()).toBeVisible()
  await expect(page.getByRole('region', { name: 'Decision' })).toContainText('Partners can see it.')
  await expect(page.getByRole('region', { name: 'Decision' }).getByRole('button', { name: 'Publish to partner…' })).toHaveCount(0)

  // API: published, with approve and publish in the audit log.
  const after = (await tao.get(`/uploads/${u.id}`)).body
  expect(after.status).toBe('published')
  const actions = (await audit(u.id)).map(e => e.action)
  expect(actions).toEqual(expect.arrayContaining(['upload', 'approve', 'publish']))

  // The Activity card on the page and the Audit log page show the publication.
  await expect(page.getByRole('table', { name: 'Activity' })).toContainText('Publish')
  await shot(page, '02-published')
  const log = await openAuditFor(page, u.id)
  await expect(auditRow(page, log, 'Publish')).toContainText('tao_admin')
  await expect(auditRow(page, log, 'Approve')).toBeVisible()
  await shot(page, '02-audit-log')
})
