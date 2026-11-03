import { expect, test } from '@playwright/test'
import { Api, findings, mustFindUpload } from '../lib/api'
import { DEALS, PROGRAM, SEEDED, STEP4 } from '../lib/facts'
import { shot, signInAs } from '../lib/ui'

/** @wave3 Parallel change (2): "Use ours" on a finding with `targets` writes the chosen value into the published deal
 * and adds a data_corrections entry. After demo step 5 (R05 overridden with use_ours, approved), the published Moneda
 * 2026-08 closing is ours, 15,020,071.52 (today it stays the report's 15,019,971.52). */
test('@wave3 use_ours on R05 writes our closing into the published deal with a data_corrections entry', async ({ page }) => {
  const u = await mustFindUpload(STEP4.deal, STEP4.period, 'published')
  const r05 = (await findings(u.id)).find(f => f.rule_id === 'R05')!
  expect(r05.targets, 'R05 carries targets').toEqual(expect.arrayContaining(['/tranche_balance/closing']))

  const slug = DEALS[STEP4.deal].slug
  const deal = (await new Api('investor_viewer').get(`/published/programs/${PROGRAM}/deals/${slug}?period=${STEP4.period}`)).body
  expect(deal.tranche_balance.closing).toBeCloseTo(SEEDED.ours, 2)
  const row = (deal.period_history as any[]).find(r => r.period === STEP4.period || r.period === 'Aug 2026' || r.period === 'August 2026')
  if (row && 'closing_balance' in row) expect(row.closing_balance).toBeCloseTo(SEEDED.ours, 2)
  const corr = (deal.data_corrections ?? []).find((c: any) => /closing/.test(String(c.field)))
  expect(corr, 'data_corrections entry for the closing').toBeTruthy()
  expect(corr.old_value).toBeCloseTo(SEEDED.reportClosing, 2)
  expect(corr.new_value).toBeCloseTo(SEEDED.ours, 2)
  expect(corr.reason).toBe(SEEDED.reason)

  await signInAs(page, 'investor_viewer')
  await page.goto(`/investor/portfolio/${PROGRAM}/deals/${slug}?period=${STEP4.period}`)
  await expect(page.locator('[data-field="tranche_balance.closing"]').first()).toHaveText('$15,020,072')
  await shot(page, 'w3-use-ours-published')
})
