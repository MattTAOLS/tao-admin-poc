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
 * dashboard for that deal and period to the cent; the Manager Viewer sees the same. (Both partners now share both programs,
 * so "the other partner's deal" has no instance left; the tenancy negatives are in specs/08-negatives.spec.ts.) */
test('step 3: investor and manager viewers see the published deal; the numbers match the shared dashboard', async ({ page }) => {
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

  // The Manager Viewer sees the same deal with the same numbers (both partners share F-PIL 2.0).
  expect((await programPartners())[PROGRAM]).toEqual(expect.arrayContaining(['investor', 'manager']))
  await switchRole(page, 'manager_viewer')
  await expect(pageTitle(page)).toHaveText('Portfolio Executive Summary')
  const mcard = page.locator('.ds-card', { hasText: PROGRAM_NAME }).filter({ has: page.getByRole('link', { name: 'Executive summary' }) }).first()
  await mcard.getByRole('link', { name: 'Executive summary' }).click()
  await page.getByRole('link', { name: /^Open deal .*Xpedite Leasing/ }).click()
  await expect(page).toHaveURL(new RegExp(`/manager/portfolio/${PROGRAM}/deals/${slug}$`))
  await expect(page.locator('[data-field="tranche_balance.closing"]').first()).toBeVisible()
  await shot(page, '03-manager-deal-page')
  const asManager = (await new Api('manager_viewer').get(`/published/programs/${PROGRAM}/deals/${slug}`)).body
  expect(asManager.tranche_balance).toEqual(published.tranche_balance)
  const mchecks = compareFields(await readDealFields(page), asManager, ref)
  expectAllMatch(mchecks, 'Xpedite Leasing 2026-08 (manager)')
})
