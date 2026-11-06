/** D7 b: comment threads on a finding or an extracted value. Internal to TAO; partners never see them.
 * The page loads the threads once and hands them down through CommentsProvider; the panel is one dialog that shows
 * either the threads on one anchor or every thread on the upload. */
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Button, Dialog, StatusPill } from '@/design/components'
import { errorText, reviewApi } from '../lib/api'
import { formatDateTime } from '../lib/format'
import {
  canResolve, carriedLabel, commentCount, insertMention, mentionIds, mentionMatches, mentionQuery, sortThreads, splitMentions, threadsOn,
} from '../lib/comments'
import type { AppUser, Comment, CommentAuthor, Thread, ThreadAnchor } from '../lib/types'

export const NO_USER = 'Sign in as a user to comment.'
export const RESOLVE_NOTE = 'Resolving a thread does not resolve the finding; the finding still needs its own decision.'
const MAX_BODY = 4000

type Ctx = { threads?: Thread[]; enabled: boolean; open: (anchor: ThreadAnchor) => void }
const CommentsCtx = createContext<Ctx>({ enabled: false, open: () => {} })
export const CommentsProvider = CommentsCtx.Provider
export const useComments = () => useContext(CommentsCtx)

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** The comment count and the "Comment" control on a finding card or a value row. `rows` counts threads on the row's
 * cells too. */
export function CommentButton({ anchor, label, rows = false, compact = false }: { anchor: ThreadAnchor; label: string; rows?: boolean; compact?: boolean }) {
  const { threads, enabled, open } = useComments()
  if (!enabled) return null
  const on = threadsOn(threads, anchor, rows)
  const n = commentCount(on)
  const allResolved = on.length > 0 && on.every(t => t.status === 'resolved')
  return (
    <button type="button" className={'rv-cbtn' + (compact ? ' rv-cbtn--compact' : '') + (n > 0 ? ' rv-cbtn--has' : '')} onClick={() => open(anchor)}
      aria-label={`Comment on ${label}${n ? `, ${plural(n, 'comment')}${allResolved ? ', resolved' : ''}` : ''}`} data-testid="comment-button">
      <span aria-hidden="true">Comment</span>
      {n > 0 && <span className="rv-cbtn__n" aria-hidden="true" data-testid="comment-count">{n}{allResolved ? ' · resolved' : ''}</span>}
    </button>
  )
}

export type PanelTarget = { kind: 'all' } | { kind: 'anchor'; anchor: ThreadAnchor }

export type ThreadPanelProps = {
  uploadId: string
  target: PanelTarget | null
  threads: Thread[] | undefined
  /** The signed-in user; null in demo mode (no X-User) or when the API answers 401 user_required. */
  me: CommentAuthor | null
  role: string
  users: AppUser[]
  currentVersion?: number | null
  labelFor: (a: ThreadAnchor) => string
  onClose: () => void
  onTarget: (t: PanelTarget) => void
  /** A thread was created, changed or got a comment: the page merges it and reloads the audit. */
  onThread: (t: Thread) => void
  loadError?: unknown
}

/** "Comments on R05 …" (one anchor) or "Comments" (every thread on the upload, with open / resolved filters). */
export function ThreadPanel(p: ThreadPanelProps) {
  const { target, threads, me, labelFor, onClose, onTarget } = p
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('all')
  useEffect(() => { if (target?.kind === 'all') setFilter('all') }, [target?.kind])
  if (!target) return null
  const all = sortThreads(threads ?? [])
  const noUser = !me

  if (target.kind === 'all') {
    const openN = all.filter(t => t.status === 'open').length
    const shown = all.filter(t => filter === 'all' || t.status === filter)
    return (
      <Dialog open onClose={onClose} size="lg" title={`Comments (${all.length})`}
        description="Every thread on this upload, open first. Comments are internal to TAO; partners never see them.">
        <div className="rv-dialog-body">
          <div className="rv-sections" role="group" aria-label="Show threads">
            {(['all', 'open', 'resolved'] as const).map(f => (
              <button key={f} type="button" className="rv-chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === 'all' ? `All ${all.length}` : f === 'open' ? `Open ${openN}` : `Resolved ${all.length - openN}`}
              </button>
            ))}
          </div>
          {noUser && <p className="rv-hint" data-testid="no-user">{NO_USER}</p>}
          {p.loadError != null && !threads && !noUser && <div className="rv-dialog-error" role="alert">{errorText(p.loadError)}</div>}
          {shown.length === 0 ? (
            <p className="rv-hint">{all.length === 0 ? 'No comments on this upload yet. Use Comment on a finding or a value to start a thread.' : `No ${filter} threads.`}</p>
          ) : (
            <ul className="rv-threadlist" aria-label="Threads">
              {shown.map(t => {
                const last = t.comments[t.comments.length - 1]
                const carried = carriedLabel(t, p.uploadId, p.currentVersion)
                return (
                  <li key={t.id} className="rv-threadlist__item">
                    <div className="rv-threadlist__head">
                      <ThreadStatus t={t} />
                      <b>{labelFor(t.anchor)}</b>
                      <span className="rv-muted">{plural(t.comments.length, 'comment')}</span>
                      {carried && <span className="rv-carried" data-testid="carried">{carried}</span>}
                      <Button size="sm" onClick={() => onTarget({ kind: 'anchor', anchor: t.anchor })} aria-label={`Open thread on ${labelFor(t.anchor)}`}>Open</Button>
                    </div>
                    {last && <p className="rv-hint">{last.author.name}: {last.body.length > 140 ? last.body.slice(0, 140) + '…' : last.body}</p>}
                    {t.status === 'resolved' && t.resolved_by && <p className="rv-hint">Resolved by {t.resolved_by.name}, {formatDateTime(t.resolved_at)}</p>}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </Dialog>
    )
  }

  const anchor = target.anchor
  const label = labelFor(anchor)
  // A table row's panel also lists the threads on its cells, matching the count on the row's control.
  const mine = sortThreads(threadsOn(threads, anchor, true))
  const openThread = mine.find(t => t.status === 'open')
  return (
    <Dialog open onClose={onClose} size="lg" title={`Comments on ${label}`}
      description={<>Internal to TAO; partners never see comments. {anchor.finding_id ? RESOLVE_NOTE : 'Resolving a thread does not change the value.'}</>}
      footer={<><Button onClick={() => onTarget({ kind: 'all' })}>All comments ({all.length})</Button><Button onClick={onClose}>Close</Button></>}>
      <div className="rv-dialog-body">
        {mine.length === 0 && <p className="rv-hint">No comments here yet.</p>}
        {mine.map(t => <ThreadView key={t.id} thread={t} {...p} label={label} replyHere={t === openThread} />)}
        {noUser ? <p className="rv-hint" data-testid="no-user">{NO_USER}</p>
          : !openThread && <NewThread {...p} anchor={anchor} label={label} />}
      </div>
    </Dialog>
  )
}

function ThreadStatus({ t }: { t: Thread }) {
  return <StatusPill tone={t.status === 'open' ? 'blue' : 'neutral'} size="sm">{t.status === 'open' ? 'Open' : 'Resolved'}</StatusPill>
}

function ThreadView({ thread: t, me, role, users, uploadId, currentVersion, onThread, label, replyHere }: ThreadPanelProps & { thread: Thread; label: string; replyHere: boolean }) {
  const [show, setShow] = useState(t.status === 'open')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  useEffect(() => { setShow(t.status === 'open') }, [t.status])
  const carried = carriedLabel(t, uploadId, currentVersion)
  const may = canResolve(t, me, role)
  const toggle = async () => {
    setBusy(true); setErr(undefined)
    try { onThread(t.status === 'open' ? await reviewApi.resolveThread(t.id) : await reviewApi.reopenThread(t.id)) }
    catch (e) { setErr(errorText(e)) }
    finally { setBusy(false) }
  }
  const names = useMemo(() => [...users.map(u => u.name), ...t.comments.map(c => c.author.name), t.created_by.name, ...(me ? [me.name] : [])], [users, t.comments, t.created_by.name, me])
  return (
    <section className={'rv-thread' + (t.status === 'resolved' ? ' rv-thread--resolved' : '')} aria-label={`Thread on ${label}, ${t.status}`}>
      <div className="rv-thread__head">
        <ThreadStatus t={t} />
        <span className="rv-muted">{plural(t.comments.length, 'comment')} · started by {t.created_by.name}, {formatDateTime(t.created_at)}</span>
        {carried && <span className="rv-carried" data-testid="carried">{carried}</span>}
        <span className="rv-thread__actions">
          {t.status === 'resolved' && <Button size="sm" variant="ghost" onClick={() => setShow(s => !s)} aria-expanded={show}>{show ? 'Hide' : 'Show'}</Button>}
          {may && <Button size="sm" loading={busy} onClick={toggle}>{t.status === 'open' ? 'Resolve thread' : 'Reopen thread'}</Button>}
        </span>
      </div>
      {t.status === 'resolved' && t.resolved_by && <p className="rv-hint">Resolved by {t.resolved_by.name}, {formatDateTime(t.resolved_at)}.</p>}
      {me && !may && t.status === 'open' && <p className="rv-hint">A TAO Admin or {t.created_by.name}, who started it, can resolve this thread.</p>}
      {err && <div className="rv-dialog-error" role="alert">{err}</div>}
      {show && <>
        <ol className="rv-comments" aria-label="Comments">
          {t.comments.map(c => <CommentItem key={c.id} c={c} me={me} users={users} names={names} onSaved={saved => onThread({ ...t, comments: t.comments.map(x => (x.id === saved.id ? saved : x)) })} />)}
        </ol>
        {me && t.status === 'open' && replyHere && (
          <Composer users={users} label={`Reply on ${label}`} submitLabel="Reply"
            send={async (body, mentions) => { const c = await reviewApi.addComment(t.id, body, mentions); onThread({ ...t, comments: [...t.comments, c] }) }} />
        )}
        {me && t.status === 'resolved' && may && <p className="rv-hint">Reopen the thread to reply.</p>}
      </>}
    </section>
  )
}

function CommentItem({ c, me, users, names, onSaved }: { c: Comment; me: CommentAuthor | null; users: AppUser[]; names: string[]; onSaved: (c: Comment) => void }) {
  const [editing, setEditing] = useState(false)
  const mine = !!me && c.author.id === me.id
  return (
    <li className="rv-comment" data-testid="comment">
      <div className="rv-comment__head">
        <b>{c.author.name}</b>
        <span className="rv-muted">{formatDateTime(c.created_at)}</span>
        {c.edited_at && <span className="rv-muted" title={`Edited ${formatDateTime(c.edited_at)}`}>· edited</span>}
        {mine && !editing && <button type="button" className="rv-linkbtn rv-comment__edit" onClick={() => setEditing(true)} aria-label="Edit your comment">Edit</button>}
      </div>
      {editing ? (
        <Composer users={users} label="Edit your comment" submitLabel="Save" initial={c.body} initialMentions={c.mentions} onCancel={() => setEditing(false)}
          send={async (body, mentions) => { onSaved(await reviewApi.editComment(c.id, body, mentions)); setEditing(false) }} />
      ) : (
        <p className="rv-comment__body">{splitMentions(c.body, names).map((s, i) => (s.mention ? <b key={i} className="rv-mention">{s.text}</b> : <span key={i}>{s.text}</span>))}</p>
      )}
    </li>
  )
}

function NewThread({ uploadId, users, anchor, label, onThread }: ThreadPanelProps & { anchor: ThreadAnchor; label: string }) {
  return (
    <div className="rv-newthread">
      <h3 className="rv-section__title">Start a thread</h3>
      <Composer users={users} label={`Comment on ${label}`} submitLabel="Comment"
        send={async (body, mentions) => onThread(await reviewApi.startThread(uploadId, { ...(anchor.finding_id ? { finding_id: anchor.finding_id } : { pointer: anchor.pointer }) }, body, mentions))} />
    </div>
  )
}

/** A text box with @mention autocomplete. Typing @ lists active TAO users (name, email, role); picking one inserts
 * "@Name" and its id goes in `mentions` while the name stays in the text. Enter sends; Shift+Enter is a new line. */
export function Composer({ users, label, submitLabel, send, initial = '', initialMentions = [], onCancel }: {
  users: AppUser[]; label: string; submitLabel: string; send: (body: string, mentions: string[]) => Promise<void>
  initial?: string; initialMentions?: string[]; onCancel?: () => void
}) {
  const [text, setText] = useState(initial)
  const [q, setQ] = useState<{ start: number; query: string; caret: number } | null>(null)
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  const picked = useRef(new Map<string, string>())
  // Mentions the comment already had: kept while their name stays in the text; ids we cannot name are kept as they are.
  const unknown = useRef<string[]>([])
  useEffect(() => {
    picked.current = new Map()
    unknown.current = []
    for (const id of initialMentions) {
      const u = users.find(x => x.id === id)
      if (u) picked.current.set(id, u.name); else unknown.current.push(id)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const ref = useRef<HTMLTextAreaElement>(null)
  const listId = useId(), hintId = useId()
  const hits = q ? mentionMatches(users, q.query) : []
  const listOpen = !!q && hits.length > 0

  const track = (value: string, caret: number) => {
    const m = mentionQuery(value, caret)
    setQ(m ? { ...m, caret } : null)
    setActive(0)
  }
  const pick = (u: AppUser) => {
    if (!q) return
    const r = insertMention(text, q.start, q.caret, u.name)
    picked.current.set(u.id, u.name)
    setText(r.text); setQ(null)
    requestAnimationFrame(() => { const el = ref.current; if (el) { el.focus(); el.setSelectionRange(r.caret, r.caret) } })
  }
  const body = text.trim()
  const submit = async () => {
    if (!body || busy) return
    if (body.length > MAX_BODY) { setErr(`Keep it under ${MAX_BODY.toLocaleString('en-US')} characters.`); return }
    setBusy(true); setErr(undefined)
    try {
      await send(body, [...mentionIds(body, picked.current), ...unknown.current])
      setText(''); setQ(null); picked.current = new Map(); unknown.current = []
    } catch (e) { setErr(errorText(e)) }
    finally { setBusy(false) }
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (listOpen) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % hits.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + hits.length) % hits.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(hits[active]); return }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setQ(null); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
  }
  return (
    <div className="rv-composer">
      <label className="ds-visually-hidden" htmlFor={listId + '-ta'}>{label}</label>
      <textarea id={listId + '-ta'} ref={ref} className="ds-input rv-composer__input" rows={2} value={text} maxLength={MAX_BODY} placeholder="Write a comment. @ to mention a TAO user."
        role="combobox" aria-expanded={listOpen} aria-controls={listId} aria-autocomplete="list" aria-describedby={hintId}
        aria-activedescendant={listOpen ? `${listId}-${active}` : undefined}
        onChange={e => { setText(e.target.value); track(e.target.value, e.target.selectionStart ?? e.target.value.length) }}
        onKeyDown={onKeyDown} onBlur={() => setTimeout(() => setQ(null), 150)} />
      {listOpen && (
        <ul id={listId} role="listbox" className="rv-mentions" aria-label="Mention a TAO user">
          {hits.map((u, i) => (
            <li key={u.id} id={`${listId}-${i}`} role="option" aria-selected={i === active} className="rv-mentions__opt"
              onMouseDown={e => { e.preventDefault(); pick(u) }}>
              <b>{u.name}</b>{u.email && <span className="rv-muted">{u.email}</span>}<span className="rv-muted">{u.role === 'tao_admin' ? 'TAO Admin' : 'TAO Analyst'}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="rv-composer__bar">
        <span id={hintId} className="rv-hint">@ to mention · Enter to send · Shift+Enter for a new line</span>
        {onCancel && <Button size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>}
        <Button size="sm" variant="primary" loading={busy} disabled={!body} onClick={submit}>{submitLabel}</Button>
      </div>
      {err && <div className="rv-dialog-error" role="alert">{err}</div>}
    </div>
  )
}


