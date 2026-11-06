import { expect, test, type Page } from '@playwright/test'
import { Api, findings, findUpload, waitSettled } from '../lib/api'
import { DEALS, MOVE, STEP11, USERS, period, samplePath } from '../lib/facts'
import { record } from '../lib/measure'
import { openReview, pageTitle, shot, signInAsUser } from '../lib/ui'

/** Demo step 11 (phase 2, wave C): people.
 * 11a users (sign in as a seeded user, User management, add / subscribe / deactivate / reactivate, refusals, audit);
 * 11b a partner's Team members; 11c comments and @mentions on a report in review; 11d the publish note, who gets
 * notified and partner notifications; 11e Profile. Runs after step 10 (Essex published to June). */
test.describe.configure({ mode: 'serial' })

type U = (typeof USERS)[keyof typeof USERS]
const as = (u: U) => new Api(u.role as any, undefined, u.id)
const patel = as(USERS.patel), moreau = as(USERS.moreau), chen = as(USERS.chen), alvarez = as(USERS.alvarez)
const r = STEP11.review
const slug = DEALS[r.deal].slug

const noAccess = (page: Page) => page.getByRole('heading', { name: 'You don’t have access' })

test('step 11a: users: sign in as a seeded user, manage users and subscriptions, refusals, audit', async ({ page }) => {
  await signInAsUser(page, USERS.patel)
  await expect(page.getByTestId('role-switcher')).toContainText('TAO Admin')
  const users = (await patel.get('/users')).body as any[]
  expect(users.map(u => u.name).sort()).toEqual(Object.values(USERS).map(u => u.name).sort())

  await page.goto('/admin/settings/users')
  await expect(pageTitle(page)).toHaveText('User management')
  const table = page.getByRole('table', { name: 'Users' })
  for (const u of Object.values(USERS)) await expect(table).toContainText(u.name)
  await shot(page, '11-user-management')

  // Add a TAO Analyst who receives every MOVE Trust deal.
  const n = STEP11.newUser
  await page.getByRole('button', { name: 'Add user', exact: true }).first().click()
  let drawer = page.getByRole('dialog', { name: 'Add user' })
  await drawer.getByLabel(/^Full name/).fill(n.name)
  await drawer.getByLabel(/^Email/).fill(n.email)
  await drawer.getByLabel(/^Role/).selectOption(n.role)
  await drawer.getByRole('checkbox', { name: /All deals in MOVE Trust, including new ones/ }).check()
  await shot(page, '11-add-user')
  await page.locator('.adm-drawer__foot').getByRole('button', { name: 'Add user' }).click()
  drawer = page.getByRole('dialog', { name: `Edit ${n.name}` })
  await expect(drawer).toBeVisible()
  const added = ((await patel.get('/users')).body as any[]).find(u => u.email === n.email)
  expect(added).toMatchObject({ name: n.name, role: n.role, partner_slug: null, status: 'active' })
  expect((await patel.get(`/users/${added.id}/subscriptions`)).body).toEqual([expect.objectContaining({ program_slug: MOVE.program, deal_slug: null, channels: ['in_app'] })])

  // Deactivate with a reason: the account can no longer call the API. Then reactivate.
  await drawer.getByRole('button', { name: 'Deactivate user' }).click()
  let dlg = page.getByRole('alertdialog', { name: `Deactivate ${n.name}?` })
  await dlg.getByLabel(/^Reason/).fill(STEP11.deactivateReason)
  await dlg.getByRole('button', { name: 'Deactivate', exact: true }).click()
  await expect(dlg).toBeHidden()
  await expect(drawer.getByRole('button', { name: 'Reactivate user' })).toBeVisible()
  expect((await patel.get(`/users/${added.id}`)).body).toMatchObject({ status: 'deactivated', deactivation_reason: STEP11.deactivateReason })
  const blocked = await new Api('tao_analyst', undefined, added.id).get('/me')
  expect(blocked.status).toBe(401)
  expect(JSON.stringify(blocked.body)).toContain('inactive_user')
  await drawer.getByRole('button', { name: 'Reactivate user' }).click()
  dlg = page.getByRole('dialog', { name: `Reactivate ${n.name}?` })
  await dlg.getByLabel(/^Reason/).fill(STEP11.reactivateReason)
  await dlg.getByRole('button', { name: 'Reactivate', exact: true }).click()
  await expect(dlg).toBeHidden()
  await expect(drawer.getByRole('button', { name: 'Deactivate user' })).toBeVisible()
  expect((await patel.get(`/users/${added.id}`)).body.status).toBe('active')

  // Refusals: deactivating yourself, and the last Company Admin of a partner.
  await page.goto(`/admin/settings/users?user=${USERS.patel.id}`)
  drawer = page.getByRole('dialog', { name: `Edit ${USERS.patel.name}` })
  await expect(drawer.getByRole('button', { name: 'Deactivate user' })).toBeDisabled()
  await expect(drawer).toContainText('You can’t change your own role or deactivate yourself.')
  const self = await patel.post(`/users/${USERS.patel.id}/deactivate`, { reason: 'trying to deactivate myself' })
  expect(self.status).toBe(409)
  expect(JSON.stringify(self.body)).toContain('self_change')
  await page.goto(`/admin/settings/users?user=${USERS.chen.id}`)
  drawer = page.getByRole('dialog', { name: `Edit ${USERS.chen.name}` })
  await expect(drawer.getByRole('button', { name: 'Deactivate user' })).toBeDisabled()
  await expect(drawer).toContainText('This is the last active admin for its company')
  await shot(page, '11-last-admin-refused')
  const last = await patel.post(`/users/${USERS.chen.id}/deactivate`, { reason: 'trying the last company admin' })
  expect(last.status).toBe(409)
  expect(JSON.stringify(last.body)).toContain('last_admin')
  const demote = await patel.patch(`/users/${USERS.chen.id}`, { role: 'investor_viewer' })
  expect(demote.status).toBe(409)
  expect(JSON.stringify(demote.body)).toContain('last_admin')

  // The Platform audit has user_change entries for the new user: created, subscriptions, deactivated, reactivated.
  const changes = ((await patel.get('/audit?scope=platform&action=user_change&limit=200')).body as any[]).filter(e => e.detail?.user_id === added.id)
  expect(changes.map(e => e.detail.change)).toEqual(expect.arrayContaining(['created', 'subscriptions', 'deactivated', 'reactivated']))
  expect(changes.every(e => e.actor_user_id === USERS.patel.id)).toBe(true)
  await page.goto('/admin/settings/users/audit?tab=platform')
  await expect(pageTitle(page)).toHaveText('Audit log')
  await expect(page.getByRole('table').first()).toContainText(STEP11.deactivateReason)
  await shot(page, '11-audit-user-change')

  // An analyst gets no access to User management.
  await signInAsUser(page, USERS.moreau)
  await page.goto('/admin/settings/users')
  await expect(noAccess(page)).toBeVisible()
  expect((await moreau.get('/users')).status).toBe(403)
})

test('step 11b: team members: a Company Admin sees only its own partner; a viewer has no access', async ({ page }) => {
  const programs = (await patel.get('/master/programs')).body as any[]
  const shared = programs.filter(p => (p.partner_slugs ?? [p.partner_slug]).includes('investor')).map(p => p.name).sort()

  await signInAsUser(page, USERS.chen)
  await page.goto('/investor/settings/team')
  await expect(pageTitle(page)).toHaveText('Team members')
  const team = page.getByRole('table').first()
  await expect(team).toContainText(USERS.chen.name)
  await expect(team).toContainText(USERS.alvarez.name)
  for (const other of [USERS.patel, USERS.moreau, USERS.novak, USERS.haddad]) await expect(team).not.toContainText(other.name)
  expect(((await chen.get('/users')).body as any[]).map(u => u.partner_slug)).toEqual(['investor', 'investor'])
  expect(((await chen.get('/users?partner_slug=manager')).body as any[]).every(u => u.partner_slug === 'investor')).toBe(true)
  expect((await chen.get(`/users/${USERS.novak.id}`)).status).toBe(404)

  await page.getByRole('button', { name: `Edit ${USERS.alvarez.name}` }).click()
  const dlg = page.getByRole('dialog', { name: `Edit ${USERS.alvarez.name}` })
  const tree = dlg.getByRole('group', { name: /^Programs shared with/ })
  await expect(tree).toBeVisible()
  const groups = await tree.getByRole('group').evaluateAll(els => els.map(e => e.getAttribute('aria-label') ?? '').filter(Boolean))
  expect([...new Set(groups)].sort()).toEqual(shared)
  await shot(page, '11-team-members')
  await dlg.getByRole('button', { name: 'Cancel' }).click()

  await signInAsUser(page, USERS.alvarez)
  await page.goto('/investor/settings/team')
  await expect(noAccess(page)).toBeVisible()
  expect((await alvarez.get('/users')).status).toBe(403)
})

test('step 11c: comments: the analyst comments on a finding and @mentions an admin, who replies and resolves', async ({ page }) => {
  test.setTimeout(6 * 60_000)
  expect(await findUpload(r.deal, '2026-06', 'published'), 'Essex June published by step 10').toBeTruthy()
  expect(await findUpload(r.deal, r.period), `${r.deal} ${r.period} already uploaded: step 11 needs a fresh stack`).toBeUndefined()
  const up = await moreau.upload(slug, r.period, samplePath(r.deal, r.month))
  expect(up.status, JSON.stringify(up.body)).toBe(201)
  const { upload: u, seconds } = await waitSettled(up.body.id)
  record('extraction', { deal: r.deal, period: r.period, pages: u.page_count, seconds, status: u.status, finding_counts: u.finding_counts, via: 'api step 11' })
  expect(u.status).toBe('needs_review')
  expect(u.finding_counts.block).toBe(0)
  const f = (await findings(u.id))[0]
  expect(f, 'a finding to comment on').toBeTruthy()

  // J. Moreau comments on the finding and mentions A. Patel. The thread starts through the API, exactly as the
  // composer would send it; the test at the end of this file checks the analyst's @ list in the UI.
  await signInAsUser(page, USERS.moreau)
  const started = await moreau.post(`/uploads/${u.id}/threads`, { anchor: { finding_id: f.id }, body: `${STEP11.comment} @${USERS.patel.name}`, mentions: [USERS.patel.id] })
  expect(started.status, JSON.stringify(started.body)).toBe(201)
  await page.goto(`/admin/uploads/queue/${u.id}`)
  const card = page.locator('article.ds-finding', { hasText: f.rule_id }).first()
  await expect(card.getByTestId('comment-button')).toContainText('1')
  await card.getByTestId('comment-button').click()
  let panel = page.getByRole('dialog', { name: /^Comments on / })
  await expect(panel.getByTestId('comment')).toContainText(STEP11.comment)
  await expect(panel.locator('.rv-mention').first()).toContainText(USERS.patel.name)
  await shot(page, '11-comment-mention')
  const threads = (await moreau.get(`/uploads/${u.id}/threads`)).body as any[]
  expect(threads.length).toBe(1)
  const th = threads[0]
  expect(th).toMatchObject({ status: 'open', anchor: expect.objectContaining({ finding_id: f.id }), created_by: { id: USERS.moreau.id, name: USERS.moreau.name } })
  expect(th.comments[0].mentions).toEqual([USERS.patel.id])

  // A. Patel: the bell shows unread; Mentions has it; opening it lands on the thread.
  await signInAsUser(page, USERS.patel)
  await expect(page.getByTestId('unread-badge')).toBeVisible()
  expect((await patel.get('/notifications/unread-count')).body.mentions).toBeGreaterThanOrEqual(1)
  await page.goto('/admin/notifications')
  await page.getByRole('tab', { name: /^Mentions/ }).click()
  const open = page.getByRole('button', { name: /^Open thread: / }).first()
  await expect(open).toBeVisible()
  await shot(page, '11-notifications-mention')
  await open.click()
  await expect(page).toHaveURL(new RegExp(`/admin/uploads/queue/${u.id}\\?thread=${th.id}`))
  panel = page.getByRole('dialog', { name: /^Comments on / })
  const thread = panel.getByRole('region', { name: /^Thread on .*, open$/ })
  await expect(thread).toContainText(STEP11.comment)

  // Reply, then resolve: the finding itself stays open.
  await panel.getByRole('combobox', { name: /^Reply on / }).fill(STEP11.reply)
  await panel.getByRole('button', { name: 'Reply', exact: true }).click()
  await expect(thread.getByTestId('comment')).toHaveCount(2)
  await thread.getByRole('button', { name: 'Resolve thread' }).click()
  await expect(panel.getByRole('region', { name: /^Thread on .*, resolved$/ })).toBeVisible()
  await shot(page, '11-thread-resolved')
  expect((await findings(u.id)).find(x => x.id === f.id)?.status).toBe(f.status)
  const audit = ((await patel.get(`/audit?scope=reports&upload_id=${u.id}`)).body as any[]).map(e => e.action)
  expect(audit.filter(a => a === 'comment').length).toBe(2)
  expect(audit).toContain('thread_resolve')
  // Moreau is told about the reply.
  expect(((await moreau.get('/notifications')).body as any[]).some(x => x.kind === 'reply' && x.thread_id === th.id)).toBe(true)

  // Partners never see threads.
  expect((await alvarez.get(`/uploads/${u.id}/threads`)).status).toBe(403)
  expect((await new Api('investor_viewer').get(`/uploads/${u.id}/threads`)).status).toBe(403)
})

test('step 11d: publish note: who gets notified, partner notifications on, the viewer reads "Note from TAO"', async ({ page }) => {
  test.setTimeout(6 * 60_000)
  const u = await findUpload(r.deal, r.period, 'needs_review')
  expect(u, 'Essex July in review from step 11c').toBeTruthy()

  // Subscribe D. Alvarez to Essex in User management (partner notifications are still off, the default).
  await signInAsUser(page, USERS.patel)
  await page.goto(`/admin/settings/users?user=${USERS.alvarez.id}`)
  const drawer = page.getByRole('dialog', { name: `Edit ${USERS.alvarez.name}` })
  await drawer.getByRole('checkbox', { name: `${r.dealName} (${MOVE.name}), in-app` }).check()
  await drawer.getByRole('button', { name: 'Save changes' }).click()
  await expect.poll(async () => (await patel.get(`/users/${USERS.alvarez.id}/subscriptions`)).body).toEqual(
    [expect.objectContaining({ program_slug: MOVE.program, deal_slug: slug })])

  // With partner notifications off: nobody at a partner is notified. D. Alvarez (subscribed) is under Not notified
  // with the "off" reason; so is M. Chen (not subscribed): the system switch ranks first.
  const before = (await patel.get(`/uploads/${u.id}/recipients`)).body
  expect(before.notified.filter((x: any) => x.partner_slug)).toEqual([])
  expect(before.not_notified).toContainEqual(expect.objectContaining({ user_id: USERS.alvarez.id, reason: 'partner_notifications_off' }))
  expect(before.not_notified).toContainEqual(expect.objectContaining({ user_id: USERS.chen.id, reason: 'partner_notifications_off' }))
  await openReview(page, u.id)
  await page.getByRole('region', { name: 'Decision' }).getByRole('button', { name: 'Publish to partner…' }).click()
  let pub = page.getByRole('dialog', { name: 'Publish to partner' })
  let who = pub.getByRole('region', { name: 'Who gets notified' })
  await expect(who.getByTestId('notifications-off')).toContainText('Partner notifications are off')
  const notList = who.getByRole('list', { name: 'Not notified' })
  await expect(notList.getByRole('listitem').filter({ hasText: USERS.alvarez.name })).toContainText('partner notifications are off')
  await expect(notList.getByRole('listitem').filter({ hasText: USERS.chen.name })).toBeVisible()
  await shot(page, '11-publish-notifications-off')
  await pub.getByRole('button', { name: 'Cancel' }).click()

  // System settings: Partner notifications on, with a reason.
  await page.goto('/admin/settings/system')
  await page.getByRole('switch', { name: /Partner notifications/ }).check()
  await page.getByRole('button', { name: 'Save changes' }).click()
  const save = page.getByRole('dialog', { name: /^Save 1 setting/ })
  await save.getByLabel(/^Reason/).fill(STEP11.settingReason)
  await save.getByRole('button', { name: 'Save 1 change' }).click()
  await expect(save).toBeHidden()
  expect((await patel.get('/settings')).body).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'partner_notifications_enabled', value: true })]))
  expect(((await patel.get('/audit?scope=platform&action=settings_change')).body as any[]).some(e => e.reason === STEP11.settingReason)).toBe(true)

  // Publish with a note: D. Alvarez is notified; the manager users are not.
  await openReview(page, u.id)
  await page.getByRole('region', { name: 'Decision' }).getByRole('button', { name: 'Publish to partner…' }).click()
  pub = page.getByRole('dialog', { name: 'Publish to partner' })
  who = pub.getByRole('region', { name: 'Who gets notified' })
  await expect(who.getByRole('table', { name: 'Notified' })).toContainText(USERS.alvarez.name)
  await pub.getByLabel(/^Note to partners/).fill(STEP11.note)
  await shot(page, '11-publish-with-note')
  await pub.getByRole('button', { name: 'Approve and publish' }).click()
  await expect(page.getByText('Published to partner').first()).toBeVisible()
  const entry = ((await patel.get(`/audit?scope=reports&upload_id=${u.id}&action=publish`)).body as any[])[0]
  expect(entry.detail).toMatchObject({ note_to_partners: STEP11.note })
  expect(JSON.stringify(entry.detail.recipients)).toContain(USERS.alvarez.id)

  // D. Alvarez: "Report published" with the note as typed; Open goes to the deal at its month.
  await signInAsUser(page, USERS.alvarez)
  await page.goto('/investor/notifications')
  const row = page.getByTestId('notification').filter({ hasText: 'Note from TAO' }).first()
  await expect(row).toContainText(`Report published: ${r.dealName}`)
  await expect(row).toContainText(STEP11.note)
  await shot(page, '11-partner-notification')
  await row.getByRole('button', { name: /^Open report: / }).click()
  await expect(page).toHaveURL(new RegExp(`/investor/portfolio/${MOVE.program}/deals/${slug}\\?period=${r.period}`))
  await expect(page.locator('[data-field="tranche_balance.closing"]').first()).toBeVisible()
  await expect(page.getByText(STEP11.comment)).toHaveCount(0)
  const mine = (await alvarez.get('/notifications')).body as any[]
  expect(mine.find(x => x.kind === 'report_published' && x.deal_slug === slug)).toMatchObject({ note_from_tao: STEP11.note, collection_period: r.period })
  expect(JSON.stringify(mine)).not.toContain(STEP11.comment)

  // Manager users are not subscribed: nothing about this report.
  for (const m of [USERS.novak, USERS.haddad]) {
    const list = (await as(m).get('/notifications')).body as any[]
    expect(list.filter(x => x.deal_slug === slug), `${m.name} notifications`).toEqual([])
  }
})

test('step 11e: profile: display name and time zone change; required notification kinds are locked', async ({ page }) => {
  const me = USERS.lindqvist
  const p = STEP11.profile
  await signInAsUser(page, me)
  await page.goto('/admin/settings/profile')
  await expect(pageTitle(page)).toHaveText('Profile')
  await page.getByLabel(/^Full name/).fill(p.name)
  await page.getByRole('button', { name: 'Save name' }).click()
  await expect(page.getByTestId('role-switcher')).toContainText(p.name)
  await page.getByLabel(/^Time zone/).selectOption(p.timeZone)
  await page.getByRole('button', { name: 'Save display' }).click()
  await expect.poll(async () => (await as(me).get('/me')).body).toMatchObject({ user: expect.objectContaining({ name: p.name }), display: expect.objectContaining({ time_zone: p.timeZone }) })
  for (const k of ['Covenant status changed (WATCH or BREACH)', 'Correction published']) {
    const box = page.getByRole('checkbox', { name: `${k}: in the portal (always on)` })
    await expect(box).toBeChecked()
    await expect(box).toBeDisabled()
  }
  await shot(page, '11-profile', { fullPage: true })
  const prefs = (await as(me).get('/me/notification-prefs')).body as any[]
  const off = prefs.map(x => (x.kind === 'correction_published' ? { ...x, in_app: false } : x)).map(({ required: _r, ...x }) => x)
  const refused = await as(me).put('/me/notification-prefs', off)
  expect(refused.status).toBe(422)
  expect(JSON.stringify(refused.body)).toContain('required')
  expect(((await patel.get('/audit?scope=platform&action=prefs_change')).body as any[]).some(e => e.actor_user_id === me.id)).toBe(true)
})

/** Was a bug (docs/requests.md, QA 2026-11-06, fixed by the Lead the same day): GET /users?partner_slug=tao&status=active
 * answered an analyst without status, so the composer's mentionMatches dropped everyone. */
test('an analyst can pick a TAO user from the @ list (fixed 2026-11-06)', async ({ page }) => {
  const u = await findUpload(r.deal, r.period)
  expect(u).toBeTruthy()
  await signInAsUser(page, USERS.moreau)
  await page.goto(`/admin/uploads/queue/${u.id}`)
  const card = page.locator('article.ds-finding').first()
  await card.getByTestId('comment-button').click()
  const panel = page.getByRole('dialog', { name: /^Comments on / })
  await panel.getByRole('combobox').first().pressSequentially('@Pa')
  await expect(panel.getByRole('listbox', { name: 'Mention a TAO user' }).getByRole('option', { name: /Patel/ })).toBeVisible({ timeout: 5_000 })
})
