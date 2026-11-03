import { expect, test } from '@playwright/test'
import { audit, findings, mustFindUpload, tao } from '../lib/api'
import { SEEDED, STEP4 } from '../lib/facts'
import { auditRow, openAuditFor, openReview, shot, signInAs } from '../lib/ui'

/** Demo step 5. As TAO Admin: override with reason "servicer typo, confirmed by email", choosing our value. Rules
 * re-run, the finding closes, approve, publish. Audit log shows the override. (What the published closing becomes is
 * wave-3 behaviour: wave3/use-ours-writes-value.spec.ts.) */
test('step 5: admin overrides R05 with our value and a reason, then publishes', async ({ page }) => {
  const u = await mustFindUpload(STEP4.deal, STEP4.period, 'needs_review')
  await signInAs(page, 'tao_admin')
  await openReview(page, u.id)
  const card = page.locator('article.ds-finding', { hasText: 'R05' })
  await card.getByRole('button', { name: 'Use ours for R05' }).click()
  const dlg = page.getByRole('dialog', { name: /Resolve R05/ })
  await expect(dlg).toBeVisible()
  await expect(dlg.getByRole('radio', { name: /Use ours/ })).toBeChecked()
  await dlg.getByLabel(/Reason/).fill(SEEDED.reason)
  await shot(page, '05-override-dialog')
  await dlg.getByRole('button', { name: 'Save and re-run rules' }).click()
  await expect(dlg).toBeHidden()
  await expect(page.getByText('R05 resolved: Use ours').first()).toBeVisible()
  await expect(page.getByText('Rules re-ran. No block findings open.').first()).toBeVisible()
  await expect(card).toContainText('Used our value')
  await expect(card).toContainText(SEEDED.reason)

  const r05 = (await findings(u.id)).find(f => f.rule_id === 'R05')!
  expect(r05.status).not.toBe('open')
  expect(r05.resolution).toMatchObject({ choice: 'use_ours', reason: SEEDED.reason, by: 'tao_admin' })
  expect((await findings(u.id)).filter(f => f.severity === 'block' && f.status === 'open')).toEqual([])

  const decision = page.getByRole('region', { name: 'Decision' })
  await expect(decision).toContainText('All block findings are resolved. Ready to publish.')
  await shot(page, '05-r05-resolved')
  await decision.getByRole('button', { name: 'Publish to partner…' }).click()
  const pub = page.getByRole('dialog', { name: 'Publish to partner' })
  await expect(pub).toContainText('1 finding resolved with a reason')
  await pub.getByRole('button', { name: 'Approve and publish' }).click()
  await expect(page.getByText('Published to partner').first()).toBeVisible()
  await expect(decision).toContainText('Partners can see it.')
  expect((await tao.get(`/uploads/${u.id}`)).body.status).toBe('published')

  const entries = await audit(u.id)
  const ov = entries.find(e => e.action === 'override')
  expect(ov).toMatchObject({ reason: SEEDED.reason, actor_role: 'tao_admin' })
  expect(ov.detail).toMatchObject({ choice: 'use_ours', rule_id: 'R05' })
  const approve = entries.find(e => e.action === 'approve')
  expect(approve.detail.overrides_used).toContain(r05.id)

  const log = await openAuditFor(page, u.id)
  const row = auditRow(page, log, 'Override')
  await expect(row).toContainText(SEEDED.reason)
  await expect(auditRow(page, log, 'Publish')).toBeVisible()
  await shot(page, '05-audit-override')
})
