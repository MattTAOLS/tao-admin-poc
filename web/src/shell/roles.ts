export type Role = 'tao_admin' | 'tao_analyst' | 'investor_admin' | 'investor_viewer' | 'manager_admin' | 'manager_viewer'
export const ROLES: { id: Role; label: string; shell: 'admin' | 'investor' | 'manager'; partner?: 'investor' | 'manager' }[] = [
  { id: 'tao_admin', label: 'TAO Admin', shell: 'admin' },
  { id: 'tao_analyst', label: 'TAO Analyst', shell: 'admin' },
  { id: 'investor_admin', label: 'Investor · Company Admin', shell: 'investor', partner: 'investor' },
  { id: 'investor_viewer', label: 'Investor · Viewer', shell: 'investor', partner: 'investor' },
  { id: 'manager_admin', label: 'Manager · Company Admin', shell: 'manager', partner: 'manager' },
  { id: 'manager_viewer', label: 'Manager · Viewer', shell: 'manager', partner: 'manager' },
]
export const roleLabel = (r: string) => ROLES.find(x => x.id === r)?.label ?? r
export const KEY = 'tao-admin-poc.role'
/** The signed-in seeded user's id (wave C, "Sign in as (POC)"). Absent = role-only mode, exactly as in phase 1. */
export const USER_KEY = 'tao-admin-poc.user'

export function loadRole(): Role { try { return (localStorage.getItem(KEY) as Role) || 'tao_admin' } catch { return 'tao_admin' } }
/** Sets the role. A stored user with another role no longer matches, so it is cleared (role-only mode). */
export function saveRole(r: Role, userRole?: Role) {
  try {
    localStorage.setItem(KEY, r)
    if (loadUserId() && userRole !== r) localStorage.removeItem(USER_KEY)
  } catch {}
}
export function loadUserId(): string | null { try { return localStorage.getItem(USER_KEY) } catch { return null } }
/** Signs in as a seeded user: stores the id and the user's role together. */
export function saveUser(id: string, role: Role) { try { localStorage.setItem(USER_KEY, id) } catch {} ; saveRole(role, role) }
export function clearUser() { try { localStorage.removeItem(USER_KEY) } catch {} }
