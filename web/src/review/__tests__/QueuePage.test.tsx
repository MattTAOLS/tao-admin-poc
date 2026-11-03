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
