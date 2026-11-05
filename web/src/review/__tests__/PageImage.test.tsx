// @vitest-environment jsdom
/** The sharper page viewer (wave A item 4): dpi per zoom, bbox scaling from the real image size (risk R6), Zoom to
 * value, and outlines that never fade the page. Page sizes and pixel widths are the real Moneda-202608 page 2
 * (1,466.67 × 1,133.33 pt; PDFium renders it 2241, 4075 and 6112 px wide at 110, 200 and 300 dpi). */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockApi, setRole } from './helpers'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  PageViewer, boxToImagePx, centreScroll, dpiForZoom, markStyle, pageCssWidth, pagePoints, pxPerPt, type Box, type ViewerTarget,
} from '../components/PageImage'

// Read from disk: vitest stubs CSS imports, even with ?raw.
const css = readFileSync(resolve(process.cwd(), 'src/review/review.css'), 'utf8')
const MONEDA_PT = { w: 1466.67, h: 1133.33 }
const RENDERS = { 110: { w: 2241, h: 1732 }, 200: { w: 4075, h: 3149 }, 300: { w: 6112, h: 4723 } } as const
// /contracts/closing on page 2 of the real Moneda extraction ("212").
const CLOSING: Box = [825.46, 981.81, 840.75, 991.81]

describe('dpi per zoom', () => {
  it('asks for 200 dpi at Fit and 100%, 300 dpi from 200% upward', () => {
    expect(dpiForZoom('fit')).toBe(200)
    expect(dpiForZoom(1)).toBe(200)
    expect(dpiForZoom(2)).toBe(300)
    expect(dpiForZoom(4)).toBe(300)
  })
})

describe('bbox scaling from the loaded image (R6)', () => {
  it.each([110, 200, 300] as const)('puts the box on the right pixels of the %i dpi render', dpi => {
    const nat = RENDERS[dpi]
    const pt = pagePoints(RENDERS[110], 110)                 // page size from the image the viewer loads first
    expect(pt.w).toBeCloseTo(MONEDA_PT.w, 0)
    expect(pt.h).toBeCloseTo(MONEDA_PT.h, 0)
    const px = boxToImagePx(CLOSING, nat.w, pt)
    const exact = CLOSING.map(v => v * dpi / 72)              // where PDFium drew the cell
    px.forEach((v, i) => expect(Math.abs(v - exact[i])).toBeLessThan(1.5))
    expect(pxPerPt(nat.w, MONEDA_PT)).toBeCloseTo(dpi / 72, 2)
  })

  it('a hard-coded 110 dpi would miss the cell on the 300 dpi image by more than 1,300 px', () => {
    const wrong = CLOSING[0] * 110 / 72
    const right = boxToImagePx(CLOSING, RENDERS[300].w, MONEDA_PT)[0]
    expect(right - wrong).toBeGreaterThan(1300)
  })

  it('places the outline as a fraction of the page, the same on every layer', () => {
    const s = markStyle(CLOSING, MONEDA_PT)
    expect(parseFloat(String(s.left))).toBeCloseTo(825.46 / 1466.67 * 100, 3)
    expect(parseFloat(String(s.top))).toBeCloseTo(981.81 / 1133.33 * 100, 3)
    expect(parseFloat(String(s.width))).toBeCloseTo(15.29 / 1466.67 * 100, 3)
  })
})

describe('zoom to value geometry', () => {
  it('centres the box at 400% (actual size = 96/72 CSS px per point)', () => {
    const css400 = pageCssWidth(4, MONEDA_PT, 0)
    expect(css400).toBeCloseTo(1466.67 * 4 / 3 * 4, 3)
    const { left, top } = centreScroll([CLOSING], MONEDA_PT, css400, { w: 900, h: 600 })
    const k = css400 / MONEDA_PT.w
    expect(left).toBe(Math.round(((825.46 + 840.75) / 2) * k - 450))
    expect(top).toBe(Math.round(((981.81 + 991.81) / 2) * k - 300))
  })
  it('clamps to the page edges', () => {
    expect(centreScroll([[0, 0, 10, 10]], MONEDA_PT, 2000, { w: 900, h: 600 })).toEqual({ left: 0, top: 0 })
  })
})

// ---- The viewer component ----

const UPLOAD = '11111111-1111-1111-1111-111111111111'
const size = (el: HTMLElement, w: number, h: number) => {
  Object.defineProperty(el, 'naturalWidth', { configurable: true, value: w })
  Object.defineProperty(el, 'naturalHeight', { configurable: true, value: h })
}
const layer = (dpi: number) => document.querySelector<HTMLImageElement>(`img[data-dpi="${dpi}"]`)
async function loadLayer(dpi: 110 | 200 | 300) {
  const img = await waitFor(() => { const i = layer(dpi); if (!i) throw new Error(`no ${dpi} layer`); return i })
  size(img, RENDERS[dpi].w, RENDERS[dpi].h)
  act(() => { fireEvent.load(img) })
  return img
}
const pageImageCalls = (calls: { path: string }[]) => calls.map(c => c.path).filter(p => p.includes('/pages/'))
const pressed = () => screen.getAllByRole('button', { pressed: true }).map(b => b.textContent)

function show(target: ViewerTarget) {
  setRole('tao_admin')
  const calls = mockApi([])
  render(<PageViewer uploadId={UPLOAD} target={target} pageCount={16} onClose={() => {}} />)
  return calls
}

const restore: (() => void)[] = []
afterEach(() => { restore.splice(0).forEach(f => f()) })
function stubViewport(w: number, h: number) {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>
  const saved = ['clientWidth', 'clientHeight', 'scrollTo'].map(k => [k, Object.getOwnPropertyDescriptor(proto, k)] as const)
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => w })
  Object.defineProperty(proto, 'clientHeight', { configurable: true, get: () => h })
  const scrollTo = vi.fn()
  Object.defineProperty(proto, 'scrollTo', { configurable: true, writable: true, value: scrollTo })
  restore.push(() => saved.forEach(([k, d]) => (d ? Object.defineProperty(proto, k, d) : delete proto[k])))
  return scrollTo
}

describe('PageViewer', () => {
  it('opens at Fit without an outline and asks for 110 + 200 dpi; 200% adds 300 dpi', async () => {
    const calls = show({ page: 2 })
    await loadLayer(110)
    expect(pressed()).toEqual(['Fit'])
    expect(pageImageCalls(calls)).toEqual([`/uploads/${UPLOAD}/pages/2.png`, `/uploads/${UPLOAD}/pages/2.png?dpi=200`])
    expect(screen.queryByRole('button', { name: 'Zoom to value' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '200%' }))
    await waitFor(() => expect(pageImageCalls(calls)).toContain(`/uploads/${UPLOAD}/pages/2.png?dpi=300`))
  })

  it('keeps the lower image on screen until the sharper one loads, with no opacity anywhere', async () => {
    show({ page: 2 })
    const base = await loadLayer(110)
    const sharp = await waitFor(() => { const i = layer(200); if (!i) throw new Error('no 200 layer'); return i })
    expect(sharp.className).toContain('rv-viewer__layer--loading')   // hidden until loaded; the 110 image shows
    expect(base.className).toBe('rv-viewer__base')
    expect(screen.getByTestId('viewer-status').textContent).toMatch(/^110 dpi/)
    size(sharp, RENDERS[200].w, RENDERS[200].h)
    act(() => { fireEvent.load(sharp) })
    expect(sharp.className).toBe('rv-viewer__layer')
    expect(screen.getByTestId('viewer-status').textContent).toMatch(/^200 dpi/)
    for (const img of [base, sharp]) {
      expect(img.style.opacity).toBe('')
      expect(['', '1']).toContain(getComputedStyle(img).opacity)
    }
  })

  it('draws a crisp outline: no fill, no blend, no opacity in the review styles', () => {
    const mark = /\.rv-mark \{([^}]*)\}/.exec(css)![1]
    expect(mark).toMatch(/outline: 2px solid var\(--bad\)/)
    expect(mark).not.toMatch(/background|mix-blend|opacity/)
    expect(css).not.toMatch(/mix-blend-mode/)
    const pageRules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(m => /rv-(viewer|mark|crop)/.test(m[1]))
    expect(pageRules.length).toBeGreaterThan(5)
    for (const [, sel, body] of pageRules) expect(`${sel.trim()} {${body}}`).not.toMatch(/opacity|filter|mix-blend/)
  })

  it('opened from a value: starts at 200% centred on the cell; Zoom to value goes to 400% and centres it', async () => {
    const scrollTo = stubViewport(900, 600)
    const calls = show({ page: 2, boxes: [CLOSING], tone: 'source', caption: 'Contracts, Closing', raw: '212' })
    await loadLayer(110)
    expect(pressed()).toEqual(['200%'])
    expect(pageImageCalls(calls)).toContain(`/uploads/${UPLOAD}/pages/2.png?dpi=300`)
    const pt = pagePoints(RENDERS[110], 110)
    const page = document.querySelector<HTMLElement>('.rv-viewer__page')!
    expect(page.style.width).toBe(`${Math.round(pageCssWidth(2, pt, 0))}px`)
    expect(scrollTo).toHaveBeenLastCalledWith(centreScroll([CLOSING], pt, pageCssWidth(2, pt, 900), { w: 900, h: 600 }))
    const mark = screen.getByTestId('page-mark')
    expect(parseFloat(mark.style.left)).toBeCloseTo(CLOSING[0] / pt.w * 100, 4)
    expect(mark.className).toBe('rv-mark rv-mark--source')

    await userEvent.click(screen.getByRole('button', { name: 'Zoom to value' }))
    expect(pressed()).toEqual(['400%'])
    expect(page.style.width).toBe(`${Math.round(pageCssWidth(4, pt, 0))}px`)
    const at400 = centreScroll([CLOSING], pt, pageCssWidth(4, pt, 900), { w: 900, h: 600 })
    expect(scrollTo).toHaveBeenLastCalledWith(at400)
    expect(at400.left).toBeGreaterThan(0)

    // Outlines stay put when the sharper image arrives (they are in page points, not 110 dpi pixels).
    const before = mark.style.cssText
    await loadLayer(300)
    expect(screen.getByTestId('page-mark').style.cssText).toBe(before)
  })

  it('an API that ignores dpi (serves 110 for every request) still gets the outline on the cell', async () => {
    show({ page: 2, boxes: [CLOSING], tone: 'source' })
    const stale = await waitFor(() => { const i = layer(200); if (!i) throw new Error('no 200 layer'); return i })
    size(stale, RENDERS[110].w, RENDERS[110].h)                 // the "200 dpi" image is really 110 dpi
    act(() => { fireEvent.load(stale) })
    expect(screen.queryByTestId('page-mark')).toBeNull()         // page size waits for the 110 image
    await loadLayer(110)
    const pt = pagePoints(RENDERS[110], 110)
    expect(parseFloat(screen.getByTestId('page-mark').style.left)).toBeCloseTo(CLOSING[0] / pt.w * 100, 4)
    expect(boxToImagePx(CLOSING, stale.naturalWidth, pt)[0]).toBeCloseTo(CLOSING[0] * 110 / 72, 0)
  })

  it('keyboard: - and + step the zoom, Z zooms to the value; previous / next page still work', async () => {
    stubViewport(900, 600)
    show({ page: 2, boxes: [CLOSING], tone: 'finding', caption: 'R05' })
    await loadLayer(110)
    const viewer = screen.getByTestId('page-viewer')
    fireEvent.keyDown(viewer, { key: '-' })
    expect(pressed()).toEqual(['100%'])
    fireEvent.keyDown(viewer, { key: '-' })
    expect(pressed()).toEqual(['Fit'])
    fireEvent.keyDown(viewer, { key: '+' })
    expect(pressed()).toEqual(['100%'])
    fireEvent.keyDown(viewer, { key: 'z' })
    expect(pressed()).toEqual(['400%'])
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    const dlg = screen.getByRole('dialog', { name: 'Report page 3 of 16' })
    expect(within(dlg).getByTestId('viewer-status').textContent).toMatch(/Outlines are on page 2/)
    await userEvent.click(within(dlg).getByRole('button', { name: 'Zoom to value' }))
    expect(screen.getByRole('dialog', { name: 'Report page 2 of 16' })).toBeTruthy()
  })
})
