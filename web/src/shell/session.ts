import { useSyncExternalStore } from 'react'
import type { Features, Me, UnreadCount } from './types'
import { loadUserId } from './roles'

/** Who is using the app (wave C, risk R1).
 * - `user`: signed in as a seeded user; every call sends X-User (plus X-Role / X-Partner for that user's role).
 * - `pending`: a user is chosen and GET /me is in flight; calls already send X-User.
 * - `role-only`: no user chosen, or GET /me failed (older API, unknown or deactivated user). Calls send X-Role /
 *   X-Partner only, exactly as in phase 1, and person-only features (notifications, profile) ask the user to sign in. */
export type SessionMode = 'user' | 'pending' | 'role-only'
export type Session = {
  mode: SessionMode
  userId: string | null
  me: Me | null
  /** Why a chosen user fell back to role-only: an API error code (`unknown_user`, `inactive_user`, `http_404`, ...). */
  fallback?: string
  unread: UnreadCount | null
  /** Me.features for the current role, read from GET /me in every mode (role-only too, without X-User).
   * null while it is being read; all false when /me fails (an older API), so partner-only gates stay closed. */
  features: Features | null
}

// A user stored from an earlier visit starts as pending, so the very first calls already carry X-User.
const fresh = (): Session => { const userId = loadUserId(); return { mode: userId ? 'pending' : 'role-only', userId, me: null, unread: null, features: null } }
let current: Session = fresh()
const listeners = new Set<() => void>()
export const sessionStore = {
  get: () => current,
  set: (s: Partial<Session>) => { current = { ...current, ...s }; listeners.forEach(l => l()) },
  /** Back to what storage says (tests, and after sign-in changes). */
  reset: () => { current = fresh(); listeners.forEach(l => l()) },
  subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } },
}

/** The current session for any page: `const { mode, me } = useSession()`; `me.user` is the signed-in person. */
export function useSession(): Session {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.get, sessionStore.get)
}
