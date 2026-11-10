/** /<shell>/settings/team: the partner Team members page (docs/phase2/designs/user-management.html D8 c, notes 9–13).
 * A Company Admin manages their own partner's people: add, edit details and role (Company Admin or Viewer), deactivate
 * or reactivate with a reason, and pick the reports each person is notified about. The API scopes every /users call
 * to the caller's partner (X-User, or X-Role + X-Partner in role-only mode); this page never asks for another partner. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, DataTable, Dialog, Field, Input, Select, StatePanel, StatusPill, Textarea, useToast, type Column } from '@/design/components'
import { api } from '@/shell/api'
import { usePageHeader } from '@/shell/header'
import { ROLES, loadRole, type Role } from '@/shell/roles'
import type { Portfolio } from './types'
import {
  errorText, fmtDate, fmtDateTime, initials, isCompanyAdmin, partnerName, pickedCount, roleWord, samePicks, toPicks, toSubscriptions,
  type AppUser, type Me, type Picks, type Subscription, type TreeProgram,
} from './team'
import './portfolio.css'

type ApiErr = { code?: string; message?: string; status?: number }

export default function TeamPage() {
  const role = loadRole()
  if (!isCompanyAdmin(role)) return <StatePanel kind="no-access" />
  return <Team role={role} />
}

function Team({ role }: { role: Role }) {
  const partner = ROLES.find(r => r.id === role)!.partner!
  const who = partnerName(partner)
  const { toast } = useToast()
  const [me, setMe] = useState<AppUser | null>(null)
  const [users, setUsers] = useState<AppUser[] | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'no-access' | 'error'>('loading')
  const [loadErr, setLoadErr] = useState('')
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])
  const [programs, setPrograms] = useState<TreeProgram[] | null>(null)
  const [progErr, setProgErr] = useState('')
  const [editing, setEditing] = useState<AppUser | null>(null)
  const [adding, setAdding] = useState<null | 'add' | 'invite'>(null)

  // The signed-in user, to mark "you". In role-only mode (no X-User) /me returns user null, or may not exist yet.
  useEffect(() => { api<Me>('/me').then(m => setMe(m.user ?? null), () => setMe(null)) }, [])

  useEffect(() => {
    let live = true
    api<AppUser[]>(`/users?partner_slug=${encodeURIComponent(partner)}`).then(
      list => { if (!live) return; setUsers(list); setState('ok') },
      (e: ApiErr) => {
        if (!live) return
        if (e.status === 403 || e.status === 404) setState('no-access')
        else { setLoadErr(e.message || 'Request failed'); setState('error') }
      },
    )
    return () => { live = false }
  }, [partner, tick])

  // The tree: only programs shared with this partner, as the published portfolio lists them for this caller.
  useEffect(() => {
    api<Portfolio>('/published/portfolio').then(
      pf => setPrograms(pf.programs.filter(p => p.program?.slug).map(p => ({
        slug: p.program!.slug, name: p.program!.name ?? p.program!.slug,
        deals: p.deals.map(d => ({ slug: d.deal_slug, name: d.deal_name })),
      }))),
      (e: ApiErr) => { setPrograms([]); setProgErr(e.message || 'The shared programs could not be loaded.') },
    )
  }, [])

  // Only this partner's people, whatever the response holds (the API already scopes it; this keeps the table honest).
  const team = useMemo(() => (users ?? [])
    .filter(u => u.partner_slug === partner)
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1) || a.name.localeCompare(b.name)), [users, partner])

  usePageHeader({
    title: 'Team members',
    subtitle: `People at ${who} who can sign in to this portal, and which reports each one receives.`,
    actions: state === 'ok' ? <>
      <Button variant="ghost" onClick={() => setAdding('invite')}>Invite</Button>
      <Button variant="primary" onClick={() => setAdding('add')}>Add user</Button>
    </> : undefined,
  })

  if (state === 'no-access') return <StatePanel kind="no-access" message="Only a Company Admin can manage the team." />
  if (state === 'error') return <StatePanel kind="error" message={loadErr} actions={<Button onClick={reload}>Retry</Button>} />

  const columns: Column<AppUser>[] = [
    { key: 'name', header: 'Name', emphasis: true, sortValue: u => u.name, render: u => (
      <span className="tm-who"><span className="tm-av" aria-hidden="true">{initials(u.name)}</span>
        <span>{u.name}{me?.id === u.id && <span className="pf-muted pf-small"> · you</span>}</span></span>
    ) },
    { key: 'email', header: 'Email', sortValue: u => u.email, render: u => u.email },
    { key: 'role', header: 'Role', sortValue: u => roleWord(u.role), render: u => roleWord(u.role) },
    { key: 'status', header: 'Status', sortValue: u => u.status, render: u => <UserStatus u={u} /> },
    { key: 'last', header: 'Last active', sortValue: u => u.last_active_at ?? '', render: u => <span className={u.last_active_at ? 'pf-nowrap' : 'pf-muted'}>{fmtDateTime(u.last_active_at)}</span> },
    { key: 'receives', header: 'Reports received', render: u => <span className="tm-subs">{u.receives_summary || 'None'}<small>In-app</small></span> },
    { key: 'edit', header: '', ariaLabel: 'Actions', align: 'right', render: u => <Button size="sm" variant="ghost" aria-label={`Edit ${u.name}`} onClick={() => setEditing(u)}>Edit</Button> },
  ]

  return (
    <div className="pf-stack">
      <div className="ds-card ds-card--pad tm-notes" role="note" aria-label="How the team works">
        <p><b>Receives</b> sets notifications only. Every teammate can still open every report for the programs shared with {who}.</p>
        <p>{who} always keeps at least one active Company Admin, and nobody can change their own role or deactivate themselves. People are never deleted; deactivating keeps their history.</p>
      </div>
      <DataTable caption="Team members" captionHidden columns={columns} rows={team} rowKey={u => u.id}
        loading={state === 'loading'} selectedKey={editing?.id ?? null}
        empty={{ title: 'No team members yet', message: `Add the first person at ${who}.` }} />
      {adding && <AddUser mode={adding} partner={partner} onClose={() => setAdding(null)} onAdded={u => {
        setAdding(null); reload()
        toast({ tone: 'ok', title: `Added ${u.name}`, message: 'Choose the reports they receive.' })
        setEditing(u)
      }} />}
      {editing && <EditUser key={editing.id} user={editing} self={me?.id === editing.id} partner={partner} programs={programs} progErr={progErr}
        onClose={() => setEditing(null)}
        onChanged={(u, msg) => { setUsers(list => list?.map(x => x.id === u.id ? u : x) ?? list); reload(); if (msg) toast({ tone: 'ok', title: msg }) }} />}
    </div>
  )
}

function UserStatus({ u }: { u: AppUser }) {
  return u.status === 'active'
    ? <StatusPill tone="ok" size="sm">Active</StatusPill>
    : <StatusPill tone="neutral" size="sm" title={u.deactivation_reason ?? undefined}>Deactivated</StatusPill>
}

const roleOptions = (partner: string) => [
  { value: `${partner}_admin`, label: 'Company Admin' },
  { value: `${partner}_viewer`, label: 'Viewer' },
]
const ROLE_HINT = 'Company Admin: reads every shared report and manages this team. Viewer: reads every shared report.'

function AddUser({ mode, partner, onClose, onAdded }: { mode: 'add' | 'invite'; partner: string; onClose: () => void; onAdded: (u: AppUser) => void }) {
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [role, setRole] = useState(`${partner}_viewer`)
  const [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const valid = name.trim().length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const submit = async () => {
    setBusy(true); setErr('')
    try { onAdded(await api<AppUser>('/users', { method: 'POST', body: JSON.stringify({ name: name.trim(), email: email.trim(), role, partner_slug: partner }) })) }
    catch (e) { setErr(errorText(e as ApiErr, partner)); setBusy(false) }
  }
  return (
    <Dialog open onClose={onClose} dismissable={!busy} title={mode === 'invite' ? 'Invite teammate' : 'Add user'}
      description={`Adds an active account at ${partnerName(partner)}. They receive no reports until you choose some.`}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={submit} loading={busy} disabled={!valid}>{mode === 'invite' ? 'Add and invite' : 'Add user'}</Button></>}>
      <div className="tm-form">
        {err && <p className="tm-err" role="alert">{err}</p>}
        <div className="tm-grid2">
          <Field label="Full name" required><Input value={name} onChange={e => setName(e.target.value)} autoComplete="off" /></Field>
          <Field label="Email" required><Input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" /></Field>
        </div>
        <Field label="Role" required hint={ROLE_HINT}><Select value={role} onChange={e => setRole(e.target.value)} options={roleOptions(partner)} /></Field>
        <label className="pf-check tm-later"><input type="checkbox" disabled /> Send an invite email <span className="pf-muted">(coming later)</span></label>
        {mode === 'invite' && <p className="pf-muted pf-small">Invite emails are coming later. The account is created now; tell your teammate yourself.</p>}
      </div>
    </Dialog>
  )
}

function EditUser({ user, self, partner, programs, progErr, onClose, onChanged }: {
  user: AppUser; self: boolean; partner: string; programs: TreeProgram[] | null; progErr: string
  onClose: () => void; onChanged: (u: AppUser, message?: string) => void
}) {
  const who = partnerName(partner)
  const [u, setU] = useState(user)
  const [name, setName] = useState(user.name), [email, setEmail] = useState(user.email), [role, setRole] = useState<string>(user.role)
  const [subs, setSubs] = useState<Subscription[] | null>(null), [subsErr, setSubsErr] = useState('')
  const [picks, setPicks] = useState<Picks>({}), [base, setBase] = useState<Picks>({})
  const [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const [statusOpen, setStatusOpen] = useState(false), [reason, setReason] = useState('')

  useEffect(() => {
    let live = true
    api<Subscription[]>(`/users/${encodeURIComponent(user.id)}/subscriptions`).then(s => { if (live) setSubs(s) }, (e: ApiErr) => { if (live) { setSubs([]); setSubsErr(errorText(e, partner)) } })
    return () => { live = false }
  }, [user.id, partner])
  useEffect(() => {
    if (!subs || !programs) return
    const p = toPicks(subs, programs); setPicks(p); setBase(p)
  }, [subs, programs])

  const ready = subs !== null && programs !== null
  const detailsChanged = name.trim() !== u.name || email.trim() !== u.email || role !== u.role
  const picksChanged = ready && !subsErr && !samePicks(picks, base, programs!)
  const active = u.status === 'active'

  const save = async () => {
    setBusy(true); setErr('')
    try {
      let next = u
      if (detailsChanged) {
        const patch: Record<string, string> = {}
        if (name.trim() !== u.name) patch.name = name.trim()
        if (email.trim() !== u.email) patch.email = email.trim()
        if (role !== u.role) patch.role = role
        next = await api<AppUser>(`/users/${encodeURIComponent(u.id)}`, { method: 'PATCH', body: JSON.stringify(patch) })
        setU(next)
      }
      if (picksChanged) {
        await api<Subscription[]>(`/users/${encodeURIComponent(u.id)}/subscriptions`, { method: 'PUT', body: JSON.stringify(toSubscriptions(picks, programs!)) })
        setBase(picks)
      }
      onChanged(next, `Saved ${next.name}`)
      onClose()
    } catch (e) { setErr(errorText(e as ApiErr, partner)); setBusy(false) }
  }

  const changeStatus = async () => {
    setBusy(true); setErr('')
    try {
      const next = await api<AppUser>(`/users/${encodeURIComponent(u.id)}/${active ? 'deactivate' : 'reactivate'}`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) })
      setU(next); setStatusOpen(false); setReason('')
      onChanged(next, active ? `Deactivated ${next.name}` : `Reactivated ${next.name}`)
    } catch (e) { setErr(errorText(e as ApiErr, partner)) }
    setBusy(false)
  }

  return (
    <Dialog open onClose={onClose} dismissable={!busy} size="lg" title={`Edit ${u.name}`}
      description={`${u.email} · last active ${fmtDateTime(u.last_active_at)}`}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={save} loading={busy && !statusOpen} disabled={!(detailsChanged || picksChanged) || !name.trim() || !email.trim()}>Save changes</Button></>}>
      <div className="tm-form">
        {err && <p className="tm-err" role="alert">{err}</p>}

        <section className="tm-sec" aria-labelledby="tm-details">
          <h3 className="tm-sec__title" id="tm-details">Details and role</h3>
          <div className="tm-grid2">
            <Field label="Full name" required><Input value={name} onChange={e => setName(e.target.value)} /></Field>
            <Field label="Email" required><Input type="email" value={email} onChange={e => setEmail(e.target.value)} /></Field>
          </div>
          <Field label="Role" required hint={self ? 'Nobody can change their own role. Ask another Company Admin.' : ROLE_HINT}>
            <Select value={role} onChange={e => setRole(e.target.value)} options={roleOptions(partner)} disabled={self} />
          </Field>
        </section>

        <section className="tm-sec" aria-labelledby="tm-status">
          <h3 className="tm-sec__title" id="tm-status">Status</h3>
          <div className="tm-statusrow">
            <UserStatus u={u} />
            <span className="pf-muted pf-small">{active ? 'Can sign in and gets notifications.' : `Cannot sign in. History is kept.${u.deactivated_at ? ` Since ${fmtDate(u.deactivated_at)}.` : ''}${u.deactivation_reason ? ` Reason: ${u.deactivation_reason}` : ''}`}</span>
            <span className="pf-spacer" />
            {!statusOpen && <Button size="sm" variant={active ? 'danger' : 'ghost'} disabled={self && active} onClick={() => { setStatusOpen(true); setErr('') }}>
              {active ? 'Deactivate user' : 'Reactivate user'}</Button>}
          </div>
          {self && active && <p className="pf-muted pf-small">You can’t deactivate yourself.</p>}
          {active && !self && <p className="pf-muted pf-small">There is no delete: deactivating stops sign-in and keeps their history. {who} always keeps at least one active Company Admin.</p>}
          {statusOpen && <div className="tm-reason">
            <Field label={active ? 'Reason for deactivating' : 'Reason for reactivating'} required hint="At least 3 characters; recorded in the audit log.">
              <Textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} />
            </Field>
            <div className="pf-actions">
              <Button size="sm" variant="ghost" onClick={() => { setStatusOpen(false); setReason('') }} disabled={busy}>Keep {active ? 'active' : 'deactivated'}</Button>
              <Button size="sm" variant={active ? 'danger' : 'primary'} onClick={changeStatus} loading={busy} disabled={reason.trim().length < 3}>
                {active ? 'Confirm deactivate' : 'Confirm reactivate'}</Button>
            </div>
          </div>}
        </section>

        <section className="tm-sec" aria-labelledby="tm-receives">
          <h3 className="tm-sec__title" id="tm-receives">Reports this person receives</h3>
          {!ready ? <p className="pf-muted pf-small" aria-busy="true">Loading the shared programs…</p>
            : subsErr ? <p className="tm-err" role="alert">{subsErr}</p>
            : <ReceivesTree programs={programs!} picks={picks} setPicks={setPicks} partner={partner} />}
          {progErr && <p className="tm-err" role="alert">{progErr}</p>}
          <p className="pf-muted pf-small">“Receives” sets notifications only. They can still open every report for the programs shared with {who}. Delivered in-app; email is coming later.</p>
        </section>
      </div>
    </Dialog>
  )
}

function ProgramBox({ checked, indeterminate, onChange }: { checked: boolean; indeterminate: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate }, [indeterminate])
  return <input ref={ref} type="checkbox" checked={checked} onChange={onChange} />
}

/** Programs shared with the partner; each with "All deals in this program, including new ones" and its deals. */
function ReceivesTree({ programs, picks, setPicks, partner }: { programs: TreeProgram[]; picks: Picks; setPicks: (f: (p: Picks) => Picks) => void; partner: string }) {
  const who = partnerName(partner)
  if (programs.length === 0) return <p className="pf-muted pf-small">No programs are shared with {who} yet.</p>
  const set = (slug: string, v: { all: boolean; deals: string[] }) => setPicks(p => ({ ...p, [slug]: v }))
  return (
    <div className="tm-tree" role="group" aria-label={`Programs shared with ${who}`}>
      <div className="tm-tree__row tm-tree__head" aria-hidden="true"><span>Programs shared with {who}</span><span className="tm-c">In-app</span><span className="tm-c">Email</span></div>
      {programs.map(p => {
        const pk = picks[p.slug] ?? { all: false, deals: [] }
        const n = pickedCount(pk, p.deals.length)
        const full = pk.all || (p.deals.length > 0 && n === p.deals.length)
        return (
          <div key={p.slug} role="group" aria-label={p.name} className="tm-tree__prog-group">
            <div className="tm-tree__row tm-tree__prog">
              <span className="tm-tree__name">
                <label className="tm-tree__label">
                  <ProgramBox checked={full} indeterminate={n > 0 && !full}
                    onChange={() => set(p.slug, full ? { all: false, deals: [] } : { all: true, deals: [] })} />
                  <span>{p.name}</span>
                </label>
                <span className="tm-cnt">{n} of {p.deals.length} deals</span>
              </span>
              <span className="tm-c"><input type="checkbox" checked={n > 0} disabled aria-label={`In-app: ${p.name}`} readOnly /></span>
              <span className="tm-c pf-muted pf-small">Coming later</span>
            </div>
            <div className="tm-tree__row tm-tree__all">
              <label className="tm-tree__label"><input type="checkbox" checked={pk.all}
                onChange={() => set(p.slug, pk.all ? { all: false, deals: p.deals.map(d => d.slug) } : { all: true, deals: [] })} />
                <b>All deals in this program, including new ones</b></label>
            </div>
            {p.deals.map(d => {
              const on = pk.all || pk.deals.includes(d.slug)
              return (
                <div key={d.slug} className={['tm-tree__row tm-tree__deal', !on && 'tm-tree__deal--off'].filter(Boolean).join(' ')}>
                  <label className="tm-tree__label"><input type="checkbox" checked={on} disabled={pk.all}
                    onChange={() => set(p.slug, { all: false, deals: on ? pk.deals.filter(x => x !== d.slug) : [...pk.deals, d.slug] })} />
                    {d.name}</label>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
