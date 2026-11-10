// @vitest-environment jsdom
/// <reference types="node" />
/** Audit H8: a table wider than its wrapper scrolls sideways inside the wrapper instead of being cut off by the card,
 * and the scrolling wrapper is a focusable, named region. Audit M18: the visually hidden class. */
import '../../test-utils'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DataTable, type Column } from '..'

type Row = { id: string; deal: string }
const rows: Row[] = [{ id: 'a', deal: 'Moneda' }]
const cols: Column<Row>[] = [{ key: 'deal', header: 'Deal' }]

/** jsdom lays nothing out: give every element a content width and a box width. */
function layout(scrollWidth: number, clientWidth: number) {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => scrollWidth })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => clientWidth })
}
afterEach(() => {
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollWidth
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
})

describe('DataTable wrapper (audit H8)', () => {
  it('a table wider than the wrapper gets the sideways-scroll class and is a focusable region named by the caption', () => {
    layout(1525, 1280)
    const { container } = render(<DataTable columns={cols} rows={rows} rowKey={r => r.id} caption="Lending companies" captionHidden />)
    const wrap = container.querySelector('.ds-table-wrap')!
    expect(wrap.classList.contains('ds-table-wrap--x')).toBe(true)
    expect(wrap.getAttribute('tabindex')).toBe('0')
    expect(screen.getByRole('region', { name: 'Lending companies' })).toBe(wrap)
  })

  it('names the region "Data table" when the caption is not plain text', () => {
    layout(1525, 1280)
    render(<DataTable columns={cols} rows={rows} rowKey={r => r.id} />)
    expect(screen.getByRole('region', { name: 'Data table' })).toBeTruthy()
  })

  it('a table that fits is left alone: no scroll container, no tab stop, header still sticks under the top bar', () => {
    layout(1000, 1000)
    const { container } = render(<DataTable columns={cols} rows={rows} rowKey={r => r.id} caption="Deals" />)
    const wrap = container.querySelector('.ds-table-wrap')!
    expect(wrap.classList.contains('ds-table-wrap--x')).toBe(false)
    expect(wrap.hasAttribute('tabindex')).toBe(false)
    expect(wrap.hasAttribute('role')).toBe(false)
    expect(wrap.hasAttribute('aria-label')).toBe(false)
  })

  it('a maxHeight table is a region whether or not it is too wide', () => {
    layout(1000, 1000)
    const { container } = render(<DataTable columns={cols} rows={rows} rowKey={r => r.id} caption="Deals" maxHeight={200} />)
    const wrap = container.querySelector('.ds-table-wrap')!
    expect(wrap.classList.contains('ds-table-wrap--scroll')).toBe(true)
    expect(screen.getByRole('region', { name: 'Deals' })).toBe(wrap)
  })
})

describe('components.css', () => {
  const css = readFileSync(resolve(__dirname, '../components.css'), 'utf8')
  const rule = (selector: string) => {
    const i = css.indexOf(selector + ' {')
    expect(i, `rule ${selector}`).toBeGreaterThanOrEqual(0)
    return css.slice(i, css.indexOf('}', i))
  }
  it('the too-wide wrapper scrolls sideways and its header sticks to the wrapper', () => {
    expect(rule('.ds-table-wrap--x')).toContain('overflow-x: auto')
    expect(rule('.ds-table-wrap--x .ds-table th')).toContain('top: 0')
    // the plain wrapper stays out of the way so the page-level sticky header works
    expect(rule('.ds-table-wrap')).not.toContain('overflow')
    // the flush card still clips (rounded corners) without becoming a scroll container
    expect(rule('.ds-card--flush')).toContain('overflow: clip')
  })
  it('the focus ring of a scrolling wrapper is inset, so a flush card does not clip it', () => {
    expect(rule('.ds-table-wrap:focus-visible')).toContain('inset')
  })
  it('visually hidden content is clipped to one pixel (audit M18)', () => {
    const r = rule('.ds-visually-hidden')
    for (const d of ['position: absolute', 'width: 1px', 'height: 1px', 'overflow: hidden', 'clip-path: inset(50%)']) expect(r).toContain(d)
  })
})
