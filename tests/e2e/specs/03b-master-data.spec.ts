import { expect, test } from '@playwright/test'
import { Api, tao } from '../lib/api'
import { pageTitle, shot, signInAs } from '../lib/ui'

/** Master data behind the partner portals: both programs are shared with the investor and the manager, the Partners
 * list exists (TAO roles only), and every covenant definition says what unit its threshold is in. */

test('master data: both programs are shared with investor and manager; /master/partners is TAO-only', async ({ page }) => {
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
  expect((await new Api('manager_viewer').get('/published/portfolio')).body.programs.map((p: any) => p.program.slug))
    .toEqual(expect.arrayContaining(['f-pil-2-0']))

  await signInAs(page, 'tao_admin')
  await page.goto('/admin/partners')
  await expect(pageTitle(page)).toHaveText('Partners')
  await expect(page.getByRole('main')).toContainText('Investor')
  await expect(page.getByRole('main')).toContainText('Manager')
  await shot(page, '03b-partners')
})

test('master data: covenant definitions carry a unit', async () => {
  const covs = (await tao.get('/master/covenants')).body as any[]
  expect(covs.length).toBeGreaterThan(0)
  for (const c of covs) expect(['fraction', 'ratio', 'currency', null], `${c.deal_slug} ${c.legal_ref}`).toContain(c.unit)
  expect(covs.some(c => c.unit === 'currency'), 'Minimum Total Equity is a currency amount').toBe(true)
  expect(covs.some(c => c.unit === 'fraction')).toBe(true)
})
