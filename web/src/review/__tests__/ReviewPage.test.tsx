// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockApi, on, renderPage, setRole, clone, type Call } from './helpers'
import ReviewPage, { partnersLabel } from '../ReviewPage'
import type { Upload } from '../lib/types'
import uploadFx from './fixtures/upload-moneda.json'
import findingsFx from './fixtures/findings-moneda.json'
import extractionFx from './fixtures/extraction-moneda.json'
import auditFx from './fixtures/audit-moneda.json'
import overrideFx from './fixtures/override-moneda.json'
import strideFx from './fixtures/findings-stride.json'
import deals from './fixtures/deals.json'
import programs from './fixtures/programs.json'

const ID = uploadFx.id
const PATH = `/admin/uploads/queue/${ID}`
const R05 = findingsFx[0]

/** R05 after a real use_ours override, recorded from the review stack (same ids as the recorded findings). For
 * use_report only `resolution.choice` changes. */
const REASON = overrideFx[0].resolution.reason
const overridden = (choice = 'use_ours') => [{ ...clone(overrideFx[0]), resolution: { ...clone(overrideFx[0].resolution), choice } }]
const FIVE = 'Roll-forward Aug 2026 · closing balance, Tranche balance · closing, Roll-forward Aug 2026 · closing amount, Tranche amount · closing, Facility · program amount'

type State = { upload: Upload; findings: unknown[]; audit: unknown[] }
function stack(state: State, extra: Parameters<typeof mockApi>[0] = []) {
  return mockApi([
    ...extra,
    on('GET', new RegExp(`^/uploads/${ID}$`), () => ({ body: state.upload })),
    on('GET', new RegExp(`^/uploads/${ID}/findings$`), () => ({ body: state.findings })),
    on('GET', new RegExp(`^/uploads/${ID}/extraction`), () => ({ body: extractionFx })),
    on('GET', /^\/audit\?upload_id=/, c => (c.headers['X-Role'] === 'tao_admin' ? { body: state.audit } : { status: 403, body: { code: 'admin_only', message: 'tao_admin only' } })),
    on('GET', /^\/master\/deals/, () => ({ body: deals })),
    on('GET', /^\/master\/programs/, () => ({ body: programs })),
  ])
}
const fresh = (): State => ({ upload: clone(uploadFx) as Upload, findings: clone(findingsFx), audit: clone(auditFx) })
const show = () => renderPage(<ReviewPage />, { path: PATH, route: '/admin/uploads/queue/:uploadId' })
const card = () => screen.getByRole('article', { name: /Tranche balance roll-forward/ })

describe('Review report', () => {
  it('shows the header facts, the R05 block card with both values and its page crop', async () => {
    stack(fresh())
    show()
    expect(await screen.findByRole('heading', { level: 1, name: 'Moneda Capital Corp.' })).toBeTruthy()
    await screen.findByRole('article', { name: /Tranche balance roll-forward/ })
    const c = card()
    expect(within(c).getByText('R05')).toBeTruthy()
    expect(within(c).getByTestId('our-value').textContent).toBe('$15,020,071.52')
    expect(within(c).getByTestId('report-value').textContent).toBe('$15,019,971.52')
    expect(within(c).getByTestId('difference').textContent).toMatch(/^−\$100\.00/)
    expect(within(c).getByText('Source page 2')).toBeTruthy()
    expect(await within(c).findByRole('img', { name: 'Report page 2' })).toBeTruthy()
    // Both periods and the settlement date from the extraction
    const facts = screen.getByRole('region', { name: 'Report' })
    expect(within(facts).getByText('Aug 2026')).toBeTruthy()
    expect(within(facts).getByText('Jul 2026')).toBeTruthy()
    expect(within(facts).getByText('settlement August 7, 2026')).toBeTruthy()
    expect(within(facts).getByText('Pass 2')).toBeTruthy()
    expect(within(facts).getByText('100.00%')).toBeTruthy()
    // Publish is blocked, with the reason on screen
    const publish = screen.getByRole('button', { name: 'Publish to partner…' }) as HTMLButtonElement
    expect(publish.disabled).toBe(true)
    expect(screen.getByText('1 block finding is open. Resolve it before publishing.')).toBeTruthy()
  })

  it('overrides R05 with a reason, re-runs, and unlocks publishing', async () => {
    const state = fresh()
    const calls = stack(state, [
      on('POST', /\/findings\/[^/]+\/override$/, () => { state.findings = overridden(); state.upload = { ...state.upload, finding_counts: { block: 0, review: 0, note: 0 } }; return { body: state.findings } }),
    ])
    show()
    await screen.findByRole('article', { name: /Tranche balance roll-forward/ })
    await userEvent.click(within(card()).getByRole('button', { name: 'Use ours for R05' }))
    const dlg = await screen.findByRole('dialog')
    expect(within(dlg).getByRole('radio', { name: /Use ours/ })).toHaveProperty('checked', true)
    // What publishing will do, with the five targets as readable labels, and the R05 hint about components
    expect(within(dlg).getByTestId('write-effect').textContent).toBe(`On publish. Writes $15,020,071.52 to 5 fields: ${FIVE}.`)
    expect(within(dlg).getByText(/choose Use report, which changes nothing/)).toBeTruthy()
    await userEvent.click(within(dlg).getByRole('radio', { name: /Use report/ }))
    expect(within(dlg).getByTestId('write-effect').textContent).toBe('On publish. Nothing changes: the extraction already holds $15,019,971.52 in all 5 fields.')
    await userEvent.click(within(dlg).getByRole('radio', { name: /Use ours/ }))
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save and re-run rules' }))
    expect(within(dlg).getByRole('alert').textContent).toMatch(/at least 3 characters/)
    expect(calls.some(c => c.method === 'POST')).toBe(false)
    await userEvent.type(within(dlg).getByRole('textbox', { name: /Reason/ }), REASON)
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save and re-run rules' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const post = calls.find(c => c.method === 'POST') as Call
    expect(post.path).toBe(`/uploads/${ID}/findings/${R05.id}/override`)
    expect(post.body).toEqual({ choice: 'use_ours', reason: REASON })
    expect(within(card()).getByText('Overridden')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Report' })).getByText('1 resolved')).toBeTruthy()
    expect(within(card()).getByText(REASON, { exact: false })).toBeTruthy()
    expect(within(card()).queryByRole('button', { name: /for R05/ })).toBeNull()
    expect(within(card()).getByTestId('pending-correction').textContent).toBe(`Pending on publish. Writes $15,020,071.52 to 5 fields: ${FIVE}.`)
    expect(await screen.findByText(/R05 resolved: Use ours/)).toBeTruthy()
    await waitFor(() => expect((screen.getByRole('button', { name: 'Publish to partner…' }) as HTMLButtonElement).disabled).toBe(false))
    // The audit log is fetched again after the override
    expect(calls.filter(c => c.path.startsWith('/audit')).length).toBeGreaterThanOrEqual(2)
  }, 20000)

  it('publishes through the pop-up, and shows the API refusal when a block is still open', async () => {
    const state = fresh(); state.findings = overridden()
    let refuse = true
    const calls = stack(state, [
      on('POST', /\/approve$/, () => refuse
        ? { status: 409, body: { code: 'open_block_findings', message: 'open block findings' } }
        : (state.upload = { ...state.upload, status: 'published', published_at: '2026-11-03T20:21:00+00:00' }, { body: state.upload })),
    ])
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'Publish to partner…' }))
    let dlg = await screen.findByRole('dialog', { name: 'Publish to partner' })
    // Both partners on the program's visibility list (partner_slugs), not only partner_slug.
    expect(within(dlg).getByText(/goes to the Investor and Manager portals\./)).toBeTruthy()
    expect(within(dlg).getByText(/1 finding resolved with a reason/)).toBeTruthy()
    const table = within(dlg).getByRole('table', { name: 'Corrections publishing writes' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(5)
    expect(rows[1].textContent).toBe('Tranche balance · closing$15,019,971.52$15,020,071.52R05 · Use ours')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Approve and publish' }))
    expect((await within(dlg).findByRole('alert')).textContent).toMatch(/block finding is still open/)
    refuse = false
    dlg = screen.getByRole('dialog', { name: 'Publish to partner' })
    await userEvent.click(within(dlg).getByRole('button', { name: 'Approve and publish' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await screen.findByText('Published to partner')).toBeTruthy()
    await waitFor(() => expect(screen.getByText(/Partners can see it/)).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Publish to partner…' })).toBeNull()
    expect(calls.filter(c => c.method === 'POST' && c.path.endsWith('/approve'))).toHaveLength(2)
  })

  it('rejects with a reason', async () => {
    const state = fresh()
    const calls = stack(state, [on('POST', /\/reject$/, c => (state.upload = { ...state.upload, status: 'rejected', reject_reason: (c.body as { reason: string }).reason }, { body: state.upload }))])
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'Reject…' }))
    const dlg = await screen.findByRole('alertdialog', { name: 'Reject report' })
    expect(within(dlg).getByText(/The status turns to Rejected and the reason goes in the audit log/)).toBeTruthy()
    expect(within(dlg).queryByText(/uploader is told/)).toBeNull()
    await userEvent.click(within(dlg).getByRole('button', { name: 'Reject report' }))
    expect(within(dlg).getByRole('alert')).toBeTruthy()
    await userEvent.type(within(dlg).getByRole('textbox', { name: /Reason/ }), 'wrong month uploaded')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Reject report' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(calls.find(c => c.path.endsWith('/reject'))!.body).toEqual({ reason: 'wrong month uploaded' })
    expect(await screen.findByText('Rejected: wrong month uploaded.')).toBeTruthy()
  })

  it('re-extracts the pages with open findings and polls until the second pass settles', async () => {
    const state = fresh()
    let polls = 0
    const calls = stack(state, [
      on('POST', /\/reextract$/, () => (state.upload = { ...state.upload, status: 'extracting' }, { status: 202, body: state.upload })),
      on('GET', new RegExp(`^/uploads/${ID}$`), () => {
        if (state.upload.status === 'extracting' && ++polls >= 2) state.upload = { ...state.upload, status: 'needs_review' }
        return { body: state.upload }
      }),
    ])
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'Re-extract pages…' }))
    const dlg = await screen.findByRole('dialog', { name: 'Re-extract pages' })
    expect(within(dlg).getByRole('checkbox', { name: 'Page 2' })).toHaveProperty('checked', true)
    expect(within(dlg).getByRole('checkbox', { name: 'Page 3' })).toHaveProperty('checked', false)
    expect(within(dlg).getAllByRole('checkbox')).toHaveLength(16)
    await userEvent.click(within(dlg).getByRole('button', { name: 'Re-extract 1 page' }))
    expect(calls.find(c => c.path.endsWith('/reextract'))!.body).toEqual({ pages: [2] })
    await screen.findByText(/Extraction is running/)
    await waitFor(() => expect(screen.getByText('1 block finding is open. Resolve it before publishing.')).toBeTruthy(), { timeout: 6000 })
    const findingGets = calls.filter(c => c.method === 'GET' && c.path.endsWith('/findings')).length
    expect(findingGets).toBeGreaterThanOrEqual(3)
  }, 10000)

  it('analysts can open the page but see no action buttons', async () => {
    setRole('tao_analyst')
    const calls = stack(fresh())
    show()
    await screen.findByRole('article', { name: /Tranche balance roll-forward/ })
    expect(screen.queryByRole('button', { name: /Use ours|Use report|Accept as restatement|Acknowledge/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Publish|Reject|Re-extract/ })).toBeNull()
    expect(screen.getByText(/Read only\. Only a TAO admin/)).toBeTruthy()
    expect(screen.queryByText('Activity')).toBeNull()
    expect(calls.some(c => c.path.startsWith('/audit'))).toBe(false)
    expect(calls.every(c => c.headers['X-Role'] === 'tao_analyst')).toBe(true)
  })

  it('partner roles get no access and no intake request', () => {
    setRole('manager_viewer')
    const calls = stack(fresh())
    show()
    expect(screen.getByText('You don’t have access')).toBeTruthy()
    expect(calls).toHaveLength(0)
  })

  it('shows the audit trail for admins', async () => {
    stack(fresh())
    show()
    const activity = await screen.findByRole('region', { name: 'Activity' }).catch(() => null)
    const table = activity ?? (await screen.findByRole('table', { name: 'Activity' }))
    expect(await within(table).findByText('Uploaded')).toBeTruthy()
  })

  it('extracted values link every value to its page, and carried months say where they came from', async () => {
    stack(fresh())
    show()
    const closing = await screen.findByRole('button', { name: 'p. 2: Tranche balance, Closing, open source page' })
    expect(closing.getAttribute('title')).toBe('15,019,971.52')
    // Carried months of the roll-forward table come from the July publication
    const trend = screen.getByRole('table', { name: 'Roll-forward by month' })
    const rows = within(trend).getAllByRole('row')
    expect(within(rows[1]).getByText('Aug 2026')).toBeTruthy()
    expect(within(rows[1]).getByRole('button', { name: /^p. 2: / })).toBeTruthy()
    expect(within(rows[2]).getByText('from published Jul 2026')).toBeTruthy()
    await userEvent.click(closing)
    const viewer = await screen.findByRole('dialog', { name: 'Report page 2 of 16' })
    expect(within(viewer).getByText('Raw text: 15,019,971.52')).toBeTruthy()
    await userEvent.click(within(viewer).getByRole('button', { name: 'Next page' }))
    expect(screen.getByRole('dialog', { name: 'Report page 3 of 16' })).toBeTruthy()
  })

  it('opens the page viewer from the finding crop', async () => {
    stack(fresh())
    show()
    await screen.findByRole('article', { name: /Tranche balance roll-forward/ })
    await userEvent.click(await within(card()).findByRole('button', { name: 'Zoom page 2' }))
    const viewer = await screen.findByRole('dialog', { name: 'Report page 2 of 16' })
    expect(within(viewer).getByText('R05 · Tranche balance roll-forward')).toBeTruthy()
  })

  it('shows not found for an unknown upload', async () => {
    mockApi([on('GET', /^\/master/, () => ({ body: [] }))])
    show()
    expect(await screen.findByText('Upload not found')).toBeTruthy()
  })
})

describe('Review report: corrections', () => {
  it('disables use ours / use report on a finding without targets, with the reason', async () => {
    const state = fresh(); state.findings = clone(strideFx)
    stack(state)
    show()
    const first = await screen.findAllByRole('article', { name: /Covenant thresholds equal the master record/ })
    const useOurs = within(first[0]).getByRole('button', { name: 'Use ours for R14' }) as HTMLButtonElement
    expect(useOurs.disabled).toBe(true)
    expect((within(first[0]).getByRole('button', { name: 'Use report for R14' }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(within(first[0]).getByRole('button', { name: 'Acknowledge for R14' }))
    const dlg = await screen.findByRole('dialog')
    expect(within(dlg).getByRole('radio', { name: /Use ours/ })).toHaveProperty('disabled', true)
    expect(within(dlg).getByRole('radio', { name: /Acknowledge/ })).toHaveProperty('checked', true)
    expect(within(dlg).getByText(/names no single value to change/)).toBeTruthy()
    expect(within(dlg).queryByTestId('write-effect')).toBeNull()
  })

  it('use report publishes with no corrections listed', async () => {
    const state = fresh(); state.findings = overridden('use_report')
    stack(state)
    show()
    await screen.findByRole('article', { name: /Tranche balance roll-forward/ })
    expect(within(card()).getByTestId('pending-correction').textContent).toBe('Pending on publish. Nothing changes: the extraction already holds $15,019,971.52 in all 5 fields.')
    await userEvent.click(screen.getByRole('button', { name: 'Publish to partner…' }))
    const dlg = await screen.findByRole('dialog', { name: 'Publish to partner' })
    expect(within(dlg).queryByRole('table')).toBeNull()
    expect(within(dlg).getByText(/No values change/)).toBeTruthy()
    expect(within(dlg).getByText(/R05: the chosen value is already the extracted one/)).toBeTruthy()
  })

  it('shows conflicting_corrections with the field, both values and a link to each card', async () => {
    const state = fresh(); state.findings = overridden()
    stack(state, [on('POST', /\/approve$/, () => ({ status: 409, body: {
      code: 'conflicting_corrections', message: 'resolved findings write different values to the same field',
      conflicts: [{ pointer: '/tranche_balance/closing', values: [15020071.52, 15019971.52], finding_ids: [R05.id, R05.id], rule_ids: ['R05', 'R07'] }],
    } }))])
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'Publish to partner…' }))
    const dlg = await screen.findByRole('dialog', { name: 'Publish to partner' })
    await userEvent.click(within(dlg).getByRole('button', { name: 'Approve and publish' }))
    const alert = await within(dlg).findByRole('alert')
    expect(alert.textContent).toMatch(/different values to the same field/)
    expect(alert.textContent).toMatch(/Tranche balance · closing: \$15,020,071\.52 \(R05\) vs \$15,019,971\.52 \(R07\)/)
    await userEvent.click(within(alert).getAllByRole('button', { name: 'Go to R05' })[0])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(card()))
  })

  it('shows correction_inconsistent with the new block findings and the corrections involved', async () => {
    const state = fresh(); state.findings = overridden()
    stack(state, [on('POST', /\/approve$/, () => ({ status: 409, body: {
      code: 'correction_inconsistent', message: 'the corrected deal raises 1 new block finding(s): R07',
      findings: [{ rule_id: 'R07', message: 'Aging buckets sum to 15019971.52, closing balance is 15020071.52', fields: ['/aging_history/0/bucket_sum'] }],
    } }))])
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'Publish to partner…' }))
    const dlg = await screen.findByRole('dialog', { name: 'Publish to partner' })
    await userEvent.click(within(dlg).getByRole('button', { name: 'Approve and publish' }))
    const alert = await within(dlg).findByRole('alert')
    expect(alert.textContent).toMatch(/nothing was published/)
    expect(within(alert).getByText(/R07 Aging buckets sum to the closing balance/)).toBeTruthy()
    expect(within(alert).getByRole('button', { name: 'Go to R05' })).toBeTruthy()
  })
})

describe('partnersLabel', () => {
  it('names every partner on the visibility list, falling back to partner_slug', () => {
    expect(partnersLabel({ partner_slug: 'investor', partner_slugs: ['investor', 'manager'] })).toBe('the Investor and Manager portals')
    expect(partnersLabel({ partner_slug: 'manager', partner_slugs: ['manager'] })).toBe('the Manager portal')
    expect(partnersLabel({ partner_slug: 'investor' })).toBe('the Investor portal')
  })
})
