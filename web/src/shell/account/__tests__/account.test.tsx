// @vitest-environment jsdom
import '@/design/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { App } from '@/shell/App'
import { KEY, USER_KEY } from '@/shell/roles'
import { sessionStore } from '@/shell/session'
import { headerStore } from '@/shell/header'
import { ADMIN_PAGES, PARTNER_PAGES } from '@/shell/pages'
import { mockApi, ME, PARTNER_ME } from '@/shell/__tests__/mockApi'
import { formatAmount, formatDate } from '../common'

function Where() { const l = useLocation(); return <output data-testid="where">{l.pathname + l.search}</output> }
function signIn(role: string, id: string, path: string) {
  localStorage.setItem(KEY, role); localStorage.setItem(USER_KEY, id); sessionStore.reset()
  return render(<MemoryRouter initialEntries={[path]}><App /><Where /></MemoryRouter>)
}
const TAO_ID = '00000000-0000-4000-8000-000000000001'
const PARTNER_ID = '00000000-0000-4000-8000-000000000006'
const NOW = new Date().toISOString()
const UPLOAD = '11111111-1111-4111-8111-111111111111'

const TAO_ITEMS = [
  { id: 'n1', kind: 'mention', title: 'J. Moreau mentioned you on Moneda Capital Corp. · Aug 2026', body: 'Can you check R05?', link: `/admin/uploads/queue/${UPLOAD}?thread=t1`, created_at: NOW, read_at: null, collection_period: '2026-08' },
  { id: 'n2', kind: 'correction_published', title: 'Correction published: Stride Capital · Jul 2026', body: null, link: '/admin/reports', created_at: '2026-11-03T21:20:00Z', read_at: '2026-11-03T22:00:00Z', version: 2,
    changes: [{ pointer: '/interest', label: 'Interest', old_value: 1290661.69, new_value: 1371370.08 }], note_from_tao: null },
]
const PARTNER_ITEMS = [
  { id: 'p1', kind: 'report_published', title: 'New report published: F-PIL 2.0 · Moneda Capital Corp. · Aug 2026', link: '/investor/portfolio', created_at: NOW, read_at: null, note_from_tao: 'No other changes from July.' },
  { id: 'p2', kind: 'report_published', title: 'New report published: F-PIL 2.0 · Stride Capital · Aug 2026', link: '/investor/portfolio', created_at: '2026-10-30T19:02:00Z', read_at: '2026-10-30T20:00:00Z', note_from_tao: null },
  { id: 'p3', kind: 'correction_published', title: 'Correction published: F-PIL 2.0 · Stride Capital · Jul 2026 (version 2)', link: '/investor/portfolio', created_at: '2026-11-03T21:21:00Z', read_at: null,
    note_from_tao: 'Interest now includes prepayment penalties.', changes: [{ label: 'Interest', old_value: 1290661.69, new_value: 1371370.08 }], version: 2 },
]
const UNREAD = { total: 1, mentions: 1, reports: 0, system: 0 }
const PREFS = [
  { kind: 'mention', in_app: true, digest: 'instant', required: false },
  { kind: 'report_published', in_app: true, digest: 'daily', required: false },
  { kind: 'correction_published', in_app: true, digest: 'instant', required: true },
  { kind: 'covenant_changed', in_app: true, digest: 'instant', required: true },
]

beforeEach(() => { localStorage.clear(); headerStore.clear() })
afterEach(() => { vi.unstubAllGlobals() })

describe('registration', () => {
  it('registers Notifications and Profile as built shell pages in both shells', () => {
    for (const p of ['/admin/notifications', '/admin/settings/profile']) expect(typeof ADMIN_PAGES.find(x => x.path === p)?.load).toBe('function')
    for (const p of ['/notifications', '/settings/profile']) expect(PARTNER_PAGES.find(x => x.path === p)?.built).toBe(true)
  })
})

describe('Notifications page (D7 a)', () => {
  it('lists the TAO tabs, marks unread rows with a dot and the word, shows corrections old → new and email as coming later', async () => {
    const calls = mockApi({ 'GET /me': ME(), 'GET /notifications/unread-count': UNREAD, 'GET /notifications': TAO_ITEMS })
    signIn('tao_admin', TAO_ID, '/admin/notifications')
    const rows = await screen.findAllByTestId('notification', {}, { timeout: 20_000 })  // first lazy load: cold compile
    expect(screen.getAllByRole('tab').map(t => t.textContent?.replace(/\d.*$/, ''))).toEqual(['All', 'Mentions', 'Reports', 'System'])
    expect(within(rows[0]).getByText('Unread')).toBeTruthy()
    expect(rows[0].className).toContain('is-unread')
    expect(within(rows[1]).getByText('Read')).toBeTruthy()
    expect(within(rows[1]).getByRole('list', { name: 'Changed values' }).textContent).toBe('Interest 1,290,661.69 → 1,371,370.08')
    expect(screen.getByText('Coming later')).toBeTruthy()
    expect(calls.find(c => c.path.startsWith('/notifications?'))!.path).toContain('tab=all')
    expect(calls.find(c => c.path.startsWith('/notifications?'))!.headers['X-User']).toBe(TAO_ID)
  })
  it('opening a row marks it read and goes to its link', async () => {
    const calls = mockApi({ 'GET /me': ME(), 'GET /notifications/unread-count': UNREAD, 'GET /notifications': TAO_ITEMS, 'POST /notifications/n1/read': { ...TAO_ITEMS[0], read_at: NOW } })
    signIn('tao_admin', TAO_ID, '/admin/notifications')
    await userEvent.click(await screen.findByRole('button', { name: /^Open thread: J. Moreau mentioned you/ }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(`/admin/uploads/queue/${UPLOAD}?thread=t1`))
    expect(calls.some(c => c.method === 'POST' && c.path === '/notifications/n1/read')).toBe(true)
  })
  it('a read row opens without another read call; tabs and Unread only change the query; Mark all read uses the tab', async () => {
    const calls = mockApi({ 'GET /me': ME(), 'GET /notifications/unread-count': UNREAD, 'GET /notifications': TAO_ITEMS, 'POST /notifications/read-all': { marked: 1 } })
    signIn('tao_admin', TAO_ID, '/admin/notifications')
    await screen.findAllByTestId('notification')
    await userEvent.click(screen.getByRole('tab', { name: /^Mentions/ }))
    await waitFor(() => expect(calls.some(c => c.path.includes('tab=mentions'))).toBe(true))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Unread only' }))
    await waitFor(() => expect(calls.some(c => c.path.includes('tab=mentions&unread=true'))).toBe(true))
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all read' }))
    await waitFor(() => expect(calls.some(c => c.method === 'POST' && c.path === '/notifications/read-all?tab=mentions')).toBe(true))
    await userEvent.click((await screen.findAllByRole('button', { name: /^Open report: Correction published/ }))[0])
    expect(calls.some(c => c.path === '/notifications/n2/read')).toBe(false)
  })
  it('asks a role-only user to sign in as a user', async () => {
    const calls = mockApi({})
    localStorage.setItem(KEY, 'tao_analyst'); sessionStore.reset()
    render(<MemoryRouter initialEntries={['/admin/notifications']}><App /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Sign in as a user' })).toBeTruthy()
    expect(screen.getByText(/stands in for real sign-in/)).toBeTruthy()
    // Only the role-only /me (wave D, for Me.features), without X-User; nothing person-only is read.
    expect(calls.every(c => c.path === '/me' && !c.headers['X-User'])).toBe(true)
  })
})

describe('Notifications page, partner (D7 d)', () => {
  it('shows Note from TAO as typed, No note from TAO, the changes, and no Mentions tab', async () => {
    mockApi({ 'GET /me': PARTNER_ME(), 'GET /notifications/unread-count': { total: 2, mentions: 0, reports: 2, system: 0 }, 'GET /notifications': PARTNER_ITEMS })
    signIn('investor_viewer', PARTNER_ID, '/investor/notifications')
    const rows = await screen.findAllByTestId('notification')
    expect(screen.getAllByRole('tab').map(t => t.textContent?.replace(/\d.*$/, ''))).toEqual(['All', 'Reports', 'System'])
    expect(within(rows[0]).getByText('Note from TAO')).toBeTruthy()
    expect(within(rows[0]).getByText('No other changes from July.')).toBeTruthy()
    const stride = rows.find(r => r.textContent?.includes('Stride Capital · Aug 2026'))!
    expect(within(stride).getByText('No note from TAO.')).toBeTruthy()
    const corr = rows.find(r => r.textContent?.includes('version 2'))!
    expect(within(corr).getByText('Interest now includes prepayment penalties.')).toBeTruthy()
    expect(within(corr).getByRole('list', { name: 'Changed values' }).textContent).toContain('1,290,661.69 → 1,371,370.08')
    expect(screen.getByRole('link', { name: /Profile › Notification preferences/ }).getAttribute('href')).toBe('/investor/settings/profile')
    expect(screen.getByText(/Your Company Admin sets them in Team members/)).toBeTruthy()
  })
})

describe('Profile page (D9)', () => {
  const routes = (over: Record<string, unknown> = {}) => ({
    'GET /me': ME(), 'GET /notifications/unread-count': UNREAD, 'GET /me/notification-prefs': PREFS,
    'GET /audit': [{ id: 'a1', at: '2026-11-05T14:14:00Z', actor_role: 'tao_admin', action: 'publish', upload_id: UPLOAD, deal_name: 'Moneda Capital Corp.', collection_period: '2026-08' }],
    'PATCH /me': (c: { body: unknown }) => ({ body: ME({ user: { ...ME().user, name: (c.body as { name?: string }).name ?? 'A. Patel' } }) }),
    'PUT /me/notification-prefs': (c: { body: unknown }) => ({ body: (c.body as typeof PREFS).map(p => ({ ...p, required: ['correction_published', 'covenant_changed'].includes(p.kind) })) }),
    ...over,
  })
  it('TAO: details with read-only email and role, name saved with PATCH /me, and the sidebar card follows', async () => {
    const calls = mockApi(routes())
    signIn('tao_admin', TAO_ID, '/admin/settings/profile')
    const name = await screen.findByRole('textbox', { name: /Full name/ }, { timeout: 20_000 })  // first lazy load of the page: cold compile
    expect(screen.getByText('tao.admin@example.com')).toBeTruthy()
    expect(screen.getByText(/managed by your admin: a TAO Admin in User management/)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Report subscriptions' })).toBeNull()
    await userEvent.clear(name); await userEvent.type(name, 'A. Patel-Ng')
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(calls.find(c => c.method === 'PATCH')?.body).toEqual({ name: 'A. Patel-Ng' }))
    await waitFor(() => expect(screen.getByTestId('role-switcher').textContent).toContain('A. Patel-Ng'))
  })
  it('display: sends only the changed fields and previews the formats', async () => {
    const calls = mockApi(routes())
    signIn('tao_admin', TAO_ID, '/admin/settings/profile')
    const df = await screen.findByRole('combobox', { name: 'Date format' })
    await userEvent.selectOptions(df, 'YYYY-MM-DD')
    expect(screen.getByText('Example: 2026-08-07')).toBeTruthy()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Number format' }), '1 234,56')
    expect(screen.getByText('Example: F-PIL 2.0 program limit 150 000 000,00')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Save display' }))
    await waitFor(() => expect(calls.find(c => c.method === 'PATCH')?.body).toEqual({ date_format: 'YYYY-MM-DD', number_format: '1 234,56' }))
  })
  it('notification grid: required kinds locked, email coming later, saved with PUT; Reset to defaults sends an empty list', async () => {
    const calls = mockApi(routes())
    signIn('tao_admin', TAO_ID, '/admin/settings/profile')
    const locked = await screen.findByRole('checkbox', { name: /Covenant status changed.*always on/ })
    expect((locked as HTMLInputElement).disabled).toBe(true)
    expect(screen.getAllByText('Coming later').length).toBe(PREFS.length)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Report published: in the portal' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save preferences' }))
    await waitFor(() => expect(calls.find(c => c.method === 'PUT')).toBeTruthy())
    const sent = calls.find(c => c.method === 'PUT')!.body as typeof PREFS
    expect(sent.find(p => p.kind === 'report_published')).toEqual({ kind: 'report_published', in_app: false, digest: 'daily' })
    await userEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }))
    await waitFor(() => expect(calls.filter(c => c.method === 'PUT').at(-1)!.body).toEqual([]))
  })
  it('My activity reads the Reports audit for this user and links to the Audit log; Security says there is no real sign-in', async () => {
    const calls = mockApi(routes())
    signIn('tao_admin', TAO_ID, '/admin/settings/profile')
    expect(await screen.findByText('Moneda Capital Corp. · Aug 2026')).toBeTruthy()
    expect(calls.find(c => c.path.startsWith('/audit'))!.path).toBe(`/audit?actor_user_id=${TAO_ID}&scope=reports&limit=10`)
    expect(screen.getByRole('link', { name: 'Open in Audit log' }).getAttribute('href')).toBe('/admin/settings/users/audit')
    expect(screen.getByText(/The POC has no real sign-in\./)).toBeTruthy()
  })
  it('partner: read-only report subscriptions with program and deal names, no Audit log link', async () => {
    const calls = mockApi({
      ...routes(), 'GET /me': PARTNER_ME(), 'GET /audit': [],
      [`GET /users/${PARTNER_ID}/subscriptions`]: [
        { program_slug: 'move-trust', deal_slug: null, channels: ['in_app'] },
        { program_slug: 'f-pil-2-0', deal_slug: 'f-pil-2-0-moneda-capital-corp', channels: ['in_app'] },
      ],
      'GET /published/portfolio': { partner: 'investor', programs: [
        { program: { slug: 'move-trust', name: 'MOVE Trust' }, deals: Array.from({ length: 9 }, (_, i) => ({ deal_slug: 'm' + i, deal_name: 'M' + i })) },
        { program: { slug: 'f-pil-2-0', name: 'F-PIL 2.0' }, deals: [{ deal_slug: 'f-pil-2-0-moneda-capital-corp', deal_name: 'Moneda Capital Corp.' }] },
      ] },
    })
    signIn('investor_viewer', PARTNER_ID, '/investor/settings/profile')
    const card = (await screen.findByRole('heading', { name: 'Report subscriptions' })).closest('section')!
    await waitFor(() => expect(within(card).getByText('MOVE Trust')).toBeTruthy())
    expect(within(card).getByText('All deals (9), including new ones')).toBeTruthy()
    expect(within(card).getByText('Moneda Capital Corp.')).toBeTruthy()
    expect(within(card).getByText('Read-only')).toBeTruthy()
    expect(within(card).queryByRole('button')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Open in Audit log' })).toBeNull()
    expect(calls.find(c => c.path.startsWith('/audit'))!.path).toBe(`/audit?actor_user_id=${PARTNER_ID}&limit=10`)
    expect(screen.getByText(/your Company Admin in Team members, or a TAO Admin in User management/)).toBeTruthy()
  })
  it('asks a role-only user to sign in, and still shows the security card', async () => {
    mockApi({})
    localStorage.setItem(KEY, 'manager_viewer'); sessionStore.reset()
    render(<MemoryRouter initialEntries={['/manager/settings/profile']}><App /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Sign in as a user' })).toBeTruthy()
    const note = screen.getByRole('heading', { name: 'Sign in as a user' }).closest('section')!
    expect(within(note).getByText('Manager · Viewer')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Security' })).toBeTruthy()
  })
})

describe('display formats', () => {
  it('formats dates in the zone and format chosen, and amounts in either number format', () => {
    expect(formatDate('2026-08-07T16:00:00Z')).toBe('7 Aug 2026')
    expect(formatDate('2026-08-07T16:00:00Z', { date_format: 'MM/DD/YYYY' })).toBe('08/07/2026')
    expect(formatDate('2026-08-08T02:00:00Z', { time_zone: 'America/Vancouver', date_format: 'DD/MM/YYYY' })).toBe('07/08/2026')
    expect(formatAmount(1916709163)).toBe('1,916,709,163.00')
    expect(formatAmount(1916709163, '1 234,56')).toBe('1 916 709 163,00')
  })
})

describe('company alerts (wave D)', () => {
  const NEW_KINDS = [
    { id: 'c1', kind: 'adverse_media', title: 'Adverse media: TLFC · litigation', link: '/admin/companies/tlfc#adverse', created_at: NOW, read_at: null },
    { id: 'c2', kind: 'negative_news', title: 'Negative news: Essex Lease Financial Corp.', link: '/admin/companies/essex#news', created_at: NOW, read_at: null },
    { id: 'c3', kind: 'report_late', title: 'Report late: Stride Capital · Oct 2026', link: '/admin/portfolio/f-pil-2-0/deals/f-pil-2-0-stride-capital', created_at: NOW, read_at: null, collection_period: '2026-10' },
  ]
  it('labels the three kinds, puts them under Reports and opens each notification link', async () => {
    const { KIND, KIND_TAB } = await import('../NotificationsPage')
    expect([KIND.adverse_media.label, KIND.negative_news.label, KIND.report_late.label]).toEqual(['Adverse media', 'Negative news', 'Report late'])
    for (const k of ['adverse_media', 'negative_news', 'report_late'] as const) { expect(KIND_TAB[k]).toBe('reports'); expect(typeof KIND[k].icon).toBe('function') }
    const calls = mockApi({ 'GET /me': ME(), 'GET /notifications/unread-count': { total: 3, mentions: 0, reports: 3, system: 0 }, 'GET /notifications': NEW_KINDS })
    signIn('tao_admin', TAO_ID, '/admin/notifications?tab=reports')
    const rows = await screen.findAllByTestId('notification')
    expect(rows.map(r => within(r).getByText(/^(Adverse media|Negative news|Report late)$/).textContent)).toEqual(['Adverse media', 'Negative news', 'Report late'])
    expect(calls.some(c => c.path.startsWith('/notifications?tab=reports'))).toBe(true)
    await userEvent.click(within(rows[0]).getByRole('button', { name: 'Open adverse media: Adverse media: TLFC · litigation' }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/admin/companies/tlfc'))
    expect(calls.some(c => c.method === 'POST' && c.path === '/notifications/c1/read')).toBe(true)
  })
  it('preferences: the three kinds with help text for TAO; report_late never offered to a partner', async () => {
    const WAVE_D = [...PREFS, ...['adverse_media', 'negative_news', 'report_late'].map(kind => ({ kind, in_app: true, digest: 'daily', required: false }))]
    mockApi({ 'GET /me': ME(), 'GET /notifications/unread-count': UNREAD, 'GET /me/notification-prefs': WAVE_D, 'GET /audit': [] })
    const { unmount } = signIn('tao_admin', TAO_ID, '/admin/settings/profile')
    expect(await screen.findByRole('checkbox', { name: 'Adverse media: in the portal' })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Negative news: in the portal' })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Report late: in the portal' })).toBeTruthy()
    expect(screen.getByText(/no report 5 business days after it was due/)).toBeTruthy()
    expect(screen.getByText(/A new adverse media item .* on a company you follow\./)).toBeTruthy()
    unmount(); localStorage.clear(); headerStore.clear()
    mockApi({ 'GET /me': PARTNER_ME(), 'GET /notifications/unread-count': UNREAD, 'GET /me/notification-prefs': WAVE_D, 'GET /audit': [], [`GET /users/${PARTNER_ID}/subscriptions`]: [], 'GET /published/portfolio': { partner: 'investor', programs: [] } })
    signIn('investor_viewer', PARTNER_ID, '/investor/settings/profile')
    expect(await screen.findByRole('checkbox', { name: 'Adverse media: in the portal' })).toBeTruthy()
    expect(screen.getByText('An adverse media item on a company you follow, once TAO has reviewed it.')).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: 'Report late: in the portal' })).toBeNull()
  })
})
