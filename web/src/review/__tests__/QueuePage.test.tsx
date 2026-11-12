// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router-dom'
import { mockApi, on, renderPage, setRole, clone } from './helpers'
import QueuePage from '../QueuePage'
import queue from './fixtures/queue.json'
import deals from './fixtures/deals.json'
import programs from './fixtures/programs.json'
import type { Upload } from '../lib/types'

const master = [on('GET', /^\/master\/deals/, () => ({ body: deals })), on('GET', /^\/master\/programs/, () => ({ body: programs }))]

function Where() { return <output data-testid="where">{useLocation().pathname}</output> }

describe('Approval queue', () => {
  it('lists needs_review uploads oldest first with deal names and severity pills', async () => {
    const calls = mockApi([
      on('GET', /^\/uploads\?status=needs_review/, () => ({ body: queue })),
      on('GET', /^\/uploads\?status=approved/, () => ({ body: [] })),
      ...master,
    ])
    renderPage(<QueuePage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Approval queue' })).toBeTruthy()
    const moneda = await screen.findByRole('link', { name: 'Moneda Capital Corp.' })
    const rows = screen.getAllByRole('row').slice(1)
    // Moneda was uploaded before Stride in the recorded queue, so it is first even though the API listed Stride first.
    expect(within(rows[0]).getByRole('link').textContent).toBe('Moneda Capital Corp.')
    expect(within(rows[1]).getByRole('link').textContent).toBe('Stride Capital')
    expect(within(rows[0]).getByText('Block')).toBeTruthy()
    expect(within(rows[1]).getByText('Review')).toBeTruthy()
    expect(within(rows[0]).getByText('Aug 2026')).toBeTruthy()
    expect(within(rows[0]).getByText('reporting Jul 2026')).toBeTruthy()
    expect(moneda.getAttribute('href')).toBe(`/admin/uploads/queue/${queue[1].id}`)
    expect(calls.every(c => c.headers['X-Role'] === 'tao_admin')).toBe(true)
  })

  it('opens the review page on row activation', async () => {
    mockApi([on('GET', /^\/uploads\?status=/, c => ({ body: c.path.includes('needs_review') ? queue : [] })), ...master])
    renderPage(<><QueuePage /><Where /></>)
    await screen.findByText('Stride Capital')
    const rows = screen.getAllByRole('row')
    await userEvent.click(within(rows[2]).getByText('Stride Capital').closest('tr')!)
    expect(screen.getByTestId('where').textContent).toBe(`/admin/uploads/queue/${queue[0].id}`)
  })

  it('marks held reports with an On hold pill, the note and who saved it, and filters to them', async () => {
    const long = 'Waiting for the servicer to confirm the tranche 52 opening balance before this goes to the partners.'
    const held = clone(queue) as Upload[]
    // Stride (second by upload time) is on hold; Moneda is not.
    held[0] = { ...held[0], hold: { at: '2026-11-11T15:04:00+00:00', by: { id: '00000000-0000-4000-8000-000000000001', name: 'A. Patel' }, by_label: 'A. Patel', note: long } }
    held[1] = { ...held[1], hold: null }
    mockApi([on('GET', /^\/uploads\?status=/, c => ({ body: c.path.includes('needs_review') ? held : [] })), ...master])
    renderPage(<QueuePage />)
    await screen.findByText('Stride Capital')
    // Held reports stay in the default list, in the same order.
    let rows = screen.getAllByRole('row').slice(1)
    expect(rows.map(r => within(r).getByRole('link').textContent)).toEqual(['Moneda Capital Corp.', 'Stride Capital'])
    expect(within(rows[0]).queryByText('On hold')).toBeNull()
    expect(within(rows[1]).getByText('Needs review')).toBeTruthy()
    expect(within(rows[1]).getByText('On hold')).toBeTruthy()
    const note = within(rows[1]).getByTestId('hold-note')
    expect(note.getAttribute('title')).toBe(long)
    // The whole note is in the cell; the column clips it with CSS (two lines), never by a character count.
    expect(note.textContent).toBe(`“${long}”`)
    expect(note.className).toContain('rv-holdnote')
    expect(within(rows[1]).getByTestId('hold-by').textContent).toMatch(/^A\. Patel, \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)

    const filter = screen.getByRole('group', { name: 'Show reports' })
    expect(within(filter).getAllByRole('button').map(b => `${b.textContent}:${b.getAttribute('aria-pressed')}`)).toEqual(['All 2:true', 'On hold 1:false'])
    await userEvent.click(within(filter).getByRole('button', { name: 'On hold 1' }))
    rows = screen.getAllByRole('row').slice(1)
    expect(rows.map(r => within(r).getByRole('link').textContent)).toEqual(['Stride Capital'])
    await userEvent.click(within(filter).getByRole('button', { name: 'All 2' }))
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(2)
  })

  it('a hold without a note shows who and when; the On hold filter says so when nothing is held', async () => {
    const held = clone(queue) as Upload[]
    held[0] = { ...held[0], hold: { at: '2026-11-11T15:04:00+00:00', by: null, by_label: 'TAO Admin', note: null } }
    mockApi([on('GET', /^\/uploads\?status=/, c => ({ body: c.path.includes('needs_review') ? held : [] })), ...master])
    const a = renderPage(<QueuePage />)
    const row = (await screen.findByText('Stride Capital')).closest('tr')!
    expect(within(row).queryByTestId('hold-note')).toBeNull()
    expect(within(row).getByTestId('hold-by').textContent).toMatch(/^TAO Admin, /)
    a.unmount()

    mockApi([on('GET', /^\/uploads\?status=/, c => ({ body: c.path.includes('needs_review') ? queue : [] })), ...master])
    renderPage(<QueuePage />)
    await screen.findByText('Stride Capital')
    await userEvent.click(screen.getByRole('button', { name: 'On hold 0' }))
    expect(await screen.findByText('Nothing on hold')).toBeTruthy()
  })

  it('shows the empty state', async () => {
    mockApi([on('GET', /^\/uploads/, () => ({ body: [] })), ...master])
    renderPage(<QueuePage />)
    expect(await screen.findByText('Nothing waiting for review')).toBeTruthy()
  })

  it('shows an error with retry', async () => {
    let fail = true
    mockApi([on('GET', /^\/uploads\?status=needs_review/, () => (fail ? { status: 500, body: { code: 'boom', message: 'Server error' } } : { body: clone(queue) })),
      on('GET', /^\/uploads\?status=approved/, () => ({ body: [] })), ...master])
    renderPage(<QueuePage />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getAllByRole('row').length).toBe(3))
  })

  it('does not fetch intake routes for partner roles', async () => {
    setRole('investor_admin')
    const calls = mockApi([])
    renderPage(<QueuePage />)
    expect(screen.getByText('You don’t have access')).toBeTruthy()
    expect(calls).toHaveLength(0)
  })

  it('analysts can read the queue', async () => {
    setRole('tao_analyst')
    mockApi([on('GET', /^\/uploads\?status=/, c => ({ body: c.path.includes('needs_review') ? queue : [] })), ...master])
    renderPage(<QueuePage />)
    expect(await screen.findByText('Moneda Capital Corp.')).toBeTruthy()
  })
})
