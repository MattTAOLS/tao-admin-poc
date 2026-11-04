// @vitest-environment jsdom
// Corrected re-issues, on responses recorded from the review stack: Moneda Aug 2026 published, then Moneda Jul 2026
// re-uploaded with replace=true (R12 names July's publication and says August still carries the earlier July figures).
import { describe, it, expect } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockApi, on, renderPage, setRole, clone, type Call } from './helpers'
import ReviewPage from '../ReviewPage'
import QueuePage from '../QueuePage'
import ReportsLibraryPage from '../ReportsLibraryPage'
import type { Upload } from '../lib/types'
import reissueFx from './fixtures/reissue-upload.json'
import reissuePublishedFx from './fixtures/reissue-upload-published.json'
import reissueFindingsFx from './fixtures/reissue-findings.json'
import reissueResolvedFx from './fixtures/reissue-findings-resolved.json'
import oldFx from './fixtures/reissue-old-upload.json'
import oldReplacedFx from './fixtures/reissue-old-replaced.json'
import extractionFx from './fixtures/extraction-moneda.json'
import deals from './fixtures/deals.json'
import programs from './fixtures/programs.json'

const NEW = reissueFx.id
const OLD = oldFx.id
const master = [on('GET', /^\/master\/deals/, () => ({ body: deals })), on('GET', /^\/master\/programs/, () => ({ body: programs }))]
const R12 = () => (reissueFindingsFx as { rule_id: string }[]).find(f => f.rule_id === 'R12')!

type State = { reissue: Upload; old: Upload; findings: unknown[] }
function stack(state: State, extra: Parameters<typeof mockApi>[0] = []) {
  return mockApi([
    ...extra,
    on('GET', new RegExp(`^/uploads/${NEW}$`), () => ({ body: state.reissue })),
    on('GET', new RegExp(`^/uploads/${OLD}$`), () => ({ body: state.old })),
    on('GET', /^\/uploads\/[^/]+\/findings$/, () => ({ body: state.findings })),
    on('GET', /^\/uploads\/[^/]+\/extraction/, () => ({ body: extractionFx })),
    on('GET', /^\/audit/, () => ({ body: [] })),
    ...master,
  ])
}
const fresh = (): State => ({ reissue: clone(reissueFx) as Upload, old: clone(oldFx) as Upload, findings: clone(reissueFindingsFx) })
const show = (id: string) => renderPage(<ReviewPage />, { path: `/admin/uploads/queue/${id}`, route: '/admin/uploads/queue/:uploadId' })

describe('Corrected re-issue', () => {
  it('shows the banner with the replaced publication, the later-months warning and a link to the replaced report', async () => {
    stack(fresh())
    show(NEW)
    const banner = await screen.findByRole('note', { name: 'Corrected re-issue' })
    expect(banner.textContent).toMatch(/^Corrected re-issue of Moneda Capital Corp\. Jul 2026\. Publishing replaces the report published \d{4}-\d{2}-\d{2} \d{2}:\d{2}\./)
    expect(within(banner).getByTestId('later-periods').textContent).toMatch(/Later published months \(Aug 2026\) still carry the earlier figures for Jul 2026\./)
    expect(within(banner).getByRole('link', { name: 'Open the replaced report' }).getAttribute('href')).toBe(`/admin/uploads/queue/${OLD}`)
  })

  it('makes Accept as replacement the R12 action and sends acknowledge with the reason', async () => {
    const state = fresh()
    const calls = stack(state, [on('POST', /\/override$/, () => { state.findings = clone(reissueResolvedFx); return { body: state.findings } })])
    show(NEW)
    const card = await screen.findByRole('article', { name: /Period not already published/ })
    expect(within(card).queryByRole('button', { name: /^Use ours/ })).toBeNull()
    await userEvent.click(within(card).getByRole('button', { name: 'Accept as replacement for R12' }))
    const dlg = await screen.findByRole('dialog')
    expect(within(dlg).getByRole('radio', { name: /Accept as replacement/ })).toHaveProperty('checked', true)
    expect(within(dlg).queryByText('Ours')).toBeNull()
    await userEvent.type(within(dlg).getByRole('textbox', { name: /Reason/ }), 'servicer sent a corrected July report')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save and re-run rules' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect((calls.find(c => c.method === 'POST') as Call).body).toEqual({ choice: 'acknowledge', reason: 'servicer sent a corrected July report' })
    expect(R12().rule_id).toBe('R12')
  })

  it('publish dialog says it replaces the published report', async () => {
    const state = fresh(); state.findings = clone(reissueResolvedFx)
    stack(state)
    show(NEW)
    await userEvent.click(await screen.findByRole('button', { name: 'Publish to partner…' }))
    const dlg = await screen.findByRole('dialog', { name: 'Publish to partner' })
    expect(within(dlg).getByTestId('publish-replaces').textContent).toMatch(/^Replaces the report published \d{4}-\d{2}-\d{2} \d{2}:\d{2}\. Partners see this re-issue instead; the earlier upload stays in the audit log\. Later months \(Aug 2026\) keep the earlier figures for this month\./)
  })

  it('after publishing, the banner says it replaced the report', async () => {
    const state = fresh(); state.reissue = clone(reissuePublishedFx) as Upload; state.findings = clone(reissueResolvedFx)
    stack(state)
    show(NEW)
    const banner = await screen.findByRole('note', { name: 'Corrected re-issue' })
    expect(banner.textContent).toMatch(/It replaced the report published/)
    expect(banner.textContent).toMatch(/Publishing the re-issue did not change them/)
  })

  it('the replaced upload links to the re-issue', async () => {
    const state = fresh(); state.old = clone(oldReplacedFx) as Upload; state.findings = []
    stack(state)
    show(OLD)
    const note = await screen.findByRole('note', { name: 'Replaced report' })
    expect(within(note).getByRole('link', { name: 'Open the re-issue' }).getAttribute('href')).toBe(`/admin/uploads/queue/${NEW}`)
    expect(screen.getByText(/partners no longer see this report/)).toBeTruthy()
  })

  it('analysts see the banner but no Accept as replacement button', async () => {
    setRole('tao_analyst')
    stack(fresh())
    show(NEW)
    await screen.findByRole('note', { name: 'Corrected re-issue' })
    await screen.findByRole('article', { name: /Period not already published/ })
    expect(screen.queryByRole('button', { name: /Accept as replacement/ })).toBeNull()
  })

  it('tags re-issues in the queue', async () => {
    mockApi([on('GET', /^\/uploads\?status=/, c => ({ body: c.path.includes('needs_review') ? [reissueFx] : [] })), ...master])
    renderPage(<QueuePage />)
    const row = (await screen.findByRole('link', { name: 'Moneda Capital Corp.' })).closest('tr')!
    expect(within(row).getByText('Re-issue')).toBeTruthy()
  })

  it('links replaced and replacing reports in the library', async () => {
    mockApi([on('GET', /^\/uploads\?status=published/, () => ({ body: [reissuePublishedFx, oldReplacedFx] })), ...master])
    renderPage(<ReportsLibraryPage />)
    await screen.findAllByText('Moneda Capital Corp.')
    const replaces = screen.getByRole('link', { name: /Report replaced by this re-issue/ })
    expect(replaces.textContent).toBe('Replaces earlier report')
    expect(replaces.getAttribute('href')).toBe(`/admin/uploads/queue/${OLD}`)
    const replacedBy = screen.getByRole('link', { name: /Re-issue that replaced/ })
    expect(replacedBy.getAttribute('href')).toBe(`/admin/uploads/queue/${NEW}`)
    const oldRow = replacedBy.closest('tr')!
    expect(within(oldRow).getByText('Replaced')).toBeTruthy()
    expect(within(oldRow).queryByRole('link', { name: /Partner view/ })).toBeNull()
  })
})
