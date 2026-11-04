import { expect, test } from '@playwright/test'
import { Api, audit, findings, tao } from '../lib/api'
import { EXTRACT_BUDGET_MS } from '../lib/env'
import { DEALS, PROGRAM, PROGRAM_NAME, STEP7, samplePath } from '../lib/facts'
import { auditRow, navTo, openAuditFor, openReview, pageTitle, shot, signInAs, switchRole } from '../lib/ui'

const investor = new Api('investor_viewer')
const slug = DEALS[STEP7.deal].slug

/** Demo step 7. As TAO Admin: Reports library > Regenerate dashboard after re-uploading month one; the roll-up
 * reflects it and the audit log records the regeneration.
 * Month one (Moneda 2026-05) is re-issued through Upload report: the 409 already_published opens "Upload as corrected
 * re-issue", the re-issue reaches needs review with R12 naming the publication it replaces and the later published
 * months, the reviewer accepts it as the replacement, publishing swaps the publication (the old upload shows
 * replaced_by), then Regenerate. */
test('step 7: admin re-issues month one, accepts it as the replacement, publishes and regenerates', async ({ page }) => {
  const old = (await investor.get(`/published/programs/${PROGRAM}/deals/${slug}?period=${STEP7.period}`)).body
  const oldUploadId: string = old.upload_id
  expect(oldUploadId).toBeTruthy()

  // Re-upload month one: refused as already published, then sent again as a corrected re-issue.
  await signInAs(page, 'tao_admin')
  await navTo(page, 'Uploads')
  await page.getByRole('button', { name: 'Upload report' }).first().click()
  await page.getByLabel('Deal').selectOption(slug)
  await page.getByLabel('Collection period').fill(STEP7.period)
  await page.getByTestId('filedrop-input').setInputFiles(samplePath(STEP7.deal, STEP7.month))
  await page.getByRole('button', { name: 'Upload report', exact: true }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Already published' })
  await expect(confirm).toContainText('Upload this file as a corrected re-issue?')
  await shot(page, '07-already-published-confirm')
  await confirm.getByRole('button', { name: 'Upload as corrected re-issue' }).click()
  await expect(page.getByRole('list', { name: 'Upload progress' }).locator('[aria-current="step"]')).toContainText('Needs review', { timeout: EXTRACT_BUDGET_MS })
  await expect(page.getByText('Corrected re-issue', { exact: true })).toBeVisible()
  await shot(page, '07-reissue-needs-review')

  const uploads = (await tao.get(`/uploads?deal_slug=${slug}`)).body as any[]
  const re = uploads.find(u => u.collection_period === STEP7.period && u.id !== oldUploadId)
  expect(re.status).toBe('needs_review')
  expect(re.replaces_upload_id).toBe(oldUploadId)
  const r12 = (await findings(re.id)).find(f => f.rule_id === 'R12')
  expect(r12, 'R12 finding on the re-issue').toBeTruthy()
  expect(r12.severity).toBe('block')
  expect(r12.message).toMatch(/Corrected re-issue: replaces the/)
  expect(r12.context.later_periods).toEqual(expect.arrayContaining(['2026-06', '2026-07', '2026-08']))
  const otherBlocks = (await findings(re.id)).filter(f => f.severity === 'block' && f.status === 'open' && f.rule_id !== 'R12')
  expect(otherBlocks, 'block findings other than R12').toEqual([])

  // Review: the banner says what publishing replaces and which later months keep the earlier figures.
  await openReview(page, re.id)
  const banner = page.getByRole('note', { name: 'Corrected re-issue' })
  await expect(banner).toContainText('Publishing replaces the report published')
  await expect(banner.getByTestId('later-periods')).toContainText('Jun 2026')
  await expect(banner.getByTestId('later-periods')).toContainText('Aug 2026')
  await shot(page, '07-reissue-banner')
  await page.getByRole('button', { name: 'Accept as replacement for R12' }).click()
  const dlg = page.getByRole('dialog', { name: /Resolve R12/ })
  await expect(dlg.getByRole('radio', { name: /Accept as replacement/ })).toBeChecked()
  await dlg.getByLabel(/Reason/).fill(STEP7.reason)
  await dlg.getByRole('button', { name: 'Save and re-run rules' }).click()
  await expect(dlg).toBeHidden()
  await expect(page.getByText('Rules re-ran. No block findings open.').first()).toBeVisible()
  await page.getByRole('button', { name: 'Publish to partner…' }).click()
  await page.getByRole('dialog', { name: 'Publish to partner' }).getByRole('button', { name: 'Approve and publish' }).click()
  await expect(page.getByText('Published to partner').first()).toBeVisible()
  await expect(banner).toContainText('It replaced the report published')
  await shot(page, '07-reissue-published')

  // The publication now points at the re-issue; the old upload shows replaced_by.
  expect((await tao.get(`/uploads/${re.id}`)).body.status).toBe('published')
  const oldAfter = (await tao.get(`/uploads/${oldUploadId}`)).body
  expect(oldAfter.replaced_by_upload_id).toBe(re.id)
  const pubAfter = (await investor.get(`/published/programs/${PROGRAM}/deals/${slug}?period=${STEP7.period}`)).body
  expect(pubAfter.upload_id).toBe(re.id)
  expect(pubAfter.tranche_balance.closing).toBeCloseTo(old.tranche_balance.closing, 2)   // same real PDF re-sent
  const entries = await audit(re.id)
  expect(entries.find(e => e.action === 'upload')?.detail).toMatchObject({ replaces_upload_id: oldUploadId })
  expect(entries.find(e => e.action === 'override')).toMatchObject({ reason: STEP7.reason })
  expect(entries.find(e => e.action === 'publish')?.detail).toMatchObject({ replaced_upload_id: oldUploadId })

  await openReview(page, oldUploadId)
  const replaced = page.getByRole('note', { name: 'Replaced report' })
  await expect(replaced).toContainText('Replaced by a corrected re-issue.')
  await shot(page, '07-old-upload-replaced')
  await replaced.getByRole('link', { name: 'Open the re-issue' }).click()
  await expect(page).toHaveURL(new RegExp(`/admin/uploads/queue/${re.id}$`))

  // Reports library > Regenerate dashboard.
  const before = (await investor.get(`/published/programs/${PROGRAM}`)).body
  await navTo(page, 'Reports library')
  await expect(pageTitle(page)).toHaveText('Reports library')
  await shot(page, '07-reports-library')
  await page.getByRole('button', { name: 'Regenerate dashboard…' }).click()
  const regen = page.getByRole('dialog', { name: 'Regenerate dashboard' })
  await regen.getByLabel('Program').selectOption(PROGRAM)
  await regen.getByRole('button', { name: 'Regenerate', exact: true }).click()
  await expect(regen).toBeHidden()
  await expect(page.getByText('Dashboards regenerated').first()).toBeVisible()
  await expect(page.getByText(new RegExp(`${PROGRAM_NAME.replace('.', '\\.')}: rebuilt from \\d+ published reports?\\.`)).first()).toBeVisible()
  const after = (await investor.get(`/published/programs/${PROGRAM}`)).body
  expect(after.portfolio_totals).toEqual(before.portfolio_totals)
  const manual = (await audit()).find(e => e.action === 'regenerate' && e.detail?.trigger === 'manual')
  expect(manual).toMatchObject({ actor_role: 'tao_admin' })
  expect(manual.detail.program_slug).toBe(PROGRAM)
  await page.goto('/admin/settings/users/audit')
  await expect(auditRow(page, page.getByRole('table', { name: 'Audit log' }), 'Regenerate')).toContainText('tao_admin')
  const log = await openAuditFor(page, re.id)
  await expect(auditRow(page, log, 'Publish')).toBeVisible()
  await shot(page, '07-audit-reissue')

  // The partner deal page for May shows the re-issue.
  await switchRole(page, 'investor_viewer')
  await page.goto(`/investor/portfolio/${PROGRAM}/deals/${slug}?period=${STEP7.period}`)
  await expect(page.getByText(/Collection period (May 2026|2026-05)/).first()).toBeVisible()
  await expect(page.locator('[data-field="tranche_balance.closing"]').first()).toHaveText(
    '$' + Math.round(pubAfter.tranche_balance.closing).toLocaleString('en-US'))
  await shot(page, '07-partner-deal-may')
})
