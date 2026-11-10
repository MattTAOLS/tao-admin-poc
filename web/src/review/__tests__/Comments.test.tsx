// @vitest-environment jsdom
/** Wave C (D7 b, c): comment threads on findings and values, @mentions, resolve rules, the no-user state, the
 * publish note and recipients, and the comment audit labels. Users are the seeded ones (seed/users.json); comment
 * texts and threads are sample data. */
import { describe, it, expect } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockApi, on, renderPage, setRole, clone, type Call } from './helpers'
import ReviewPage from '../ReviewPage'
import type { Thread, Upload } from '../lib/types'
import { canResolve, carriedLabel, insertMention, mentionIds, mentionMatches, mentionQuery, splitMentions, threadsOn } from '../lib/comments'
import uploadFx from './fixtures/upload-moneda.json'
import findingsFx from './fixtures/findings-moneda.json'
import extractionFx from './fixtures/extraction-moneda.json'
import overrideFx from './fixtures/override-moneda.json'
import deals from './fixtures/deals.json'
import programs from './fixtures/programs.json'
import seedUsers from '../../../../seed/users.json'

const ID = uploadFx.id
const PATH = `/admin/uploads/queue/${ID}`
const R05 = findingsFx[0]
const users = seedUsers.map(u => ({ ...u, status: 'active', created_at: '2026-11-01T00:00:00+00:00' }))
const user = (name: string) => users.find(u => u.name === name)!
const PATEL = user('A. Patel'), OKAFOR = user('R. Okafor'), MOREAU = user('J. Moreau'), LINDQVIST = user('S. Lindqvist')
const author = (u: { id: string; name: string }) => ({ id: u.id, name: u.name })

const T_FINDING = 'aaaaaaaa-0000-4000-8000-000000000001'
const T_VALUE = 'aaaaaaaa-0000-4000-8000-000000000002'
function threadsFx(): Thread[] {
  return [
    {
      id: T_FINDING, upload_id: ID, anchor: { finding_id: R05.id, rule_id: 'R05' }, status: 'open', version: null,
      created_by: author(MOREAU), created_at: '2026-11-05T15:42:00+00:00', resolved_by: null, resolved_at: null,
      comments: [
        { id: 'c1', thread_id: T_FINDING, author: author(MOREAU), body: '@A. Patel the closing is 100.00 off. Page 2 shows the report figure.', mentions: [PATEL.id], created_at: '2026-11-05T15:42:00+00:00', edited_at: null },
        { id: 'c2', thread_id: T_FINDING, author: author(OKAFOR), body: 'Agree, same as last month.', mentions: [], created_at: '2026-11-05T15:51:00+00:00', edited_at: null },
      ],
    },
    {
      id: T_VALUE, upload_id: ID, anchor: { pointer: '/tranche_balance/principal_prepayments' }, status: 'resolved', version: null,
      created_by: author(LINDQVIST), created_at: '2026-11-05T14:31:00+00:00', resolved_by: author(PATEL), resolved_at: '2026-11-05T14:58:00+00:00',
      comments: [{ id: 'c3', thread_id: T_VALUE, author: author(LINDQVIST), body: 'Prepayments match page 2.', mentions: [], created_at: '2026-11-05T14:31:00+00:00', edited_at: null }],
    },
  ]
}

type State = { upload: Upload; findings: unknown[]; threads: Thread[]; me: (typeof users)[number] | null; audit: unknown[] }
const fresh = (me: State['me'] = PATEL): State => ({ upload: clone(uploadFx) as Upload, findings: clone(findingsFx), threads: threadsFx(), me, audit: [] })

function stack(state: State, extra: Parameters<typeof mockApi>[0] = []) {
  return mockApi([
    ...extra,
    on('GET', /^\/me$/, () => ({ body: { user: state.me, role: state.me?.role ?? 'tao_admin', partner_slug: null, display: {} } })),
    on('GET', new RegExp(`^/uploads/${ID}/threads$`), () => (state.me ? { body: state.threads } : { status: 401, body: { code: 'user_required', message: 'sign in' } })),
    on('GET', /^\/users\?partner_slug=tao&status=active$/, () => (state.me?.role === 'tao_admin'
      ? { body: users.filter(u => u.partner_slug === null) } : { status: 403, body: { code: 'company_admin_only', message: 'no' } })),
    on('GET', new RegExp(`^/uploads/${ID}$`), () => ({ body: state.upload })),
    on('GET', new RegExp(`^/uploads/${ID}/findings$`), () => ({ body: state.findings })),
    on('GET', new RegExp(`^/uploads/${ID}/extraction`), () => ({ body: extractionFx })),
    on('GET', /^\/audit\?upload_id=/, () => ({ body: state.audit })),
    on('GET', /^\/master\/deals/, () => ({ body: deals })),
    on('GET', /^\/master\/programs/, () => ({ body: programs })),
  ])
}
const show = () => renderPage(<ReviewPage />, { path: PATH, route: '/admin/uploads/queue/:uploadId' })
const card = () => screen.getByRole('article', { name: /Tranche balance roll-forward/ })
const posts = (calls: Call[], re: RegExp) => calls.filter(c => c.method !== 'GET' && re.test(c.path))

describe('comment helpers', () => {
  it('finds the @query before the caret, matches TAO users and keeps only mentions still in the text', () => {
    expect(mentionQuery('Thanks @R. O', 12)).toEqual({ start: 7, query: 'R. O' })
    expect(mentionQuery('mail a@b', 8)).toBeNull()
    expect(mentionQuery('@x\ny', 4)).toBeNull()
    expect(mentionMatches(users as never, 'lind').map(u => u.name)).toEqual(['S. Lindqvist'])
    // partner users never appear, even when they match
    expect(mentionMatches(users as never, 'example').map(u => u.name)).toEqual(['A. Patel', 'J. Moreau', 'R. Okafor', 'S. Lindqvist'])
    const ins = insertMention('Hi @ok', 3, 6, 'R. Okafor')
    expect(ins).toEqual({ text: 'Hi @R. Okafor ', caret: 14 })
    const picked = new Map([[OKAFOR.id, 'R. Okafor'], [PATEL.id, 'A. Patel']])
    expect(mentionIds('Hi @R. Okafor, see this', picked)).toEqual([OKAFOR.id])
    expect(splitMentions('@A. Patel look', ['A. Patel'])).toEqual([{ text: '@A. Patel', mention: true }, { text: ' look', mention: false }])
  })

  it('resolve rules: any TAO Admin, or the thread starter; an analyst only their own (C10)', () => {
    const t = threadsFx()[0]
    expect(canResolve(t, author(PATEL), 'tao_admin')).toBe(true)
    expect(canResolve(t, author(MOREAU), 'tao_analyst')).toBe(true)
    expect(canResolve(t, author(LINDQVIST), 'tao_analyst')).toBe(false)
    expect(canResolve(t, null, 'tao_admin')).toBe(false)
  })

  it('marks carried-over threads and counts a row with its cells', () => {
    const t = { ...threadsFx()[0], version: 1 }
    expect(carriedLabel(t, ID, 2)).toBe('from version 1')
    expect(carriedLabel(t, ID, 1)).toBeNull()
    expect(carriedLabel({ ...t, upload_id: 'other' }, ID, 1)).toBe('from the replaced report, version 1')
    const cell = { ...threadsFx()[1], anchor: { pointer: '/covenants/2/threshold' } }
    expect(threadsOn([cell], { pointer: '/covenants/2' }, true)).toHaveLength(1)
    expect(threadsOn([cell], { pointer: '/covenants/2' })).toHaveLength(0)
    expect(threadsOn([cell], { pointer: '/covenants/20' }, true)).toHaveLength(0)
  })
})

describe('Comment threads on the Review report', () => {
  it('shows counts on the finding card and the value row, and the header list with open and resolved filters', async () => {
    stack(fresh())
    show()
    await screen.findByRole('article', { name: /Tranche balance roll-forward/ })
    const btn = await within(card()).findByRole('button', { name: /^Comment on R05 .*, 2 comments$/ })
    expect(within(btn).getByTestId('comment-count').textContent).toBe('2')
    expect(screen.getByRole('button', { name: 'Comment on Tranche balance, Principal prepayments, 1 comment, resolved' })).toBeTruthy()
    // Header: every thread on the upload
    await userEvent.click(screen.getByRole('button', { name: 'Comments (2)' }))
    const dlg = await screen.findByRole('dialog', { name: 'Comments (2)' })
    const list = within(dlg).getByRole('list', { name: 'Threads' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    await userEvent.click(within(dlg).getByRole('button', { name: 'Resolved 1' }))
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByText(/Resolved by A\. Patel/)).toBeTruthy()
    await userEvent.click(within(dlg).getByRole('button', { name: 'Open 1' }))
    expect(within(dlg).getByRole('list', { name: 'Threads' }).textContent).toMatch(/R05/)
    // Open goes to the thread itself
    await userEvent.click(within(dlg).getByRole('button', { name: /^Open thread on R05/ }))
    const panel = await screen.findByRole('dialog', { name: /^Comments on R05/ })
    expect(within(panel).getAllByTestId('comment')).toHaveLength(2)
    // The mention in the first comment is shown as a mention
    expect(within(panel).getByText('@A. Patel').tagName).toBe('B')
  }, 40000)

  it('replies with an @mention picked from the autocomplete and sends the user id', async () => {
    const state = fresh()
    const calls = stack(state, [
      on('POST', new RegExp(`^/threads/${T_FINDING}/comments$`), c => ({ status: 201, body: {
        id: 'c9', thread_id: T_FINDING, author: author(PATEL), body: (c.body as { body: string }).body, mentions: (c.body as { mentions: string[] }).mentions,
        created_at: '2026-11-05T16:00:00+00:00', edited_at: null } })),
    ])
    show()
    await screen.findByRole('article', { name: /Tranche balance roll-forward/ })
    await userEvent.click(await within(card()).findByRole('button', { name: /^Comment on R05/ }))
    const panel = await screen.findByRole('dialog', { name: /^Comments on R05/ })
    const box = within(panel).getByRole('combobox', { name: /Reply on R05/ })
    await userEvent.type(box, 'Thanks @')
    // Typing @ lists active TAO users (not me), name order
    let opts = within(panel).getAllByRole('option')
    expect(opts.map(o => o.textContent)).toEqual([
      'J. Moreautao.analyst@example.comTAO Analyst', 'R. Okafortao.admin2@example.comTAO Admin', 'S. Lindqvisttao.analyst2@example.comTAO Analyst'])
    await userEvent.type(box, 'ok')
    opts = within(panel).getAllByRole('option')
    expect(opts).toHaveLength(1)
    await userEvent.keyboard('{Enter}')
    expect((box as HTMLTextAreaElement).value).toBe('Thanks @R. Okafor ')
    expect(within(panel).queryByRole('listbox')).toBeNull()
    await userEvent.type(box, 'please confirm.')
    await userEvent.click(within(panel).getByRole('button', { name: 'Reply' }))
    await waitFor(() => expect(within(panel).getAllByTestId('comment')).toHaveLength(3))
    const sent = posts(calls, /\/comments$/)
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toEqual({ body: 'Thanks @R. Okafor please confirm.', mentions: [OKAFOR.id] })
    // The finding card's count follows
    expect(within(card()).getByRole('button', { name: /^Comment on R05 .*, 3 comments$/ })).toBeTruthy()
  }, 40000)

  it('drops a mention whose name was deleted, and Escape closes the list without closing the panel', async () => {
    const calls = stack(fresh(), [
      on('POST', new RegExp(`^/threads/${T_FINDING}/comments$`), c => ({ status: 201, body: { id: 'c9', thread_id: T_FINDING, author: author(PATEL), body: (c.body as { body: string }).body, mentions: [], created_at: '2026-11-05T16:00:00+00:00', edited_at: null } })),
    ])
    show()
    await screen.findByRole('article', { name: /Tranche balance roll-forward/ })
    await userEvent.click(await within(card()).findByRole('button', { name: /^Comment on R05/ }))
    const panel = await screen.findByRole('dialog', { name: /^Comments on R05/ })
    const box = within(panel).getByRole('combobox', { name: /Reply on R05/ }) as HTMLTextAreaElement
    await userEvent.type(box, '@mor')
    await userEvent.keyboard('{Enter}')
    expect(box.value).toBe('@J. Moreau ')
    await userEvent.clear(box)
    await userEvent.type(box, 'No mention after all @')
    expect(within(panel).getByRole('listbox')).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(within(panel).queryByRole('listbox')).toBeNull()
    expect(screen.getByRole('dialog', { name: /^Comments on R05/ })).toBeTruthy()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(posts(calls, /\/comments$/)).toHaveLength(1))
    expect(posts(calls, /\/comments$/)[0].body).toEqual({ body: 'No mention after all @', mentions: [] })
  }, 40000)

  it('starts a thread on an extracted value', async () => {
    const state = fresh()
    const calls = stack(state, [
      on('POST', new RegExp(`^/uploads/${ID}/threads$`), c => {
        const b = c.body as { anchor: { pointer: string }; body: string; mentions: string[] }
        const t: Thread = { id: 'new-thread', upload_id: ID, anchor: b.anchor, status: 'open', version: null, created_by: author(PATEL), created_at: '2026-11-05T16:00:00+00:00',
          resolved_by: null, resolved_at: null, comments: [{ id: 'c10', thread_id: 'new-thread', author: author(PATEL), body: b.body, mentions: b.mentions, created_at: '2026-11-05T16:00:00+00:00', edited_at: null }] }
        state.threads = [...state.threads, t]
        return { status: 201, body: t }
      }),
    ])
    show()
    const btn = await screen.findByRole('button', { name: 'Comment on Tranche balance, Closing' })
    await userEvent.click(btn)
    const panel = await screen.findByRole('dialog', { name: 'Comments on Tranche balance · closing' })
    expect(within(panel).getByText('No comments here yet.')).toBeTruthy()
    expect(within(panel).getByText(/Resolving a thread does not change the value/)).toBeTruthy()
    await userEvent.type(within(panel).getByRole('combobox', { name: /Comment on Tranche balance/ }), 'Check the closing against page 2.')
    await userEvent.click(within(panel).getByRole('button', { name: 'Comment' }))
    await waitFor(() => expect(within(panel).getAllByTestId('comment')).toHaveLength(1))
    expect(posts(calls, /\/threads$/)[0].body).toEqual({ anchor: { pointer: '/tranche_balance/closing' }, body: 'Check the closing against page 2.', mentions: [] })
    // Now open: the box replies to it
    expect(within(panel).getByRole('combobox', { name: /Reply on/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Comments (3)' })).toBeTruthy()
  }, 40000)

  it('audit M22: a ?thread= link opens that thread once; a comment on another value keeps the panel where it is', async () => {
    const state = fresh()
    stack(state, [
      on('POST', new RegExp(`^/uploads/${ID}/threads$`), c => {
        const b = c.body as { anchor: { pointer: string }; body: string; mentions: string[] }
        const t: Thread = { id: 'new-thread', upload_id: ID, anchor: b.anchor, status: 'open', version: null, created_by: author(PATEL), created_at: '2026-11-05T16:00:00+00:00',
          resolved_by: null, resolved_at: null, comments: [{ id: 'c10', thread_id: 'new-thread', author: author(PATEL), body: b.body, mentions: b.mentions, created_at: '2026-11-05T16:00:00+00:00', edited_at: null }] }
        state.threads = [...state.threads, t]
        return { status: 201, body: t }
      }),
    ])
    renderPage(<ReviewPage />, { path: `${PATH}?thread=${T_FINDING}`, route: '/admin/uploads/queue/:uploadId' })
    const linked = await screen.findByRole('dialog', { name: /^Comments on R05/ }, { timeout: 15000 })
    await userEvent.click(within(linked).getAllByRole('button', { name: 'Close' })[0])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await userEvent.click(screen.getByRole('button', { name: 'Comment on Tranche balance, Closing' }))
    const panel = await screen.findByRole('dialog', { name: 'Comments on Tranche balance · closing' })
    await userEvent.type(within(panel).getByRole('combobox', { name: /Comment on Tranche balance/ }), 'Check closing')
    await userEvent.click(within(panel).getByRole('button', { name: 'Comment' }))
    // The threads reload with the new one; the panel stays on the value the reviewer is commenting on.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Comments (3)' })).toBeTruthy())
    await waitFor(() => expect(within(screen.getByRole('dialog')).getAllByTestId('comment')).toHaveLength(1))
    expect(screen.getByRole('dialog', { name: 'Comments on Tranche balance · closing' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: /^Comments on R05/ })).toBeNull()
    // Closed, it stays closed: nothing re-applies the link.
    await userEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Close' })[0])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  }, 40000)

  it('TAO Admin resolves any thread and reopens it; resolving leaves the finding open', async () => {
    const state = fresh()
    const calls = stack(state, [
      on('POST', new RegExp(`^/threads/${T_FINDING}/resolve$`), () => ({ body: { ...state.threads[0], status: 'resolved', resolved_by: author(PATEL), resolved_at: '2026-11-05T16:05:00+00:00' } })),
      on('POST', new RegExp(`^/threads/${T_FINDING}/reopen$`), () => ({ body: { ...state.threads[0], status: 'open' } })),
    ])
    show()
    await screen.findByRole('article', { name: /Tranche balance roll-forward/ })
    await userEvent.click(await within(card()).findByRole('button', { name: /^Comment on R05/ }))
    const panel = await screen.findByRole('dialog', { name: /^Comments on R05/ })
    expect(within(panel).getByText(/Resolving a thread does not resolve the finding/)).toBeTruthy()
    await userEvent.click(within(panel).getByRole('button', { name: 'Resolve thread' }))
    expect(await within(panel).findByRole('region', { name: /Thread on R05 .*, resolved/ })).toBeTruthy()
    expect(within(panel).getByText(/Resolved by A\. Patel/)).toBeTruthy()
    // The finding itself is untouched: still open, still blocking
    expect(within(card()).getByText('Open')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Publish to partner…' }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(within(panel).getByRole('button', { name: 'Reopen thread' }))
    expect(await within(panel).findByRole('region', { name: /Thread on R05 .*, open/ })).toBeTruthy()
    expect(posts(calls, /\/(resolve|reopen)$/).map(c => c.path.split('/').pop())).toEqual(['resolve', 'reopen'])
  }, 40000)

  it('an analyst resolves the thread they started, not someone else\'s, and edits only their own comment', async () => {
    setRole('tao_analyst')
    const state = fresh(MOREAU)
    state.threads[1] = { ...state.threads[1], status: 'open', resolved_by: null, resolved_at: null }
    const calls = stack(state, [
      on('PATCH', /^\/comments\/c1$/, c => ({ body: { ...state.threads[0].comments[0], body: (c.body as { body: string }).body, edited_at: '2026-11-05T16:10:00+00:00' } })),
    ])
    show()
    await screen.findByRole('article', { name: /Tranche balance roll-forward/ })
    // Analysts get the Comment control even though they have no override buttons
    expect(within(card()).queryByRole('button', { name: /Use ours/ })).toBeNull()
    await userEvent.click(await within(card()).findByRole('button', { name: /^Comment on R05/ }))
    let panel = await screen.findByRole('dialog', { name: /^Comments on R05/ })
    expect(within(panel).getByRole('button', { name: 'Resolve thread' })).toBeTruthy()
    // Edit: only on J. Moreau's own comment, not R. Okafor's
    const edits = within(panel).getAllByRole('button', { name: 'Edit your comment' })
    expect(edits).toHaveLength(1)
    await userEvent.click(edits[0])
    const box = within(panel).getByRole('combobox', { name: 'Edit your comment' }) as HTMLTextAreaElement
    expect(box.value).toMatch(/^@A\. Patel the closing/)
    await userEvent.clear(box)
    await userEvent.type(box, '@A. Patel the closing is 100.00 off (page 2).')
    await userEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(within(panel).getByText(/· edited/)).toBeTruthy())
    // The analyst cannot read /users (C3): the mention the comment had is kept by id
    expect(posts(calls, /^\/comments\/c1$/)[0].body).toEqual({ body: '@A. Patel the closing is 100.00 off (page 2).', mentions: [PATEL.id] })
    await userEvent.click(within(panel).getByRole('button', { name: /^All comments/ }))
    const all = await screen.findByRole('dialog', { name: 'Comments (2)' })
    await userEvent.click(within(all).getByRole('button', { name: /^Open thread on Tranche balance · principal prepayments/ }))
    panel = await screen.findByRole('dialog', { name: /^Comments on Tranche balance · principal prepayments/ })
    expect(within(panel).queryByRole('button', { name: 'Resolve thread' })).toBeNull()
    expect(within(panel).getByText('A TAO Admin or S. Lindqvist, who started it, can resolve this thread.')).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: 'Edit your comment' })).toBeNull()
  }, 40000)

  it('without a signed-in user shows "Sign in as a user to comment" instead of the controls', async () => {
    const state = fresh(null)
    const calls = stack(state)
    show()
    await screen.findByRole('article', { name: /Tranche balance roll-forward/ })
    await userEvent.click(await within(card()).findByRole('button', { name: /^Comment on R05/ }))
    const panel = await screen.findByRole('dialog', { name: /^Comments on R05/ })
    expect(within(panel).getByTestId('no-user').textContent).toBe('Sign in as a user to comment.')
    expect(within(panel).queryByRole('combobox')).toBeNull()
    expect(within(panel).queryByRole('button', { name: /Resolve thread/ })).toBeNull()
    await userEvent.click(within(panel).getByRole('button', { name: /^All comments/ }))
    expect(within(await screen.findByRole('dialog', { name: 'Comments (0)' })).getByTestId('no-user')).toBeTruthy()
    // No user, no /users call
    expect(calls.some(c => c.path.startsWith('/users'))).toBe(false)
  }, 40000)

  it('marks threads carried over from an earlier version', async () => {
    const state = fresh()
    state.upload = { ...state.upload, status: 'published', published_at: '2026-11-05T12:00:00+00:00', published_version: 2, finding_counts: { block: 0, review: 0, note: 0 } }
    state.findings = clone(overrideFx)
    state.threads = state.threads.map(t => ({ ...t, version: 1 }))
    stack(state, [on('GET', /\/edits$/, () => ({ body: [] })), on('GET', /\/corrections$/, () => ({ body: [] }))])
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'Comments (2)' }))
    const dlg = await screen.findByRole('dialog', { name: 'Comments (2)' })
    expect(within(dlg).getAllByTestId('carried').map(x => x.textContent)).toEqual(['from version 1', 'from version 1'])
  }, 40000)
})

describe('Publish dialog: note to partners and who gets notified', () => {
  const recipients = {
    notified: [
      { user_id: users[4].id, name: 'M. Chen', partner_slug: 'investor', channels: ['in_app'] },
      { user_id: users[6].id, name: 'K. Novak', partner_slug: 'manager', channels: ['in_app', 'email'] },
    ],
    not_notified: [
      { user_id: users[5].id, name: 'D. Alvarez', partner_slug: 'investor', reason: 'not_subscribed' },
      { user_id: users[7].id, name: 'L. Haddad', partner_slug: 'manager', reason: 'deactivated' },
    ],
  }
  const ready = () => { const s = fresh(); s.findings = clone(overrideFx); s.upload = { ...s.upload, finding_counts: { block: 0, review: 0, note: 0 } }; return s }

  it('lists the recipients and the not-notified reasons, and sends the note as the approve body', async () => {
    const state = ready()
    const calls = stack(state, [
      on('GET', new RegExp(`^/uploads/${ID}/recipients$`), () => ({ body: recipients })),
      on('POST', /\/approve$/, () => (state.upload = { ...state.upload, status: 'published', published_at: '2026-11-05T16:20:00+00:00' }, { body: state.upload })),
    ])
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'Publish to partner…' }))
    const dlg = await screen.findByRole('dialog', { name: 'Publish to partner' })
    // The existing content stays
    expect(within(dlg).getByText(/1 finding resolved with a reason/)).toBeTruthy()
    const who = within(dlg).getByRole('region', { name: 'Who gets notified' })
    const table = await within(who).findByRole('table', { name: 'Notified' })
    expect(within(table).getAllByRole('row').slice(1).map(r => r.textContent)).toEqual(['InvestorM. ChenIn-app', 'ManagerK. NovakIn-app · Email (coming later)'])
    expect(within(who).getByText(/2 people at 2 partners/)).toBeTruthy()
    const not = within(who).getByRole('list', { name: 'Not notified' })
    expect(within(not).getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'D. Alvarez · Investor: does not receive this deal.', 'L. Haddad · Manager: deactivated.'])
    expect(within(who).getByText('The 2 internal comment threads on this upload are not sent.')).toBeTruthy()
    expect(within(who).queryByTestId('notifications-off')).toBeNull()
    const note = within(dlg).getByRole('textbox', { name: /Note to partners/ }) as HTMLTextAreaElement
    expect(note.maxLength).toBe(2000)
    await userEvent.type(note, '  Opening balance includes new tranche 52.  ')
    expect(within(dlg).getByTestId('note-count').textContent).toBe('44 / 2,000')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Approve and publish' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(posts(calls, /\/approve$/)[0].body).toEqual({ note_to_partners: 'Opening balance includes new tranche 52.' })
  }, 40000)

  it('says plainly when partner notifications are off, and an empty note is sent as null', async () => {
    const state = ready()
    const off = { notified: [], not_notified: recipients.notified.map(r => ({ user_id: r.user_id, name: r.name, partner_slug: r.partner_slug, reason: 'partner_notifications_off' })) }
    const calls = stack(state, [
      on('GET', new RegExp(`^/uploads/${ID}/recipients$`), () => ({ body: off })),
      on('POST', /\/approve$/, () => ({ body: { ...state.upload, status: 'published' } })),
    ])
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'Publish to partner…' }))
    const dlg = await screen.findByRole('dialog', { name: 'Publish to partner' })
    expect((await within(dlg).findByTestId('notifications-off')).textContent).toMatch(/^Partner notifications are off, so no partner is notified\./)
    expect(within(dlg).queryByRole('table', { name: 'Notified' })).toBeNull()
    expect(within(within(dlg).getByRole('list', { name: 'Not notified' })).getAllByRole('listitem')[0].textContent).toBe('M. Chen · Investor: partner notifications are off.')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Approve and publish' }))
    await waitFor(() => expect(posts(calls, /\/approve$/)).toHaveLength(1))
    expect(posts(calls, /\/approve$/)[0].body).toEqual({ note_to_partners: null })
  }, 40000)
})

describe('Activity: comment entries', () => {
  it('labels comment, comment_edit, thread_resolve and thread_reopen', async () => {
    const state = fresh()
    const base = { actor_role: 'tao_analyst', upload_id: ID, reason: null }
    state.audit = [
      { ...base, id: 'a1', at: '2026-11-05T15:42:00+00:00', actor_label: 'J. Moreau', action: 'comment', detail: { thread_id: T_FINDING, comment_id: 'c1', anchor: { finding_id: R05.id, rule_id: 'R05' }, body: 'Closing is 100.00 off.', mentions: [PATEL.id] } },
      { ...base, id: 'a2', at: '2026-11-05T15:50:00+00:00', actor_label: 'J. Moreau', action: 'comment_edit', detail: { thread_id: T_FINDING, comment_id: 'c1', before: 'Closing is off.', after: 'Closing is 100.00 off.' } },
      { ...base, id: 'a3', at: '2026-11-05T15:58:00+00:00', actor_role: 'tao_admin', actor_label: 'A. Patel', action: 'thread_resolve', detail: { thread_id: T_FINDING } },
      { ...base, id: 'a4', at: '2026-11-05T16:02:00+00:00', actor_role: 'tao_admin', actor_label: 'A. Patel', action: 'thread_reopen', detail: { thread_id: T_FINDING } },
    ]
    stack(state)
    show()
    const act = await screen.findByRole('region', { name: 'Activity' })
    await within(act).findByText('Comment added')
    for (const t of ['Comment edited', 'Thread resolved', 'Thread reopened']) expect(within(act).getByText(t)).toBeTruthy()
    expect(act.textContent).toMatch(/R05 thread · “Closing is 100\.00 off\.” · 1 mention/)
    expect(act.textContent).toMatch(/“Closing is off\.” → “Closing is 100\.00 off\.”/)
  }, 40000)
})
