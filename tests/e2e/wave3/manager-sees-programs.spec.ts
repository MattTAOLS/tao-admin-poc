import { expect, test } from '@playwright/test'
import { Api, tao } from '../lib/api'
import { compareFields, expectAllMatch, readDealFields } from '../lib/deal'
import { DEALS, PROGRAM, PROGRAM_NAME, STEP1, referenceDeal } from '../lib/facts'
import { pageTitle, shot, signInAs } from '../lib/ui'

/** @wave3 Parallel change (1) and (3): the manager partner sees both programs (MOVE Trust and F-PIL 2.0), the
 * /master/partners route exists, and covenant definitions carry `unit`. Demo step 3's "the Manager Viewer sees the
 * same". Expected to fail until the API / UI wave-3 work is merged. */

test('@wave3 both programs list investor and manager as partners', async () => {
  const programs = (await tao.get('/master/programs')).body as any[]
  for (const slug of ['f-pil-2-0', 'move-trust']) {
    const p = programs.find(x => x.slug === slug)
    expect(p?.partner_slugs, `${slug}.partner_slugs`).toEqual(expect.arrayContaining(['investor', 'manager']))
  }
  const partners = await tao.get('/master/partners')
  expect(partners.status, 'GET /master/partners').toBe(200)
  expect((partners.body as any[]).map(p => p.slug)).toEqual(expect.arrayContaining(['investor', 'manager']))
  expect((await new Api('tao_analyst').get('/master/partners')).status).toBe(200)
  expect((await new Api('manager_viewer').get('/master/partners')).status).toBe(403)
})

test('@wave3 covenant definitions carry a unit', async () => {
  const covs = (await tao.get('/master/covenants')).body as any[]
  expect(covs.length).toBeGreaterThan(0)
  for (const c of covs) expect(['fraction', 'ratio', 'currency', null], `${c.deal_slug} ${c.legal_ref}`).toContain(c.unit)
  expect(covs.some(c => c.unit === 'currency'), 'Minimum Total Equity is a currency amount').toBe(true)
})

test('@wave3 manager viewer sees F-PIL 2.0 and the same Xpedite numbers as the investor', async ({ page }) => {
  const slug = DEALS[STEP1.deal].slug
  const manager = new Api('manager_viewer')
  const portfolio = (await manager.get('/published/portfolio')).body
  expect(portfolio.programs.map((p: any) => p.program.slug)).toEqual(expect.arrayContaining([PROGRAM]))
  const asManager = (await manager.get(`/published/programs/${PROGRAM}/deals/${slug}`))
  expect(asManager.status).toBe(200)
  const asInvestor = (await new Api('investor_viewer').get(`/published/programs/${PROGRAM}/deals/${slug}?period=${STEP1.period}`)).body
  const m = (await manager.get(`/published/programs/${PROGRAM}/deals/${slug}?period=${STEP1.period}`)).body
  expect(m.tranche_balance).toEqual(asInvestor.tranche_balance)

  await signInAs(page, 'manager_viewer')
  await expect(pageTitle(page)).toHaveText('Portfolio Executive Summary')
  await expect(page.getByText(PROGRAM_NAME).first()).toBeVisible()
  await page.goto(`/manager/portfolio/${PROGRAM}/deals/${slug}?period=${STEP1.period}`)
  await expect(pageTitle(page)).toContainText('Xpedite Leasing')
  await shot(page, 'w3-manager-deal-page')
  const checks = compareFields(await readDealFields(page), m, referenceDeal(STEP1.deal))
  expectAllMatch(checks, 'Xpedite Leasing 2026-08 (manager)')
})
