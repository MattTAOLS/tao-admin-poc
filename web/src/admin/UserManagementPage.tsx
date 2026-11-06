import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Button, Card, DataTable, Dialog, Field, Input, KpiTile, Select, StatePanel, StatusPill, Textarea, formatNumber, icons, useToast, type Column,
} from '@/design/components'
import { usePageHeader } from '@/shell/header'
import type { Role } from '@/shell/roles'
import { adminApi, type ApiError, type AuditEntry, type Deal, type Partner, type Program } from './data'
import { useResource, useRole } from './hooks'
import { LoadError, TextLink, errorText, formatDateTime } from './ui'
import {
  ROLE_LABEL, ROLE_ORDER, USER_CHANGE_LABEL, dealTicked, filterUsers, fromTree, initials, isTaoRole, lockReason, partnerName, partnersForRole,
  receives, roleText, sameSubs, setAll, sortUsers, subsText, tickedCount, toTree, toggleDeal, usersApi, validEmail, visiblePrograms,
  type AppUser, type AppUserPatch, type Subscription, type Tree, type UserFilter,
} from './users'

const LOCK_TEXT = {
  self_change: 'You can’t change your own role or deactivate yourself. Another TAO Admin can.',
  last_admin: 'This is the last active admin for its company (TAO, or the partner). Add or promote another admin before changing this one.',
} as const

type Ctx = { users: AppUser[]; partners: Partner[]; programs: Program[]; deals: Deal[]; meId: string | null }

/** User management (D8 a, b). TAO Admin only (C3); the API answers 403 for anyone else. Every user, TAO and partner,
 * with filters; a drawer from the right edits details, role, status and the reports the user receives. */
export default function UserManagementPage() {
  const role = useRole()
  const [params, setParams] = useSearchParams()
  const [inviting, setInviting] = useState(false)
  const admin = role === 'tao_admin'
  const res = useResource(() => (admin
    ? Promise.all([usersApi.list(), adminApi.partners(), adminApi.programs(), adminApi.deals(), usersApi.me().then(m => m.user?.id ?? null, () => null)])
    : Promise.resolve(null)), [role])
  const filter: UserFilter = { partner: params.get('partner') ?? '', status: params.get('status') ?? '', q: params.get('q') ?? '' }
  const openId = params.get('user')
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }) }

  usePageHeader({
    title: 'User management',
    subtitle: 'Everyone who signs in: their role, status and which reports they receive. In-app notifications only in phase 2.',
  })

  if (!admin) return <StatePanel kind="no-access" message="User management is for TAO Admin. Switch role in the sidebar to see it." />
  if (res.error) return <LoadError error={res.error} onRetry={res.reload} />
  const [users, partners, programs, deals, meId] = res.data ?? [[], [], [], [], null]
  const ctx: Ctx = { users, partners, programs, deals, meId }
  const rows = sortUsers(filterUsers(users, filter))
  const selected = openId && openId !== 'new' ? users.find(u => u.id === openId) : undefined
  const loading = res.loading && !res.data
  const count = (f: (u: AppUser) => boolean) => users.filter(f).length

  const columns: Column<AppUser>[] = [
    { key: 'name', header: 'Name', emphasis: true, sortValue: u => u.name.toLowerCase(), render: u => (
      <span className="adm-person">
        <span className="adm-avatar" aria-hidden="true">{initials(u.name)}</span>
        <span><b>{u.name}</b>{meId === u.id && <span className="adm-tag adm-tag--muted">you</span>}<small>{u.email}</small></span>
      </span>
    ) },
    { key: 'role', header: 'Role', sortValue: u => ROLE_ORDER.indexOf(u.role), render: u => ROLE_LABEL[u.role] },
    { key: 'partner', header: 'Partner', sortValue: u => u.partner_slug ?? '', render: u => partnerName(u.partner_slug, partners) },
    { key: 'status', header: 'Status', render: u => <UserStatus u={u} /> },
    { key: 'last', header: 'Last active', sortValue: u => u.last_active_at ?? '', render: u => u.last_active_at ? <time className="adm-nowrap" dateTime={u.last_active_at}>{formatDateTime(u.last_active_at)}</time> : <span className="adm-muted">Never</span> },
    { key: 'receives', header: 'Reports received', render: u => <span className={receives(u).startsWith('None') ? 'adm-muted' : undefined}>{receives(u)}</span> },
    { key: 'edit', header: <span className="ds-visually-hidden">Edit</span>, align: 'right', render: u => <span className="adm-open" aria-hidden="true">Edit</span> },
  ]

  return (
    <div className="adm-stack">
      <div className="adm-tiles">
        <KpiTile label="Users" value={loading ? undefined : formatNumber(users.length)} loading={loading}
          context={`${formatNumber(count(u => u.partner_slug === null))} TAO · ${partners.map(p => `${formatNumber(count(u => u.partner_slug === p.slug))} ${p.name}`).join(' · ')}`} />
        <KpiTile label="Active" value={loading ? undefined : formatNumber(count(u => u.status === 'active'))} loading={loading} context="Can sign in and get notifications" />
        <KpiTile label="Deactivated" value={loading ? undefined : formatNumber(count(u => u.status === 'deactivated'))} loading={loading} context="Cannot sign in; history kept" />
      </div>
      <Card>
        <form className="adm-filters" role="search" aria-label="Filter users" onSubmit={e => e.preventDefault()}>
          <Field label="Partner">
            <Select value={filter.partner} onChange={e => set('partner', e.target.value || null)}>
              <option value="">Everyone</option>
              <option value="tao">TAO staff</option>
              {partners.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={filter.status} onChange={e => set('status', e.target.value || null)}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="deactivated">Deactivated</option>
            </Select>
          </Field>
          <Field label="Search" className="adm-grow">
            <Input type="search" value={filter.q} placeholder="Name or email" onChange={e => set('q', e.target.value || null)} />
          </Field>
          <Button onClick={() => setParams(openId ? { user: openId } : {}, { replace: true })} disabled={!filter.partner && !filter.status && !filter.q}>Clear filters</Button>
        </form>
      </Card>
      <Card title="Users" padding="flush" actions={<>
        <Button as="link" to="/admin/settings/users/roles" variant="ghost">Roles &amp; permissions</Button>
        <Button onClick={() => setInviting(true)}>Invite by email</Button>
        <Button variant="primary" icon={<icons.IconPlus width={16} height={16} />} onClick={() => set('user', 'new')}>Add user</Button>
      </>} subtitle={`${formatNumber(rows.length)} of ${formatNumber(users.length)} shown. Select a row to edit. Nobody is deleted: deactivated users keep their history.`}>
        <div className="adm-scroll">
          <DataTable className="adm-rowtable" columns={columns} rows={rows} rowKey={u => u.id} caption="Users" captionHidden loading={loading}
            onRowClick={u => set('user', u.id)} rowLabel={u => `Edit ${u.name}`} selectedKey={openId}
            empty={users.length ? { title: 'No users match these filters', action: <Button onClick={() => setParams({}, { replace: true })}>Clear filters</Button> }
              : { title: 'No users yet', message: 'Add the first user with Add user.' }} />
        </div>
      </Card>
      {res.data && (openId === 'new' || selected) && (
        <UserDrawer key={openId} user={selected ?? null} ctx={ctx} onClose={() => set('user', null)}
          onSaved={u => { res.reload(); set('user', u.id) }} />
      )}
      {res.data && openId && openId !== 'new' && !selected && (
        <div className="adm-note adm-note--warn" role="alert">No user with id <span className="adm-mono">{openId}</span>. <button type="button" className="adm-linkbtn" onClick={() => set('user', null)}>Close</button></div>
      )}
      {inviting && <InviteDialog partners={partners} onClose={() => setInviting(false)} onSaved={u => { setInviting(false); res.reload(); set('user', u.id) }} />}
    </div>
  )
}

function UserStatus({ u }: { u: AppUser }) {
  return u.status === 'active'
    ? <StatusPill tone="ok" size="sm">Active</StatusPill>
    : <StatusPill tone="neutral" size="sm" title={u.deactivation_reason ?? undefined}>Deactivated</StatusPill>
}

/** Every role, TAO first; partner roles name their company kind. */
function RoleOptions() {
  return <>
    <optgroup label="TAO Solutions">{ROLE_ORDER.filter(isTaoRole).map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</optgroup>
    <optgroup label="Investor">{(['investor_admin', 'investor_viewer'] as Role[]).map(r => <option key={r} value={r}>Investor · {ROLE_LABEL[r]}</option>)}</optgroup>
    <optgroup label="Manager">{(['manager_admin', 'manager_viewer'] as Role[]).map(r => <option key={r} value={r}>Manager · {ROLE_LABEL[r]}</option>)}</optgroup>
  </>
}

const ROLE_HELP = 'TAO Analyst uploads, reads every report and comments. TAO Admin also edits values and covenants, resolves findings, publishes and manages users. Company Admin manages their own team; Viewer reads the portal.'

/** The drawer (D8 b): details and role, status, reports this user receives, history. `user` null = Add user. */
function UserDrawer({ user, ctx, onClose, onSaved }: { user: AppUser | null; ctx: Ctx; onClose: () => void; onSaved: (u: AppUser) => void }) {
  const { toast } = useToast()
  const isNew = !user
  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [role, setRole] = useState<Role>(user?.role ?? 'tao_analyst')
  const [partner, setPartner] = useState<string | null>(user?.partner_slug ?? null)
  const [tree, setTree] = useState<Tree>({})
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [statusDialog, setStatusDialog] = useState<'deactivate' | 'reactivate' | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const subsRes = useResource(() => (user ? usersApi.subscriptions(user.id) : Promise.resolve([] as Subscription[])), [user?.id])
  useEffect(() => { if (subsRes.data) setTree(toTree(subsRes.data)) }, [subsRes.data])
  useEffect(() => { heading.current?.focus() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy && !statusDialog) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, statusDialog, onClose])

  const lock = user ? lockReason(user, ctx.users, ctx.meId) : null
  const partnerChoices = partnersForRole(role, ctx.partners)
  const onRole = (r: Role) => {
    setRole(r)
    const choices = partnersForRole(r, ctx.partners)
    setPartner(choices.some(p => p.slug === partner) ? partner : choices.length === 1 ? choices[0].slug : choices.length ? null : null)
  }
  const draftUser = { partner_slug: isTaoRole(role) ? null : partner }
  const programs = visiblePrograms(draftUser, ctx.programs)
  const subs = fromTree(Object.fromEntries(Object.entries(tree).filter(([p]) => programs.some(x => x.slug === p))), ctx.programs)
  const totalDeals = ctx.deals.filter(d => programs.some(p => p.slug === d.program_slug)).length
  const ticked = programs.reduce((n, p) => n + tickedCount(tree, p.slug, ctx.deals), 0)

  const errs = {
    name: !name.trim() ? 'Required.' : undefined,
    email: !email.trim() ? 'Required.' : !validEmail(email) ? 'An email address, e.g. name@example.com.' : undefined,
    partner: !isTaoRole(role) && !partner ? 'Choose the partner this person works for.' : undefined,
  }
  const e = (k: keyof typeof errs) => (touched ? errs[k] : undefined)
  const patch: AppUserPatch = {}
  if (user) {
    if (name.trim() !== user.name) patch.name = name.trim()
    if (email.trim() !== user.email) patch.email = email.trim()
    if (role !== user.role) patch.role = role
    if (draftUser.partner_slug !== user.partner_slug) patch.partner_slug = draftUser.partner_slug
  }
  const subsChanged = !subsRes.data ? subs.length > 0 : !sameSubs(subsRes.data, subs)
  const dirty = isNew || Object.keys(patch).length > 0 || subsChanged

  const save = async () => {
    setTouched(true)
    if (Object.values(errs).some(Boolean)) return
    setBusy(true); setError(undefined)
    try {
      let saved = user
      if (!user) saved = await usersApi.create({ name: name.trim(), email: email.trim(), role, partner_slug: draftUser.partner_slug })
      else if (Object.keys(patch).length) saved = await usersApi.patch(user.id, patch)
      if (subsChanged && saved) await usersApi.putSubscriptions(saved.id, subs)
      toast({ tone: 'ok', title: isNew ? `${name.trim()} added` : `${name.trim()} saved`, message: 'Each change is recorded on the Platform tab of the Audit log.' })
      onSaved(saved!)
    } catch (err) { setError(errorText(err as ApiError)) }
    finally { setBusy(false) }
  }

  return (
    <aside className="adm-drawer" role="dialog" aria-modal="false" aria-labelledby="adm-drawer-title">
      <div className="adm-drawer__head">
        <span className="adm-avatar adm-avatar--lg" aria-hidden="true">{initials(name || email || '?')}</span>
        <div>
          <h2 id="adm-drawer-title" tabIndex={-1} ref={heading}>{isNew ? 'Add user' : `Edit ${user.name}`}</h2>
          {user && <small>{roleText(user, ctx.partners)} · {user.last_active_at ? `last active ${formatDateTime(user.last_active_at)}` : 'never signed in'}</small>}
        </div>
        <button type="button" className="ds-iconbtn" aria-label="Close" onClick={onClose} disabled={busy}><icons.IconClose /></button>
      </div>
      <form className="adm-drawer__body" noValidate onSubmit={(ev: FormEvent) => { ev.preventDefault(); void save() }} id="adm-user-form">
        <section aria-labelledby="adm-sec-details">
          <h3 id="adm-sec-details" className="adm-section-title">Details and role</h3>
          <div className="adm-form">
            <Field label="Full name" required error={e('name')}><Input value={name} onChange={ev => setName(ev.target.value)} autoComplete="off" /></Field>
            <Field label="Email" required error={e('email')} hint="Unique. No email is sent in phase 2."><Input type="email" value={email} onChange={ev => setEmail(ev.target.value)} autoComplete="off" /></Field>
            <div className="adm-form__row">
              <Field label="Role" required hint={lock ? LOCK_TEXT[lock] : undefined}>
                <Select value={role} onChange={ev => onRole(ev.target.value as Role)} disabled={!!lock}><RoleOptions /></Select>
              </Field>
              {!isTaoRole(role) && (
                <Field label="Partner" required error={e('partner')}>
                  <Select value={partner ?? ''} onChange={ev => setPartner(ev.target.value || null)}>
                    <option value="">Choose a partner</option>
                    {partnerChoices.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                  </Select>
                </Field>
              )}
            </div>
            <p className="adm-hint">{ROLE_HELP} <TextLink to="/admin/settings/users/roles">Compare roles</TextLink></p>
          </div>
        </section>

        {user && (
          <section aria-labelledby="adm-sec-status">
            <h3 id="adm-sec-status" className="adm-section-title">Status</h3>
            <div className="adm-statusrow">
              <UserStatus u={user} />
              <span className="adm-muted">
                {user.status === 'active' ? 'Can sign in and gets notifications.'
                  : `Cannot sign in. History is kept.${user.deactivated_at ? ` Deactivated ${formatDateTime(user.deactivated_at)}` : ''}${user.deactivation_reason ? `: ${user.deactivation_reason}` : ''}`}
              </span>
              {user.status === 'active'
                ? <Button size="sm" variant="danger" disabled={!!lock || busy} onClick={() => setStatusDialog('deactivate')}>Deactivate user</Button>
                : <Button size="sm" disabled={busy} onClick={() => setStatusDialog('reactivate')}>Reactivate user</Button>}
            </div>
            {user.status === 'active' && lock && <p className="adm-hint">{LOCK_TEXT[lock]}</p>}
          </section>
        )}

        <section aria-labelledby="adm-sec-reports">
          <h3 id="adm-sec-reports" className="adm-section-title">Reports this user receives <span className="adm-tag">New</span></h3>
          {subsRes.error ? <LoadError error={subsRes.error} onRetry={subsRes.reload} /> : (
            <SubscriptionTree programs={programs} deals={ctx.deals} tree={tree} onChange={setTree} loading={subsRes.loading && !subsRes.data}
              partnerLabel={draftUser.partner_slug ? partnerName(draftUser.partner_slug, ctx.partners) : null} />
          )}
          <p className="adm-hint" role="status">
            {ticked === 0 ? 'Receives no report notifications. Mentions still reach this person.'
              : `Receives ${isTaoRole(role) ? 'needs review, published, correction published, covenant changed and rejected' : 'published and correction published'}, for the ticked deals: ${formatNumber(ticked)} of ${formatNumber(totalDeals)} deals.`}
            {' '}Receiving only decides who is told; it never changes what a partner can open.
          </p>
        </section>

        {user && <UserHistory user={user} ctx={ctx} />}
        {error && <div className="adm-note adm-note--warn" role="alert">{error}</div>}
      </form>
      <div className="adm-drawer__foot">
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" form="adm-user-form" loading={busy} disabled={!dirty}>{isNew ? 'Add user' : 'Save changes'}</Button>
      </div>
      {user && statusDialog && (
        <StatusDialog user={user} mode={statusDialog} onClose={() => setStatusDialog(null)}
          onDone={u => { setStatusDialog(null); onSaved(u) }} />
      )}
    </aside>
  )
}

/** Program → deal tree. "All deals in this program, including new ones" is the program entry (deal_slug null). */
export function SubscriptionTree({ programs, deals, tree, onChange, loading, partnerLabel }: {
  programs: Program[]; deals: Deal[]; tree: Tree; onChange: (t: Tree) => void; loading?: boolean; partnerLabel: string | null
}) {
  if (loading) return <p className="adm-muted">Loading…</p>
  if (!programs.length) return <p className="adm-muted">{partnerLabel ? `No program is shared with ${partnerLabel} yet, so there is nothing to receive.` : 'No programs yet.'}</p>
  return (
    <table className="adm-subtree" aria-label="Reports this user receives">
      <thead><tr><th scope="col">{partnerLabel ? `Programs shared with ${partnerLabel}` : 'Program / deal'}</th><th scope="col">In-app</th><th scope="col">Email</th></tr></thead>
      {programs.map(p => {
        const ds = deals.filter(d => d.program_slug === p.slug).sort((a, b) => a.name.localeCompare(b.name))
        const all = !!tree[p.slug]?.all
        const n = tickedCount(tree, p.slug, deals)
        return (
          <tbody key={p.slug}>
            <tr className="adm-subtree__prog">
              <th scope="rowgroup" colSpan={1}>
                <b>{p.name}</b> <span className="adm-muted">{formatNumber(n)} of {formatNumber(ds.length)} deals</span>
                <label className="adm-check adm-subtree__all">
                  <input type="checkbox" checked={all} onChange={ev => onChange(setAll(tree, p.slug, ev.target.checked))} />
                  All deals in {p.name}, including new ones
                </label>
              </th>
              <td className="adm-muted">{all ? 'Yes' : n ? 'Some deals' : 'No'}</td>
              <td><span className="adm-muted" title="Email is coming later; phase 2 is in-app only">Coming later</span></td>
            </tr>
            {ds.map(d => (
              <tr key={d.slug}>
                <td className="adm-subtree__deal">{d.name}</td>
                <td>
                  <label className="adm-check">
                    <input type="checkbox" checked={dealTicked(tree, p.slug, d.slug)} aria-label={`${d.name} (${p.name}), in-app`}
                      onChange={ev => onChange(toggleDeal(tree, p.slug, d.slug, ev.target.checked, ds.map(x => x.slug)))} />
                  </label>
                </td>
                <td><input type="checkbox" disabled aria-label={`${d.name}, email (coming later)`} /></td>
              </tr>
            ))}
          </tbody>
        )
      })}
    </table>
  )
}

/** This user's recent changes: Platform entries that name them (detail.user_id) or that they made (actor_user_id). */
function UserHistory({ user, ctx }: { user: AppUser; ctx: Ctx }) {
  const res = useResource(() => usersApi.history(user.email), [user.id, user.email])
  const rows = (res.data ?? []).filter(e => {
    const d = (e.detail ?? {}) as Record<string, unknown>
    return d.user_id === user.id || e.actor_user_id === user.id || JSON.stringify(d).includes(user.email)
  }).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8)
  return (
    <section aria-labelledby="adm-sec-history">
      <h3 id="adm-sec-history" className="adm-section-title">History</h3>
      {res.error ? <p className="adm-muted">History could not be loaded: {errorText(res.error)}</p>
        : res.loading && !res.data ? <p className="adm-muted">Loading…</p>
        : rows.length === 0 ? <p className="adm-muted">No changes recorded yet.</p> : (
          <table className="adm-ba adm-userhist" aria-label={`Recent changes for ${user.name}`}>
            <tbody>{rows.map(e => (
              <tr key={e.id}>
                <td className="adm-nowrap"><time dateTime={e.at}>{formatDateTime(e.at)}</time></td>
                <td>{e.actor_label ?? e.actor_role}</td>
                <td>{historyText(e, ctx)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      <TextLink to={`/admin/settings/users/audit?tab=platform&q=${encodeURIComponent(user.email)}`}>All entries in the Audit log</TextLink>
    </section>
  )
}

export function historyText(e: AuditEntry, ctx: Pick<Ctx, 'programs' | 'deals' | 'partners'>): string {
  const d = (e.detail ?? {}) as Record<string, unknown>
  if (e.action !== 'user_change') return e.action === 'prefs_change' ? 'Changed their own settings' : e.action
  const kind = typeof d.change === 'string' ? d.change : 'updated'
  const head = USER_CHANGE_LABEL[kind] ?? kind
  if (kind === 'subscriptions') return `${head}: ${subsText(d.before, ctx.programs, ctx.deals)} → ${subsText(d.after, ctx.programs, ctx.deals)}`
  const b = (d.before ?? {}) as Record<string, unknown>, a = (d.after ?? {}) as Record<string, unknown>
  const diffs = Object.keys({ ...b, ...a }).filter(k => JSON.stringify(b[k]) !== JSON.stringify(a[k]) && k !== 'updated_at')
    .map(k => `${k} ${k === 'role' ? ROLE_LABEL[b[k] as Role] ?? b[k] ?? '—' : b[k] ?? '—'} → ${k === 'role' ? ROLE_LABEL[a[k] as Role] ?? a[k] ?? '—' : a[k] ?? '—'}`)
  return [head, ...(kind === 'updated' ? diffs : []), e.reason ? `reason: ${e.reason}` : null].filter(Boolean).join(' · ')
}

/** Deactivate or reactivate with a reason of three characters or more (StatusChangeRequest). */
function StatusDialog({ user, mode, onClose, onDone }: { user: AppUser; mode: 'deactivate' | 'reactivate'; onClose: () => void; onDone: (u: AppUser) => void }) {
  const { toast } = useToast()
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const short = reason.trim().length < 3
  const go = async () => {
    setTouched(true)
    if (short) return
    setBusy(true); setError(undefined)
    try {
      const u = mode === 'deactivate' ? await usersApi.deactivate(user.id, reason.trim()) : await usersApi.reactivate(user.id, reason.trim())
      toast({ tone: 'ok', title: mode === 'deactivate' ? `${user.name} deactivated` : `${user.name} reactivated` })
      onDone(u)
    } catch (err) { setError(errorText(err as ApiError)) }
    finally { setBusy(false) }
  }
  return (
    <Dialog open onClose={onClose} dismissable={!busy} role={mode === 'deactivate' ? 'alertdialog' : 'dialog'}
      title={mode === 'deactivate' ? `Deactivate ${user.name}?` : `Reactivate ${user.name}?`}
      footer={<>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant={mode === 'deactivate' ? 'danger' : 'primary'} type="submit" form="adm-status-form" loading={busy}>{mode === 'deactivate' ? 'Deactivate' : 'Reactivate'}</Button>
      </>}>
      <form id="adm-status-form" className="adm-form" noValidate onSubmit={ev => { ev.preventDefault(); void go() }}>
        {mode === 'deactivate' ? (
          <ul className="adm-bullets">
            <li>Signed out now; cannot sign in.</li>
            <li>Stops receiving notifications.</li>
            <li>Uploads, comments and audit history stay, under their name. Nothing is deleted.</li>
          </ul>
        ) : <p>The same account comes back with its history. Reports it receives stay as they were set.</p>}
        <Field label="Reason" required hint="At least three characters. Shown in the audit entry." error={touched && short ? 'Give a reason of at least three characters.' : undefined}>
          <Textarea rows={2} value={reason} onChange={ev => setReason(ev.target.value)} />
        </Field>
        {error && <div className="adm-note adm-note--warn" role="alert">{error}</div>}
      </form>
    </Dialog>
  )
}

/** Invite by email (D8 a): email and role only. The contract needs a name, so the email's local part stands in until
 * the person changes it on their Profile. No email is sent in phase 2. */
function InviteDialog({ partners, onClose, onSaved }: { partners: Partner[]; onClose: () => void; onSaved: (u: AppUser) => void }) {
  const { toast } = useToast()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('tao_analyst')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const choices = useMemo(() => partnersForRole(role, partners), [role, partners])
  const [partner, setPartner] = useState<string>('')
  useEffect(() => { setPartner(choices.length === 1 ? choices[0].slug : '') }, [choices])
  const errs = {
    email: !email.trim() ? 'Required.' : !validEmail(email) ? 'An email address, e.g. name@example.com.' : undefined,
    partner: !isTaoRole(role) && !partner ? 'Choose the partner.' : undefined,
  }
  const go = async () => {
    setTouched(true)
    if (errs.email || errs.partner) return
    setBusy(true); setError(undefined)
    try {
      const addr = email.trim()
      const u = await usersApi.create({ email: addr, name: addr.split('@')[0], role, partner_slug: isTaoRole(role) ? null : partner })
      toast({ tone: 'ok', title: `${addr} added`, message: 'Active, receiving no reports yet. No invite email is sent in phase 2.' })
      onSaved(u)
    } catch (err) { setError(errorText(err as ApiError)) }
    finally { setBusy(false) }
  }
  return (
    <Dialog open onClose={onClose} dismissable={!busy} title="Invite by email"
      description="Email and role only. The person sets their own name on their Profile; reports default to none until an admin sets them."
      footer={<>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" form="adm-invite-form" loading={busy}>Add user</Button>
      </>}>
      <form id="adm-invite-form" className="adm-form" noValidate onSubmit={ev => { ev.preventDefault(); void go() }}>
        <Field label="Email" required error={touched ? errs.email : undefined}><Input type="email" value={email} onChange={ev => setEmail(ev.target.value)} /></Field>
        <Field label="Role" required><Select value={role} onChange={ev => setRole(ev.target.value as Role)}><RoleOptions /></Select></Field>
        {!isTaoRole(role) && choices.length > 1 && (
          <Field label="Partner" required error={touched ? errs.partner : undefined}>
            <Select value={partner} onChange={ev => setPartner(ev.target.value)}>
              <option value="">Choose a partner</option>
              {choices.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
            </Select>
          </Field>
        )}
        <div className="adm-note">Email is coming later: no invite is sent in phase 2. The user is added as active.</div>
        {error && <div className="adm-note adm-note--warn" role="alert">{error}</div>}
      </form>
    </Dialog>
  )
}
