import { expect, test, type Locator, type Page } from '@playwright/test'
import { Api, findings, findUpload, waitSettled, type Role } from '../lib/api'
import { DEALS, MOVE, STEP14, USERS, samplePath } from '../lib/facts'
import { record } from '../lib/measure'
import { auditRow, openAuditFor, openReview, pageTitle, shot, signInAsUser } from '../lib/ui'

/** Demo step 14: Save for later (On hold) and per-person notify choices in the Publish pop-up.
 * 14a Save… on the review page, the Approval queue, the On hold marker, who may do what, save again, Release hold;
 * 14b the Publish pop-up with partner notifications off: locked partner rows, a TAO user added and a subscriber left
 *     out by hand, Reset, and "Save for later" keeping the note and the choices as a draft;
 * 14c partner notifications on: who becomes addable and who stays locked, the API refusals, Approve and publish with
 *     people added and left out, the notifications, the subscriptions (unchanged) and the audit entry.
 * Runs last, on its own report (TLFC LP (Leases) July 2026, the month after step 9's June), so no other step's report
 * is touched. It ends with partner notifications on, as step 11 left them. */
test.describe.configure({ mode: 'serial' })

type U = { id: string; name: string; role: string }
const as = (u: U) => new Api(u.role as Role, undefined, u.id)
const patel = as(USERS.patel), moreau = as(USERS.moreau), alvarez = as(USERS.alvarez)
const investor = new Api('investor_viewer')
const S = STEP14, r = STEP14.review
const slug = DEALS[r.deal].slug
const QUEUE = /\/admin\/uploads\/queue$/

/** Every user as the API lists them now (step 11 adds one and renames another), each with a client acting as that user. */
async function everyone(): Promise<{ id: string; name: string; role: Role; partner_slug: string | null; status: string; api: Api }[]> {
  const res = await patel.get('/users')
  expect(res.status).toBe(200)
  return (res.body as any[]).map(u => ({ ...u, api: new Api(u.role, u.partner_slug ?? undefined, u.id) }))
}
const nameOf = async (id: string) => (await everyone()).find(u => u.id === id)!.name
/** The user's report_published notifications about one upload. */
async function publishedTo(api: Api, uploadId: string): Promise<any[]> {
  const res = await api.get('/notifications')
  expect(res.status, `GET /notifications as ${api.user}`).toBe(200)
  return (res.body as any[]).filter(n => n.kind === 'report_published' && n.upload_id === uploadId)
}
async function subscriptionsOfAll(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  for (const u of await everyone()) out[u.id] = (await patel.get(`/users/${u.id}/subscriptions`)).body
  return out
}
/** Subscribe a TAO user to the deal (keeping what they already receive), so the publish has subscribers to act on. */
async function subscribe(u: U) {
  const now = (await patel.get(`/users/${u.id}/subscriptions`)).body as any[]
  if (now.some(x => x.program_slug === MOVE.program && (x.deal_slug === slug || x.deal_slug === null))) return
  const put = await patel.put(`/users/${u.id}/subscriptions`, [...now.map(x => ({ program_slug: x.program_slug, deal_slug: x.deal_slug, channels: x.channels })),
    { program_slug: MOVE.program, deal_slug: slug, channels: ['in_app'] }])
  expect(put.status, JSON.stringify(put.body)).toBe(200)
}
async function setPartnerNotifications(value: boolean, reason: string) {
  const now = ((await patel.get('/settings')).body as any[]).find(x => x.key === 'partner_notifications_enabled')
  if (now.value === value) return
  expect((await patel.put('/settings/partner_notifications_enabled', { value, reason })).status).toBe(200)
}
const upload = async (id: string) => (await patel.get(`/uploads/${id}`)).body
const people = (n: number) => new RegExp(`· ${n === 0 ? 'nobody' : `${n} ${n === 1 ? 'person' : 'people'}`}$`)
const decision = (page: Page) => page.getByRole('region', { name: 'Decision' })
const queueRow = (page: Page, id: string) =>
  page.getByRole('table', { name: 'Reports waiting for review' }).getByRole('row').filter({ has: page.locator(`a[href$="/${id}"]`) })
/** The queue shows the hold note in quotes, clipped at 60 characters, with the full text in the title. */
async function expectQueueNote(row: Locator, note: string) {
  const cell = row.getByTestId('hold-note')
  await expect(cell).toHaveAttribute('title', note)
  if (note.length <= 60) return expect(cell).toHaveText(`“${note}”`)
  await expect(cell).toContainText(`“${note.slice(0, 50)}`)
  await expect(cell).toContainText('…”')
}
const savedToast = (page: Page) => page.getByRole('status').filter({ hasText: 'Saved. On hold in the Approval queue.' })
async function openPublish(page: Page, id: string): Promise<{ pub: Locator; who: Locator }> {
  await openReview(page, id)
  await decision(page).getByRole('button', { name: 'Publish to partner…' }).click()
  const pub = page.getByRole('dialog', { name: 'Publish to partner' })
  const who = pub.getByRole('region', { name: 'Who gets notified' })
  await expect(who.getByTestId('notify-count')).toBeVisible()
  return { pub, who }
}
const personRow = (who: Locator, id: string) => who.getByTestId(`recipient-${id}`)
const switchOf = (who: Locator, id: string) => personRow(who, id).getByRole('switch')

test('step 14a: Save… puts a report On hold: the queue, the marker, who may do what, save again, Release hold', async ({ page }) => {
  test.setTimeout(8 * 60_000)
  expect(await findUpload(r.deal, r.prior, 'published'), `${r.dealName} ${r.prior} published by step 9`).toBeTruthy()
  expect(await findUpload(r.deal, r.period), `${r.deal} ${r.period} already uploaded: step 14 needs a fresh stack`).toBeUndefined()

  // Setup through the API: partner notifications off (step 11 switched them on), and two TAO subscribers of the deal.
  await setPartnerNotifications(false, S.offReason)
  await subscribe(USERS.moreau)
  await subscribe(USERS.okafor)

  const up = await moreau.upload(slug, r.period, samplePath(r.deal, r.month))
  expect(up.status, JSON.stringify(up.body)).toBe(201)
  const { upload: u, seconds } = await waitSettled(up.body.id)
  record('extraction', { deal: r.deal, period: r.period, pages: u.page_count, seconds, status: u.status, finding_counts: u.finding_counts, via: 'api step 14' })
  expect(u.status).toBe('needs_review')
  expect(u.finding_counts.block, `open block findings: ${(await findings(u.id)).filter(f => f.severity === 'block').map(f => f.rule_id)}`).toBe(0)
  expect(u.hold).toBeNull()
  expect(u.draft).toBeNull()

  // The action bar, in order.
  await signInAsUser(page, USERS.patel)
  await openReview(page, u.id)
  await expect(decision(page).getByRole('button')).toHaveText(['Re-extract pages…', 'Save…', 'Reject…', 'Publish to partner…'])
  await expect(page.getByTestId('hold-line')).toHaveCount(0)

  // Save… with a note: toast, and the Approval queue opens.
  await decision(page).getByRole('button', { name: 'Save…' }).click()
  let dlg = page.getByRole('dialog', { name: 'Save for later' })
  await expect(dlg.getByLabel(/^Why is it waiting\?/)).toHaveValue('')
  await expect(dlg).toContainText('Nothing is sent to partners.')
  await dlg.getByLabel(/^Why is it waiting\?/).fill(S.holdNote)
  await shot(page, '14-save-for-later')
  await dlg.getByRole('button', { name: 'Save and close' }).click()
  await expect(savedToast(page)).toBeVisible()
  await expect(page).toHaveURL(QUEUE)
  await expect(pageTitle(page)).toHaveText('Approval queue')

  // The row: On hold beside the status, the note, who and when. The "On hold" chip filters to it.
  let row = queueRow(page, u.id)
  await expect(row).toContainText(r.dealName)
  await expect(row.getByTestId('on-hold')).toHaveText('On hold')
  await expect(row).toContainText('Needs review')
  await expectQueueNote(row, S.holdNote)
  await expect(row.getByTestId('hold-by')).toHaveText(new RegExp(`^${USERS.patel.name}, \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}$`))
  const all = (await patel.get('/uploads?status=needs_review')).body as any[]
  const held = all.filter(x => x.hold)
  expect(held.map(x => x.id)).toEqual([u.id])
  const chips = page.getByRole('group', { name: 'Show reports' })
  await expect(chips.getByRole('button', { name: /^All \d+$/ })).toHaveAttribute('aria-pressed', 'true')
  await chips.getByRole('button', { name: 'On hold 1', exact: true }).click()
  await expect(page.getByRole('table', { name: 'Reports waiting for review' }).locator('tbody tr')).toHaveCount(1)
  await expect(queueRow(page, u.id)).toBeVisible()
  await shot(page, '14-queue-on-hold')
  let now = await upload(u.id)
  expect(now.status).toBe('needs_review')
  expect(now.hold).toMatchObject({ note: S.holdNote, by_label: USERS.patel.name, by: expect.objectContaining({ id: USERS.patel.id }) })
  expect(now.draft).toBeNull()

  // Nothing was published and nobody was told: the partner still has June.
  const pubDeal = (await investor.get(`/published/programs/${MOVE.program}/deals/${slug}`)).body
  expect(pubDeal.published_period).toBe(r.prior)
  expect(pubDeal.available_periods).not.toContain(r.period)
  expect((await investor.get(`/published/programs/${MOVE.program}/deals/${slug}?period=${r.period}`)).status).toBe(404)
  for (const p of await everyone()) if (p.status === 'active') expect(await publishedTo(p.api, u.id), `${p.name} report_published`).toEqual([])

  // The review page: the On hold pill beside the status, the line with who, when and the note, and Release hold.
  await openReview(page, u.id)
  await expect(page.getByTestId('on-hold')).toHaveText('On hold')
  let line = page.getByTestId('hold-line')
  await expect(line).toContainText(new RegExp(`On hold since \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} by ${USERS.patel.name}: `))
  await expect(line).toContainText(S.holdNote)
  await expect(line.getByRole('button', { name: 'Release hold' })).toBeVisible()
  await shot(page, '14-review-on-hold')

  // The analyst sees the marker, but has no Save… and no Release hold; the API refuses both.
  await signInAsUser(page, USERS.moreau)
  await openReview(page, u.id)
  await expect(page.getByTestId('on-hold')).toHaveText('On hold')
  line = page.getByTestId('hold-line')
  await expect(line).toContainText(S.holdNote)
  await expect(line.getByRole('button', { name: 'Release hold' })).toHaveCount(0)
  await expect(decision(page).getByRole('button', { name: 'Save…' })).toHaveCount(0)
  await expect(decision(page)).toContainText('Read only.')
  await shot(page, '14-analyst-sees-hold')
  await page.goto('/admin/uploads/queue')
  await expect(queueRow(page, u.id).getByTestId('on-hold')).toBeVisible()
  for (const res of [await moreau.post(`/uploads/${u.id}/hold`, { note: 'analyst should not be able to do this' }), await moreau.req('DELETE', `/uploads/${u.id}/hold`)]) {
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('admin_only')
  }

  // Partner roles reach none of it: the app sends them back to their own shell, and the API refuses every route.
  await signInAsUser(page, USERS.alvarez)
  for (const url of ['/admin/uploads/queue', `/admin/uploads/queue/${u.id}`]) {
    await page.goto(url)
    await expect(page).toHaveURL(/\/investor\/portfolio$/)
    await expect(page.getByTestId('on-hold')).toHaveCount(0)
  }
  // The program page still shows the deal as of June.
  await page.goto(`/investor/portfolio/${MOVE.program}`)
  await expect(page.locator('.ds-card').filter({ has: page.getByRole('link', { name: /^Open deal .*TLFC LP/ }) }).last()).toContainText('As of Jun 2026')
  for (const api of [alvarez, as(USERS.chen), as(USERS.novak), new Api('investor_viewer'), new Api('manager_admin')]) {
    const who = `${api.role} ${api.user ?? '(role only)'}`
    const list = await api.get('/uploads')
    expect(list.status, `${who} GET /uploads`).toBe(403)
    expect(JSON.stringify(list.body)).not.toContain(S.holdNote)
    for (const [method, route] of [['GET', `/uploads/${u.id}`], ['GET', `/uploads/${u.id}/recipients`], ['POST', `/uploads/${u.id}/hold`], ['DELETE', `/uploads/${u.id}/hold`]]) {
      const res = await api.req(method, route, method === 'POST' ? {} : undefined)
      expect(res.status, `${who} ${method} ${route}`).toBe(403)
      expect(JSON.stringify(res.body)).not.toContain(S.holdNote)
    }
  }
  expect((await upload(u.id)).hold.note).toBe(S.holdNote)

  // Save again with a different note: the dialog starts from the stored note; the new one replaces it.
  await signInAsUser(page, USERS.patel)
  await openReview(page, u.id)
  await decision(page).getByRole('button', { name: 'Save…' }).click()
  dlg = page.getByRole('dialog', { name: 'Save for later' })
  await expect(dlg.getByLabel(/^Why is it waiting\?/)).toHaveValue(S.holdNote)
  await dlg.getByLabel(/^Why is it waiting\?/).fill(S.holdNote2)
  await dlg.getByRole('button', { name: 'Save and close' }).click()
  await expect(page).toHaveURL(QUEUE)
  row = queueRow(page, u.id)
  await expectQueueNote(row, S.holdNote2)
  await expect(row).not.toContainText(S.holdNote.slice(0, 40))
  now = await upload(u.id)
  expect(now.hold.note).toBe(S.holdNote2)
  expect(now.status).toBe('needs_review')

  // Release hold: the marker goes; the report stays in Needs review.
  await openReview(page, u.id)
  await page.getByTestId('hold-line').getByRole('button', { name: 'Release hold' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Hold released' })).toBeVisible()
  await expect(page.getByTestId('hold-line')).toHaveCount(0)
  await expect(page.getByTestId('on-hold')).toHaveCount(0)
  await expect(decision(page).getByRole('button', { name: 'Save…' })).toBeVisible()
  now = await upload(u.id)
  expect(now.status).toBe('needs_review')
  expect(now.hold).toBeNull()
  const again = await patel.req('DELETE', `/uploads/${u.id}/hold`)
  expect(again.status).toBe(409)
  expect(again.body.code).toBe('bad_state')
  await page.goto('/admin/uploads/queue')
  await expect(queueRow(page, u.id)).toContainText('Needs review')
  await expect(queueRow(page, u.id).getByTestId('on-hold')).toHaveCount(0)
  await page.getByRole('group', { name: 'Show reports' }).getByRole('button', { name: 'On hold 0', exact: true }).click()
  await expect(page.getByText('Nothing on hold')).toBeVisible()

  // Audit: two saves with their notes, one release, all by A. Patel.
  const holds = (await patel.get(`/audit?scope=reports&upload_id=${u.id}&action=hold`)).body as any[]
  expect(holds.map(e => e.reason).sort()).toEqual([S.holdNote, S.holdNote2].sort())
  const released = (await patel.get(`/audit?scope=reports&upload_id=${u.id}&action=hold_release`)).body as any[]
  expect(released.length).toBe(1)
  expect(released[0].detail).toMatchObject({ note: S.holdNote2 })
  expect([...holds, ...released].every(e => e.actor_user_id === USERS.patel.id)).toBe(true)
})

test('step 14b: Publish pop-up, partner notifications off: locked rows, add and leave out by hand, Reset, Save for later keeps the draft', async ({ page }) => {
  test.setTimeout(6 * 60_000)
  const u = await findUpload(r.deal, r.period, 'needs_review')
  expect(u, `${r.dealName} ${r.period} in review from step 14a`).toBeTruthy()
  const lindqvist = { ...USERS.lindqvist, name: await nameOf(USERS.lindqvist.id) }      // step 11e renames her
  const rec = (await patel.get(`/uploads/${u.id}/recipients`)).body
  const n = rec.notified.length
  // By default: the two TAO subscribers are notified; S. Lindqvist does not receive the deal and can be added; every
  // partner user is locked by the System setting.
  for (const p of [USERS.moreau, USERS.okafor]) expect(rec.notified).toContainEqual(expect.objectContaining({ user_id: p.id, partner_slug: null, can_change: true }))
  expect(rec.notified.filter((x: any) => x.partner_slug)).toEqual([])
  expect(rec.not_notified).toContainEqual(expect.objectContaining({ user_id: lindqvist.id, reason: 'not_subscribed', can_change: true }))
  const partners = [USERS.chen, USERS.alvarez, USERS.novak, USERS.haddad]
  for (const p of partners) expect(rec.not_notified).toContainEqual(expect.objectContaining({ user_id: p.id, reason: 'partner_notifications_off', can_change: false }))

  await signInAsUser(page, USERS.patel)
  let { pub, who } = await openPublish(page, u.id)
  await expect(pub.getByRole('button')).toContainText(['Cancel', 'Save for later', 'Approve and publish'])
  await expect(who.getByTestId('notify-count')).toHaveText(people(n))
  await expect(who.getByTestId('notifications-off')).toContainText('Partner notifications are off, so no partner is notified.')
  await expect(who.getByRole('table')).toHaveCount(0)                                   // the old Notified table is gone
  await expect(who.getByRole('list', { name: 'Not notified' })).toHaveCount(0)          // and the Not notified list
  await expect(who.getByRole('list').evaluateAll(els => els.map(e => e.getAttribute('aria-label')))).resolves.toEqual(['TAO', 'Investor', 'Manager'])
  for (const p of partners) {
    const row = personRow(who.getByRole('list', { name: p.role.startsWith('investor') ? 'Investor' : 'Manager' }), p.id)
    await expect(row).toContainText(p.name)
    await expect(row).toContainText('Not notified')
    await expect(row).toContainText(S.lockedOff)
    await expect(row.getByRole('switch', { name: p.name, exact: true })).toBeDisabled()
    await row.getByRole('switch').click({ force: true }).catch(() => {})                // a locked switch does not move
    await expect(row.getByRole('switch')).not.toBeChecked()
  }
  await expect(who.getByTestId('notify-count')).toHaveText(people(n))
  await expect(who.getByTestId('notify-changes')).toHaveCount(0)

  // A TAO user who does not receive the deal: switch on. A TAO subscriber: switch off. The count follows.
  const tao = who.getByRole('list', { name: 'TAO' })
  const addRow = personRow(tao, lindqvist.id), outRow = personRow(tao, USERS.okafor.id), keepRow = personRow(tao, USERS.moreau.id)
  await expect(addRow).toContainText('Not notified')
  await expect(addRow).toContainText(S.notReceiving)
  await expect(outRow).toContainText('Will be notified')
  await expect(outRow).toContainText('In-app')
  await addRow.getByRole('switch', { name: lindqvist.name, exact: true }).check()
  await expect(addRow).toContainText('Will be notified')
  await expect(addRow).toContainText('Added for this report')
  await expect(who.getByTestId('notify-count')).toHaveText(people(n + 1))
  await expect(who.getByTestId('notify-changes')).toContainText('1 change for this report only. Subscriptions are not changed.')
  await outRow.getByRole('switch', { name: USERS.okafor.name, exact: true }).uncheck()
  await expect(outRow).toContainText('Not notified')
  await expect(outRow).toContainText('Left out for this report')
  await expect(who.getByTestId('notify-count')).toHaveText(people(n))
  await expect(who.getByTestId('notify-changes')).toContainText('2 changes for this report only. Subscriptions are not changed.')
  await expect(keepRow).toContainText('Will be notified')

  // Reset: the defaults are back.
  await who.getByTestId('notify-changes').getByRole('button', { name: 'Reset' }).click()
  await expect(who.getByTestId('notify-changes')).toHaveCount(0)
  await expect(addRow.getByRole('switch')).not.toBeChecked()
  await expect(addRow).toContainText(S.notReceiving)
  await expect(outRow.getByRole('switch')).toBeChecked()
  await expect(outRow).toContainText('In-app')
  await expect(who.getByTestId('notify-count')).toHaveText(people(n))

  // The same two choices again, a note to partners, then Save for later: toast, queue, On hold with no hold note.
  await addRow.getByRole('switch').check()
  await outRow.getByRole('switch').uncheck()
  await pub.getByLabel(/^Note to partners/).fill(S.noteToPartners)
  await who.scrollIntoViewIfNeeded()
  await shot(page, '14-publish-choices-notifications-off')
  await pub.getByRole('button', { name: 'Save for later' }).click()
  await expect(savedToast(page)).toBeVisible()
  await expect(page).toHaveURL(QUEUE)
  const row = queueRow(page, u.id)
  await expect(row.getByTestId('on-hold')).toBeVisible()
  await expect(row.getByTestId('hold-by')).toContainText(`${USERS.patel.name}, `)
  await expect(row.getByTestId('hold-note')).toHaveCount(0)
  const held = await upload(u.id)
  expect(held.status).toBe('needs_review')
  expect(held.hold).toMatchObject({ note: null, by_label: USERS.patel.name })
  expect(held.draft).toEqual({ note_to_partners: S.noteToPartners, notify: { add: [lindqvist.id], remove: [USERS.okafor.id] } })
  const entry = ((await patel.get(`/audit?scope=reports&upload_id=${u.id}&action=hold`)).body as any[]).find(e => e.detail?.has_draft_note)
  expect(entry.detail).toMatchObject({ note: null, has_draft_note: true, notify_add: [lindqvist.name], notify_remove: [USERS.okafor.name] })
  // Still nothing published, nobody told, no subscription touched.
  expect((await investor.get(`/published/programs/${MOVE.program}/deals/${slug}`)).body.published_period).toBe(r.prior)
  expect(await publishedTo(as(lindqvist), u.id)).toEqual([])
  expect((await patel.get(`/users/${lindqvist.id}/subscriptions`)).body).toEqual([])

  // Reopen: the review page says On hold with no note; the pop-up shows the same note and the same choices.
  await openReview(page, u.id)
  await expect(page.getByTestId('hold-line')).toContainText(new RegExp(`by ${USERS.patel.name}\\.`))
  ;({ pub, who } = await openPublish(page, u.id))
  await expect(pub.getByLabel(/^Note to partners/)).toHaveValue(S.noteToPartners)
  await expect(personRow(who, lindqvist.id)).toContainText('Added for this report')
  await expect(switchOf(who, lindqvist.id)).toBeChecked()
  await expect(personRow(who, USERS.okafor.id)).toContainText('Left out for this report')
  await expect(switchOf(who, USERS.okafor.id)).not.toBeChecked()
  await expect(who.getByTestId('notify-changes')).toContainText('2 changes for this report only.')
  await expect(who.getByTestId('notify-count')).toHaveText(people(n))
  await who.scrollIntoViewIfNeeded()
  await shot(page, '14-publish-draft-reopened')
  await pub.getByRole('button', { name: 'Cancel' }).click()

  // Directly: a locked person cannot be added to a draft or to a publish while partner notifications are off.
  const msg = `${USERS.novak.name} cannot be added: partner notifications are switched off in System settings`
  for (const res of [await patel.post(`/uploads/${u.id}/hold`, { notify: { add: [USERS.novak.id], remove: [] } }),
    await patel.post(`/uploads/${u.id}/approve`, { notify: { add: [USERS.novak.id] } })]) {
    expect(res.status).toBe(422)
    expect(res.body).toMatchObject({ code: 'invalid', message: msg })
  }
  expect(await upload(u.id)).toMatchObject({ status: 'needs_review', draft: held.draft })
})

test('step 14c: partner notifications on: who becomes addable, who stays locked; publish with people added and left out', async ({ page }) => {
  test.setTimeout(6 * 60_000)
  const u = await findUpload(r.deal, r.period, 'needs_review')
  expect(u, `${r.dealName} ${r.period} on hold from step 14b`).toBeTruthy()
  expect(u.hold).toBeTruthy()
  const lindqvist = { ...USERS.lindqvist, name: await nameOf(USERS.lindqvist.id) }

  // D. Alvarez switches "Report published" off in her Profile.
  await signInAsUser(page, USERS.alvarez)
  await page.goto('/investor/settings/profile')
  await expect(pageTitle(page)).toHaveText('Profile')
  await page.getByRole('checkbox', { name: 'Report published: in the portal', exact: true }).uncheck()
  await page.getByRole('button', { name: 'Save preferences' }).click()
  await expect.poll(async () => ((await alvarez.get('/me/notification-prefs')).body as any[]).find(x => x.kind === 'report_published')?.in_app).toBe(false)

  try {
    // A. Patel: System settings, Partner notifications on, with a reason.
    await signInAsUser(page, USERS.patel)
    await page.goto('/admin/settings/system')
    await page.getByRole('switch', { name: /Partner notifications/ }).check()
    await page.getByRole('button', { name: 'Save changes' }).click()
    const save = page.getByRole('dialog', { name: /^Save 1 setting/ })
    await save.getByLabel(/^Reason/).fill(S.onReason)
    await save.getByRole('button', { name: 'Save 1 change' }).click()
    await expect(save).toBeHidden()
    expect((await patel.get('/settings')).body).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'partner_notifications_enabled', value: true })]))

    // Who can be changed now: M. Chen and the Manager users see the deal and do not receive it (addable); D. Alvarez
    // switched the notification off herself (locked).
    const rec = (await patel.get(`/uploads/${u.id}/recipients`)).body
    for (const p of [USERS.chen, USERS.novak, USERS.haddad]) expect(rec.not_notified).toContainEqual(expect.objectContaining({ user_id: p.id, reason: 'not_subscribed', can_change: true }))
    expect(rec.not_notified).toContainEqual(expect.objectContaining({ user_id: USERS.alvarez.id, reason: 'switched_off', can_change: false }))
    const n = rec.notified.length                                    // before any choice
    const { pub, who } = await openPublish(page, u.id)
    await expect(who.getByTestId('notifications-off')).toHaveCount(0)
    await expect(pub.getByLabel(/^Note to partners/)).toHaveValue(S.noteToPartners)        // the draft from 14b
    await expect(personRow(who, lindqvist.id)).toContainText('Added for this report')
    await expect(personRow(who, USERS.okafor.id)).toContainText('Left out for this report')
    const alvarezRow = personRow(who.getByRole('list', { name: 'Investor' }), USERS.alvarez.id)
    await expect(alvarezRow).toContainText('Not notified')
    await expect(alvarezRow).toContainText(S.lockedProfile)
    await expect(alvarezRow.getByRole('switch')).toBeDisabled()
    await expect(alvarezRow.getByRole('switch')).not.toBeChecked()
    const chenRow = personRow(who.getByRole('list', { name: 'Investor' }), USERS.chen.id)
    await expect(chenRow).toContainText(S.notReceiving)
    await expect(chenRow).not.toContainText('Locked')
    await expect(chenRow.getByRole('switch')).toBeEnabled()
    for (const m of [USERS.novak, USERS.haddad]) await expect(switchOf(who, m.id)).toBeEnabled()
    await chenRow.getByRole('switch', { name: USERS.chen.name, exact: true }).check()
    await expect(chenRow).toContainText('Will be notified')
    await expect(chenRow).toContainText('Added for this report')
    await expect(who.getByTestId('notify-changes')).toContainText('3 changes for this report only. Subscriptions are not changed.')
    await expect(who.getByTestId('notify-count')).toHaveText(people(n + 1))               // two added, one left out
    await who.scrollIntoViewIfNeeded()
    await shot(page, '14-publish-partners-on')

    // The API refuses a locked person with a plain message, before anything is published.
    for (const res of [await patel.post(`/uploads/${u.id}/approve`, { note_to_partners: S.noteToPartners, notify: { add: [USERS.alvarez.id], remove: [] } }),
      await patel.post(`/uploads/${u.id}/hold`, { notify: { add: [USERS.alvarez.id], remove: [] } })]) {
      expect(res.status).toBe(422)
      expect(res.body).toMatchObject({ code: 'invalid', message: `${USERS.alvarez.name} cannot be added: they switched this notification off in their profile` })
    }
    expect(await upload(u.id)).toMatchObject({ status: 'needs_review', hold: expect.objectContaining({ by_label: USERS.patel.name }) })
    expect((await investor.get(`/published/programs/${MOVE.program}/deals/${slug}`)).body.published_period).toBe(r.prior)

    // Approve and publish: S. Lindqvist and M. Chen added, R. Okafor left out, J. Moreau untouched.
    const subsBefore = await subscriptionsOfAll()
    const expected = [...rec.notified.map((x: any) => x.user_id).filter((id: string) => id !== USERS.okafor.id), lindqvist.id, USERS.chen.id].sort()
    await pub.getByRole('button', { name: 'Approve and publish' }).click()
    await expect(page.getByText('Published to partner').first()).toBeVisible()
    await expect(page.getByTestId('hold-line')).toHaveCount(0)
    await expect(page.getByTestId('on-hold')).toHaveCount(0)
    const done = await upload(u.id)
    expect(done).toMatchObject({ status: 'published', hold: null, draft: null })
    expect((await investor.get(`/published/programs/${MOVE.program}/deals/${slug}`)).body.published_period).toBe(r.period)

    // Exactly one report_published each for the added and the untouched; none for the left-out, the locked, the rest.
    const users = await everyone()
    for (const p of users.filter(x => x.status === 'active')) {
      const got = await publishedTo(p.api, u.id)
      if (expected.includes(p.id)) {
        expect(got.length, `${p.name} report_published`).toBe(1)
        expect(got[0]).toMatchObject({ note_from_tao: S.noteToPartners, deal_slug: slug, collection_period: r.period })
      } else expect(got, `${p.name} report_published`).toEqual([])
    }
    for (const id of [lindqvist.id, USERS.chen.id, USERS.moreau.id]) expect(expected).toContain(id)
    for (const id of [USERS.okafor.id, USERS.alvarez.id, USERS.novak.id, USERS.haddad.id]) expect(expected).not.toContain(id)
    // Nobody's subscriptions changed: the added people still do not receive the deal, the left-out one still does.
    expect(await subscriptionsOfAll()).toEqual(subsBefore)
    expect((subsBefore[lindqvist.id] as any[]).length).toBe(0)
    expect(subsBefore[USERS.okafor.id]).toContainEqual(expect.objectContaining({ program_slug: MOVE.program, deal_slug: slug }))
    const next = (await patel.get(`/uploads/${u.id}/recipients`)).body
    expect(next.not_notified).toContainEqual(expect.objectContaining({ user_id: lindqvist.id, reason: 'not_subscribed' }))
    expect(next.notified).toContainEqual(expect.objectContaining({ user_id: USERS.okafor.id }))

    // The publish audit entry: recipients, "Added by hand", "Left out"; the hold entries are in the trail.
    const entry = ((await patel.get(`/audit?scope=reports&upload_id=${u.id}&action=publish`)).body as any[])[0]
    expect([...entry.detail.recipients].sort()).toEqual(expected)
    expect(entry.detail).toMatchObject({
      note_to_partners: S.noteToPartners,
      notified_added: [{ id: lindqvist.id, name: lindqvist.name }, { id: USERS.chen.id, name: USERS.chen.name }],
      notified_removed: [{ id: USERS.okafor.id, name: USERS.okafor.name }],
    })
    const log = await openAuditFor(page, u.id)
    const published = auditRow(page, log, 'Publish')
    await expect(published).toContainText(`Added by hand: ${lindqvist.name}, ${USERS.chen.name}`)
    await expect(published).toContainText(`Left out: ${USERS.okafor.name}`)
    await expect(auditRow(page, log, 'Saved for later (On hold)')).toBeVisible()
    await expect(auditRow(page, log, 'Hold released')).toContainText('Hold released; back to Needs review')
    await shot(page, '14-audit-added-left-out')

    // A published report cannot be held or released.
    const hold = await patel.post(`/uploads/${u.id}/hold`, { note: 'trying to hold a published report' })
    expect(hold.status).toBe(409)
    expect(hold.body.code).toBe('bad_state')
    expect((await patel.req('DELETE', `/uploads/${u.id}/hold`)).status).toBe(409)
    await openReview(page, u.id)
    await expect(decision(page).getByRole('button', { name: 'Save…' })).toHaveCount(0)

    // M. Chen, added by hand: "Report published" with the note from TAO.
    await signInAsUser(page, USERS.chen)
    await page.goto('/investor/notifications')
    const note = page.getByTestId('notification').filter({ hasText: S.noteToPartners }).first()
    await expect(note).toContainText(`Report published: ${r.dealName}`)
    await expect(note).toContainText('Note from TAO')
    await shot(page, '14-added-partner-notification')
  } finally {
    // D. Alvarez's Profile choice goes back on, so a later publish reaches her as before this step.
    const prefs = (await alvarez.get('/me/notification-prefs')).body as any[]
    const back = await alvarez.put('/me/notification-prefs', prefs.map(({ required: _r, ...x }) => (x.kind === 'report_published' ? { ...x, in_app: true } : x)))
    expect(back.status, JSON.stringify(back.body)).toBe(200)
  }
})
