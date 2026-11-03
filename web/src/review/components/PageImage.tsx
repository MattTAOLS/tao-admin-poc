import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Button, Dialog, SkeletonBlock } from '@/design/components'
import { pageImageUrl } from '../lib/api'

/** Page images are rendered at 110 dpi (contracts/openapi.yaml); source bboxes are in PDF points from the top-left. */
export const PX_PER_PT = 110 / 72
export type Box = number[] // [x0, y0, x1, y1] in PDF points

function usePageImage(uploadId: string, page: number) {
  const [url, setUrl] = useState<string>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    setUrl(undefined); setFailed(false)
    pageImageUrl(uploadId, page).then(u => { if (live) setUrl(u) }, () => { if (live) setFailed(true) })
    return () => { live = false }
  }, [uploadId, page])
  return { url, failed }
}

type Nat = { w: number; h: number }
const markStyle = (b: Box, nat: Nat) => ({
  left: `${(b[0] * PX_PER_PT / nat.w) * 100}%`, top: `${(b[1] * PX_PER_PT / nat.h) * 100}%`,
  width: `${((b[2] - b[0]) * PX_PER_PT / nat.w) * 100}%`, height: `${((b[3] - b[1]) * PX_PER_PT / nat.h) * 100}%`,
})
function Marks({ boxes, nat, tone }: { boxes: Box[]; nat?: Nat; tone: 'finding' | 'source' }) {
  if (!nat) return null
  return <>{boxes.map((b, i) => <span key={i} className={'rv-mark' + (tone === 'source' ? ' rv-mark--source' : '')} style={markStyle(b, nat)} data-testid="page-mark" />)}</>
}

/** Thumbnail of one report page for a finding card. With bboxes it zooms in on `focus` (or all boxes) and outlines
 * every box; without, it shows the top of the page. Click (or Enter) opens the page viewer. */
export function PageCrop({ uploadId, page, boxes = [], focus, onZoom }: { uploadId: string; page: number; boxes?: Box[]; focus?: Box; onZoom: () => void }) {
  const { url, failed } = usePageImage(uploadId, page)
  const [nat, setNat] = useState<Nat>()
  if (failed) return <div className="rv-cropstate">Page {page} image is not available. Open the PDF to check this page.</div>
  if (!url) return <div aria-busy="true"><SkeletonBlock height={170} radius={8} /><span className="ds-visually-hidden">Loading page {page}</span></div>

  let style: CSSProperties | undefined
  const around = focus ? [focus] : boxes
  if (nat && around.length > 0) {
    const x0 = Math.min(...around.map(b => b[0])), x1 = Math.max(...around.map(b => b[2]))
    const y0 = Math.min(...around.map(b => b[1])), y1 = Math.max(...around.map(b => b[3]))
    // Scale so the focused cells fill about a third of the thumbnail width, between 1.4x and 6x the thumbnail.
    const span = Math.max((x1 - x0) * PX_PER_PT / nat.w, 0.005)
    const k = Math.min(6, Math.max(1.4, 0.33 / span))
    const cx = ((x0 + x1) / 2) * PX_PER_PT / nat.w, cy = ((y0 + y1) / 2) * PX_PER_PT / nat.h
    style = { width: `${k * 100}%`, transform: `translate(-${cx * 100}%, -${cy * 100}%)` }
  }
  return (
    <button type="button" className="rv-crop" onClick={onZoom} aria-label={`Zoom page ${page}`}>
      <span className={'rv-crop__inner' + (style ? '' : ' rv-crop__inner--top')} style={style}>
        <img src={url} alt={`Report page ${page}`} onLoad={e => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
        <Marks boxes={boxes} nat={nat} tone="finding" />
      </span>
      <span className="rv-crop__hint" aria-hidden="true">Zoom</span>
    </button>
  )
}

export type ViewerTarget = { page: number; boxes?: Box[]; tone?: 'finding' | 'source'; caption?: string; raw?: string }

const ZOOMS = [{ id: 'fit', label: 'Fit' }, { id: '1', label: '100%' }, { id: '1.5', label: '150%' }, { id: '2', label: '200%' }] as const

/** Full-page viewer with zoom levels and previous / next page. Outlines the boxes it was opened with. */
export function PageViewer({ uploadId, target, pageCount, onClose }: { uploadId: string; target: ViewerTarget | null; pageCount?: number | null; onClose: () => void }) {
  const [page, setPage] = useState(target?.page ?? 1)
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]['id']>('fit')
  useEffect(() => { if (target) { setPage(target.page); setZoom('fit') } }, [target])
  if (!target) return null
  const onTargetPage = page === target.page
  return (
    <Dialog open onClose={onClose} size="lg" title={`Report page ${page}${pageCount ? ` of ${pageCount}` : ''}`}
      description={target.caption}
      footer={<Button variant="primary" onClick={onClose}>Close</Button>}>
      <div className="rv-viewer__bar" role="toolbar" aria-label="Page view">
        {ZOOMS.map(z => <Button key={z.id} size="sm" aria-pressed={zoom === z.id} variant={zoom === z.id ? 'primary' : 'ghost'} onClick={() => setZoom(z.id)}>{z.label}</Button>)}
        <Button size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous page</Button>
        <Button size="sm" disabled={!!pageCount && page >= pageCount} onClick={() => setPage(p => p + 1)}>Next page</Button>
        {target.boxes && target.boxes.length > 0 && <span className="rv-muted">{onTargetPage ? 'Outlined: the cells the rule read' : `Outlines are on page ${target.page}`}</span>}
      </div>
      <ViewerPage uploadId={uploadId} page={page} zoom={zoom} boxes={onTargetPage ? target.boxes ?? [] : []} tone={target.tone ?? 'finding'} />
      {target.raw && onTargetPage && <div className="rv-raw">Raw text: {target.raw}</div>}
    </Dialog>
  )
}

function ViewerPage({ uploadId, page, zoom, boxes, tone }: { uploadId: string; page: number; zoom: string; boxes: Box[]; tone: 'finding' | 'source' }) {
  const { url, failed } = usePageImage(uploadId, page)
  const [nat, setNat] = useState<Nat>()
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Bring the first outline into view once the image has its size.
    const mark = scroller.current?.querySelector<HTMLElement>('.rv-mark')
    if (mark && typeof mark.scrollIntoView === 'function') mark.scrollIntoView({ block: 'center', inline: 'center' })
  }, [nat, zoom, page])
  if (failed) return <div className="rv-cropstate">Page {page} image is not available.</div>
  if (!url) return <div aria-busy="true"><SkeletonBlock height={420} radius={8} /><span className="ds-visually-hidden">Loading page {page}</span></div>
  const width = zoom === 'fit' || !nat ? '100%' : `${nat.w * Number(zoom)}px`
  return (
    <div className="rv-viewer__scroll" ref={scroller} tabIndex={0} aria-label={`Page ${page} image, scrollable`}>
      <div className="rv-viewer__page" style={{ width }}>
        <img src={url} alt={`Report page ${page}`} onLoad={e => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
        <Marks boxes={boxes} nat={nat} tone={tone} />
      </div>
    </div>
  )
}
