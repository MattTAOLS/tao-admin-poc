export type Role = 'tao_admin' | 'tao_analyst' | 'investor_admin' | 'investor_viewer' | 'manager_admin' | 'manager_viewer'
export const ROLES: { id: Role; label: string; shell: 'admin' | 'investor' | 'manager'; partner?: 'investor' | 'manager' }[] = [
  { id: 'tao_admin', label: 'TAO Admin', shell: 'admin' },
  { id: 'tao_analyst', label: 'TAO Analyst', shell: 'admin' },
  { id: 'investor_admin', label: 'Investor · Company Admin', shell: 'investor', partner: 'investor' },
  { id: 'investor_viewer', label: 'Investor · Viewer', shell: 'investor', partner: 'investor' },
  { id: 'manager_admin', label: 'Manager · Company Admin', shell: 'manager', partner: 'manager' },
  { id: 'manager_viewer', label: 'Manager · Viewer', shell: 'manager', partner: 'manager' },
]
export const KEY = 'tao-admin-poc.role'
export function loadRole(): Role { try { return (localStorage.getItem(KEY) as Role) || 'tao_admin' } catch { return 'tao_admin' } }
export function saveRole(r: Role) { try { localStorage.setItem(KEY, r) } catch {} }
