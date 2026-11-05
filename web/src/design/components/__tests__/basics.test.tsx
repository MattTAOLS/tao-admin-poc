// @vitest-environment jsdom
import '../../test-utils'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button, StatusPill, UploadStatusPill, SeverityPill, CovenantPill, Card, KpiTile, SkeletonBlock, Breadcrumb, PageHeader, StatePanel, UPLOAD_STATUS } from '..'

describe('Button', () => {
  it('is a type=button by default and fires onClick from keyboard', async () => {
    const onClick = vi.fn()
    render(<Button variant="primary" onClick={onClick}>Publish</Button>)
    const b = screen.getByRole('button', { name: 'Publish' })
    expect(b).toHaveProperty('type', 'button')
    expect(b.className).toContain('ds-btn--primary')
    b.focus(); await userEvent.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledTimes(1)
  })
  it('loading blocks clicks and sets aria-busy', async () => {
    const onClick = vi.fn()
    render(<Button variant="danger" loading onClick={onClick}>Reject</Button>)
    const b = screen.getByRole('button', { name: 'Reject' })
    expect(b.getAttribute('aria-busy')).toBe('true')
    expect((b as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(b)
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('StatusPill', () => {
  it('always renders a dot and a word', () => {
    const { container } = render(<StatusPill tone="warn">WATCH</StatusPill>)
    expect(container.querySelector('.ds-pill__dot')).not.toBeNull()
    expect(screen.getByText('WATCH')).toBeTruthy()
  })
  it('maps every upload status in the contract to a word', () => {
    for (const s of Object.keys(UPLOAD_STATUS) as (keyof typeof UPLOAD_STATUS)[]) {
      const { unmount } = render(<UploadStatusPill status={s} />)
      expect(screen.getByText(UPLOAD_STATUS[s].label)).toBeTruthy()
      unmount()
    }
  })
  it('severity and covenant pills use the right tones', () => {
    const { container } = render(<><SeverityPill severity="block" /><CovenantPill status="breach" /><StatusPill tone="ok" count={3}>OK</StatusPill></>)
    expect(container.querySelectorAll('.ds-pill--bad').length).toBe(2)
    expect(screen.getByText('Block')).toBeTruthy()
    expect(screen.getByText('BREACH')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
  })
})

describe('Card', () => {
  it('renders a heading and actions when titled', () => {
    render(<Card title="Recent uploads" actions={<Button>View all</Button>}>body</Card>)
    expect(screen.getByRole('heading', { level: 2, name: 'Recent uploads' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'View all' })).toBeTruthy()
  })
  it('is a padded box without a title', () => {
    const { container } = render(<Card>plain</Card>)
    expect(container.firstElementChild!.className).toContain('ds-card--pad')
  })
})

describe('KpiTile', () => {
  it('shows value, unit, context and an accessible delta', () => {
    render(<KpiTile label="Records" value="60" unit="/ 60" context="exact tie-out" delta={{ value: '+2', direction: 'up' }} />)
    expect(screen.getByText('60')).toBeTruthy()
    expect(screen.getByText(/exact tie-out/)).toBeTruthy()
    expect(screen.getByText(/^Up/)).toBeTruthy()
  })
  it('a delta without a tone keeps the direction colours (up green, down red, flat grey)', () => {
    const { container, rerender } = render(<KpiTile label="Balance" value="$10" delta={{ value: '+1', direction: 'up' }} />)
    const cls = () => container.querySelector('.ds-kpi__delta')!.className
    expect(cls()).toBe('ds-kpi__delta ds-kpi__delta--up')
    rerender(<KpiTile label="Balance" value="$10" delta={{ value: '-1', direction: 'down' }} />)
    expect(cls()).toBe('ds-kpi__delta ds-kpi__delta--down')
    rerender(<KpiTile label="Balance" value="$10" delta={{ value: '0', direction: 'flat' }} />)
    expect(cls()).toBe('ds-kpi__delta ds-kpi__delta--flat')
    expect(container.querySelector('.ds-kpi__delta')!.getAttribute('title')).toBeNull()
    expect(screen.queryByText(/better|worse/)).toBeNull()
  })
  it('a delta tone sets the colour apart from the arrow and says better or worse', () => {
    const { container, rerender } = render(<KpiTile label="Delinquency" value="2.1%" delta={{ value: '+0.3 pp', direction: 'up', tone: 'bad' }} />)
    const el = () => container.querySelector('.ds-kpi__delta')!
    expect(el().className).toBe('ds-kpi__delta ds-kpi__delta--bad')
    expect(el().textContent).toContain('▲')
    expect(el().getAttribute('title')).toBe('Up: worse')
    expect(el().textContent).toMatch(/, worse$/)
    rerender(<KpiTile label="Delinquency" value="1.8%" delta={{ value: '-0.3 pp', direction: 'down', tone: 'good' }} />)
    expect(el().className).toBe('ds-kpi__delta ds-kpi__delta--good')
    expect(el().textContent).toContain('▼')
    expect(el().getAttribute('title')).toBe('Down: better')
    rerender(<KpiTile label="Balance" value="$10" delta={{ value: '+1', direction: 'up', tone: 'neutral' }} />)
    expect(el().className).toBe('ds-kpi__delta ds-kpi__delta--neutral')
    expect(el().getAttribute('title')).toBeNull()
    expect(el().textContent).not.toMatch(/better|worse/)
  })
  it('shows an em dash when there is no value and a skeleton when loading', () => {
    const { rerender, container } = render(<KpiTile label="Deals" />)
    expect(screen.getByText('—')).toBeTruthy()
    rerender(<KpiTile label="Deals" loading />)
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0)
  })
})

describe('SkeletonBlock', () => {
  it('is hidden from assistive tech and can render lines', () => {
    const { container } = render(<SkeletonBlock lines={3} />)
    expect(container.firstElementChild!.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelectorAll('.ds-skel').length).toBe(3)
  })
})

describe('Breadcrumb and PageHeader', () => {
  it('marks the last crumb as current and links the rest', () => {
    render(<Breadcrumb items={[{ label: 'Uploads', href: '/admin/uploads' }, { label: 'Approval queue' }]} />)
    expect(screen.getByRole('link', { name: 'Uploads' }).getAttribute('href')).toBe('/admin/uploads')
    expect(screen.getByText('Approval queue').getAttribute('aria-current')).toBe('page')
  })
  it('PageHeader renders h1, status and actions', () => {
    render(<PageHeader title="Review report" crumbs={[{ label: 'Uploads', href: '/x' }, { label: 'Review' }]} status={<StatusPill tone="warn">Needs review</StatusPill>} actions={<Button variant="primary">Publish</Button>} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Review report' })).toBeTruthy()
    expect(screen.getByText('Needs review')).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeTruthy()
  })
})

describe('StatePanel', () => {
  it('has default copy per kind and error is an alert', () => {
    render(<StatePanel kind="error" actions={<Button>Retry</Button>} />)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeTruthy()
  })
  it('no-access copy matches the shell wording', () => {
    render(<StatePanel kind="no-access" />)
    expect(screen.getByRole('heading', { name: 'You don’t have access' })).toBeTruthy()
  })
})
