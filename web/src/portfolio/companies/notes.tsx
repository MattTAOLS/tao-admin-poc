/** Analyst notes (D6 note 13): TAO only, never sent to partners. Both TAO roles add notes; the author edits their own;
 * the author or a TAO Admin removes one (the API keeps the row and audits it). @mentions work like review comments:
 * typing @ lists active TAO users, picking one inserts "@Name" and sends the id in `mentions`. A note can name the
 * report month it is about. Writing needs a signed-in user (the API answers 401 user_required without one). */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Button, Dialog, Field, Select, formatPeriod, useToast } from '@/design/components'
import { api } from '@/shell/api'
import type { AppUser } from '@/shell/types'
import type { CompanyNote, Month, NoteInput, TaoUser } from './types'
import { errText, fmtDay, insertMention, mentionIds, mentionQuery, splitMentions } from './util'

const MAX = 4000
const initials = (n: string) => n.split(/[\s.]+/).filter(Boolean).slice(0, 2).map(s => s[0]!.toUpperCase()).join('')

export function NotesSection({ slug, notes, setNotes, users, user, admin, months, focusId }: {
  slug: string; notes: CompanyNote[] | null | 'error'; setNotes: (fn: (n: CompanyNote[]) => CompanyNote[]) => void
  users: TaoUser[]; user: AppUser | null; admin: boolean; months: Month[]; focusId?: string | null
}) {
  const { toast } = useToast()
  const [editing, setEditing] = useState<string | null>(null)
  const [removing, setRemoving] = useState<CompanyNote | null>(null)
  const names = [...users.map(u => u.name), ...(Array.isArray(notes) ? notes.flatMap(n => n.mentions.map(m => m.name)) : [])]

  if (notes === 'error') return <p className="co-err" role="alert">The notes could not be loaded.</p>
  const add = async (input: NoteInput) => {
    const n = await api<CompanyNote>(`/companies/${encodeURIComponent(slug)}/notes`, { method: 'POST', body: JSON.stringify(input) })
    setNotes(list => [n, ...list])
  }
  const save = async (id: string, input: NoteInput) => {
    const n = await api<CompanyNote>(`/company-notes/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) })
    setNotes(list => list.map(x => (x.id === id ? n : x)))
    setEditing(null)
  }
  return (
    <div className="pf-stack">
      {notes === null ? <p className="pf-muted">Loading notes…</p> : notes.length === 0
        ? <p className="pf-muted">No notes yet.</p>
        : (
          <ul className="co-notes" aria-label="Analyst notes">
            {notes.map(n => {
              const mine = !!user && n.author.id === user.id
              return (
                <li key={n.id} id={`note-${n.id}`} className="co-note" aria-current={focusId === n.id ? 'true' : undefined}>
                  <span className="tm-av" aria-hidden="true">{initials(n.author.name)}</span>
                  <div>
                    <div className="co-note__head">
                      <b>{n.author.name}</b><span>· {fmtDay(n.created_at)}</span>
                      {n.collection_period && <span>· {formatPeriod(n.collection_period)} report</span>}
                      {n.edited_at && <span>· edited</span>}
                    </div>
                    {editing === n.id
                      ? <NoteComposer users={users} months={months} label="Edit your note" submitLabel="Save" initial={n}
                          onCancel={() => setEditing(null)} send={input => save(n.id, input)} />
                      : <p className="co-note__body">{splitMentions(n.body, names).map((s, i) => (s.mention ? <b key={i} className="co-mention">{s.text}</b> : <span key={i}>{s.text}</span>))}</p>}
                    {editing !== n.id && (mine || admin) && (
                      <div className="co-note__acts">
                        {mine && <Button size="sm" onClick={() => setEditing(n.id)} aria-label={`Edit note from ${fmtDay(n.created_at)}`}>Edit</Button>}
                        <Button size="sm" variant="ghost" onClick={() => setRemoving(n)} aria-label={`Remove note by ${n.author.name} from ${fmtDay(n.created_at)}`}>Remove</Button>
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      {user
        ? <NoteComposer users={users} months={months} label="New note" submitLabel="Add note" send={add} />
        : <p className="co-hint">Adding a note needs a signed-in user. Use “Sign in as (POC)” in the sidebar.</p>}
      {removing && (
        <RemoveNote note={removing} onClose={() => setRemoving(null)} onRemoved={() => {
          setNotes(list => list.filter(x => x.id !== removing.id)); setRemoving(null); toast({ tone: 'ok', title: 'Note removed' })
        }} />
      )}
    </div>
  )
}

function RemoveNote({ note, onClose, onRemoved }: { note: CompanyNote; onClose: () => void; onRemoved: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  const go = async () => {
    setBusy(true); setErr(undefined)
    try { await api<void>(`/company-notes/${encodeURIComponent(note.id)}`, { method: 'DELETE' }); onRemoved() }
    catch (e) { setErr(errText(e)); setBusy(false) }
  }
  return (
    <Dialog open role="alertdialog" onClose={onClose} dismissable={!busy} title="Remove this note?"
      description="It leaves the page. The audit log keeps the text."
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="danger" loading={busy} onClick={go}>Remove note</Button></>}>
      {err && <p className="co-err" role="alert">{err}</p>}
    </Dialog>
  )
}

export function NoteComposer({ users, months, label, submitLabel, send, initial, onCancel }: {
  users: TaoUser[]; months: Month[]; label: string; submitLabel: string; send: (input: NoteInput) => Promise<void>
  initial?: CompanyNote; onCancel?: () => void
}) {
  const [text, setText] = useState(initial?.body ?? '')
  const [month, setMonth] = useState<string>(initial?.collection_period ?? '')
  const [q, setQ] = useState<{ start: number; query: string; caret: number } | null>(null)
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  const picked = useRef(new Map<string, string>())
  useEffect(() => { for (const m of initial?.mentions ?? []) picked.current.set(m.id, m.name) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const ref = useRef<HTMLTextAreaElement>(null)
  const listId = useId(), hintId = useId()
  const hits = q ? users
    .filter(u => u.status === 'active' && (u.role === 'tao_admin' || u.role === 'tao_analyst'))
    .filter(u => !q.query.trim() || u.name.toLowerCase().includes(q.query.trim().toLowerCase()) || u.email.toLowerCase().includes(q.query.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 6) : []
  const open = !!q && hits.length > 0
  const track = (value: string, caret: number) => { const m = mentionQuery(value, caret); setQ(m ? { ...m, caret } : null); setActive(0) }
  const pick = (u: TaoUser) => {
    if (!q) return
    const r = insertMention(text, q.start, q.caret, u.name)
    picked.current.set(u.id, u.name)
    setText(r.text); setQ(null)
    requestAnimationFrame(() => { const el = ref.current; if (el) { el.focus(); el.setSelectionRange(r.caret, r.caret) } })
  }
  const body = text.trim()
  const submit = async () => {
    if (!body || busy) return
    setBusy(true); setErr(undefined)
    try {
      await send({ body, mentions: mentionIds(body, picked.current), collection_period: month || null })
      if (!initial) { setText(''); setMonth(''); picked.current = new Map() }
    } catch (e) { setErr(errText(e)) }
    finally { setBusy(false) }
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % hits.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + hits.length) % hits.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(hits[active]); return }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setQ(null); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit() }
  }
  return (
    <div className="co-composer">
      <label className="ds-visually-hidden" htmlFor={listId + '-ta'}>{label}</label>
      <textarea id={listId + '-ta'} ref={ref} className="ds-input" rows={2} value={text} maxLength={MAX}
        placeholder="Write a note for TAO. @ to mention a TAO user."
        role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-describedby={hintId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onChange={e => { setText(e.target.value); track(e.target.value, e.target.selectionStart ?? e.target.value.length) }}
        onKeyDown={onKeyDown} onBlur={() => setTimeout(() => setQ(null), 150)} />
      {open && (
        <ul id={listId} role="listbox" className="co-mentions" aria-label="Mention a TAO user">
          {hits.map((u, i) => (
            <li key={u.id} id={`${listId}-${i}`} role="option" aria-selected={i === active} onMouseDown={e => { e.preventDefault(); pick(u) }}>
              <b>{u.name}</b>{u.email && <span className="pf-muted">{u.email}</span>}<span className="pf-muted">{u.role === 'tao_admin' ? 'TAO Admin' : 'TAO Analyst'}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="co-composer__bar">
        <span id={hintId} className="co-composer__hint">Visible to TAO users only · @ to mention · Enter to send · Shift+Enter for a new line</span>
        <Field label="Report month">
          <Select value={month} onChange={e => setMonth(e.target.value)}
            options={[{ value: '', label: 'No month' }, ...months.map(m => ({ value: m, label: formatPeriod(m) }))]} />
        </Field>
        {onCancel && <Button size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>}
        <Button size="sm" variant="primary" loading={busy} disabled={!body} onClick={() => void submit()}>{submitLabel}</Button>
      </div>
      {err && <p className="co-err" role="alert">{err}</p>}
    </div>
  )
}
