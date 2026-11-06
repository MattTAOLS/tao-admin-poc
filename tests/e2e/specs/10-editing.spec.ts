import { expect, test, type Page } from '@playwright/test'
import { analyst, Api, findings, findUpload, tao, waitSettled } from '../lib/api'
import { compareFields, readDealFields } from '../lib/deal'
import { DEALS, MOVE, PROGRAM, STEP10, period, samplePath, type DealKey } from '../lib/facts'
import { record } from '../lib/measure'
import { auditRow, openReview, pageTitle, shot, signInAs, switchRole } from '../lib/ui'

const investor = new Api('investor_viewer')

/** Demo step 10 (phase 2, wave B): editing.
 * 10a: a TAO Admin edits an extracted value in review with a reason; the rules re-run (the closing edit raises R05), the
 *      edit is reverted (R05 closes), another value is edited and published; the Publish dialog lists it and the investor
 *      deal page shows "Corrected by TAO" old -> new. The Reports audit tab has value_edit and value_edit_revert.
 * 10b: corrections after publish from the Reports library: one publishes at once as version 2 (Corrected, Version 2 of 2,
 *      version 1 with its banner); one opens a block, waits in the Approval queue tagged Correction while version 1 stays
 *      live, and is acknowledged and approved as version 2. Analysts see no edit or correct control and get 403.
 * 10c: a covenant gets a new version from a date with a reason; History shows it, the Platform audit tab has the
 *      master_change with before / after, a new version not later than the current one is 409, analysts read History only.
 * Runs after step 9 on the state it leaves (Essex published to May; TLFC LP June and Finloc July published). */
test.describe.configure({ mode: 'serial' })

const slugOf = (d: DealKey) => DEALS[d].slug
const programOf = (d: DealKey) => (slugOf(d).startsWith('move-trust') ? MOVE.program : PROGRAM)

async function publishedDeal(d: DealKey, per: string, version?: number) {
  const r = await investor.get(`/published/programs/${programOf(d)}/deals/${slugOf(d)}?period=${per}${version ? `&version=${version}` : ''}`)
  expect(r.status, `published ${d} ${per}${version ? ` v${version}` : ''}`).toBe(200)
  return r.body
}

const at = (obj: any, pointer: string) => pointer.split('/').slice(1).reduce((o, k) => (o == null ? undefined : o[k]), obj)
const openBlocks = async (uploadId: string) => (await findings(uploadId)).filter(f => f.severity === 'block' && f.status === 'open')

/** The Reports library's "Correct a value…" for one published deal month: pick the value, type the new one, reason, note. */
async function correctFromLibrary(page: Page, c: typeof STEP10.correctClean, value: number) {
  await page.goto('/admin/reports')
  await expect(pageTitle(page)).toHaveText('Reports library')
  const per = new Date(`${c.period}-15`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  await page.getByRole('button', { name: `Correct a value of ${c.name} ${per}` }).click()
  const dlg = page.getByRole('dialog', { name: 'Correct a published value' })
  await expect(dlg).toContainText('published version 1')
  await dlg.getByRole('searchbox').fill(c.search)
  await dlg.getByRole('list', { name: 'Matching values' }).getByRole('button', { name: c.pick }).first().click()
  const table = dlg.getByRole('table', { name: 'Values to correct' })
  await table.getByRole('textbox').fill(value.toFixed(2))
  await dlg.getByLabel(/^Reason/).fill(STEP10.correctionReason)
  await dlg.getByLabel(/Note to partners/).fill(STEP10.noteToPartners)
  return dlg
}

test('step 10a: admin edits an extracted value in review, the rules re-run, reverts, edits again and publishes', async ({ page }) => {
  test.setTimeout(6 * 60_000)
  const e = STEP10.edit
  expect(await findUpload(e.deal, '2026-05', 'published'), 'Essex May published by step 9').toBeTruthy()
  expect(await findUpload(e.deal, e.period), `${e.deal} ${e.period} already uploaded: step 10 needs a fresh stack`).toBeUndefined()

  // Essex June: the analyst uploads it; it reaches review with no Block.
  const r = await analyst.upload(slugOf(e.deal), e.period, samplePath(e.deal, e.month))
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  const { upload: u, seconds } = await waitSettled(r.body.id)
  record('extraction', { deal: e.deal, period: e.period, pages: u.page_count, seconds, status: u.status, finding_counts: u.finding_counts, via: 'api step 10' })
  expect(u.status).toBe('needs_review')
  expect(u.finding_counts.block).toBe(0)
  const ex = (await tao.get(`/uploads/${u.id}/extraction`)).body.deal
  const closing = at(ex, e.raise.pointer) as number
  const interest = at(ex, e.keep.pointer) as number

  // The analyst sees the values with no Edit control, and the API refuses the edit.
  await signInAs(page, 'tao_analyst')
  await page.goto(`/admin/uploads/queue/${u.id}`)
  await expect(page.getByText('Extracted values').first()).toBeVisible()
  await expect(page.getByRole('button', { name: `Edit ${e.raise.label}` })).toHaveCount(0)
  await expect(page.locator('button.rv-ev__btn')).toHaveCount(0)
  expect((await analyst.post(`/uploads/${u.id}/edits`, { pointer: e.keep.pointer, value: interest + 1, reason: 'analyst tries an edit' })).status).toBe(403)

  // TAO Admin edits the closing balance: the rules re-run and R05 blocks.
  await switchRole(page, 'tao_admin')
  await openReview(page, u.id)
  const decision = page.getByRole('region', { name: 'Decision' })
  await page.getByRole('button', { name: `Edit ${e.raise.label}` }).click()
  let dlg = page.getByRole('dialog', { name: `Edit ${e.raise.label}` })
  await dlg.getByLabel(/^New value/).fill((closing + e.raise.delta).toFixed(2))
  await dlg.getByLabel(/^Reason/).fill(e.reason)
  await expect(dlg.getByTestId('edit-change')).toBeVisible()
  await shot(page, '10-edit-dialog')
  await dlg.getByRole('button', { name: 'Save and re-run rules' }).click()
  await expect(dlg).toBeHidden()
  const r05 = page.locator('article.ds-finding', { hasText: 'R05' })
  await expect(r05.first()).toBeVisible()
  await expect(decision).toContainText(/block finding.* open/)
  const edited = page.locator(`[data-testid="edited-value"][data-pointer="${e.raise.pointer}"]`)
  await expect(edited).toContainText('Edited')
  await r05.first().scrollIntoViewIfNeeded()
  await shot(page, '10-edit-raises-r05')
  expect((await openBlocks(u.id)).map(f => f.rule_id)).toContain('R05')

  // Revert: the original is back, the rules re-run and R05 closes.
  await page.getByRole('button', { name: `Revert ${e.raise.label}` }).click()
  dlg = page.getByRole('dialog', { name: `Revert ${e.raise.label}` })
  await dlg.getByLabel(/^Reason/).fill(e.revertReason)
  await dlg.getByRole('button', { name: 'Revert and re-run rules' }).click()
  await expect(dlg).toBeHidden()
  await expect(edited).toHaveCount(0)
  await expect(decision).toContainText('Ready to publish')
  expect(await openBlocks(u.id)).toEqual([])

  // Edit again: interest, which no block rule reads.
  await page.getByRole('button', { name: `Edit ${e.keep.label}` }).click()
  dlg = page.getByRole('dialog', { name: `Edit ${e.keep.label}` })
  await dlg.getByLabel(/^New value/).fill((interest + e.keep.delta).toFixed(2))
  await dlg.getByLabel(/^Reason/).fill(e.reason)
  await dlg.getByRole('button', { name: 'Save and re-run rules' }).click()
  await expect(dlg).toBeHidden()
  await expect(page.locator(`[data-testid="edited-value"][data-pointer="${e.keep.pointer}"]`)).toContainText('Edited')
  expect(await openBlocks(u.id)).toEqual([])
  const edits = (await tao.get(`/uploads/${u.id}/edits`)).body as any[]
  expect(edits.length).toBe(2)
  expect(edits.find(x => x.pointer === e.raise.pointer)?.reverted_at).toBeTruthy()
  expect(edits.find(x => x.pointer === e.keep.pointer)).toMatchObject({ old_value: interest, new_value: interest + e.keep.delta, reverted_at: null })

  // Publish: the dialog lists the edit.
  await decision.getByRole('button', { name: 'Publish to partner…' }).click()
  const pub = page.getByRole('dialog', { name: 'Publish to partner' })
  await expect(pub).toContainText('1 value edit by hand, listed below')
  await expect(pub.getByTestId('publish-edits')).toContainText(e.reason)
  await shot(page, '10-publish-lists-edit')
  await pub.getByRole('button', { name: 'Approve and publish' }).click()
  await expect(page.getByText('Published to partner').first()).toBeVisible()

  // The Reports audit tab: value_edit twice, value_edit_revert once, with the reasons.
  const entries = (await tao.get(`/audit?scope=reports&upload_id=${u.id}`)).body as any[]
  expect(entries.filter(x => x.action === 'value_edit').length).toBe(2)
  expect(entries.filter(x => x.action === 'value_edit_revert')).toEqual([expect.objectContaining({ reason: e.revertReason, actor_role: 'tao_admin' })])
  await page.goto(`/admin/settings/users/audit?upload_id=${u.id}`)
  await expect(pageTitle(page)).toHaveText('Audit log')
  const log = page.getByRole('table').first()
  await expect(auditRow(page, log, 'Value edited')).toBeVisible()
  await expect(auditRow(page, log, 'Value edit reverted')).toContainText(e.revertReason)
  await shot(page, '10-audit-value-edits')

  // The investor deal page: Data corrections shows the interest edit as Corrected by TAO, old -> new.
  const deal = await publishedDeal(e.deal, e.period)
  expect(at(deal, e.keep.pointer)).toBeCloseTo(interest + e.keep.delta, 2)
  expect(at(deal, e.raise.pointer)).toBeCloseTo(closing, 2)
  const corr = (deal.data_corrections as any[]).filter(c => c.choice === 'manual')
  expect(corr).toEqual([expect.objectContaining({ record: 'tranche_balance', field: 'interest', old_value: interest, new_value: interest + e.keep.delta, reason: e.reason })])
  await switchRole(page, 'investor_viewer')
  await page.goto(`/investor/portfolio/${MOVE.program}/deals/${slugOf(e.deal)}?period=${e.period}`)
  const card = page.locator('.ds-card', { hasText: 'Data corrections' }).last()
  await expect(card).toContainText('Corrected by TAO')
  await card.scrollIntoViewIfNeeded()
  const shown = (await readDealFields(page)).filter(f => f.field.startsWith('data_corrections.'))
  expect(shown.length, 'old and new value on the page').toBeGreaterThanOrEqual(2)
  expect(compareFields(shown, deal, deal).filter(c => !c.displayOk)).toEqual([])
  await shot(page, '10-deal-corrected-by-tao')
})

test('step 10b: corrections after publish: one publishes as version 2, one waits in the queue until approved', async ({ page }) => {
  test.setTimeout(6 * 60_000)
  const a = STEP10.correctClean, b = STEP10.correctBlock
  const ua = await findUpload(a.deal, a.period, 'published')
  const ub = await findUpload(b.deal, b.period, 'published')
  expect(ua && ub, 'TLFC LP June and Finloc July published by step 9').toBeTruthy()
  const v1a = await publishedDeal(a.deal, a.period)
  const v1b = await publishedDeal(b.deal, b.period)
  const oldA = at(v1a, a.pointer) as number, oldB = at(v1b, b.pointer) as number

  // The analyst: no Correct a value… in the library, no Correct… on a published report, 403 from the API.
  await signInAs(page, 'tao_analyst')
  await page.goto('/admin/reports')
  await expect(pageTitle(page)).toHaveText('Reports library')
  await expect(page.getByRole('button', { name: /^Correct a value of/ })).toHaveCount(0)
  await page.goto(`/admin/uploads/queue/${ua.id}`)
  await expect(page.getByText('Extracted values').first()).toBeVisible()
  await expect(page.getByRole('button', { name: /^Correct / })).toHaveCount(0)
  expect((await analyst.post(`/uploads/${ua.id}/corrections`, { edits: [{ pointer: a.pointer, value: oldA + 1 }], reason: 'analyst tries a correction' })).status).toBe(403)

  // A clean correction: published at once as version 2.
  await switchRole(page, 'tao_admin')
  let dlg = await correctFromLibrary(page, a, oldA + a.delta)
  await shot(page, '10-correct-dialog')
  await dlg.getByRole('button', { name: 'Correct and re-publish' }).click()
  let result = page.getByRole('dialog', { name: 'Correction published' })
  await expect(result).toContainText('Published as version 2.')
  await result.getByRole('button', { name: 'Close' }).last().click()
  const v2a = await publishedDeal(a.deal, a.period)
  expect(v2a.version).toBe(2)
  expect(at(v2a, a.pointer)).toBeCloseTo(oldA + a.delta, 2)
  expect(v2a.versions.find((v: any) => v.version === 2)).toMatchObject({ current: true, reason: STEP10.correctionReason, note_to_partners: STEP10.noteToPartners })
  expect(at(await publishedDeal(a.deal, a.period, 1), a.pointer)).toBeCloseTo(oldA, 2)

  // Investor: Corrected, Version 2 of 2; the menu opens version 1 with the Earlier version banner.
  await switchRole(page, 'investor_viewer')
  await page.goto(`/investor/portfolio/${MOVE.program}/deals/${slugOf(a.deal)}?period=${a.period}`)
  await expect(page.getByText('Corrected', { exact: true }).first()).toBeVisible()
  const vbtn = page.getByRole('button', { name: 'Version 2 of 2' })
  await vbtn.click()
  const menu = page.getByRole('region', { name: 'Published versions' })
  await expect(menu).toContainText(STEP10.correctionReason)
  await shot(page, '10-version-menu')
  await menu.getByRole('link', { name: /^Version 1/ }).click()
  await expect(page).toHaveURL(/[?&]version=1/)
  const banner = page.getByRole('note', { name: 'Earlier version' })
  await expect(banner).toContainText('You are looking at version 1. The current version is 2.')
  await expect(page.getByRole('button', { name: 'Version 1 of 2' })).toBeVisible()
  await shot(page, '10-version-1-banner')

  // A correction that opens a block: it waits in the queue tagged Correction; version 1 stays live.
  await switchRole(page, 'tao_admin')
  dlg = await correctFromLibrary(page, b, oldB + b.delta)
  await dlg.getByRole('button', { name: 'Correct and re-publish' }).click()
  result = page.getByRole('dialog', { name: 'Correction waiting for approval' })
  await expect(result).toContainText('Waiting in the approval queue: 1 block finding.')
  await expect(result).toContainText('Version 1 stays live')
  await result.getByRole('button', { name: 'Close' }).last().click()
  const waiting = (await tao.get('/corrections?status=needs_review')).body as any[]
  const k = waiting.find(c => c.deal_slug === slugOf(b.deal) && c.collection_period === b.period)
  expect(k).toMatchObject({ status: 'needs_review', version: 2 })
  expect(k.finding_counts.block).toBe(1)
  const live = await publishedDeal(b.deal, b.period)
  expect(live.version ?? 1).toBe(1)
  expect(at(live, b.pointer)).toBeCloseTo(oldB, 2)

  await page.goto('/admin/uploads/queue')
  await expect(pageTitle(page)).toHaveText('Approval queue')
  const row = page.getByRole('row', { name: new RegExp(`${b.name}.*correction`) }).or(page.getByRole('row').filter({ hasText: b.name }).filter({ hasText: 'Correction' })).first()
  await expect(row).toContainText('Correction')
  await expect(row).toContainText('version 2')
  await shot(page, '10-queue-correction')
  await row.getByRole('link', { name: `${b.name} correction` }).click()
  const kcard = page.getByRole('region', { name: 'Correction' }).or(page.locator('[aria-label="Correction"]')).first()
  await expect(kcard).toContainText('Correction · version 2')
  const kdecision = page.getByRole('region', { name: 'Correction decision' })
  await expect(kdecision.getByRole('button', { name: 'Approve and publish v2' })).toBeDisabled()
  await shot(page, '10-correction-review')
  await kcard.getByRole('button', { name: 'Acknowledge R05' }).click()
  const ack = page.getByRole('dialog', { name: /R05/ })
  await ack.getByLabel(/^Reason/).fill(STEP10.ackReason)
  await ack.getByRole('button', { name: 'Acknowledge' }).click()
  await expect(ack).toBeHidden()
  await expect(kdecision.getByRole('button', { name: 'Approve and publish v2' })).toBeEnabled()
  await kdecision.getByRole('button', { name: 'Approve and publish v2' }).click()
  await expect(page.getByText('Published as version 2').first()).toBeVisible()
  const v2b = await publishedDeal(b.deal, b.period)
  expect(v2b.version).toBe(2)
  expect(at(v2b, b.pointer)).toBeCloseTo(oldB + b.delta, 2)
  expect((await tao.get(`/corrections/${k.id}`)).body.status).toBe('published')
  const acts = ((await tao.get(`/audit?scope=reports&upload_id=${ub.id}`)).body as any[]).map(x => x.action)
  expect(acts).toEqual(expect.arrayContaining(['correction', 'correction_approve', 'publish']))
  expect((await analyst.post(`/corrections/${k.id}/approve`)).status).toBe(403)
})

test('step 10c: admin adds a covenant version from a date; History and the Platform audit show it; analysts read only', async ({ page }) => {
  // At 1440 x 900 the Covenant definitions table is wider than its card and the Actions / History column is clipped
  // (docs/requests.md, QA 2026-11-05). This step runs at 1920 wide; the known-bug test below checks 1440.
  await page.setViewportSize({ width: 1920, height: 1080 })
  const c = STEP10.covenant
  const slug = slugOf(c.deal)
  const before = ((await tao.get(`/master/covenants?deal_slug=${slug}`)).body as any[]).find(x => x.legal_ref === c.legalRef)
  expect(before).toMatchObject({ effective_from: c.currentFrom })
  const recordUrl = `/admin/partners/investor/programs/${PROGRAM}`
  const editName = `Edit ${c.legalRef} from ${c.currentFrom} for ${c.dealName}`
  const historyName = `History of ${c.legalRef} for ${c.dealName}`

  // The analyst opens History but has no Edit, and the API refuses the change.
  await signInAs(page, 'tao_analyst')
  await page.goto(recordUrl)
  await expect(page.getByText('Read only. Only TAO Admin can change master data.')).toBeVisible()
  await expect(page.getByRole('button', { name: historyName, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: editName, exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: historyName, exact: true }).click()
  await expect(page.getByRole('table', { name: new RegExp(`^Version history · ${c.dealName} · ${c.legalRef.replace(/[()]/g, '\\$&')}`) })).toBeVisible()
  const { id: _id, origin: _o, superseded_at: _s, supersedes_id: _si, changed_by: _cb, change_reason: _cr, changed_at: _ca, ...def } = before
  expect((await analyst.req('PUT', '/master/covenants', { ...def, mode: 'new_version', effective_from: c.newFrom, reason: 'analyst tries a covenant change' })).status).toBe(403)

  // TAO Admin: Edit › New version from a date, watch buffer widened from 2026-09-01, with a reason.
  await switchRole(page, 'tao_admin')
  await page.goto(recordUrl)
  await page.getByRole('button', { name: editName, exact: true }).click()
  const dlg = page.getByRole('dialog', { name: new RegExp(`^Edit ${c.legalRef.replace(/[()]/g, '\\$&')}`) })
  await dlg.getByRole('radio', { name: /New version from a date/ }).check()
  await dlg.getByLabel(/^Watch buffer/).fill(String(c.watchBuffer))
  await dlg.getByLabel(/^Effective from/).fill(c.newFrom)
  await dlg.getByLabel(/^Reason/).fill(c.reason)
  await expect(dlg.getByRole('region', { name: 'What this change does' })).toContainText(`from ${c.newFrom}`)
  await shot(page, '10-covenant-new-version')
  await dlg.getByRole('button', { name: 'Save new version' }).click()
  await expect(dlg).toBeHidden()

  const all = ((await tao.get(`/master/covenants?deal_slug=${slug}&include_history=true`)).body as any[]).filter(x => x.legal_ref === c.legalRef)
  expect(all.map(x => x.effective_from).sort()).toEqual([c.currentFrom, c.newFrom])
  const nv = all.find(x => x.effective_from === c.newFrom)
  expect(nv).toMatchObject({ watch_buffer_pct: c.watchBuffer, threshold: before.threshold, change_reason: c.reason, changed_by: expect.stringMatching(/tao_admin|TAO Admin/) })

  // History lists the new version with the reason.
  await page.getByRole('button', { name: historyName, exact: true }).first().click()
  const hist = page.getByRole('table', { name: new RegExp(`^Version history · ${c.dealName} · ${c.legalRef.replace(/[()]/g, '\\$&')}`) }).first()
  await expect(hist).toContainText(c.newFrom)
  await expect(hist).toContainText(c.reason)
  await shot(page, '10-covenant-history')

  // The Platform audit tab: master_change with before / after and the reason.
  const mc = ((await tao.get(`/audit?scope=platform&action=master_change`)).body as any[]).find(x => x.reason === c.reason)
  expect(mc, 'master_change entry').toBeTruthy()
  expect(JSON.stringify(mc.detail)).toContain(c.newFrom)
  expect(JSON.stringify(mc.detail)).toMatch(/before/)
  expect(JSON.stringify(mc.detail)).toMatch(/after/)
  test.info().annotations.push({ type: 'master_change detail', description: JSON.stringify(mc.detail).slice(0, 800) })
  await page.goto('/admin/settings/users/audit?tab=platform')
  await expect(pageTitle(page)).toHaveText('Audit log')
  const prow = page.getByRole('row').filter({ hasText: 'Master data change' }).filter({ hasText: c.reason }).first()
  await expect(prow).toBeVisible()
  await shot(page, '10-audit-platform')

  // A new version not later than the current one is refused: 409 effective_not_later.
  for (const eff of [c.newFrom, '2026-08-01']) {
    const r = await tao.req('PUT', '/master/covenants', { ...def, watch_buffer_pct: c.watchBuffer, mode: 'new_version', effective_from: eff, reason: 'QA negative: not later than the current version' })
    expect(r.status, `new_version from ${eff}: ${JSON.stringify(r.body)}`).toBe(409)
    expect(JSON.stringify(r.body)).toContain('effective_not_later')
  }
})

/** Known bug (docs/requests.md, QA 2026-11-05): at the suite's 1440 x 900 viewport the Program / facility record's Covenant
 * definitions table (about 1,480 px) is clipped by its card (overflow-x: clip, no scroll), so Edit and History cannot be
 * reached. Marked test.fail: it passes while the bug is there and turns red when it is fixed; then drop the marker and
 * the 1920 viewport in step 10c. */
test('known bug: covenant Edit and History are reachable at 1440 x 900', async ({ page }) => {
  test.fail()
  const c = STEP10.covenant
  await signInAs(page, 'tao_admin')
  await page.goto(`/admin/partners/investor/programs/${PROGRAM}`)
  await page.getByRole('button', { name: `History of ${c.legalRef} for ${c.dealName}`, exact: true }).click({ trial: true, timeout: 5_000 })
})
