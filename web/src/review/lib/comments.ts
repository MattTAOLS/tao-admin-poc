/** Wave C comment threads (D7 b): pure helpers for anchors, counts, who may resolve, and @mentions. */
import type { AppUser, Comment, CommentAuthor, Thread, ThreadAnchor } from './types'

/** A stable key for an anchor: `f:<finding id>` or `p:<pointer>`. */
export const anchorKey = (a: ThreadAnchor): string => (a.finding_id ? 'f:' + a.finding_id : 'p:' + (a.pointer ?? ''))

/** Threads on exactly this anchor. A row anchor (`/covenants/2`) also takes the threads on its cells
 * (`/covenants/2/threshold`), so a table row shows every thread on its values. */
export function threadsOn(threads: Thread[] | undefined, a: ThreadAnchor, withChildren = false): Thread[] {
  if (!threads) return []
  if (a.finding_id) return threads.filter(t => t.anchor.finding_id === a.finding_id)
  const p = a.pointer ?? ''
  return threads.filter(t => t.anchor.pointer === p || (withChildren && !!t.anchor.pointer && t.anchor.pointer.startsWith(p + '/')))
}

export const commentCount = (threads: Thread[]) => threads.reduce((n, t) => n + t.comments.length, 0)

/** Open threads first, then newest activity first (the API sends open first too; this keeps it after local updates). */
export function sortThreads(threads: Thread[]): Thread[] {
  const last = (t: Thread) => t.comments[t.comments.length - 1]?.created_at ?? t.created_at
  return [...threads].sort((a, b) => Number(a.status !== 'open') - Number(b.status !== 'open') || last(b).localeCompare(last(a)))
}

/** C10: any TAO Admin, or the person who started the thread. Analysts resolve only their own. */
export function canResolve(thread: Thread, me: CommentAuthor | null, role: string): boolean {
  if (!me) return false
  return role === 'tao_admin' || thread.created_by.id === me.id
}

/** "from version 1" for a thread carried over from an earlier publication version (C9), or "from the replaced
 * report" for a thread listed from the upload a corrected re-issue replaces. Null for a thread on this version. */
export function carriedLabel(thread: Thread, uploadId: string, currentVersion: number | null | undefined): string | null {
  if (thread.upload_id !== uploadId) return thread.version != null ? `from the replaced report, version ${thread.version}` : 'from the replaced report'
  if (thread.version != null && currentVersion != null && thread.version < currentVersion) return `from version ${thread.version}`
  return null
}

/** The @query being typed just before the caret, or null. A query runs from an @ that starts the text or follows
 * whitespace, up to the caret, without a line break; names like "A. Patel" contain a space and a dot. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at < 0) return null
  if (at > 0 && !/\s/.test(before[at - 1])) return null
  const query = before.slice(at + 1)
  if (/[\n\r]/.test(query) || query.length > 40) return null
  return { start: at, query }
}

/** Active TAO users whose name or email matches the query, name order, at most `limit`. */
export function mentionMatches(users: AppUser[], query: string, limit = 6): AppUser[] {
  const q = query.trim().toLowerCase()
  return users
    .filter(u => u.status === 'active' && (u.role === 'tao_admin' || u.role === 'tao_analyst'))
    .filter(u => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit)
}

/** Replaces "@<query>" (from `start` to `caret`) with "@Name " and returns the new text and caret. */
export function insertMention(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
  const ins = '@' + name + ' '
  return { text: text.slice(0, start) + ins + text.slice(caret), caret: start + ins.length }
}

/** The ids to send in `mentions`: users picked from the list whose "@Name" is still in the text. Each once. */
export function mentionIds(text: string, picked: Map<string, string>): string[] {
  const ids: string[] = []
  for (const [id, name] of picked) if (text.includes('@' + name) && !ids.includes(id)) ids.push(id)
  return ids
}

/** Mention candidates when the user list cannot be read (GET /users is TAO Admin only, C3): everyone who has
 * already written on this upload. */
export function peopleFromThreads(threads: Thread[] | undefined): AppUser[] {
  const seen = new Map<string, AppUser>()
  const add = (a: CommentAuthor) => { if (!seen.has(a.id)) seen.set(a.id, { id: a.id, name: a.name, email: '', role: 'tao_analyst', partner_slug: null, status: 'active' }) }
  for (const t of threads ?? []) { add(t.created_by); t.comments.forEach((c: Comment) => add(c.author)) }
  return [...seen.values()]
}

/** Comment text split so @mentions of named people can be shown in bold. */
export function splitMentions(body: string, names: string[]): { text: string; mention: boolean }[] {
  const sorted = [...new Set(names)].filter(Boolean).sort((a, b) => b.length - a.length)
  if (sorted.length === 0) return [{ text: body, mention: false }]
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp('(@(?:' + sorted.map(esc).join('|') + '))', 'g')
  return body.split(re).filter(s => s !== '').map(s => ({ text: s, mention: sorted.some(n => s === '@' + n) }))
}
