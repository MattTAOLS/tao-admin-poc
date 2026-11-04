import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { Api } from '../lib/api'
import { compareFields, expectAllMatch, maxMoneyDiff, readDealFields } from '../lib/deal'
import { CACHE } from '../lib/env'
import { DEALS, PROGRAM, PROGRAM_NAME, STEP1, referenceDeal } from '../lib/facts'
import { record } from '../lib/measure'
import { programPartners } from '../lib/tenancy'
import { pageTitle, shot, signInAs, switchRole } from '../lib/ui'

const slug = DEALS[STEP1.deal].slug

/** Demo step 3. As Investor Viewer: Portfolio Executive Summary > F-PIL 2.0 > Deal page. Numbers match the shared
 * dashboard for that deal and period to the cent; switching to the other partner's deal shows You don't have access.
 * (The Manager Viewer seeing the same deal is wave-3 behaviour: wave3/manager-sees-programs.spec.ts.) */
test('step 3: investor viewer sees the published deal and the numbers match the shared dashboard', async ({ page }) => {
  await signInAs(page, 'investor_viewer')
  await expect(pageTitle(page)).toHaveText('Portfolio Executive Summary')
  await shot(page, '03-portfolio-summary')
  const card = page.locator('.ds-card', { hasText: PROGRAM_NAME }).filter({ has: page.getByRole('link', { name: 'Executive summary' }) }).first()
  await card.getByRole('link', { name: 'Executive summary' }).click()
  await expect(page).toHaveURL(new RegExp(`/investor/portfolio/${PROGRAM}$`))
  await expect(pageTitle(page)).toContainText(PROGRAM_NAME)
  await shot(page, '03-program-summary')
  await page.getByRole('link', { name: /^Open deal .*Xpedite Leasing/ }).click()
  await expect(page).toHaveURL(new RegExp(`/investor/portfolio/${PROGRAM}/deals/${slug}$`))
  await expect(pageTitle(page)).toContainText('Xpedite Leasing')
  await expect(page.getByText(`Collection period ${referenceDeal(STEP1.deal).collection_period}`)).toBeVisible()
  await expect(page.locator('[data-field="tranche_balance.closing"]').first()).toBeVisible()
  await shot(page, '03-deal-page', { fullPage: true })

  const published = (await new Api('investor_viewer').get(`/published/programs/${PROGRAM}/deals/${slug}`)).body
  expect(published.published_period).toBe(STEP1.period)
  expect(published.available_periods).toEqual(['2026-08', '2026-07', '2026-06', '2026-05'])
  const ref = referenceDeal(STEP1.deal)
  const checks = compareFields(await readDealFields(page), published, ref)
  fs.mkdirSync(CACHE, { recursive: true })
  fs.writeFileSync(path.join(CACHE, 'step3-deal-fields.json'), JSON.stringify(checks, null, 2))
  record('numbers_match', { deal: STEP1.deal, period: STEP1.period, fields: checks.length, display_mismatches: checks.filter(c => !c.displayOk).length,
    reference_mismatches: checks.filter(c => !c.referenceOk).length, max_money_diff: maxMoneyDiff(checks) })
  expectAllMatch(checks, 'Xpedite Leasing 2026-08 (investor)')
  // To the cent on the headline balances.
  for (const k of ['opening', 'closing', 'principal', 'principal_prepayments', 'losses', 'interest', 'recoveries'] as const)
    expect(published.tranche_balance[k], `tranche_balance.${k}`).toBeCloseTo(ref.tranche_balance[k], 2)

  // A partner that does not see this program gets "You don't have access" on the same deal, by URL and by API.
  const partners = (await programPartners())[PROGRAM]
  const outsider = (['investor', 'manager'] as const).find(p => !partners.includes(p))
  test.info().annotations.push({ type: 'tenancy', description: `${PROGRAM} partners: ${partners.join(', ')}; outsider: ${outsider ?? 'none'}` })
  if (outsider) {
    const role = outsider === 'manager' ? 'manager_viewer' : 'investor_viewer'
    await switchRole(page, role)
    await page.goto(`/${outsider}/portfolio/${PROGRAM}/deals/${slug}`)
    await expect(page.getByRole('heading', { name: 'You don’t have access' })).toBeVisible()
    await expect(page.locator('[data-field]')).toHaveCount(0)
    await shot(page, '03-other-partner-no-access')
    const r = await new Api(role).get(`/published/programs/${PROGRAM}/deals/${slug}`)
    expect([403, 404]).toContain(r.status)
  }
})
