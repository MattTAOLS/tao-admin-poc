import { expect, test } from '@playwright/test'
import { Api, audit } from '../lib/api'
import { DEALS, PROGRAM, PROGRAM_NAME, samplePath } from '../lib/facts'
import { auditRow, navTo, pageTitle, shot, signInAs } from '../lib/ui'

const investor = new Api('investor_viewer')

/** Demo step 7. As TAO Admin: Reports library > Regenerate dashboard after re-uploading month one; the roll-up
 * reflects it and the audit log records the regeneration.
 * Today the API refuses a second upload for a published deal + period (409 already_published, rule R12: "reject or
 * regenerate instead"), so month one cannot be re-uploaded; the test records that refusal in the UI and then runs the
 * regeneration. The gap is filed in docs/requests.md (QA & Demo). */
test('step 7: admin regenerates the dashboard from the Reports library; the audit log records it', async ({ page }) => {
  const before = (await investor.get(`/published/programs/${PROGRAM}`)).body
  await signInAs(page, 'tao_admin')

  // Re-upload month one (Moneda 2026-05): refused because the period is published.
  await navTo(page, 'Uploads')
  await page.getByRole('button', { name: 'Upload report' }).first().click()
  await page.getByLabel('Deal').selectOption(DEALS.moneda.slug)
  await page.getByLabel('Collection period').fill('2026-05')
  await page.getByTestId('filedrop-input').setInputFiles(samplePath('moneda', '202605'))
  await page.getByRole('button', { name: 'Upload report', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText(/already published/i)
  await shot(page, '07-reupload-refused')

  // Reports library > Regenerate dashboard.
  await navTo(page, 'Reports library')
  await expect(pageTitle(page)).toHaveText('Reports library')
  const table = page.getByRole('table', { name: 'Published reports' })
  await expect(table.getByRole('row')).toHaveCount(1 + 12)   // header + 4 months x 3 deals
  await shot(page, '07-reports-library')
  await page.getByRole('button', { name: 'Regenerate dashboard…' }).click()
  const dlg = page.getByRole('dialog', { name: 'Regenerate dashboard' })
  await dlg.getByLabel('Program').selectOption(PROGRAM)
  await shot(page, '07-regenerate-dialog')
  await dlg.getByRole('button', { name: 'Regenerate', exact: true }).click()
  await expect(dlg).toBeHidden()
  await expect(page.getByText('Dashboards regenerated').first()).toBeVisible()
  await expect(page.getByText(`${PROGRAM_NAME}: rebuilt from 12 published reports.`).first()).toBeVisible()

  // The roll-up is the same numbers (nothing changed underneath) and the audit log has a manual regeneration.
  const after = (await investor.get(`/published/programs/${PROGRAM}`)).body
  expect(after.portfolio_totals).toEqual(before.portfolio_totals)
  expect(after.covenant_totals).toEqual(before.covenant_totals)
  const regen = (await audit()).find(e => e.action === 'regenerate' && e.detail?.trigger === 'manual')
  expect(regen).toMatchObject({ actor_role: 'tao_admin' })
  expect(regen.detail).toMatchObject({ program_slug: PROGRAM, publications: 12 })

  await page.goto('/admin/settings/users/audit')
  const log = page.getByRole('table', { name: 'Audit log' })
  await expect(auditRow(page, log, 'Regenerate')).toContainText('tao_admin')
  await shot(page, '07-audit-regenerate')
})
