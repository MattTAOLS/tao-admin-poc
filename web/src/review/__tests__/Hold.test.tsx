// @vitest-environment jsdom
/** Save for later (On hold) and the per-person notify choices in the Publish pop-up (contract of 2026-11-11):
 * Upload.hold, Upload.draft, NotifyChoices, POST / DELETE /uploads/{id}/hold, ApproveRequest.notify,
 * Recipients.can_change. Users are the seeded ones (seed/users.json); notes are sample text. */
import { describe, it, expect } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { mockApi, on, renderPage, setRole, clone, type Call } from './helpers'
import ReviewPage from '../ReviewPage'
import { notifyChoices } from '../components/Dialogs'
import type { Hold, Recipients, Upload } from '../lib/types'
import uploadFx from './fixtures/upload-moneda.json'
import findingsFx from './fixtures/findings-moneda.json'
import extractionFx from './fixtures/extraction-moneda.json'
import overrideFx from './fixtures/override-moneda.json'
import deals from './fixtures/deals.json'
import programs from './fixtures/programs.json'
import seedUsers from '../../../../seed/users.json'

const ID = uploadFx.id
const PATH = `/admin/uploads/queue/${ID}`
const user = (name: string) => seedUsers.find(u => u.name === name)!
const PATEL = user('A. Patel'), OKAFOR = user('R. Okafor'), CHEN = user('M. Chen'), ALVAREZ = user('D. Alvarez'), NOVAK = user('K. Novak'), HADDAD = user('L. Haddad')
const HOLD: Hold = { at: '2026-11-11T15:04:00+00:00', by: { id: PATEL.id, name: PATEL.name }, by_label: 'A. Patel', note: 'Waiting for the servicer to confirm tranche 52.' }

/** TAO: Patel is notified, Okafor can be added. Investor: Chen is notified, Alvarez can be added. Manager: Novak is
 * notified, Haddad is deactivated (locked). */
const recipients = (): Recipients => ({
  notified: [
    { user_id: PATEL.id, name: PATEL.name, partner_slug: null, channels: ['in_app'], can_change: true },
    { user_id: CHEN.id, name: CHEN.name, partner_slug: 'investor', channels: ['in_app'], can_change: true },
    { user_id: NOVAK.id, name: NOVAK.name, partner_slug: 'manager', channels: ['in_app', 'email'], can_change: true },
  ],
  not_notified: [
    { user_id: OKAFOR.id, name: OKAFOR.name, partner_slug: null, reason: 'not_subscribed', can_change: true },
    { user_id: ALVAREZ.id, name: ALVAREZ.name, partner_slug: 'investor', reason: 'not_subscribed', can_change: true },
    { user_id: HADDAD.id, name: HADDAD.name, partner_slug: 'manager', reason: 'deactivated', can_change: false },
  ],
})

type State = { upload: Upload; findings: unknown[]; recipients: Recipients }
/** Block findings resolved, so Publish is open. */
const fresh = (over: Partial<Upload> = {}): State => ({
  upload: { ...(clone(uploadFx) as Upload), finding_counts: { block: 0, review: 0, note: 0 }, hold: null, draft: null, ...over },
  findings: clone(overrideFx), recipients: recipients(),
})
function stack(state: State, extra: Parameters<typeof mockApi>[0] = []) {
  return mockApi([
    ...extra,
    on('GET', new RegExp(`^/uploads/${ID}$`), () => ({ body: state.upload })),
    on('GET', new RegExp(`^/uploads/${ID}/findings$`), () => ({ body: state.findings })),
    on('GET', new RegExp(`^/uploads/${ID}/extraction`), () => ({ body: extractionFx })),
    on('GET', new RegExp(`^/uploads/${ID}/recipients$`), () => ({ body: state.recipients })),
    on('POST', new RegExp(`^/uploads/${ID}/hold$`), c => {
      const b = (c.body ?? {}) as { note?: string | null }
      state.upload = { ...state.upload, hold: { ...HOLD, note: b.note ?? null } }
      return { body: state.upload }
    }),
    on('DELETE', new RegExp(`^/uploads/${ID}/hold$`), () => (state.upload = { ...state.upload, hold: null }, { body: state.upload })),
    on('GET', /^\/audit\?upload_id=/, () => ({ body: [] })),
    on('GET', /^\/master\/deals/, () => ({ body: deals })),
    on('GET', /^\/master\/programs/, () => ({ body: programs })),
  ])
}
/** The review page with the Approval queue route beside it, so leaving for the queue can be seen. */
const show = () => renderPage(
  <Routes>
    <Route path="queue" element={<output data-testid="where">Approval queue</output>} />
    <Route path="queue/:uploadId" element={<ReviewPage />} />
  </Routes>, { path: PATH, route: '/admin/uploads/*' })
const writes = (calls: Call[], re: RegExp) => calls.filter(c => c.method !== 'GET' && re.test(c.path))
const openPublish = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Publish to partner…' }))
  const dlg = await screen.findByRole('dialog', { name: 'Publish to partner' })
  await within(dlg).findByRole('list', { name: 'TAO' })
  return dlg
}
const sw = (dlg: HTMLElement, name: string) => within(dlg).getByRole('switch', { name }) as HTMLInputElement
const row = (dlg: HTMLElement, id: string) => within(dlg).getByTestId(`recipient-${id}`).textContent

describe('Save… on the action bar', () => {
  it('sits between Re-extract pages… and Reject…, and saves with no note: the body has only note', async () => {
    const state = fresh()
    const calls = stack(state)
    show()
    await screen.findByRole('button', { name: 'Save…' })
    const bar = screen.getByRole('region', { name: 'Decision' })
    expect(within(bar).getAllByRole('button').map(b => b.textContent)).toEqual(['Re-extract pages…', 'Save…', 'Reject…', 'Publish to partner…'])
    expect(within(bar).getByText('All block findings are resolved. Ready to publish.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Save…' }))
    const dlg = await screen.findByRole('dialog', { name: 'Save for later' })
    expect(within(dlg).getByText('The report stays in the Approval queue marked On hold. Nothing is sent to partners. Your draft note and notification choices are kept.')).toBeTruthy()
    const note = within(dlg).getByRole('textbox', { name: /Why is it waiting\?/ }) as HTMLTextAreaElement
    expect(note.maxLength).toBe(1000)
    expect(note.required).toBe(false)
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save and close' }))
    expect(await screen.findByText('Saved. On hold in the Approval queue.')).toBeTruthy()
    expect((await screen.findByTestId('where')).textContent).toBe('Approval queue')
    const posts = writes(calls, /\/hold$/)
    expect(posts).toHaveLength(1)
    expect(posts[0].method).toBe('POST')
    expect(posts[0].body).toEqual({ note: null })
  }, 40000)

  it('sends the note, and nothing else, when a draft is stored', async () => {
    const state = fresh({ draft: { note_to_partners: 'Opening balance includes tranche 52.', notify: { add: [OKAFOR.id], remove: [] } } })
    const calls = stack(state)
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'Save…' }))
    const dlg = await screen.findByRole('dialog', { name: 'Save for later' })
    await userEvent.type(within(dlg).getByRole('textbox', { name: /Why is it waiting\?/ }), '  Waiting for the servicer.  ')
    expect(within(dlg).getByTestId('hold-note-count').textContent).toBe('29 / 1,000')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save and close' }))
    await screen.findByTestId('where')
    expect(writes(calls, /\/hold$/)[0].body).toEqual({ note: 'Waiting for the servicer.' })
  }, 40000)

  it('Cancel sends nothing; an API refusal stays in the dialog', async () => {
    const state = fresh()
    const calls = stack(state, [on('POST', /\/hold$/, () => ({ status: 409, body: { code: 'bad_state', message: 'Only a report in Needs review can be saved for later.' } }))])
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'Save…' }))
    let dlg = await screen.findByRole('dialog', { name: 'Save for later' })
    await userEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(writes(calls, /\/hold$/)).toHaveLength(0)
    await userEvent.click(screen.getByRole('button', { name: 'Save…' }))
    dlg = await screen.findByRole('dialog', { name: 'Save for later' })
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save and close' }))
    expect((await within(dlg).findByRole('alert')).textContent).toBe('Only a report in Needs review can be saved for later.')
    expect(screen.queryByTestId('where')).toBeNull()
  }, 40000)

  it('is hidden for the analyst and for uploads that are not in Needs review', async () => {
    setRole('tao_analyst')
    stack(fresh({ hold: HOLD }))
    const a = show()
    await screen.findByRole('article', { name: /Tranche balance roll-forward/ })
    expect(screen.queryByRole('button', { name: 'Save…' })).toBeNull()
    // The analyst sees the marker, not the Release hold button.
    expect(screen.getByTestId('hold-line').textContent).toMatch(/^On hold since /)
    expect(screen.queryByRole('button', { name: 'Release hold' })).toBeNull()
    a.unmount()

    for (const status of ['approved', 'published', 'rejected', 'extraction_failed'] as const) {
      setRole('tao_admin')
      stack(fresh({ status, published_at: status === 'published' ? '2026-11-05T16:20:00+00:00' : null }))
      const r = show()
      await screen.findByRole('region', { name: 'Decision' })
      await screen.findByRole('article', { name: /Tranche balance roll-forward/ })
      expect(screen.queryByRole('button', { name: 'Save…' })).toBeNull()
      r.unmount()
    }
  }, 60000)
})

describe('On hold marker on the review page', () => {
  it('shows the pill beside the status and the line with the note; Release hold calls DELETE and clears both', async () => {
    const state = fresh({ hold: HOLD })
    const calls = stack(state)
    show()
    const line = await screen.findByTestId('hold-line')
    expect(line.textContent).toMatch(/^On hold since \d{4}-\d{2}-\d{2} \d{2}:\d{2} by A\. Patel: Waiting for the servicer to confirm tranche 52\.Release hold$/)
    expect(line.querySelector('q')!.textContent).toBe(HOLD.note)
    const top = screen.getByTestId('topbar')
    expect(within(top).getByText('Needs review')).toBeTruthy()
    expect(within(top).getByText('On hold')).toBeTruthy()
    // The action bar's hint is unchanged.
    expect(screen.getByText('All block findings are resolved. Ready to publish.')).toBeTruthy()
    // Save… starts from the note already stored.
    await userEvent.click(screen.getByRole('button', { name: 'Save…' }))
    const dlg = await screen.findByRole('dialog', { name: 'Save for later' })
    expect((within(dlg).getByRole('textbox', { name: /Why is it waiting\?/ }) as HTMLTextAreaElement).value).toBe(HOLD.note)
    await userEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }))

    await userEvent.click(screen.getByRole('button', { name: 'Release hold' }))
    await waitFor(() => expect(screen.queryByTestId('hold-line')).toBeNull())
    expect(within(screen.getByTestId('topbar')).queryByText('On hold')).toBeNull()
    expect(await screen.findByText('Hold released')).toBeTruthy()
    const del = writes(calls, /\/hold$/)
    expect(del).toHaveLength(1)
    expect(del[0].method).toBe('DELETE')
    expect(screen.queryByTestId('where')).toBeNull()
  }, 40000)

  it('without a note the line ends after the name', async () => {
    stack(fresh({ hold: { ...HOLD, by: null, by_label: 'TAO Admin', note: null } }))
    show()
    expect((await screen.findByTestId('hold-line')).textContent).toMatch(/^On hold since \d{4}-\d{2}-\d{2} \d{2}:\d{2} by TAO Admin\.Release hold$/)
  }, 40000)
})

describe('Publish pop-up: who gets notified, per person', () => {
  it('lists TAO then each partner with the default states; locked rows cannot be switched', async () => {
    stack(fresh())
    show()
    const dlg = await openPublish()
    const who = within(dlg).getByRole('region', { name: 'Who gets notified' })
    expect(within(who).getAllByRole('list').map(l => l.getAttribute('aria-label'))).toEqual(['TAO', 'Investor', 'Manager'])
    expect(within(who).getByTestId('notify-count').textContent).toBe(' · 3 people')
    expect(within(who).queryByTestId('notify-changes')).toBeNull()
    expect(row(dlg, PATEL.id)).toBe('A. PatelTAOWill be notifiedIn-app')
    expect(row(dlg, OKAFOR.id)).toBe('R. OkaforTAONot notifieddoes not receive this deal')
    expect(row(dlg, NOVAK.id)).toBe('K. NovakManagerWill be notifiedIn-app · Email (coming later)')
    expect(row(dlg, HADDAD.id)).toBe('L. HaddadManagerNot notified Locked: deactivated')
    expect(sw(dlg, 'A. Patel').checked).toBe(true)
    expect(sw(dlg, 'D. Alvarez').checked).toBe(false)
    expect(sw(dlg, 'D. Alvarez').disabled).toBe(false)
    const locked = sw(dlg, 'L. Haddad')
    expect(locked.disabled).toBe(true)
    await userEvent.click(locked)
    expect(locked.checked).toBe(false)
    expect(within(who).getByTestId('notify-count').textContent).toBe(' · 3 people')
    expect(within(who).queryByTestId('notifications-off')).toBeNull()
  }, 40000)

  it('adds and leaves out people for this publish, keeps a live count, resets, and sends notify', async () => {
    const state = fresh()
    const calls = stack(state, [on('POST', /\/approve$/, () => (state.upload = { ...state.upload, status: 'published', published_at: '2026-11-11T16:20:00+00:00' }, { body: state.upload }))])
    show()
    const dlg = await openPublish()
    const who = within(dlg).getByRole('region', { name: 'Who gets notified' })
    await userEvent.click(sw(dlg, 'R. Okafor'))
    expect(row(dlg, OKAFOR.id)).toBe('R. OkaforTAOWill be notifiedAdded for this report')
    expect(within(who).getByTestId('notify-count').textContent).toBe(' · 4 people')
    expect(within(who).getByTestId('notify-changes').textContent).toBe('1 change for this report only. Subscriptions are not changed. Reset')
    await userEvent.click(sw(dlg, 'M. Chen'))
    await userEvent.click(sw(dlg, 'K. Novak'))
    expect(row(dlg, CHEN.id)).toBe('M. ChenInvestorNot notifiedLeft out for this report')
    expect(within(who).getByTestId('notify-count').textContent).toBe(' · 2 people')
    expect(within(who).getByTestId('notify-changes').textContent).toMatch(/^3 changes for this report only\. Subscriptions are not changed\./)

    await userEvent.click(within(who).getByRole('button', { name: 'Reset' }))
    expect(within(who).queryByTestId('notify-changes')).toBeNull()
    expect(within(who).getByTestId('notify-count').textContent).toBe(' · 3 people')
    expect(sw(dlg, 'R. Okafor').checked).toBe(false)
    expect(sw(dlg, 'M. Chen').checked).toBe(true)

    // Switching a row back by hand is the same as never touching it.
    await userEvent.click(sw(dlg, 'K. Novak'))
    await userEvent.click(sw(dlg, 'K. Novak'))
    expect(within(who).queryByTestId('notify-changes')).toBeNull()

    await userEvent.click(sw(dlg, 'D. Alvarez'))
    await userEvent.click(sw(dlg, 'M. Chen'))
    await userEvent.type(within(dlg).getByRole('textbox', { name: /Note to partners/ }), 'Tranche 52 is in the opening balance.')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Approve and publish' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes(calls, /\/approve$/)[0].body).toEqual({ note_to_partners: 'Tranche 52 is in the opening balance.', notify: { add: [ALVAREZ.id], remove: [CHEN.id] } })
    expect(screen.queryByTestId('where')).toBeNull()
  }, 60000)

  it('leaves notify out of the approve body when nothing was switched', async () => {
    const state = fresh()
    const calls = stack(state, [on('POST', /\/approve$/, () => ({ body: { ...state.upload, status: 'published' } }))])
    show()
    const dlg = await openPublish()
    await userEvent.click(within(dlg).getByRole('button', { name: 'Approve and publish' }))
    await waitFor(() => expect(writes(calls, /\/approve$/)).toHaveLength(1))
    expect(writes(calls, /\/approve$/)[0].body).toEqual({ note_to_partners: null })
  }, 40000)

  it('partner notifications off: partner rows are locked with the reason, TAO rows can be switched', async () => {
    const state = fresh()
    state.recipients = {
      notified: [{ user_id: PATEL.id, name: PATEL.name, partner_slug: null, channels: ['in_app'], can_change: true }],
      not_notified: [
        { user_id: OKAFOR.id, name: OKAFOR.name, partner_slug: null, reason: 'not_subscribed', can_change: true },
        { user_id: CHEN.id, name: CHEN.name, partner_slug: 'investor', reason: 'partner_notifications_off', can_change: false },
        { user_id: NOVAK.id, name: NOVAK.name, partner_slug: 'manager', reason: 'partner_notifications_off', can_change: false },
      ],
    }
    const calls = stack(state, [on('POST', /\/approve$/, () => ({ body: { ...state.upload, status: 'published' } }))])
    show()
    const dlg = await openPublish()
    expect(within(dlg).getByTestId('notifications-off').textContent).toBe('Partner notifications are off, so no partner is notified. A TAO Admin can turn them on in System settings.')
    expect(sw(dlg, 'M. Chen').disabled).toBe(true)
    expect(sw(dlg, 'K. Novak').disabled).toBe(true)
    expect(row(dlg, CHEN.id)).toBe('M. ChenInvestorNot notified Locked: partner notifications are off')
    expect(within(dlg).getByTestId('notify-count').textContent).toBe(' · 1 person')
    await userEvent.click(sw(dlg, 'A. Patel'))
    expect(within(dlg).getByTestId('notify-count').textContent).toBe(' · nobody')
    await userEvent.click(sw(dlg, 'R. Okafor'))
    await userEvent.click(within(dlg).getByRole('button', { name: 'Approve and publish' }))
    await waitFor(() => expect(writes(calls, /\/approve$/)).toHaveLength(1))
    expect(writes(calls, /\/approve$/)[0].body).toEqual({ note_to_partners: null, notify: { add: [OKAFOR.id], remove: [PATEL.id] } })
  }, 40000)

  it('applies the stored draft on open and drops a choice that is no longer allowed, without an error', async () => {
    // Saved: add Okafor (still fine), add Haddad (now deactivated: locked), add Chen (already notified), remove
    // Novak (still fine), remove Alvarez (not notified anyway).
    const state = fresh({ hold: HOLD, draft: { note_to_partners: 'Tranche 52 is in the opening balance.', notify: { add: [OKAFOR.id, HADDAD.id, CHEN.id], remove: [NOVAK.id, ALVAREZ.id] } } })
    const calls = stack(state, [on('POST', /\/approve$/, () => ({ body: { ...state.upload, status: 'published', hold: null, draft: null } }))])
    show()
    const dlg = await openPublish()
    expect((within(dlg).getByRole('textbox', { name: /Note to partners/ }) as HTMLTextAreaElement).value).toBe('Tranche 52 is in the opening balance.')
    expect(sw(dlg, 'R. Okafor').checked).toBe(true)
    expect(sw(dlg, 'K. Novak').checked).toBe(false)
    expect(sw(dlg, 'L. Haddad').checked).toBe(false)
    expect(sw(dlg, 'M. Chen').checked).toBe(true)
    expect(row(dlg, CHEN.id)).toBe('M. ChenInvestorWill be notifiedIn-app')
    expect(within(dlg).getByTestId('notify-changes').textContent).toMatch(/^2 changes for this report only\./)
    expect(within(dlg).getByTestId('notify-count').textContent).toBe(' · 3 people')
    expect(within(dlg).queryByRole('alert')).toBeNull()
    await userEvent.click(within(dlg).getByRole('button', { name: 'Approve and publish' }))
    await waitFor(() => expect(writes(calls, /\/approve$/)).toHaveLength(1))
    expect(writes(calls, /\/approve$/)[0].body).toEqual({ note_to_partners: 'Tranche 52 is in the opening balance.', notify: { add: [OKAFOR.id], remove: [NOVAK.id] } })
  }, 40000)

  it('notifyChoices keeps only what the recipients still allow', () => {
    const r = recipients()
    expect(notifyChoices(r, { add: [OKAFOR.id, OKAFOR.id, HADDAD.id, CHEN.id, 'unknown'], remove: [NOVAK.id, ALVAREZ.id] })).toEqual({ add: [OKAFOR.id], remove: [NOVAK.id] })
    expect(notifyChoices(undefined, { add: [OKAFOR.id], remove: [NOVAK.id] })).toEqual({ add: [], remove: [] })
    expect(notifyChoices(r, {})).toEqual({ add: [], remove: [] })
  })

  it('a 422 from the API is shown in the dialog, which stays open', async () => {
    const state = fresh()
    const calls = stack(state, [on('POST', /\/approve$/, () => ({ status: 422, body: { code: 'invalid', message: 'R. Okafor cannot be added to this publish.' } }))])
    show()
    const dlg = await openPublish()
    await userEvent.click(sw(dlg, 'R. Okafor'))
    await userEvent.click(within(dlg).getByRole('button', { name: 'Approve and publish' }))
    expect((await within(dlg).findByRole('alert')).textContent).toBe('R. Okafor cannot be added to this publish.')
    expect(screen.getByRole('dialog', { name: 'Publish to partner' })).toBeTruthy()
    // The choice is still there to correct.
    expect(sw(dlg, 'R. Okafor').checked).toBe(true)
    expect(writes(calls, /\/approve$/)).toHaveLength(1)
  }, 40000)

  it('Save for later posts the note and the choices as the draft, then goes to the queue', async () => {
    const state = fresh()
    const calls = stack(state)
    show()
    const dlg = await openPublish()
    expect([...dlg.querySelectorAll('.ds-dialog__foot button')].map(b => b.textContent)).toEqual(['Cancel', 'Save for later', 'Approve and publish'])
    await userEvent.type(within(dlg).getByRole('textbox', { name: /Note to partners/ }), 'Draft note.')
    await userEvent.click(sw(dlg, 'R. Okafor'))
    await userEvent.click(sw(dlg, 'M. Chen'))
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save for later' }))
    expect(await screen.findByText('Saved. On hold in the Approval queue.')).toBeTruthy()
    expect((await screen.findByTestId('where')).textContent).toBe('Approval queue')
    const posts = writes(calls, /\/hold$/)
    expect(posts).toHaveLength(1)
    // No hold note is stored, so none is sent.
    expect(posts[0].body).toEqual({ note_to_partners: 'Draft note.', notify: { add: [OKAFOR.id], remove: [CHEN.id] } })
    expect(writes(calls, /\/approve$/)).toHaveLength(0)
  }, 40000)

  it('Save for later sends the existing hold note along; Cancel discards the dialog and posts nothing', async () => {
    const state = fresh({ hold: HOLD, draft: { note_to_partners: 'Stored note.', notify: { add: [OKAFOR.id], remove: [] } } })
    const calls = stack(state)
    show()
    let dlg = await openPublish()
    await userEvent.click(sw(dlg, 'R. Okafor'))
    await userEvent.clear(within(dlg).getByRole('textbox', { name: /Note to partners/ }))
    await userEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(writes(calls, /\/(hold|approve)$/)).toHaveLength(0)
    // Opening again starts from the stored draft, not from what was discarded.
    dlg = await openPublish()
    expect((within(dlg).getByRole('textbox', { name: /Note to partners/ }) as HTMLTextAreaElement).value).toBe('Stored note.')
    expect(sw(dlg, 'R. Okafor').checked).toBe(true)
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save for later' }))
    await screen.findByTestId('where')
    expect(writes(calls, /\/hold$/)[0].body).toEqual({ note: HOLD.note, note_to_partners: 'Stored note.', notify: { add: [OKAFOR.id], remove: [] } })
  }, 40000)

  it('has no Save for later on an approved upload', async () => {
    stack(fresh({ status: 'approved' }))
    show()
    const dlg = await openPublish()
    expect(within(dlg).queryByRole('button', { name: 'Save for later' })).toBeNull()
    expect(within(dlg).getByRole('button', { name: 'Approve and publish' })).toBeTruthy()
  }, 40000)
})
