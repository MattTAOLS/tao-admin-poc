import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Button, StatusPill } from '@/design/components'
import type { Deal, PublicationVersion } from './types'

/** Publication versions of one deal month (contracts/openapi.yaml PublishedDeal.version / versions, decision B2).
 * Version 1 is the original publication; 2+ are corrections published without a new PDF. A deal with no version, or
 * only version 1, is not corrected and nothing on the page changes. */
export type VersionInfo = { shown: number; current: number; total: number; corrected: boolean; older: boolean; list: PublicationVersion[] }

export function versionInfo(d: Pick<Deal, 'version' | 'versions'>): VersionInfo {
  const list = [...(d.versions ?? [])].sort((a, b) => a.version - b.version)
  const shown = typeof d.version === 'number' && d.version >= 1 ? d.version : (list.find(v => v.current)?.version ?? list[list.length - 1]?.version ?? 1)
  const newest = list.length ? list[list.length - 1].version : shown
  const current = list.find(v => v.current)?.version ?? Math.max(newest, shown)
  const total = Math.max(newest, current, shown)
  return { shown, current, total, corrected: current > 1, older: shown < current, list }
}

/** "5 Nov 2026" from an ISO timestamp; the raw string when it does not parse. */
export function versionDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const t = new Date(iso)
  return Number.isNaN(t.getTime()) ? iso : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** Header status for a corrected deal month: a "Corrected" pill, then "Version N of M" opening the versions menu.
 * `hrefFor` gives each version's link (the current one without ?version). Renders nothing when not corrected. */
export function VersionStatus({ d, hrefFor }: { d: Deal; hrefFor: (v: number | undefined) => string }) {
  const info = versionInfo(d)
  if (!info.corrected) return null
  return (
    <span className="pf-version">
      <StatusPill tone="blue" size="sm" title={`Corrected after publication; the current version is ${info.current}`}>Corrected</StatusPill>
      <VersionMenu info={info} hrefFor={hrefFor} />
    </span>
  )
}

function VersionMenu({ info, hrefFor }: { info: VersionInfo; hrefFor: (v: number | undefined) => string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const box = useRef<HTMLSpanElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const loc = useLocation()
  useEffect(() => { setOpen(false) }, [loc.pathname, loc.search])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus() } }
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown) }
  }, [open])
  const newestFirst = [...info.list].reverse()
  return (
    <span className="pf-vmenu" ref={box}>
      <Button ref={btn} size="sm" aria-expanded={open} aria-controls={id} aria-haspopup="true" onClick={() => setOpen(o => !o)}>
        Version {info.shown} of {info.total}
      </Button>
      {open && (
        <div id={id} className="pf-vmenu__panel" role="region" aria-label="Published versions">
          <ol className="pf-vmenu__list">
            {newestFirst.map(v => {
              const isCurrent = v.version === info.current
              const here = v.version === info.shown
              return (
                <li key={v.version} className={here ? 'pf-vmenu__item pf-vmenu__item--here' : 'pf-vmenu__item'}>
                  <Link to={hrefFor(isCurrent ? undefined : v.version)} aria-current={here ? 'page' : undefined} className="pf-vmenu__link">
                    Version {v.version}{isCurrent ? ' (current)' : v.version === 1 ? ' (original)' : ''}
                  </Link>
                  <div className="pf-muted pf-small">Published {versionDate(v.published_at)} by {v.published_by || '—'}</div>
                  <div className="pf-small">{v.reason || (v.version === 1 ? 'Original publication' : 'No reason recorded')}</div>
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </span>
  )
}

/** Shown above the deal when an earlier version is open: which version, which is current, and a way back. */
export function OlderVersionBanner({ d, currentHref }: { d: Deal; currentHref: string }) {
  const info = versionInfo(d)
  if (!info.older) return null
  const v = info.list.find(x => x.version === info.shown)
  return (
    <div className="pf-oldversion" role="note" aria-label="Earlier version">
      <StatusPill tone="warn" size="sm">Earlier version</StatusPill>
      <span>You are looking at version {info.shown}. The current version is {info.current}.</span>
      {v && <span className="pf-muted">Published {versionDate(v.published_at)} by {v.published_by}.</span>}
      <Link className="pf-strip__link" to={currentHref}>Go to the current version</Link>
    </div>
  )
}
