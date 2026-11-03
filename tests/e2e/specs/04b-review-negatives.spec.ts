import { expect, test } from '@playwright/test'
import { analyst, findings, mustFindUpload, tao } from '../lib/api'
import { STEP4 } from '../lib/facts'
import { openReview, shot, signInAs } from '../lib/ui'

/** Negative tests on the seeded upload while its R05 block is open (between demo steps 4 and 5). */

test('negative: an analyst cannot approve, override or reject (UI read only, API 403)', async ({ page }) => {
  const u = await mustFindUpload(STEP4.deal, STEP4.period, 'needs_review')
  const r05 = (await findings(u.id)).find(f => f.rule_id === 'R05')!
  await signInAs(page, 'tao_analyst')
  await openReview(page, u.id)
  const decision = page.getByRole('region', { name: 'Decision' })
  await expect(decision).toContainText('Read only. Only a TAO admin can resolve findings, re-extract, reject or publish.')
  await expect(decision.getByRole('button')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /for R05$/ })).toHaveCount(0)
  await expect(page.getByRole('table', { name: 'Activity' })).toHaveCount(0)
  await shot(page, '04b-analyst-read-only')

  const a = await analyst.post(`/uploads/${u.id}/approve`)
  expect(a.status).toBe(403)
  expect(a.body.code).toBe('admin_only')
  const o = await analyst.post(`/uploads/${u.id}/findings/${r05.id}/override`, { choice: 'use_ours', reason: 'analyst should not be able to do this' })
  expect(o.status).toBe(403)
  const rj = await analyst.post(`/uploads/${u.id}/reject`, { reason: 'analyst should not be able to do this' })
  expect(rj.status).toBe(403)
  expect((await tao.get(`/uploads/${u.id}`)).body.status).toBe('needs_review')
})

test('negative: publish is refused while a block finding is open (button disabled, API 409)', async ({ page }) => {
  const u = await mustFindUpload(STEP4.deal, STEP4.period, 'needs_review')
  await signInAs(page, 'tao_admin')
  await openReview(page, u.id)
  const decision = page.getByRole('region', { name: 'Decision' })
  await expect(decision).toContainText('1 block finding is open. Resolve it before publishing.')
  await expect(decision.getByRole('button', { name: 'Publish to partner…' })).toBeDisabled()
  await shot(page, '04b-publish-blocked')

  const a = await tao.post(`/uploads/${u.id}/approve`)
  expect(a.status).toBe(409)
  expect(a.body.code).toBe('open_block_findings')
  expect(a.body.message).toContain('R05')
  expect((await tao.get(`/uploads/${u.id}`)).body.status).toBe('needs_review')
})
