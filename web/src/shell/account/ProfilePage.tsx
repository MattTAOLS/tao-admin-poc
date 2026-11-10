import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, DataTable, Field, Input, Select, SkeletonBlock, StatePanel, StatusPill, useToast, type Column } from '@/design/components'
import { api } from '../api'
import { usePageHeader } from '../header'
import { loadRole, roleLabel, type Role } from '../roles'
import { sessionStore, useSession } from '../session'
import type { AppUser, AuditRow, DateFormat, Me, MePatch, NotificationKind, NotificationPref, NumberFormat, Subscription } from '../types'
import { SignInNote, TAO_ONLY_KINDS, formatAmount, formatDate, formatDateTime, periodLabel, useShell, withDefaults, type ShellId } from './common'
import './account.css'

const TAO_ROLES: Role[] = ['tao_admin', 'tao_analyst']
const isTao = (r: Role) => TAO_ROLES.includes(r)
const COMPANY: Record<string, string> = { investor: 'Investor', manager: 'Manager' }
export const companyOf = (u: Pick<AppUser, 'role' | 'partner_slug'>) => (isTao(u.role) ? 'TAO Solutions Inc.' : COMPANY[u.partner_slug ?? ''] ?? u.partner_slug ?? '')

export const TIME_ZONES = ['America/Toronto', 'America/Vancouver', 'America/Edmonton', 'America/Winnipeg', 'America/Halifax', 'America/New_York', 'Europe/London', 'UTC']
const DATE_FORMATS: DateFormat[] = ['D MMM YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY']
const NUMBER_FORMATS: NumberFormat[] = ['1,234.56', '1 234,56']
/** Sample instant for the format previews: settlement of the August 2026 reports (7 Aug 2026, noon Toronto). */
const SAMPLE_DAY = '2026-08-07T16:00:00Z'
/** F-PIL 2.0 program limit (seed/README.md), for the number preview. */
const SAMPLE_AMOUNT = 150_000_000

export const PREF_LABEL: Record<NotificationKind, string> = {
  mention: 'Someone @mentions you',
  reply: 'A reply in a thread you are in',
  report_needs_review: 'Report waiting for approval',
  report_published: 'Report published',
  correction_published: 'Correction published',
  covenant_changed: 'Covenant status changed (WATCH or BREACH)',
  report_rejected: 'Report rejected',
  user_change: 'Changes to your account or the reports you receive',
  system: 'System events, such as a failed extraction',
  adverse_media: 'Adverse media',
  negative_news: 'Negative news',
  report_late: 'Report late',
}

/** One line under the event name, where the name alone does not say who it is for. */
export const PREF_HELP: Partial<Record<NotificationKind, { tao: string; partner: string }>> = {
  adverse_media: {
    tao: 'A new adverse media item (litigation, regulatory, fraud, insolvency or sanctions keywords) on a company you follow.',
    partner: 'An adverse media item on a company you follow, once TAO has reviewed it.',
  },
  negative_news: {
    tao: 'A news item screened Negative on a company you follow.',
    partner: 'A news item screened Negative on a company you follow.',
  },
  report_late: {
    tao: 'A deal you receive has no report 5 business days after it was due. Once per deal and month.',
    partner: '',
  },
}

const ACTION_LABEL: Record<string, string> = {
  upload: 'Upload', extract: 'Extraction', reextract: 'Re-extract', override: 'Override', restate: 'Restatement', approve: 'Approve',
  reject: 'Reject', publish: 'Publish', regenerate: 'Regenerate', master_change: 'Master data change', export: 'Export',
  value_edit: 'Value edit', value_edit_revert: 'Value edit reverted', correction: 'Correction', correction_approve: 'Correction approved',
  correction_reject: 'Correction rejected', user_change: 'User change', prefs_change: 'Profile change', settings_change: 'Settings change',
  comment: 'Comment', comment_edit: 'Comment edited', thread_resolve: 'Thread resolved', thread_reopen: 'Thread reopened',
}

/** Profile (design D9), one component for /admin/settings/profile and the partner /settings/profile. */
export default function ProfilePage() {
  const shell = useShell()
  const { mode, me } = useSession()
  usePageHeader({ title: 'Profile', subtitle: 'Your details, how the portal shows dates and numbers, what you are told about, and your sign-in.' })
  const role = me?.role ?? loadRole()
  if (mode === 'pending') return <div className="acct" aria-busy="true"><Card><SkeletonBlock lines={6} /></Card></div>
  if (mode === 'role-only' || !me?.user) {
    return <div className="acct"><SignInNote what="Your profile, notification preferences and activity" role={role} /><SecurityCard /></div>
  }
  return <ProfileView shell={shell} me={me as Me & { user: AppUser }} />
}

export function ProfileView({ shell, me }: { shell: ShellId; me: Me & { user: AppUser } }) {
  const partner = !isTao(me.role)
  return (
    <div className="acct acct-profile">
      <DetailsCard me={me} />
      <DisplayCard me={me} />
      <PrefsCard partner={partner} />
      {partner && <SubscriptionsCard userId={me.user.id} companyAdmin={me.role.endsWith('_admin')} />}
      <ActivityCard me={me} shell={shell} />
      <SecurityCard />
    </div>
  )
}

/** PATCH /me with the changed fields; the session (and the sidebar card) take the new values. */
async function patchMe(body: MePatch): Promise<Me> {
  const next = await api<Me>('/me', { method: 'PATCH', body: JSON.stringify(body) })
  sessionStore.set({ me: next })
  return next
}

function DetailsCard({ me }: { me: Me & { user: AppUser } }) {
  const [name, setName] = useState(me.user.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const { toast } = useToast()
  useEffect(() => { setName(me.user.name) }, [me.user.name])
  const partner = !isTao(me.role)
  const trimmed = name.trim()
  const dirty = trimmed !== me.user.name
  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!trimmed) { setError('Enter your name.'); return }
    setBusy(true); setError(undefined)
    try { await patchMe({ name: trimmed }); toast({ tone: 'ok', title: 'Name saved' }) }
    catch (err) { setError((err as Error).message || 'Could not save.') }
    finally { setBusy(false) }
  }
  return (
    <Card title="Personal details" subtitle="Shown on comments, @mentions and audit entries.">
      <form className="acct-form" onSubmit={save}>
        <Field label="Full name" required error={error}><Input value={name} onChange={e => setName(e.target.value)} autoComplete="name" /></Field>
        <dl className="acct-dl acct-dl--grid">
          <dt>Email</dt><dd>{me.user.email}</dd>
          <dt>Role</dt><dd>{roleLabel(me.role)}</dd>
          <dt>Company</dt><dd>{companyOf(me.user)}</dd>
        </dl>
        <p className="acct-muted">Email, role and company are managed by your admin: {partner
          ? 'your Company Admin in Team members, or a TAO Admin in User management.'
          : 'a TAO Admin in User management.'}</p>
        <div className="acct-actions">
          <Button type="button" variant="ghost" disabled={!dirty || busy} onClick={() => { setName(me.user.name); setError(undefined) }}>Discard</Button>
          <Button type="submit" variant="primary" disabled={!dirty} loading={busy}>Save name</Button>
        </div>
      </form>
    </Card>
  )
}

function DisplayCard({ me }: { me: Me }) {
  const saved = withDefaults(me.display)
  const [d, setD] = useState(saved)
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()
  useEffect(() => { setD(withDefaults(me.display)) }, [me.display])
  const changed = (Object.keys(saved) as (keyof typeof saved)[]).filter(k => d[k] !== saved[k])
  const zones = TIME_ZONES.includes(d.time_zone) ? TIME_ZONES : [d.time_zone, ...TIME_ZONES]
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await patchMe(Object.fromEntries(changed.map(k => [k, d[k]])) as MePatch)
      toast({ tone: 'ok', title: 'Display settings saved' })
    } catch (err) { toast({ tone: 'bad', title: 'Could not save display settings', message: (err as Error).message }) }
    finally { setBusy(false) }
  }
  return (
    <Card title="Display" subtitle="How your screens show dates, times and numbers. Stored figures do not change.">
      <form className="acct-form" onSubmit={save}>
        <div className="acct-row">
          <Field label="Time zone" hint="Notification and activity times use this zone. Audit entries are stored in UTC.">
            <Select value={d.time_zone} onChange={e => setD({ ...d, time_zone: e.target.value })} options={zones.map(z => ({ value: z, label: z }))} />
          </Field>
          <Field label="Date format" hint={`Example: ${formatDate(SAMPLE_DAY, d)}`}>
            <Select value={d.date_format} onChange={e => setD({ ...d, date_format: e.target.value as DateFormat })} options={DATE_FORMATS.map(f => ({ value: f, label: formatDate(SAMPLE_DAY, { ...d, date_format: f }) }))} />
          </Field>
          <Field label="Number format" hint={`Example: F-PIL 2.0 program limit ${formatAmount(SAMPLE_AMOUNT, d.number_format)}`}>
            <Select value={d.number_format} onChange={e => setD({ ...d, number_format: e.target.value as NumberFormat })} options={NUMBER_FORMATS.map(f => ({ value: f, label: formatAmount(SAMPLE_AMOUNT, f) }))} />
          </Field>
        </div>
        <p className="acct-muted">Collection periods always read as a month (Aug 2026 or 2026-08), never as a day.</p>
        <div className="acct-actions">
          <Button type="button" variant="ghost" disabled={!changed.length || busy} onClick={() => setD(saved)}>Discard</Button>
          <Button type="submit" variant="primary" disabled={!changed.length} loading={busy}>Save display</Button>
        </div>
      </form>
    </Card>
  )
}

/** report_late is TAO only (decision S3): never offered in a partner's preferences, whatever the API lists. */
export const forShell = (rows: NotificationPref[], partner: boolean) => (partner ? rows.filter(r => !TAO_ONLY_KINDS.includes(r.kind)) : rows)

function PrefsCard({ partner }: { partner: boolean }) {
  const [saved, setSaved] = useState<NotificationPref[] | null>(null)
  const [rows, setRows] = useState<NotificationPref[]>([])
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()
  useEffect(() => {
    api<NotificationPref[]>('/me/notification-prefs').then(r => { const own = forShell(r, partner); setSaved(own); setRows(own) }).catch(e => setError((e as Error).message || 'Could not load your notification settings.'))
  }, [])
  const dirty = useMemo(() => JSON.stringify(rows) !== JSON.stringify(saved), [rows, saved])
  const put = async (body: NotificationPref[], done: string) => {
    setBusy(true)
    try {
      const r = await api<NotificationPref[]>('/me/notification-prefs', { method: 'PUT', body: JSON.stringify(body.map(({ kind, in_app, digest }) => ({ kind, in_app, digest }))) })
      const own = forShell(r, partner); setSaved(own); setRows(own); toast({ tone: 'ok', title: done })
    } catch (e) { toast({ tone: 'bad', title: 'Could not save notification settings', message: (e as Error).message }) }
    finally { setBusy(false) }
  }
  const set = (kind: NotificationKind, patch: Partial<NotificationPref>) => setRows(rs => rs.map(r => (r.kind === kind ? { ...r, ...patch } : r)))
  const columns: Column<NotificationPref>[] = [
    { key: 'kind', header: 'Event', emphasis: true, render: r => {
      const help = PREF_HELP[r.kind]?.[partner ? 'partner' : 'tao']
      return <>{PREF_LABEL[r.kind] ?? r.kind}{help && <span className="acct-hint">{help}</span>}</>
    } },
    { key: 'in_app', header: 'In the portal', render: r => r.required
      ? <span className="acct-lock"><input type="checkbox" checked disabled aria-label={`${PREF_LABEL[r.kind]}: in the portal (always on)`} /> Always on</span>
      : <input type="checkbox" checked={r.in_app} onChange={e => set(r.kind, { in_app: e.target.checked })} aria-label={`${PREF_LABEL[r.kind]}: in the portal`} /> },
    { key: 'email', header: 'Email', render: () => <span className="acct-muted">Coming later</span> },
    { key: 'digest', header: 'Email delivery', render: r => (
      <select className="ds-input acct-select-sm" value={r.digest} onChange={e => set(r.kind, { digest: e.target.value as NotificationPref['digest'] })} aria-label={`${PREF_LABEL[r.kind]}: email delivery`}>
        <option value="instant">Instant</option><option value="daily">Daily digest</option>
      </select>) },
  ]
  return (
    <Card title="Notification preferences" padding="flush"
      subtitle={partner ? 'Events a partner can receive. Report events come only for the deals you receive.' : 'Report events come only for the deals you receive. Mentions reach you whatever you receive.'}
      actions={<Button size="sm" variant="ghost" disabled={busy || !saved} onClick={() => void put([], 'Notification settings reset to the defaults')}>Reset to defaults</Button>}>
      {error && <StatePanel kind="error" message={error} />}
      {!error && !saved && <div className="acct-pad"><SkeletonBlock lines={4} /></div>}
      {saved && (
        <>
          <DataTable columns={columns} rows={rows} rowKey={r => r.kind} caption="Notification preferences" density="compact" captionHidden />
          <div className="acct-pad">
            <p className="acct-muted">In-app items always arrive at once. Email is coming later: the delivery choice is kept for when it arrives. Covenant changes and corrections cannot be switched off.</p>
            <div className="acct-actions">
              <Button type="button" variant="ghost" disabled={!dirty || busy} onClick={() => setRows(saved)}>Discard</Button>
              <Button type="button" variant="primary" disabled={!dirty} loading={busy} onClick={() => void put(rows, 'Notification settings saved')}>Save preferences</Button>
            </div>
          </div>
        </>
      )}
    </Card>
  )
}

type Names = { programs: Record<string, string>; deals: Record<string, string>; dealCount: Record<string, number> }
type PortfolioLite = { programs?: { program?: { slug: string; name: string }; deals?: { deal_slug: string; deal_name: string }[] }[] }

function SubscriptionsCard({ userId, companyAdmin }: { userId: string; companyAdmin: boolean }) {
  const [subs, setSubs] = useState<Subscription[] | null>(null)
  const [names, setNames] = useState<Names>({ programs: {}, deals: {}, dealCount: {} })
  const [error, setError] = useState<string>()
  useEffect(() => {
    let live = true
    api<Subscription[]>(`/users/${userId}/subscriptions`).then(s => { if (live) setSubs(s) }).catch(e => { if (live) setError((e as Error).message || 'Could not load your report subscriptions.') })
    api<PortfolioLite>('/published/portfolio').then(p => {
      if (!live) return
      const n: Names = { programs: {}, deals: {}, dealCount: {} }
      for (const pr of p.programs ?? []) {
        if (!pr.program) continue
        n.programs[pr.program.slug] = pr.program.name; n.dealCount[pr.program.slug] = pr.deals?.length ?? 0
        for (const d of pr.deals ?? []) n.deals[d.deal_slug] = d.deal_name
      }
      setNames(n)
    }).catch(() => { /* slugs are shown instead of names */ })
    return () => { live = false }
  }, [userId])
  const byProgram = useMemo(() => {
    const m = new Map<string, Subscription[]>()
    for (const s of subs ?? []) m.set(s.program_slug, [...(m.get(s.program_slug) ?? []), s])
    return [...m.entries()]
  }, [subs])
  const channels = (c: Subscription['channels']) => c.map(x => (x === 'in_app' ? 'In-app' : 'Email')).join(' · ')
  return (
    <Card title="Report subscriptions" subtitle="The reports you are told about. Managed by your admin." actions={<StatusPill tone="neutral" size="sm">Read-only</StatusPill>}>
      {error && <StatePanel kind="error" message={error} />}
      {!error && subs === null && <SkeletonBlock lines={2} />}
      {subs && subs.length === 0 && <p>You receive no reports yet. You can still open every report shared with your company in the portal.</p>}
      {subs && subs.length > 0 && (
        <table className="ds-table acct-table">
          <caption className="ds-visually-hidden">Report subscriptions</caption>
          <thead><tr><th scope="col">Program</th><th scope="col">Deals</th><th scope="col">Channel</th></tr></thead>
          <tbody>
            {byProgram.map(([p, rows]) => {
              const all = rows.find(r => r.deal_slug === null)
              const deals = rows.filter(r => r.deal_slug)
              const count = names.dealCount[p]
              return (
                <tr key={p}>
                  <td>{names.programs[p] ?? p}</td>
                  <td>{all ? `All deals${count ? ` (${count})` : ''}, including new ones` : deals.map(d => names.deals[d.deal_slug!] ?? d.deal_slug).join(', ')}</td>
                  <td>{channels((all ?? deals[0]).channels)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <p className="acct-muted">{companyAdmin
        ? 'You change who receives what for your team in Team members. A subscription decides what you are told about; it never changes what you can open.'
        : 'To add or remove a report, ask your Company Admin (Team members) or TAO. A subscription decides what you are told about; it never changes what you can open.'}</p>
    </Card>
  )
}

function ActivityCard({ me, shell }: { me: Me & { user: AppUser }; shell: ShellId }) {
  const tao = isTao(me.role)
  const [rows, setRows] = useState<AuditRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const q = `/audit?actor_user_id=${encodeURIComponent(me.user.id)}${tao ? '&scope=reports' : ''}&limit=10`
    let live = true
    api<AuditRow[]>(q).then(r => { if (live) setRows(r) }).catch(() => { if (live) { setRows([]); setFailed(true) } })
    return () => { live = false }
  }, [me.user.id, tao])
  const columns: Column<AuditRow>[] = [
    { key: 'at', header: 'When', render: r => formatDateTime(r.at, me.display) },
    { key: 'action', header: 'Action', render: r => ACTION_LABEL[r.action] ?? r.action },
    { key: 'what', header: 'What', render: r => [r.deal_name ?? r.deal_slug, periodLabel(r.collection_period)].filter(Boolean).join(' · ') || r.reason || '—' },
  ]
  return (
    <Card title="My activity" padding="flush"
      subtitle={tao ? 'Your last 10 entries on the Reports side of the audit log.' : 'Your last 10 recorded actions.'}
      actions={tao && shell === 'admin' ? <Button as="link" to="/admin/settings/users/audit" size="sm" variant="ghost">Open in Audit log</Button> : undefined}>
      {rows === null && <div className="acct-pad"><SkeletonBlock lines={3} /></div>}
      {rows && rows.length > 0 && <DataTable columns={columns} rows={rows} rowKey={r => r.id} caption="My activity" density="compact" captionHidden />}
      {rows && rows.length === 0 && (
        <p className="acct-pad acct-muted">{failed
          ? 'Your activity could not be loaded.'
          : tao ? 'Nothing yet. Uploads, comments, resolutions and publishes you make appear here.' : 'Nothing yet. Downloads and other actions you take appear here.'}</p>
      )}
    </Card>
  )
}

export function SecurityCard() {
  const shell = useShell()
  return (
    <Card title="Security" actions={<StatusPill tone="warn" size="sm">No real sign-in yet</StatusPill>}>
      <p><b>The POC has no real sign-in.</b> Anyone who opens the app picks a sample user in <b>Sign in as (POC)</b>, and the API trusts that choice. There is no password, no two-step verification and no session to list.</p>
      <p className="acct-muted">Real sign-in, with two-step verification for TAO roles, comes with production. Until then, do not treat the user you picked as security.</p>
      <p className="acct-muted">More: <Link to={shell === 'admin' ? '/admin/help#sign-in' : `/${shell}/help#sign-in`}>Help › Sign in as a user</Link></p>
    </Card>
  )
}
