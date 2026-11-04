import { expect, test } from '@playwright/test'
import { Api, audit, tao, waitSettled, type Role } from '../lib/api'
import { blankPdf } from '../lib/blank-pdf'
import { API_URL } from '../lib/env'
import { DEALS } from '../lib/facts'
import { programPartners } from '../lib/tenancy'
import { shot, signInAs } from '../lib/ui'

/** Negative tests: partner tenancy by URL and by API, partner roles on TAO routes, and a blank PDF. Both programs are
 * shared with both partners, so the hidden-program loop finds nothing today; the X-Partner spoof, an unknown partner,
 * no partner and the shell redirect still apply. */

const VIEWER: Record<'investor' | 'manager', Role> = { investor: 'investor_viewer', manager: 'manager_viewer' }

for (const partner of ['investor', 'manager'] as const) {
  test(`negative: ${partner} gets no access to programs it does not own, by URL and by API`, async ({ page }) => {
    const role = VIEWER[partner]
    const api = new Api(role)
    const owners = await programPartners()
    const hidden = Object.keys(owners).filter(p => !owners[p].includes(partner))
    const visible = Object.keys(owners).filter(p => owners[p].includes(partner))
    test.info().annotations.push({ type: 'tenancy', description: `${partner}: visible ${visible.join(', ') || 'none'}; hidden ${hidden.join(', ') || 'none'}` })

    // The portfolio lists only owned programs.
    const portfolio = (await api.get('/published/portfolio')).body
    for (const p of portfolio.programs) expect(visible).toContain(p.program.slug)

    await signInAs(page, role)
    for (const program of hidden) {
      const deals = ((await tao.get('/master/deals')).body as any[]).filter(d => d.program_slug === program)
      const deal = deals[0].slug
      for (const route of [`/published/programs/${program}`, `/published/programs/${program}/deals/${deal}`]) {
        const r = await api.get(route)
        expect([403, 404], `${role} GET ${route} -> ${r.status}`).toContain(r.status)
        expect(JSON.stringify(r.body)).not.toContain('tranche_balance')
      }
      for (const url of [`/${partner}/portfolio/${program}`, `/${partner}/portfolio/${program}/dashboard`, `/${partner}/portfolio/${program}/deals/${deal}`]) {
        await page.goto(url)
        await expect(page.getByRole('heading', { name: 'You don’t have access' }), url).toBeVisible()
        await expect(page.locator('[data-field]')).toHaveCount(0)
      }
    }
    if (hidden.length) await shot(page, `08-${partner}-no-access`)

    // The other partner's shell URL never renders: the app sends the role back to its own shell.
    const other = partner === 'investor' ? 'manager' : 'investor'
    await page.goto(`/${other}/portfolio/f-pil-2-0`)
    await expect(page).toHaveURL(new RegExp(`/${partner}/portfolio$`))
    // Claiming the other partner in X-Partner is refused.
    const spoof = await new Api(role, other).get('/published/portfolio')
    expect(spoof.status).toBe(403)
    expect(spoof.body.code).toBe('bad_partner')
    // An unknown partner, or none at all, gets nothing.
    for (const bogus of ['nobody', undefined]) {
      const h: Record<string, string> = { 'X-Role': role, ...(bogus ? { 'X-Partner': bogus } : {}) }
      for (const route of ['/published/portfolio', '/published/programs/f-pil-2-0', '/published/programs/f-pil-2-0/deals/f-pil-2-0-xpedite-leasing']) {
        const r = await fetch(API_URL + route, { headers: h })
        expect([403, 404], `${role} X-Partner ${bogus ?? '(none)'} GET ${route}`).toContain(r.status)
        expect(await r.text()).not.toContain('tranche_balance')
      }
    }
  })
}

test('negative: partner roles cannot reach TAO routes, by URL or by API', async ({ page }) => {
  const api = new Api('investor_admin')
  for (const route of ['/uploads', '/audit', '/master/programs', '/master/deals']) {
    const r = await api.get(route)
    expect(r.status, `investor_admin GET ${route}`).toBe(403)
  }
  expect((await api.post('/published/regenerate', {})).status).toBe(403)
  await signInAs(page, 'investor_admin')
  for (const url of ['/admin', '/admin/uploads/queue', '/admin/settings/users/audit']) {
    await page.goto(url)
    await expect(page).toHaveURL(/\/investor\/portfolio$/)
  }
  // TAO-admin-only pages inside the admin shell: an analyst gets "no access" on the Audit log (Partners is read-only
  // for analysts since wave 3, so it is not a negative case any more).
  await signInAs(page, 'tao_analyst')
  await page.goto('/admin/settings/users/audit')
  await expect(page.getByRole('heading', { name: 'You don’t have access' })).toBeVisible()
  expect((await new Api('tao_analyst').get('/audit')).status).toBe(403)
})

test('negative: a blank PDF ends in extraction_failed with a plain message', async ({ page }) => {
  await signInAs(page, 'tao_analyst')
  await page.goto('/admin/uploads/new')
  await page.getByLabel('Deal').selectOption(DEALS.stride.slug)
  await page.getByLabel('Collection period').fill('2026-09')
  await page.getByTestId('filedrop-input').setInputFiles({ name: 'blank.pdf', mimeType: 'application/pdf', buffer: blankPdf() })
  await page.getByRole('button', { name: 'Upload report', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Extraction failed: page 1 has no text layer', { timeout: 120_000 })
  await shot(page, '08-blank-pdf-failed')
  const uploads = (await tao.get(`/uploads?deal_slug=${DEALS.stride.slug}`)).body as any[]
  const u = uploads.find(x => x.collection_period === '2026-09')
  const { upload } = await waitSettled(u.id)
  expect(upload.status).toBe('extraction_failed')
  const reason = (await audit(u.id)).find(e => e.action === 'extract')?.reason
  test.info().annotations.push({ type: 'message', description: String(reason) })
  expect(reason, 'audit reason for the failed extraction').toBeTruthy()
  expect(String(reason)).not.toMatch(/Traceback|Exception|Error:/)
  // Clean up: the admin rejects it so it leaves the queue.
  const rj = await tao.post(`/uploads/${u.id}/reject`, { reason: 'blank test PDF (QA negative test)' })
  expect(rj.status).toBe(200)
})
