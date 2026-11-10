import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Card, SkeletonBlock, StatePanel, StatusPill, icons, useToast, type Tone } from '@/design/components'
import type { ComponentType } from 'react'
import { api, refreshUnread } from '../api'
import { usePageHeader } from '../header'
import { loadRole } from '../roles'
import { useSession } from '../session'
import type { AppNotification, DisplayPrefs, NotificationKind, NotificationTab, NumberFormat, UnreadCount } from '../types'
import { SignInNote, dayKey, formatAmount, formatDate, formatTime, notificationTarget, periodLabel, profilePath, useShell, withDefaults, type ShellId } from './common'
import './account.css'

type KindIcon = ComponentType<{ width?: number; height?: number }>
/** Label, tone, icon and open-button text per kind. Status is always a dot plus a word; the icon is decoration. */
export const KIND: Record<NotificationKind, { label: string; tone: Tone; open: string; icon: KindIcon }> = {
  mention: { label: 'Mention', tone: 'blue', open: 'Open thread', icon: icons.IconUser },
  reply: { label: 'Reply', tone: 'blue', open: 'Open thread', icon: icons.IconUsers },
  report_needs_review: { label: 'Needs review', tone: 'warn', open: 'Open review', icon: icons.IconInbox },
  report_published: { label: 'Published', tone: 'ok', open: 'Open report', icon: icons.IconBook },
  correction_published: { label: 'Correction', tone: 'dpv', open: 'Open report', icon: icons.IconRefresh },
  covenant_changed: { label: 'Covenant', tone: 'warn', open: 'Open covenant', icon: icons.IconChart },
  report_rejected: { label: 'Rejected', tone: 'bad', open: 'Open upload', icon: icons.IconClose },
  user_change: { label: 'Account', tone: 'neutral', open: 'Open', icon: icons.IconSettings },
  system: { label: 'System', tone: 'neutral', open: 'Open', icon: icons.IconAlert },
  // Wave D: company alerts. Each opens its notification link (the company profile, or the deal for report_late).
  adverse_media: { label: 'Adverse media', tone: 'bad', open: 'Open adverse media', icon: icons.IconShield },
  negative_news: { label: 'Negative news', tone: 'warn', open: 'Open news', icon: icons.IconNews },
  report_late: { label: 'Report late', tone: 'warn', open: 'Open deal', icon: icons.IconClock },
}

/** The tab each kind sits in (contract: Notification tabs; wave D adds the company alerts to Reports). The API filters by
 * tab; this map is the same rule for anything the client groups. */
export const KIND_TAB: Record<NotificationKind, Exclude<NotificationTab, 'all'>> = {
  mention: 'mentions', reply: 'mentions',
  report_needs_review: 'reports', report_published: 'reports', correction_published: 'reports', covenant_changed: 'reports',
  report_rejected: 'reports', adverse_media: 'reports', negative_news: 'reports', report_late: 'reports',
  user_change: 'system', system: 'system',
}
export { TAO_ONLY_KINDS } from './common'
const REPORT_KINDS: NotificationKind[] = ['report_published', 'correction_published']

/** Tabs per shell. Partners are never mentioned (comments are internal to TAO), so their inbox has no Mentions tab. */
export const TABS: Record<'tao' | 'partner', { id: NotificationTab; label: string }[]> = {
  tao: [{ id: 'all', label: 'All' }, { id: 'mentions', label: 'Mentions' }, { id: 'reports', label: 'Reports' }, { id: 'system', label: 'System' }],
  partner: [{ id: 'all', label: 'All' }, { id: 'reports', label: 'Reports' }, { id: 'system', label: 'System' }],
}
const unreadFor = (u: UnreadCount | null, t: NotificationTab) => (u ? (t === 'all' ? u.total : u[t]) : 0)
/** Notifications per request. A full page means there may be older ones: "Show older" asks for the next page (offset). */
export const PAGE_SIZE = 100

/** Notifications inbox (design D7 a and d), one component for /admin/notifications and the partner /notifications. */
export default function NotificationsPage() {
  const shell = useShell()
  const { mode, me } = useSession()
  const role = me?.role ?? loadRole()
  usePageHeader({
    title: 'Notifications',
    subtitle: shell === 'admin' ? 'Mentions, reports that need you and platform events.' : 'New reports, corrections and covenant changes for the deals you receive.',
  })
  if (mode === 'pending') return <div className="acct" aria-busy="true"><Card><SkeletonBlock lines={4} /></Card></div>
  if (mode === 'role-only' || !me) return <div className="acct"><SignInNote what="Notifications" role={role} /></div>
  return <NotificationsView shell={shell} display={me.display} />
}

export function NotificationsView({ shell, display }: { shell: ShellId; display?: DisplayPrefs }) {
  const partner = shell !== 'admin'
  const tabs = TABS[partner ? 'partner' : 'tao']
  const [params, setParams] = useSearchParams()
  const tab = (tabs.find(t => t.id === params.get('tab'))?.id ?? 'all') as NotificationTab
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [items, setItems] = useState<AppNotification[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const { unread, me, features } = useSession()
  const role = me?.role ?? loadRole()
  const nav = useNavigate()
  const { toast } = useToast()
  const prefs = withDefaults(display)

  // Every request takes a number; only the newest one may write its answer, so a slow tab's answer never lands on the
  // tab selected after it (audit L19). Changing tab or filter, and leaving the page, retire the request in flight.
  const seq = useRef(0)
  const path = useCallback((offset: number) =>
    `/notifications?tab=${tab}${unreadOnly ? '&unread=true' : ''}&limit=${PAGE_SIZE}${offset ? `&offset=${offset}` : ''}`, [tab, unreadOnly])
  const load = useCallback(async () => {
    const id = ++seq.current
    setError(null); setLoadingOlder(false)
    try {
      const page = await api<AppNotification[]>(path(0))
      if (seq.current !== id) return
      setItems(page); setMore(page.length === PAGE_SIZE)
    } catch (e) {
      if (seq.current !== id) return
      setItems([]); setMore(false); setError((e as Error).message || 'The notifications could not be loaded.')
    }
  }, [path])
  useEffect(() => { setItems(null); setMore(false); void load(); return () => { seq.current++ } }, [load])
  /** The next page of older notifications, added under the ones shown (audit L22). */
  const showOlder = async () => {
    if (!items || loadingOlder) return
    const id = ++seq.current
    setLoadingOlder(true)
    try {
      const page = await api<AppNotification[]>(path(items.length))
      if (seq.current !== id) return
      setItems(cur => { const have = new Set((cur ?? []).map(n => n.id)); return [...(cur ?? []), ...page.filter(n => !have.has(n.id))] })
      setMore(page.length === PAGE_SIZE); setLoadingOlder(false)
    } catch (e) {
      if (seq.current !== id) return
      setLoadingOlder(false)
      toast({ tone: 'bad', title: 'Could not load older notifications', message: (e as Error).message })
    }
  }

  const setTab = (t: NotificationTab) => { const n = new URLSearchParams(params); if (t === 'all') n.delete('tab'); else n.set('tab', t); setParams(n, { replace: true }) }
  const onTabKey = (e: KeyboardEvent, i: number) => {
    const n = tabs.length
    const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1
    if (to < 0) return
    e.preventDefault(); setTab(tabs[to].id)
    ;(e.currentTarget.parentElement?.children[to] as HTMLElement | undefined)?.focus()
  }

  /** Opening a row marks it read, then goes where it happened. */
  const open = async (n: AppNotification) => {
    if (!n.read_at) {
      try { await api(`/notifications/${n.id}/read`, { method: 'POST' }) } catch { /* the link still opens */ }
      void refreshUnread()
    }
    nav(notificationTarget(n.link, shell, role, features))
  }
  const markAll = async () => {
    try {
      const r = await api<{ marked: number }>(`/notifications/read-all?tab=${tab}`, { method: 'POST' })
      toast({ tone: 'ok', title: r.marked === 1 ? '1 notification marked read' : `${r.marked} notifications marked read` })
      await load(); void refreshUnread()
    } catch (e) { toast({ tone: 'bad', title: 'Could not mark them read', message: (e as Error).message }) }
  }

  const groups: { label: string; rows: AppNotification[] }[] = []
  if (items) {
    const today = dayKey(new Date().toISOString(), prefs)
    for (const n of items) {
      const k = dayKey(n.created_at, prefs)
      const label = k === today ? `Today · ${formatDate(n.created_at, prefs)}` : 'Earlier'
      const g = groups.find(x => x.label === label)
      if (g) g.rows.push(n); else groups.push({ label, rows: [n] })
    }
  }
  const unreadHere = unreadFor(unread, tab)

  return (
    <div className="acct ntf-page">
      <Card padding="flush" title={<span>Inbox</span>} subtitle={unread ? `${unread.total} unread` : undefined}
        actions={<Button variant="ghost" size="sm" onClick={markAll} disabled={!unreadHere}>Mark all read</Button>}>
        <div className="ntf-bar">
          <div role="tablist" aria-label="Notification types" className="ntf-tabs">
            {tabs.map((t, i) => {
              const c = unreadFor(unread, t.id)
              return (
                <button key={t.id} type="button" role="tab" id={`ntf-tab-${t.id}`} aria-selected={tab === t.id} aria-controls="ntf-panel" tabIndex={tab === t.id ? 0 : -1}
                  className="ntf-tab" onClick={() => setTab(t.id)} onKeyDown={e => onTabKey(e, i)}>
                  {t.label}{c ? <span className="ntf-tab__n"><span aria-hidden="true">{c}</span><span className="ds-visually-hidden"> ({c} unread)</span></span> : null}
                </button>
              )
            })}
          </div>
          <label className="ntf-unread"><input type="checkbox" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} /> Unread only</label>
        </div>
        <div role="tabpanel" id="ntf-panel" aria-labelledby={`ntf-tab-${tab}`} className="ntf-panel">
          {items === null && <div className="ntf-loading" aria-busy="true"><SkeletonBlock lines={4} /></div>}
          {error && <StatePanel kind="error" message={error} actions={<Button onClick={() => void load()}>Try again</Button>} />}
          {items && !error && items.length === 0 && (
            <StatePanel kind="empty" title={unreadOnly ? 'No unread notifications' : 'No notifications yet'}
              message={partner ? 'New reports, corrections and covenant changes for the deals you receive appear here.' : 'Mentions, reports that need you and platform events appear here.'} />
          )}
          {groups.map(g => (
            <section key={g.label} aria-label={g.label}>
              <h3 className="ntf-day">{g.label}</h3>
              <ul className="ntf-list">
                {g.rows.map(n => <NotificationRow key={n.id} n={n} partner={partner} prefs={prefs} onOpen={() => void open(n)} />)}
              </ul>
            </section>
          ))}
          {items && !error && more && (
            <div className="ntf-more"><Button variant="ghost" size="sm" onClick={() => void showOlder()} loading={loadingOlder}>Show older</Button></div>
          )}
        </div>
      </Card>
      <HowNotified shell={shell} />
    </div>
  )
}

export function NotificationRow({ n, partner, prefs, onOpen }: { n: AppNotification; partner: boolean; prefs: Required<DisplayPrefs>; onOpen: () => void }) {
  const k = KIND[n.kind] ?? KIND.system
  const openLabel = n.kind === 'mention' && (n.link ?? '').includes('?note=') ? 'Open note' : k.open   // company note vs comment thread
  const unread = !n.read_at
  const today = dayKey(n.created_at, prefs) === dayKey(new Date().toISOString(), prefs)
  return (
    <li className={['ntf', unread && 'is-unread'].filter(Boolean).join(' ')} data-testid="notification">
      <div className="ntf__main">
        <h4 className="ntf__title">{n.title}</h4>
        {n.body && <p className="ntf__body">{n.body}</p>}
        {n.changes && n.changes.length > 0 && <Changes changes={n.changes} nf={prefs.number_format} />}
        {REPORT_KINDS.includes(n.kind) && (partner
          ? (n.note_from_tao
            ? <div className="ntf__note"><b>Note from TAO</b><p>{n.note_from_tao}</p></div>
            : <p className="ntf__nonote">No note from TAO.</p>)
          : (n.note_from_tao ? <div className="ntf__note"><b>Note to partners</b><p>{n.note_from_tao}</p></div> : null))}
        <div className="ntf__meta">
          <span className="ntf__kind"><k.icon width={14} height={14} /><StatusPill tone={k.tone} size="sm">{k.label}</StatusPill></span>
          {n.collection_period && <span>{periodLabel(n.collection_period)}</span>}
          {n.version != null && n.version > 1 && <span>Version {n.version}</span>}
          {unread ? <StatusPill tone="dpv" size="sm">Unread</StatusPill> : <StatusPill tone="neutral" size="sm">Read</StatusPill>}
        </div>
      </div>
      <div className="ntf__side">
        <time dateTime={n.created_at}>{today ? formatTime(n.created_at, prefs) : `${formatDate(n.created_at, prefs)}, ${formatTime(n.created_at, prefs)}`}</time>
        <Button size="sm" variant={unread ? 'primary' : 'ghost'} onClick={onOpen} aria-label={`${openLabel}: ${n.title}`}>{openLabel}</Button>
      </div>
    </li>
  )
}

function Changes({ changes, nf }: { changes: NonNullable<AppNotification['changes']>; nf: NumberFormat }) {
  return (
    <ul className="ntf__changes" aria-label="Changed values">
      {changes.map((c, i) => (
        <li key={c.pointer ?? i}><span>{c.label ?? c.pointer}</span> <span className="num">{formatAmount(c.old_value, nf)}</span> <span aria-label="changed to">→</span> <span className="num">{formatAmount(c.new_value, nf)}</span></li>
      ))}
    </ul>
  )
}

/** "How you are notified": in-app now, email later (decision C5). */
export function HowNotified({ shell }: { shell: ShellId }) {
  const partner = shell !== 'admin'
  const companyAdmin = partner && loadRole().endsWith('_admin')
  return (
    <Card title="How you are notified" subtitle="Your own setting" className="acct-how">
      <dl className="acct-dl">
        <dt>In the portal</dt>
        <dd>On for every type you keep on in <Link to={profilePath(shell)}>Profile › Notification preferences</Link>. Covenant changes and corrections cannot be switched off.</dd>
        <dt>Companies you follow</dt>
        <dd>{partner
          ? <>Adverse media TAO has reviewed, and negative news, for companies you follow. Shown while TAO has company profiles on.</>
          : <>Adverse media and negative news for companies you follow, and a late report for deals you receive. They sit under Reports.</>}</dd>
        <dt>Email</dt>
        <dd><StatusPill tone="neutral" size="sm">Coming later</StatusPill> The POC does not send email yet; everything arrives here.</dd>
        <dt>Which reports</dt>
        <dd>{partner
          ? <>Report notifications come for the deals you receive. {companyAdmin ? 'You set them for your team in Team members.' : 'Your Company Admin sets them in Team members, or TAO in User management.'}</>
          : <>Report notifications come for the deals you receive, set by a TAO Admin in User management. Mentions reach you whatever you receive.</>}</dd>
      </dl>
    </Card>
  )
}
