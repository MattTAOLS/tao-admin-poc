/** Cells shared by the Companies list, the Executive Summary section and the profile header. */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, StatusPill, useToast } from '@/design/components'
import { api } from '@/shell/api'
import { deltaTone } from '../polarity'
import type { CompanyRow, WorstStatus } from './types'
import { ADVERSE_WORD, NEWS_7D_MEANING, STATUS_TONE, STATUS_WORD, dealCount, delinquencyText, errText } from './util'
import './companies.css'

export function NameCell({ r, href }: { r: { name: string; deals: unknown[] }; href: string }) {
  return (
    <span className="co-name">
      <Link to={href} onClick={e => e.stopPropagation()}>{r.name}</Link>
      <small>{dealCount(r.deals.length)}</small>
    </span>
  )
}

export function StatusWord({ status, size = 'sm' }: { status: WorstStatus; size?: 'sm' | 'md' }) {
  if (!status) return <StatusPill tone="neutral" size={size}>Not published</StatusPill>
  return <StatusPill tone={STATUS_TONE[status]} size={size}>{STATUS_WORD[status]}</StatusPill>
}

export function StatusCell({ r, counts = true }: { r: CompanyRow; counts?: boolean }) {
  return (
    <span className="co-status">
      <StatusWord status={r.status} />
      {counts && <span className="co-sub">{r.breach} breach · {r.watch} watch</span>}
    </span>
  )
}

const ARROW = { up: '↑', down: '↓', flat: '—' } as const
const WORD = { up: 'Up', down: 'Down', flat: 'Flat' } as const

/** Latest delinquency (a range across several deals). The arrow and word give the direction; the colour says good or
 * bad (rising delinquency is bad), from the shared polarity rules. */
export function DelinquencyCell({ d }: { d: CompanyRow['delinquency'] }) {
  const text = delinquencyText(d)
  const dir = d.direction
  if (!dir || text === '—') return <span className="pf-num">{text}</span>
  const tone = deltaTone('delinquency_ratio', dir)
  const cls = tone === 'good' ? 'pf-trend--good' : tone === 'bad' ? 'pf-trend--bad' : 'pf-trend--flat'
  const judged = tone === 'good' ? ', better' : tone === 'bad' ? ', worse' : ''
  return (
    <span className="pf-nowrap">
      <span className="pf-num">{text}</span>{' '}
      <span className={`pf-trend ${cls}`} title={`${WORD[dir]} vs the prior month${judged}`}>
        <span aria-hidden="true">{ARROW[dir]}</span> {WORD[dir]}
      </span>
    </span>
  )
}

export function NewsCell({ n }: { n: number }) {
  return <span className={n ? 'pf-num' : 'pf-num pf-muted'} title={NEWS_7D_MEANING}>{n ? `${n} new` : '0'}</span>
}

/** The news_7d column header: the tooltip says what is counted (decision E3). */
export function NewsHeader({ label }: { label: string }) {
  return <span title={NEWS_7D_MEANING}>{label}<span className="ds-visually-hidden">: {NEWS_7D_MEANING.toLowerCase()}</span></span>
}

export function AdverseCell({ a }: { a: CompanyRow['adverse'] }) {
  const tone = a.state === 'to_review' ? 'warn' : a.state === 'clear' ? 'ok' : 'neutral'
  return <StatusPill tone={tone} size="sm">{ADVERSE_WORD(a)}</StatusPill>
}

/** Follow star (PUT / DELETE /companies/{slug}/follow). Following is per person, so it needs a signed-in user; in
 * role-only mode it is disabled and says why. */
export function FollowStar({ slug, name, following, signedIn, onChange, variant = 'star' }: {
  slug: string; name: string; following: boolean; signedIn: boolean; onChange: (following: boolean) => void; variant?: 'star' | 'button'
}) {
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()
  const toggle = async () => {
    if (!signedIn || busy) return
    setBusy(true)
    const next = !following
    try {
      await api<void>(`/companies/${encodeURIComponent(slug)}/follow`, { method: next ? 'PUT' : 'DELETE' })
      onChange(next)
    } catch (e) { toast({ tone: 'bad', title: next ? 'Could not follow' : 'Could not stop following', message: errText(e) }) }
    finally { setBusy(false) }
  }
  const hint = signedIn ? undefined : 'Sign in as a user to follow companies'
  if (variant === 'button') {
    return (
      <Button size="sm" aria-pressed={following} disabled={!signedIn} loading={busy} title={hint}
        onClick={e => { e.stopPropagation(); void toggle() }}>
        <span aria-hidden="true">{following ? '★' : '☆'}</span> {following ? 'Following' : 'Follow'}
      </Button>
    )
  }
  return (
    <button type="button" className="co-star" aria-pressed={following} disabled={!signedIn || busy}
      aria-label={following ? `Stop following ${name}` : `Follow ${name}`} title={hint ?? (following ? 'Following' : 'Follow')}
      onClick={e => { e.stopPropagation(); void toggle() }}>
      <span aria-hidden="true">{following ? '★' : '☆'}</span>
    </button>
  )
}
