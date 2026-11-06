// @vitest-environment jsdom
/** Wave B on the review pages: value edits in review (D1 a), corrections after publish (D1 c), corrections in the
 * approval queue, and the new audit actions. The edit and correction objects follow contracts/openapi.yaml › ValueEdit /
 * Correction; their numbers are the recorded Moneda Aug 2026 extraction's (the closing balance 15,019,971.52 and R05's
 * computed 15,020,071.52), so no figure is invented. */
import { describe, it, expect } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockApi, on, renderPage, setRole, clone, type Call } from './helpers'

/** Long text goes in with one paste instead of a keystroke per character: same result, much faster on this page. */
const fill = async (el: HTMLElement, text: string) => { await userEvent.click(el); await userEvent.paste(text) }
import ReviewPage from '../ReviewPage'
import QueuePage from '../QueuePage'
import ReportsLibraryPage from '../ReportsLibraryPage'
import type { Correction, CorrectionDetail, Upload, ValueEdit } from '../lib/types'
import uploadFx from './fixtures/upload-moneda.json'
import findingsFx from './fixtures/findings-moneda.json'
import extractionFx from './fixtures/extraction-moneda.json'
import auditFx from './fixtures/audit-moneda.json'
import queue from './fixtures/queue.json'
import published from './fixtures/published.json'
import deals from './fixtures/deals.json'
import programs from './fixtures/programs.json'

const ID = uploadFx.id
const PATH = `/admin/uploads/queue/${ID}`
const PTR = '/tranche_balance/closing'
const LABEL = 'Tranche balance, Closing'
const EXTRACTED = 15019971.52
const OURS = 15020071.52
const REASON = 'Page 2 prints 15,020,071.52; checked at 400% in the page viewer.'
const CORR = 'c0a1b2c3-0000-4000-8000-000000000001'

const edit = (over: Partial<ValueEdit> = {}): ValueEdit => ({
  id: 'e0a1b2c3-0000-4000-8000-000000000001', upload_id: ID, correction_id: null, pointer: PTR, old_value: EXTRACTED, new_value: OURS,
  reason: REASON, source_page: 2, actor_role: 'tao_admin', actor_label: 'TAO Admin', at: '2026-11-05T15:41:00+00:00', reverted_at: null, ...over,
})
const correction = (over: Partial<CorrectionDetail> = {}): CorrectionDetail => ({
  id: CORR, upload_id: ID, deal_slug: uploadFx.deal_slug, collection_period: '2026-08', status: 'published', version: 2,
  edits: [edit({ id: 'e0a1b2c3-0000-4000-8000-000000000002', correction_id: CORR, reason: 'Servicer confirmed the closing balance by email.' })],
  reason: 'Servicer confirmed the closing balance by email.', note_to_partners: null, finding_counts: { block: 0, review: 0, note: 0 },
  created_at: '2026-11-05T19:20:00+00:00', created_by: 'tao_admin', ...over,
})

type State = { upload: Upload; findings: unknown[]; audit: unknown[]; edits: ValueEdit[]; corrections: Correction[] }
const fresh = (): State => ({ upload: clone(uploadFx) as Upload, findings: clone(findingsFx), audit: clone(auditFx), edits: [], corrections: [] })
const publishedState = (): State => ({ ...fresh(), findings: [], upload: { ...(clone(uploadFx) as Upload), status: 'published', published_at: '2026-11-05T16:02:00+00:00', published_version: 1 } })

function stack(state: State, extra: Parameters<typeof mockApi>[0] = []) {
  return mockApi([
    ...extra,
    on('GET', new RegExp(`^/uploads/${ID}$`), () => ({ body: state.upload })),
    on('GET', new RegExp(`^/uploads/${ID}/findings$`), () => ({ body: state.findings })),
    on('GET', new RegExp(`^/uploads/${ID}/extraction`), () => ({ body: extractionFx })),
    on('GET', new RegExp(`^/uploads/${ID}/edits$`), () => ({ body: state.edits })),
    on('GET', new RegExp(`^/uploads/${ID}/corrections$`), () => ({ body: state.corrections })),
    on('GET', /^\/audit\?upload_id=/, c => (c.headers['X-Role'] === 'tao_admin' ? { body: state.audit } : { status: 403, body: { code: 'admin_only', message: 'tao_admin only' } })),
    on('GET', /^\/master\/deals/, () => ({ body: deals })),
    on('GET', /^\/master\/programs/, () => ({ body: programs })),
  ])
}
const show = (path = PATH) => renderPage(<ReviewPage />, { path, route: '/admin/uploads/queue/:uploadId' })
const editedRow = (ptr = PTR) => screen.queryAllByTestId('edited-value').find(n => n.getAttribute('data-pointer') === ptr)
const save = () => screen.getByRole('button', { name: 'Save and re-run rules' }) as HTMLButtonElement

describe('Edit extracted values (D1 a)', () => {
  it('TAO Admin edits a value: page source, rules that read it, 10-character reason, re-run, Edited marker', async () => {
    const state = fresh()
    const calls = stack(state, [
      on('POST', new RegExp(`^/uploads/${ID}/edits$`), c => {
        const b = c.body as { value: number; reason: string }
        state.edits = [edit({ new_value: b.value, reason: b.reason })]
        state.upload = { ...state.upload, finding_counts: { block: 0, review: 0, note: 0 }, active_edit_count: 1 }
        state.findings = []
        return { body: { edit: state.edits[0], finding_counts: { block: 0, review: 0, note: 0 } } }
      }),
    ])
    show()
    await userEvent.click(await screen.findByRole('button', { name: `Edit ${LABEL}` }))
    const dlg = await screen.findByRole('dialog', { name: `Edit ${LABEL}` })
    expect(within(dlg).getByTestId('edit-current').textContent).toMatch(/^\$15,019,971\.52extracted from page 2/)
    expect(within(dlg).getByText('15,019,971.52', { selector: 'code' })).toBeTruthy()
    expect(within(dlg).getByRole('button', { name: 'Open page 2 in the page viewer' })).toBeTruthy()
    expect(within(dlg).getByTestId('edit-rules').textContent).toMatch(/Rules that read this value: R05 /)
    expect(save().disabled).toBe(true)
    await userEvent.type(within(dlg).getByRole('textbox', { name: /New value/ }), '15,020,071.52')
    expect(within(dlg).getByTestId('edit-change').textContent).toBe('Change. +$100.00 (0.001%): $15,019,971.52 → $15,020,071.52')
    // Reason under 10 characters: Save stays disabled and the field says why.
    const reason = within(dlg).getByRole('textbox', { name: /Reason/ })
    await userEvent.type(reason, 'too short')
    await userEvent.tab()
    expect(save().disabled).toBe(true)
    expect(within(dlg).getByText(/at least 10 characters \(9 so far\)/)).toBeTruthy()
    expect(calls.some(c => c.method === 'POST')).toBe(false)
    await userEvent.clear(reason)
    await fill(reason, REASON)
    expect(save().disabled).toBe(false)
    await userEvent.click(save())
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const post = calls.find(c => c.method === 'POST') as Call
    expect(post.body).toEqual({ pointer: PTR, value: OURS, reason: REASON })
    expect(await screen.findByText(`${LABEL} edited`)).toBeTruthy()
    expect(screen.getByText('Rules re-ran. No block findings open.')).toBeTruthy()
    await waitFor(() => expect(editedRow()).toBeTruthy())
    expect(within(editedRow()!).getByText('Edited')).toBeTruthy()
    expect(within(editedRow()!).getByText('original $15,019,971.52')).toBeTruthy()
    expect(within(editedRow()!).getByText('$15,020,071.52')).toBeTruthy()
    expect(within(editedRow()!).getByRole('button', { name: `Revert ${LABEL}` })).toBeTruthy()
    // Findings refreshed after the re-run; the footer counts the edit.
    await waitFor(() => expect(screen.getByText('No findings. Every rule passed for this extraction.')).toBeTruthy())
    expect(screen.getByTestId('edited-count').textContent).toBe('1 value edited')
  }, 60000)

  it('rejects a value that does not parse or equals the current one', async () => {
    stack(fresh())
    show()
    await userEvent.click(await screen.findByRole('button', { name: `Edit ${LABEL}` }))
    const dlg = await screen.findByRole('dialog')
    await fill(within(dlg).getByRole('textbox', { name: /Reason/ }), REASON)
    const input = within(dlg).getByRole('textbox', { name: /New value/ })
    await userEvent.type(input, 'abc')
    expect(within(dlg).getByText('Not a number in this format.')).toBeTruthy()
    expect(save().disabled).toBe(true)
    await userEvent.clear(input)
    await userEvent.type(input, '15019971.52')
    expect(within(dlg).getByText('Same as the current value.')).toBeTruthy()
    expect(save().disabled).toBe(true)
  }, 60000)

  it('reverts an edit with a reason of at least 3 characters', async () => {
    const state = fresh(); state.edits = [edit()]
    const calls = stack(state, [
      on('POST', /\/edits\/[^/]+\/revert$/, () => {
        state.edits = [edit({ reverted_at: '2026-11-05T16:00:00+00:00', reverted_by: 'tao_admin', revert_reason: 'Wrong row.' })]
        return { body: { edit: state.edits[0], finding_counts: { block: 1, review: 0, note: 0 } } }
      }),
    ])
    show()
    await waitFor(() => expect(editedRow()).toBeTruthy())
    await userEvent.click(within(editedRow()!).getByRole('button', { name: `Revert ${LABEL}` }))
    const dlg = await screen.findByRole('dialog', { name: `Revert ${LABEL}` })
    expect(within(dlg).getByText(/Restores \$15,019,971\.52/)).toBeTruthy()
    const go = within(dlg).getByRole('button', { name: 'Revert and re-run rules' }) as HTMLButtonElement
    await userEvent.type(within(dlg).getByRole('textbox', { name: /Reason/ }), 'no')
    expect(go.disabled).toBe(true)
    await userEvent.type(within(dlg).getByRole('textbox', { name: /Reason/ }), 'pe')
    expect(go.disabled).toBe(false)
    await userEvent.click(go)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const post = calls.find(c => c.method === 'POST') as Call
    expect(post.path).toBe(`/uploads/${ID}/edits/${edit().id}/revert`)
    expect(post.body).toEqual({ reason: 'nope' })
    expect(await screen.findByText('Rules re-ran. 1 block finding open.')).toBeTruthy()
    await waitFor(() => expect(editedRow()).toBeUndefined())
    expect(screen.queryByTestId('edited-count')).toBeNull()
  }, 60000)

  it('TAO Analyst sees the Edited marker, original and reason, with no controls', async () => {
    setRole('tao_analyst')
    const state = fresh(); state.edits = [edit()]
    stack(state)
    show()
    await waitFor(() => expect(editedRow()).toBeTruthy())
    const row = editedRow()!
    expect(within(row).getByText('Edited')).toBeTruthy()
    expect(within(row).getByText('original $15,019,971.52')).toBeTruthy()
    expect(within(row).getByRole('tooltip').textContent).toContain(REASON)
    expect(screen.queryByRole('button', { name: /^(Edit|Revert|Correct) / })).toBeNull()
    expect(screen.getByTestId('edited-summary').textContent).toBe(' 1 value edited.')
  }, 60000)

  it('the Publish dialog lists every active edit; the re-extract dialog warns about edited pages', async () => {
    const state = fresh(); state.findings = []; state.upload = { ...state.upload, finding_counts: { block: 0, review: 0, note: 0 } }
    state.edits = [edit(), edit({ id: 'e0a1b2c3-0000-4000-8000-000000000009', pointer: '/tranche_amount/closing', reverted_at: '2026-11-05T15:50:00+00:00' })]
    stack(state)
    show()
    await waitFor(() => expect(screen.getByTestId('edited-count').textContent).toBe('1 value edited'))
    await userEvent.click(screen.getByRole('button', { name: 'Publish to partner…' }))
    const dlg = await screen.findByRole('dialog', { name: 'Publish to partner' })
    const table = within(dlg).getByRole('table', { name: 'Values edited by hand' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('Tranche balance · closing')
    expect(rows[0].textContent).toContain('$15,019,971.52')
    expect(rows[0].textContent).toContain('$15,020,071.52')
    expect(rows[0].textContent).toContain('TAO Admin')
    expect(rows[0].textContent).toContain(REASON)
    expect(within(dlg).getByText('1 value edit by hand, listed below')).toBeTruthy()
    await userEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Re-extract pages…' }))
    const rx = await screen.findByRole('dialog', { name: 'Re-extract pages' })
    await userEvent.click(within(rx).getByRole('checkbox', { name: 'Page 2' }))
    expect(within(rx).getByTestId('reextract-edited').textContent).toMatch(/^Page 2 has 1 edited value\. The edit is kept/)
  }, 60000)
})

describe('Corrections after publish (D1 c)', () => {
  it('a published record shows its version and corrections, and Correct… publishes as the next version', async () => {
    const state = publishedState()
    state.corrections = [correction({ id: 'c0a1b2c3-0000-4000-8000-00000000000a', status: 'rejected', reject_reason: 'Wrong month.' })]
    const calls = stack(state, [
      on('POST', new RegExp(`^/uploads/${ID}/corrections$`), () => {
        const c = correction()
        state.upload = { ...state.upload, published_version: 2 }
        state.corrections = [c, ...state.corrections]
        return { body: c }
      }),
    ])
    show()
    expect((await screen.findByTestId('version')).textContent).toBe('Version 1')
    const card = await screen.findByRole('region', { name: 'Corrections' })
    expect(within(card).getByRole('link', { name: 'Open correction version 2' }).getAttribute('href')).toBe(`${PATH}?correction=c0a1b2c3-0000-4000-8000-00000000000a`)
    expect(screen.queryByRole('button', { name: `Edit ${LABEL}` })).toBeNull()
    await userEvent.click(await screen.findByRole('button', { name: `Correct ${LABEL}` }))
    const dlg = await screen.findByRole('dialog', { name: 'Correct a published value' })
    expect(within(dlg).getByText(/published version 1\. A correction creates version 2/)).toBeTruthy()
    expect(within(dlg).getByText('Note to partners (optional)')).toBeTruthy()
    expect(within(dlg).getByText(/Sent to partners with the correction/)).toBeTruthy()
    const submit = within(dlg).getByRole('button', { name: 'Correct and re-publish' }) as HTMLButtonElement
    await userEvent.type(within(dlg).getByRole('textbox', { name: 'New value for Tranche balance · closing' }), '15020071.52')
    await userEvent.type(within(dlg).getByRole('textbox', { name: /^Reason/ }), 'by email')
    expect(submit.disabled).toBe(true)
    await userEvent.type(within(dlg).getByRole('textbox', { name: /^Reason/ }), ' from the servicer')
    await fill(within(dlg).getByRole('textbox', { name: /Note to partners/ }), 'Closing balance corrected.')
    expect(submit.disabled).toBe(false)
    await userEvent.click(submit)
    const done = await screen.findByTestId('correction-result')
    expect(done.textContent).toMatch(/^Published as version 2\./)
    const post = calls.find(c => c.method === 'POST') as Call
    expect(post.body).toEqual({ edits: [{ pointer: PTR, value: OURS }], reason: 'by email from the servicer', note_to_partners: 'Closing balance corrected.' })
  }, 60000)

  it('a correction that opens a block finding waits in the approval queue', async () => {
    const state = publishedState()
    stack(state, [
      on('POST', new RegExp(`^/uploads/${ID}/corrections$`), () => ({ body: correction({ status: 'needs_review', finding_counts: { block: 1, review: 0, note: 0 } }) })),
    ])
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'Correct a value…' }))
    const dlg = await screen.findByRole('dialog', { name: 'Correct a published value' })
    await userEvent.type(within(dlg).getByRole('searchbox', { name: /Value/ }), 'tranche balance · closing')
    await userEvent.click(within(within(dlg).getByRole('list', { name: 'Matching values' })).getByRole('button', { name: /Tranche balance · closing/ }))
    await userEvent.type(within(dlg).getByRole('textbox', { name: 'New value for Tranche balance · closing' }), '15020071.52')
    await fill(within(dlg).getByRole('textbox', { name: /^Reason/ }), 'Servicer confirmed the closing balance by email.')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Correct and re-publish' }))
    const done = await screen.findByTestId('correction-result')
    expect(done.textContent).toMatch(/^Waiting in the approval queue: 1 block finding\. Version 2 is not published\. Version 1 stays live/)
    expect(within(done).getByRole('link', { name: 'Open the correction' }).getAttribute('href')).toBe(`${PATH}?correction=${CORR}`)
  }, 60000)

  it('the Reports library shows versions and opens Correct a value… for TAO Admin only', async () => {
    const list = clone(published) as Upload[]
    list[0] = { ...list[0], published_version: 2 }
    list[1] = { ...list[1], published_version: 1 }
    const calls = mockApi([
      on('GET', /^\/uploads\?status=published/, () => ({ body: list })),
      on('GET', /^\/uploads\/[^/]+\/extraction/, () => ({ body: extractionFx })),
      on('GET', /^\/uploads\/[^/]+\/(findings|edits|corrections)$/, () => ({ body: [] })),
      on('POST', /^\/uploads\/[^/]+\/corrections$/, c => ({ body: correction({ upload_id: c.path.split('/')[2], status: 'published', version: 2 }) })),
      on('GET', /^\/master\/deals/, () => ({ body: deals })),
      on('GET', /^\/master\/programs/, () => ({ body: programs })),
    ])
    renderPage(<ReportsLibraryPage />)
    await screen.findAllByText('Moneda Capital Corp.')
    const xp = screen.getAllByRole('row').find(r => r.textContent?.includes('Xpedite'))!
    expect(within(xp).getByTestId('library-version').textContent).toBe('v2')
    expect(within(xp).getByText('Corrected')).toBeTruthy()
    await userEvent.click(within(xp).getByRole('button', { name: /^Correct a value of Xpedite Leasing/ }))
    const dlg = await screen.findByRole('dialog', { name: 'Correct a published value' })
    await userEvent.type(await within(dlg).findByRole('searchbox', { name: /Value/ }), 'tranche balance · closing')
    await userEvent.click(within(within(dlg).getByRole('list', { name: 'Matching values' })).getByRole('button', { name: /^Tranche balance · closing/ }))
    await userEvent.type(within(dlg).getByRole('textbox', { name: 'New value for Tranche balance · closing' }), '15020071.52')
    await fill(within(dlg).getByRole('textbox', { name: /^Reason/ }), 'Servicer confirmed the closing balance by email.')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Correct and re-publish' }))
    expect((await screen.findByTestId('correction-result')).textContent).toMatch(/^Published as version 2\./)
    expect(calls.find(c => c.method === 'POST')!.path).toBe(`/uploads/${list[0].id}/corrections`)
  }, 60000)

  it('analysts get no Correct a value… in the library', async () => {
    setRole('tao_analyst')
    mockApi([
      on('GET', /^\/uploads\?status=published/, () => ({ body: published })),
      on('GET', /^\/master\/deals/, () => ({ body: deals })),
      on('GET', /^\/master\/programs/, () => ({ body: programs })),
    ])
    renderPage(<ReportsLibraryPage />)
    await screen.findAllByText('Moneda Capital Corp.')
    expect(screen.queryByRole('button', { name: /Correct a value/ })).toBeNull()
  })
})

describe('Corrections in the approval queue', () => {
  it('lists pending corrections with a Correction tag, linking to the correction review', async () => {
    const calls = mockApi([
      on('GET', /^\/uploads\?status=needs_review/, () => ({ body: queue })),
      on('GET', /^\/uploads\?status=approved/, () => ({ body: [] })),
      on('GET', /^\/corrections\?status=needs_review/, () => ({ body: [correction({ status: 'needs_review', finding_counts: { block: 1, review: 0, note: 0 } })] })),
      on('GET', /^\/master\/deals/, () => ({ body: deals })),
      on('GET', /^\/master\/programs/, () => ({ body: programs })),
    ])
    renderPage(<QueuePage />)
    const link = await screen.findByRole('link', { name: 'Moneda Capital Corp. correction' })
    expect(link.getAttribute('href')).toBe(`${PATH}?correction=${CORR}`)
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    // Oldest first: the two uploads (4 Nov) before the correction (5 Nov).
    const row = rows[2]
    expect(within(row).getByText('Correction')).toBeTruthy()
    expect(within(row).getByText('version 2 · 1 value')).toBeTruthy()
    expect(within(row).getByText('Block')).toBeTruthy()
    expect(within(row).getByText('Needs review')).toBeTruthy()
    expect(within(row).getByText('F-PIL 2.0')).toBeTruthy()
    expect(calls.some(c => c.path === '/corrections?status=needs_review')).toBe(true)
  })
})

describe('Correction review view', () => {
  const view = (state: State, detail: CorrectionDetail, extra: Parameters<typeof mockApi>[0] = []) => {
    const calls = stack(state, [...extra, on('GET', new RegExp(`^/corrections/${CORR}$`), () => ({ body: detail }))])
    show(`${PATH}?correction=${CORR}`)
    return calls
  }

  it('shows the edits and re-run findings; Approve is refused while a block finding is open', async () => {
    const state = publishedState(); state.upload = { ...state.upload, pending_correction_id: CORR }
    const detail = correction({ status: 'needs_review', finding_counts: { block: 1, review: 0, note: 0 }, findings: clone(findingsFx) as never })
    view(state, detail)
    const card = await screen.findByRole('region', { name: 'Correction' })
    expect(within(card).getByText('Correction · version 2')).toBeTruthy()
    const edits = within(card).getByRole('table', { name: 'Values this correction changes' })
    expect(within(edits).getAllByRole('row')[1].textContent).toContain('$15,020,071.52')
    expect(within(card).getByRole('article', { name: /Tranche balance roll-forward/ })).toBeTruthy()
    const approve = within(card).getByRole('button', { name: 'Approve and publish v2' }) as HTMLButtonElement
    expect(approve.disabled).toBe(true)
    expect(within(card).getByText(/1 block finding open on the corrected values\. Approve is refused/)).toBeTruthy()
  }, 60000)

  it('shows the 409 open_block_findings refusal, then approves', async () => {
    const state = publishedState()
    let refuse = true
    const detail = correction({ status: 'needs_review', findings: [] })
    const calls = view(state, detail, [
      on('POST', new RegExp(`^/corrections/${CORR}/approve$`), () => (refuse
        ? { status: 409, body: { code: 'open_block_findings', message: 'open block findings' } }
        : { body: { ...detail, status: 'published', decided_at: '2026-11-05T20:00:00+00:00', decided_by: 'tao_admin' } })),
    ])
    const card = await screen.findByRole('region', { name: 'Correction' })
    await userEvent.click(within(card).getByRole('button', { name: 'Approve and publish v2' }))
    expect((await within(card).findByRole('alert')).textContent).toBe('A block finding is still open. Resolve it before publishing.')
    refuse = false
    await userEvent.click(within(card).getByRole('button', { name: 'Approve and publish v2' }))
    expect(await screen.findByText('Published as version 2')).toBeTruthy()
    await waitFor(() => expect(within(card).queryByRole('button', { name: 'Approve and publish v2' })).toBeNull())
    expect(calls.filter(c => c.method === 'POST' && c.path.endsWith('/approve'))).toHaveLength(2)
  }, 60000)

  it('TAO Admin acknowledges a block finding on the correction (3+ characters), then Approve unlocks', async () => {
    const state = publishedState()
    const open = clone(findingsFx) as never as { id: string; status: string; resolution: unknown }[]
    let detail = correction({ status: 'needs_review', finding_counts: { block: 1, review: 0, note: 0 }, findings: open as never })
    const calls = view(state, correction(), [
      on('GET', new RegExp(`^/corrections/${CORR}$`), () => ({ body: detail })),
      on('POST', new RegExp(`^/corrections/${CORR}/findings/[^/]+/override$`), c => {
        const b = c.body as { choice: string; reason: string }
        detail = { ...detail, finding_counts: { block: 0, review: 0, note: 0 },
          findings: [{ ...open[0], status: 'overridden', resolution: { choice: b.choice, reason: b.reason, by: 'tao_admin', at: '2026-11-05T20:00:00+00:00' } }] as never }
        return { body: detail }
      }),
    ])
    const card = await screen.findByRole('region', { name: 'Correction' })
    expect(within(card).queryByRole('button', { name: /Use ours|Use report/ })).toBeNull()
    expect((within(card).getByRole('button', { name: 'Approve and publish v2' }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(within(card).getByRole('button', { name: 'Acknowledge R05' }))
    const dlg = await screen.findByRole('dialog', { name: /^Acknowledge: R05/ })
    const go = within(dlg).getByRole('button', { name: 'Acknowledge' }) as HTMLButtonElement
    await userEvent.type(within(dlg).getByRole('textbox', { name: /Reason/ }), 'ok')
    expect(go.disabled).toBe(true)
    await userEvent.type(within(dlg).getByRole('textbox', { name: /Reason/ }), '!')
    await userEvent.click(go)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const post = calls.find(c => c.method === 'POST') as Call
    expect(post.path).toBe(`/corrections/${CORR}/findings/${open[0].id}/override`)
    expect(post.body).toEqual({ choice: 'acknowledge', reason: 'ok!' })
    await waitFor(() => expect((within(card).getByRole('button', { name: 'Approve and publish v2' }) as HTMLButtonElement).disabled).toBe(false))
    expect(within(card).queryByRole('button', { name: 'Acknowledge R05' })).toBeNull()
  }, 60000)

  it('rejects a queued correction with a reason', async () => {
    const state = publishedState()
    const detail = correction({ status: 'needs_review', findings: [] })
    const calls = view(state, detail, [
      on('POST', new RegExp(`^/corrections/${CORR}/reject$`), c => ({ body: { ...detail, status: 'rejected', reject_reason: (c.body as { reason: string }).reason } })),
    ])
    const card = await screen.findByRole('region', { name: 'Correction' })
    await userEvent.click(within(card).getByRole('button', { name: 'Reject…' }))
    const dlg = await screen.findByRole('alertdialog', { name: 'Reject correction' })
    await userEvent.type(within(dlg).getByRole('textbox', { name: /Reason/ }), 'Wrong month')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Reject correction' }))
    expect(await screen.findByText('Correction rejected')).toBeTruthy()
    expect(calls.find(c => c.path.endsWith('/reject'))!.body).toEqual({ reason: 'Wrong month' })
  }, 60000)
})

describe('Activity', () => {
  it('labels the wave B audit actions and shows old → new', async () => {
    const state = fresh()
    state.audit = [...state.audit,
      { id: 'a1', at: '2026-11-05T15:41:00+00:00', actor_role: 'tao_admin', actor_label: 'TAO Admin', action: 'value_edit', upload_id: ID, reason: REASON,
        detail: { pointer: PTR, old_value: EXTRACTED, new_value: OURS, source_page: 2 } },
      { id: 'a2', at: '2026-11-05T15:50:00+00:00', actor_role: 'tao_admin', actor_label: 'TAO Admin', action: 'value_edit_revert', upload_id: ID, reason: 'Wrong row', detail: {} },
      { id: 'a3', at: '2026-11-05T19:20:00+00:00', actor_role: 'tao_admin', actor_label: 'TAO Admin', action: 'correction', upload_id: ID, reason: 'x', detail: { version: 2 } },
      { id: 'a4', at: '2026-11-05T19:30:00+00:00', actor_role: 'tao_admin', actor_label: 'TAO Admin', action: 'correction_approve', upload_id: ID, reason: null, detail: {} },
      { id: 'a5', at: '2026-11-05T19:40:00+00:00', actor_role: 'tao_admin', actor_label: 'TAO Admin', action: 'correction_reject', upload_id: ID, reason: 'y', detail: {} },
    ]
    stack(state)
    show()
    const act = await screen.findByRole('region', { name: 'Activity' })
    await within(act).findByText('Value edited')
    for (const t of ['Edit reverted', 'Value corrected', 'Correction approved', 'Correction rejected']) expect(within(act).getByText(t)).toBeTruthy()
    expect(within(act).getByText(/Tranche balance · closing \(p\. 2\)/)).toBeTruthy()
    expect(within(act).getByText('$15,020,071.52')).toBeTruthy()
    expect(within(act).getByText('version 2')).toBeTruthy()
  }, 60000)
})
