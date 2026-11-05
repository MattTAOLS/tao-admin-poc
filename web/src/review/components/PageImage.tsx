import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type SyntheticEvent } from 'react'
import { Button, Dialog, SkeletonBlock } from '@/design/components'
import { pageImageUrl, type PageDpi } from '../lib/api'

/** Source bboxes are [x0, y0, x1, y1] in PDF points from the top-left of the page. */
export type Box = number[]
/** A page's size in PDF points. Moneda pages are about 1,467 × 1,133 pt, most others 612 × 792. */
export type PagePt = { w: number; h: number }
type Nat = { w: number; h: number }

/** The finding-card crop keeps the contract default; the viewer asks for sharper images by zoom. */
export const CROP_DPI: PageDpi = 110
export type Zoom = 'fit' | 1 | 2 | 4
export const ZOOMS: { id: Zoom; label: string }[] = [{ id: 'fit', label: 'Fit' }, { id: 1, label: '100%' }, { id: 2, label: '200%' }, { id: 4, label: '400%' }]
/** Zoom when the viewer opens on a value or a finding with an outline, and for Zoom to value. */
export const OPEN_ZOOM: Zoom = 2
export const VALUE_ZOOM: Zoom = 4
/** 100% is actual size: one PDF point is 96/72 CSS pixels, as in a PDF reader. */
const CSS_PX_PER_PT = 96 / 72

/** The image the viewer requests at each zoom: 200 dpi for Fit and 100%, 300 dpi from 200% upward. */
export function dpiForZoom(zoom: Zoom): PageDpi {
  return zoom === 'fit' || zoom < 2 ? 200 : 300
}

/** Page size in points from an image rendered at a known dpi (the image's real pixel size, not an assumed one). */
export function pagePoints(nat: Nat, dpi: PageDpi): PagePt {
  return { w: nat.w * 72 / dpi, h: nat.h * 72 / dpi }
}

/** Image pixels per PDF point for a loaded image: its real width over the page width in points (risk R6). */
export function pxPerPt(naturalWidth: number, page: PagePt): number {
  return naturalWidth / page.w
}

/** A bbox in the loaded image's pixels. */
export function boxToImagePx(b: Box, naturalWidth: number, page: PagePt): Box {
  const k = pxPerPt(naturalWidth, page)
  return b.map(v => v * k)
}

/** Outline position as a fraction of the page, so it fits whichever image (110, 200 or 300 dpi) is on screen. */
export function markStyle(b: Box, page: PagePt): CSSProperties {
  return {
    left: `${(b[0] / page.w) * 100}%`, top: `${(b[1] / page.h) * 100}%`,
    width: `${((b[2] - b[0]) / page.w) * 100}%`, height: `${((b[3] - b[1]) / page.h) * 100}%`,
  }
}

/** Page width in CSS pixels at a zoom; Fit fills the viewer width. */
export function pageCssWidth(zoom: Zoom, page: PagePt, fitWidth: number): number {
  return zoom === 'fit' ? fitWidth : page.w * CSS_PX_PER_PT * zoom
}

/** Scroll offsets that put the centre of `boxes` in the middle of a viewport over a page drawn `cssWidth` wide. */
export function centreScroll(boxes: Box[], page: PagePt, cssWidth: number, viewport: { w: number; h: number }): { left: number; top: number } {
  const k = cssWidth / page.w
  const x0 = Math.min(...boxes.map(b => b[0])), x1 = Math.max(...boxes.map(b => b[2]))
  const y0 = Math.min(...boxes.map(b => b[1])), y1 = Math.max(...boxes.map(b => b[3]))
  const maxLeft = Math.max(0, cssWidth - viewport.w), maxTop = Math.max(0, page.h * k - viewport.h)
  const clamp = (v: number, max: number) => Math.round(Math.min(max, Math.max(0, v)))
  return { left: clamp(((x0 + x1) / 2) * k - viewport.w / 2, maxLeft), top: clamp(((y0 + y1) / 2) * k - viewport.h / 2, maxTop) }
}

function usePageImage(uploadId: string, page: number, dpi: PageDpi, enabled = true) {
  const [url, setUrl] = useState<string>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    setUrl(undefined); setFailed(false)
    if (!enabled) return
    pageImageUrl(uploadId, page, dpi).then(u => { if (live) setUrl(u) }, () => { if (live) setFailed(true) })
    return () => { live = false }
  }, [uploadId, page, dpi, enabled])
  return { url, failed }
}

const natOf = (img: HTMLImageElement): Nat => ({ w: img.naturalWidth, h: img.naturalHeight })

function Marks({ boxes, page, tone }: { boxes: Box[]; page?: PagePt; tone: 'finding' | 'source' }) {
  if (!page) return null
  return <>{boxes.map((b, i) => <span key={i} className={'rv-mark' + (tone === 'source' ? ' rv-mark--source' : '')} style={markStyle(b, page)} data-testid="page-mark" />)}</>
}

/** Thumbnail of one report page for a finding card (110 dpi). With bboxes it zooms in on `focus` (or all boxes) and
 * outlines every box; without, it shows the top of the page. Click (or Enter) opens the page viewer. */
export function PageCrop({ uploadId, page, boxes = [], focus, onZoom }: { uploadId: string; page: number; boxes?: Box[]; focus?: Box; onZoom: () => void }) {
  const { url, failed } = usePageImage(uploadId, page, CROP_DPI)
  const [pt, setPt] = useState<PagePt>()
  if (failed) return <div className="rv-cropstate">Page {page} image is not available. Open the PDF to check this page.</div>
  if (!url) return <div aria-busy="true"><SkeletonBlock height={170} radius={8} /><span className="ds-visually-hidden">Loading page {page}</span></div>

  let style: CSSProperties | undefined
  const around = focus ? [focus] : boxes
  if (pt && around.length > 0) {
    const x0 = Math.min(...around.map(b => b[0])), x1 = Math.max(...around.map(b => b[2]))
    const y0 = Math.min(...around.map(b => b[1])), y1 = Math.max(...around.map(b => b[3]))
    // Scale so the focused cells fill about a third of the thumbnail width, between 1.4x and 6x the thumbnail.
    const span = Math.max((x1 - x0) / pt.w, 0.005)
    const k = Math.min(6, Math.max(1.4, 0.33 / span))
    const cx = ((x0 + x1) / 2) / pt.w, cy = ((y0 + y1) / 2) / pt.h
    style = { width: `${k * 100}%`, transform: `translate(-${cx * 100}%, -${cy * 100}%)` }
  }
  return (
    <button type="button" className="rv-crop" onClick={onZoom} aria-label={`Zoom page ${page}`}>
      <span className={'rv-crop__inner' + (style ? '' : ' rv-crop__inner--top')} style={style}>
        <img src={url} alt={`Report page ${page}`} onLoad={e => setPt(pagePoints(natOf(e.currentTarget), CROP_DPI))} />
        <Marks boxes={boxes} page={pt} tone="finding" />
      </span>
      <span className="rv-crop__hint" aria-hidden="true">Zoom</span>
    </button>
  )
}

export type ViewerTarget = { page: number; boxes?: Box[]; tone?: 'finding' | 'source'; caption?: string; raw?: string }

/** Full-page viewer: Fit / 100 / 200 / 400%, Zoom to value, previous / next page. Outlines the boxes it was opened
 * with. Keyboard: + and - change zoom, Z zooms to the value, arrow keys pan the focused page, Escape closes. */
export function PageViewer({ uploadId, target, pageCount, onClose }: { uploadId: string; target: ViewerTarget | null; pageCount?: number | null; onClose: () => void }) {
  const [page, setPage] = useState(target?.page ?? 1)
  const [zoom, setZoomState] = useState<Zoom>('fit')
  const [centreReq, setCentreReq] = useState(0)
  const [shownDpi, setShownDpi] = useState<PageDpi>()
  const hasBoxes = !!target?.boxes && target.boxes.length > 0
  useEffect(() => {
    if (!target) return
    setPage(target.page)
    setZoomState(target.boxes && target.boxes.length > 0 ? OPEN_ZOOM : 'fit')
    setCentreReq(n => n + 1)
  }, [target])
  if (!target) return null
  const onTargetPage = page === target.page
  const setZoom = (z: Zoom) => { setZoomState(z); setCentreReq(n => n + 1) }
  const zoomToValue = () => { setPage(target.page); setZoom(VALUE_ZOOM) }
  const step = (d: 1 | -1) => {
    const i = ZOOMS.findIndex(z => z.id === zoom), next = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, i + d))]
    if (next.id !== zoom) setZoom(next.id)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === '+' || e.key === '=') { e.preventDefault(); step(1) }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); step(-1) }
    else if ((e.key === 'z' || e.key === 'Z') && hasBoxes) { e.preventDefault(); zoomToValue() }
  }
  return (
    <Dialog open onClose={onClose} size="lg" title={`Report page ${page}${pageCount ? ` of ${pageCount}` : ''}`}
      description={target.caption}
      footer={<Button variant="primary" onClick={onClose}>Close</Button>}>
      <div onKeyDown={onKeyDown} data-testid="page-viewer">
        <div className="rv-viewer__bar" role="toolbar" aria-label="Page view">
          {ZOOMS.map(z => <Button key={z.id} size="sm" aria-pressed={zoom === z.id} variant={zoom === z.id ? 'primary' : 'ghost'} onClick={() => setZoom(z.id)}>{z.label}</Button>)}
          {hasBoxes && <Button size="sm" onClick={zoomToValue} aria-keyshortcuts="Z">Zoom to value</Button>}
          <Button size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous page</Button>
          <Button size="sm" disabled={!!pageCount && page >= pageCount} onClick={() => setPage(p => p + 1)}>Next page</Button>
          <span className="rv-muted" data-testid="viewer-status">
            {shownDpi ? `${shownDpi} dpi` : 'Loading'}
            {hasBoxes && (onTargetPage ? ` · Outlined: ${target.tone === 'source' ? 'the cell this value came from' : 'the cells the rule read'}` : ` · Outlines are on page ${target.page}`)}
          </span>
        </div>
        <ViewerPage key={page} uploadId={uploadId} page={page} zoom={zoom} centreReq={centreReq} boxes={onTargetPage ? target.boxes ?? [] : []}
          tone={target.tone ?? 'finding'} onShown={setShownDpi} />
        {target.raw && onTargetPage && <div className="rv-raw">Raw text: {target.raw}</div>}
      </div>
    </Dialog>
  )
}

/** One page, drawn from stacked images: the 110 dpi image (usually cached from the finding crop) underneath, the
 * 200 and 300 dpi images on top once each has loaded. The lower image stays visible until the sharper one is ready,
 * so changing zoom never blanks the page. Outlines are placed in page points, so they fit every layer. */
function ViewerPage({ uploadId, page, zoom, centreReq, boxes, tone, onShown }: {
  uploadId: string; page: number; zoom: Zoom; centreReq: number; boxes: Box[]; tone: 'finding' | 'source'; onShown: (dpi: PageDpi | undefined) => void
}) {
  const want = dpiForZoom(zoom)
  // Once 300 dpi has been asked for on this page it stays on top, so zooming back out does not drop to a softer image.
  const [want300, setWant300] = useState(want === 300)
  useEffect(() => { if (want === 300) setWant300(true) }, [want])
  const layers = [
    { dpi: 110 as PageDpi, ...usePageImage(uploadId, page, 110) },
    { dpi: 200 as PageDpi, ...usePageImage(uploadId, page, 200) },
    { dpi: 300 as PageDpi, ...usePageImage(uploadId, page, 300, want300) },
  ]
  const [nats, setNats] = useState<Partial<Record<PageDpi, Nat>>>({})
  const scroller = useRef<HTMLDivElement>(null)

  // Page size in points from the 110 dpi image (the contract default, which every API version serves); only if that
  // one fails, from the next image that loads. Outlines and zoom widths use it; each layer is scaled by its own width.
  const geomLayer = layers.find(l => nats[l.dpi] && layers.slice(0, layers.indexOf(l)).every(x => x.failed))
  const pt = geomLayer ? pagePoints(nats[geomLayer.dpi]!, geomLayer.dpi) : undefined
  const loaded = layers.filter(l => l.url && nats[l.dpi]).map(l => l.dpi)
  const shown = loaded.length ? loaded[loaded.length - 1] : undefined
  useEffect(() => { onShown(shown) }, [shown, onShown])

  const ptKey = pt ? `${pt.w.toFixed(1)}x${pt.h.toFixed(1)}` : ''
  useEffect(() => {
    const el = scroller.current
    if (!el || !pt || boxes.length === 0) return
    const css = pageCssWidth(zoom, pt, el.clientWidth)
    const { left, top } = centreScroll(boxes, pt, css, { w: el.clientWidth, h: el.clientHeight })
    if (typeof el.scrollTo === 'function') el.scrollTo({ left, top })
    else { el.scrollLeft = left; el.scrollTop = top }
    // Re-centre on a zoom change, Zoom to value, or once the page size is known; not when a sharper layer arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centreReq, zoom, ptKey])

  const base = layers.find(l => l.url)
  if (!base) {
    if (layers.every(l => l.failed || (l.dpi === 300 && !want300))) return <div className="rv-cropstate">Page {page} image is not available.</div>
    return <div aria-busy="true"><SkeletonBlock height={420} radius={8} /><span className="ds-visually-hidden">Loading page {page}</span></div>
  }
  const width = zoom === 'fit' || !pt ? '100%' : `${Math.round(pageCssWidth(zoom, pt, 0))}px`
  const onLoad = (dpi: PageDpi) => (e: SyntheticEvent<HTMLImageElement>) => {
    const n = natOf(e.currentTarget)
    setNats(m => ({ ...m, [dpi]: n }))
  }
  return (
    <div className="rv-viewer__scroll" ref={scroller} tabIndex={0} aria-label={`Page ${page} image, scrollable`}>
      <div className="rv-viewer__page" style={{ width }}>
        {layers.filter(l => l.url).map(l => (
          <img key={l.dpi} src={l.url} data-dpi={l.dpi} alt={l === base ? `Report page ${page}` : ''} aria-hidden={l === base ? undefined : true}
            className={l === base ? 'rv-viewer__base' : 'rv-viewer__layer' + (nats[l.dpi] ? '' : ' rv-viewer__layer--loading')}
            onLoad={onLoad(l.dpi)} />
        ))}
        <Marks boxes={boxes} page={pt} tone={tone} />
      </div>
    </div>
  )
}
