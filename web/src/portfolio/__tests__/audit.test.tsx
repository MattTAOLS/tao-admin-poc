// @vitest-environment jsdom
/** Bug audit fixes on the portal pages: M16 (profile opens on a published deal), M18 (hidden chart tables sit in a hidden
 * div), L18 (What to watch links only to sections on the page), L20 (hover readout placement), L21 (no negative zero). */
import '@/design/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { headerStore } from '@/shell/header'
import { renderAt, setup, state } from './companyApi'
import { deals } from './fixtures'
import { fmtNum } from '../Num'
import { RatioChart } from '../RatioChart'
import { tipPlacement } from '../companies/charts'
import { SignalsSection, signalAnchor } from '../companies/sections'
import type { WatchSignal } from '../companies/types'

beforeEach(() => { setup(); headerStore.clear() })
afterEach(() => { vi.unstubAllGlobals() })
const ready = () => screen.findByRole('heading', { name: 'What to watch' }, { timeout: 15_000 })

describe('M16: the profile of a company with several deals opens on a published one', () => {
  it('TLFC with only its third deal published opens on that deal, not on "Not published yet"', async () => {
    state.unpublished = ['move-trust-tlfc-leases', 'move-trust-tlfc-loans']
    renderAt('/admin/companies/tlfc', 'tao_admin')
    await ready()
    expect((screen.getByLabelText('Deal') as HTMLSelectElement).value).toBe('move-trust-tlfc-lp-leases')
    expect(screen.queryByRole('heading', { name: 'Not published yet' })).toBeNull()
    expect(screen.queryByText('Not published yet')).toBeNull()
    expect(state.calls.some(c => c.path === '/companies/tlfc/deals/move-trust-tlfc-lp-leases/insights')).toBe(true)
    expect(state.calls.some(c => c.path.includes('/deals/move-trust-tlfc-leases'))).toBe(false)
  }, 60_000)

  it('?deal= still wins, even for an unpublished deal', async () => {
    state.unpublished = ['move-trust-tlfc-leases', 'move-trust-tlfc-loans']
    renderAt('/admin/companies/tlfc?deal=move-trust-tlfc-loans', 'tao_admin')
    expect(await screen.findByRole('heading', { name: 'Not published yet' }, { timeout: 15_000 })).toBeTruthy()
    expect((screen.getByLabelText('Deal') as HTMLSelectElement).value).toBe('move-trust-tlfc-loans')
  }, 60_000)

  it('falls back to the first deal when none is published', async () => {
    state.unpublished = ['move-trust-tlfc-leases', 'move-trust-tlfc-loans', 'move-trust-tlfc-lp-leases']
    renderAt('/admin/companies/tlfc', 'tao_admin')
    expect(await screen.findByRole('heading', { name: 'Not published yet' }, { timeout: 15_000 })).toBeTruthy()
    expect((screen.getByLabelText('Deal') as HTMLSelectElement).value).toBe('move-trust-tlfc-leases')
  }, 60_000)
})

describe('M18: a chart\'s screen-reader table is inside a visually hidden div', () => {
  it('company profile charts', async () => {
    renderAt('/admin/companies/essex-lease-financial-corp', 'tao_admin')
    await ready()
    const wraps = screen.getAllByTestId('chart-table')
    expect(wraps.length).toBeGreaterThan(2)
    for (const w of wraps) {
      expect(w.tagName).toBe('DIV')
      expect(w.classList.contains('ds-visually-hidden')).toBe(true)
      expect(w.querySelector('table')).toBeTruthy()
    }
    // No table is hidden by the class itself: a table ignores width: 1px.
    expect(document.querySelectorAll('table.ds-visually-hidden')).toHaveLength(0)
  }, 60_000)

  it('deal page ratio chart', () => {
    const d = deals['move-trust-essex-lease-financial-corp']
    const { container } = render(<RatioChart history={d.ratio_history} />)
    const w = within(container).getByTestId('chart-table')
    expect(w.tagName).toBe('DIV')
    expect(w.classList.contains('ds-visually-hidden')).toBe(true)
    expect(w.querySelector('table caption')).toBeTruthy()
    expect(container.querySelectorAll('table.ds-visually-hidden')).toHaveLength(0)
  })
})

describe('L18: What to watch links', () => {
  it('maps the old anchors to the sections that exist', () => {
    expect(signalAnchor('losses')).toBe('loss-ratios')
    expect(signalAnchor('next-report')).toBe('record')
    expect(signalAnchor('chart-rolling_3month_loss_ratio_pct')).toBe('loss-ratios')
    expect(signalAnchor('chart-rolling_12month_loss_ratio_pct')).toBe('loss-ratios')
    for (const a of ['loss-ratios', 'record', 'chart-interest_coverage_ratio', 'pool-balance', 'covenant-history', 'news', 'adverse']) expect(signalAnchor(a)).toBe(a)
  })

  it('links a signal only when its target is on the page; otherwise the title is plain text', () => {
    const sig = (title: string, anchor: string): WatchSignal => ({ kind: 'x', severity: 'info', title, detail: 'd', anchor })
    render(
      <>
        <div id="loss-ratios" />
        <div id="news" />
        <SignalsSection period="2026-07" signals={[sig('Losses high', 'losses'), sig('Loss chart', 'chart-rolling_12month_loss_ratio_pct'), sig('News', 'news'),
          sig('Report late', 'next-report'), sig('Gone', 'chart-not_on_the_page'), sig('Empty', '')]} />
      </>,
    )
    expect(screen.getByRole('link', { name: 'Losses high' }).getAttribute('href')).toBe('#loss-ratios')
    expect(screen.getByRole('link', { name: 'Loss chart' }).getAttribute('href')).toBe('#loss-ratios')
    expect(screen.getByRole('link', { name: 'News' }).getAttribute('href')).toBe('#news')
    // #record, the chart and the empty anchor are not on this page: text, no link
    for (const t of ['Report late', 'Gone', 'Empty']) {
      expect(screen.getByText(t)).toBeTruthy()
      expect(screen.queryByRole('link', { name: t })).toBeNull()
    }
    expect(screen.getAllByRole('link')).toHaveLength(3)
  })

  it('on the real profile every What to watch link points at an element on the page', async () => {
    renderAt('/admin/companies/essex-lease-financial-corp', 'tao_admin')
    await ready()
    // The record panel and the loss card carry the ids the API links to.
    expect(document.getElementById('record')!.querySelector('.co-record')).toBeTruthy()
    expect(within(document.getElementById('loss-ratios')!).getByRole('heading', { name: 'Rolling loss ratios' })).toBeTruthy()
    const links = within(document.getElementById('what-to-watch')!).getAllByRole('link')
    expect(links.length).toBeGreaterThan(0)
    for (const a of links) expect(document.getElementById(a.getAttribute('href')!.slice(1))).toBeTruthy()
  }, 60_000)
})

describe('L20: hover readout placement', () => {
  const space = { min: 8, max: 592, tip: 200 }
  it('sits right of the guide when it fits', () => {
    expect(tipPlacement({ guide: 100, ...space })).toEqual({ side: 'right', left: 114 })
  })
  it('flips left when the right side would leave the space', () => {
    expect(tipPlacement({ guide: 450, ...space })).toEqual({ side: 'left', left: 236 })
  })
  it('in a right-hand column the limit is the window edge, not the chart midpoint', () => {
    // The chart starts at x 900 in a 1280 px window; its left half used to open rightwards and be cut off.
    const p = tipPlacement({ guide: 1000, tip: 300, min: 908, max: 1272 })
    expect(p.left).toBeGreaterThanOrEqual(908)
    expect(p.left + 300).toBeLessThanOrEqual(1272)
  })
  it('clamps inside the space when neither side fits', () => {
    const p = tipPlacement({ guide: 300, tip: 400, min: 8, max: 592 })
    expect(p.left).toBeGreaterThanOrEqual(8)
    expect(p.left + 400).toBeLessThanOrEqual(592)
    // A box wider than the space starts at its left edge
    expect(tipPlacement({ guide: 300, tip: 700, min: 8, max: 592 }).left).toBe(8)
  })
  it('keeps the gap from the guide', () => {
    expect(tipPlacement({ guide: 100, ...space, gap: 20 }).left).toBe(120)
    expect(tipPlacement({ guide: 500, ...space, gap: 20 }).left).toBe(280)
  })
})

describe('L21: a value that rounds to zero has no minus sign', () => {
  it('money, as the reference renderer prints it', () => {
    expect(fmtNum(-0.06, 'money')).toBe('$0')
    expect(fmtNum(-0.49, 'money')).toBe('$0')
    expect(fmtNum(-0, 'money')).toBe('$0')
    expect(fmtNum(0.4, 'money')).toBe('$0')
    expect(fmtNum(-0.51, 'money')).toBe('-$1')
    expect(fmtNum(-1234.4, 'money')).toBe('-$1,234')
  })
  it('percent, count and ratio', () => {
    expect(fmtNum(-0.00004, 'pct')).toBe('0.00%')
    expect(fmtNum(-0.0001, 'pct')).toBe('-0.01%')
    expect(fmtNum(-0.4, 'count')).toBe('0')
    expect(fmtNum(-3, 'count')).toBe('-3')
    expect(fmtNum(-0.004, 'ratio')).toBe('0.00x')
    expect(fmtNum(-0.01, 'ratio')).toBe('-0.01x')
  })
  it('signed kinds already print a bare zero', () => {
    expect(fmtNum(-0.2, 'signed-money')).toBe('$0')
    expect(fmtNum(-0.2, 'signed-count')).toBe('0')
  })
})
