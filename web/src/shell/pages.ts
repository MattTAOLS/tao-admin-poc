import type { ComponentType } from 'react'
/** Every page in docs/portal-map.md, by shell. `built: true` pages get a real component in wave 1; the rest render a
 * routed placeholder so navigation and the role switcher behave as the finished app will. Owner = agent folder.
 *
 * To register a page, add `load` to its entry (one line, tell the Design System agent who owns this file):
 *   { path: '/admin/uploads', ..., load: () => import('@/admin/UploadsPage') }
 * The module's default export is rendered inside the shell (lazy, with the route progress bar while it loads).
 * Read route params with react-router's useParams; set the top bar with usePageHeader from '@/shell/header'. */
export type Page = {
  path: string; title: string; nav?: 'main' | 'account'; roles?: string[]; built?: boolean
  owner: 'admin' | 'review' | 'portfolio' | 'shell'; purpose?: string
  load?: () => Promise<{ default: ComponentType }>
}
export const ADMIN_PAGES: Page[] = [
  { path: '/admin', title: 'Dashboard', nav: 'main', built: true, owner: 'admin', purpose: 'Queue counts, recent uploads, covenant status across programs' },
  { path: '/admin/uploads', title: 'Uploads', nav: 'main', built: true, owner: 'admin' },
  { path: '/admin/uploads/new', title: 'Upload report', built: true, owner: 'admin', purpose: 'Pick deal and period first, then the file; shows both dates back before accepting' },
  { path: '/admin/uploads/history', title: 'Upload history', built: true, owner: 'admin' },
  { path: '/admin/uploads/queue', title: 'Approval queue', built: true, owner: 'review', load: () => import('@/review/QueuePage') },
  { path: '/admin/uploads/queue/:uploadId', title: 'Review report', built: true, owner: 'review', purpose: 'Finding cards: rule, severity, ours vs report, page crop; override / restate / reject / publish', load: () => import('@/review/ReviewPage') },
  { path: '/admin/reports', title: 'Reports library', nav: 'main', built: true, owner: 'review', purpose: 'Published reports; Regenerate dashboard pop-up' },
  { path: '/admin/partners', title: 'Partners', nav: 'main', roles: ['tao_admin'], built: true, owner: 'admin' },
  { path: '/admin/partners/:partnerId', title: 'Partner details', roles: ['tao_admin'], built: true, owner: 'admin' },
  { path: '/admin/partners/:partnerId/programs/:programId', title: 'Program / facility record', roles: ['tao_admin'], built: true, owner: 'admin', purpose: 'Limits, covenant definitions with threshold rules, amendment dates' },
  { path: '/admin/portfolio', title: 'Portfolio Executive Summary', nav: 'main', built: true, owner: 'portfolio' },
  { path: '/admin/notifications', title: 'Notifications', nav: 'main', owner: 'shell' },
  { path: '/admin/search', title: 'Search results', owner: 'shell' },
  { path: '/admin/help', title: 'Help & support', nav: 'main', owner: 'shell' },
  { path: '/admin/settings/users', title: 'User management', nav: 'account', roles: ['tao_admin'], owner: 'admin' },
  { path: '/admin/settings/users/audit', title: 'Audit log', roles: ['tao_admin'], built: true, owner: 'admin' },
  { path: '/admin/settings/users/roles', title: 'Roles & permissions', roles: ['tao_admin'], owner: 'admin' },
  { path: '/admin/settings/profile', title: 'Profile', nav: 'account', owner: 'shell' },
  { path: '/admin/settings/system', title: 'System settings', nav: 'account', roles: ['tao_admin'], owner: 'shell' },
]
export const PARTNER_PAGES: Page[] = [
  { path: '', title: 'Home', nav: 'main', built: true, owner: 'portfolio', purpose: 'Redirects to Portfolio Executive Summary (home page in the map)' },
  { path: '/portfolio', title: 'Portfolio Executive Summary', nav: 'main', built: true, owner: 'portfolio' },
  { path: '/portfolio/:programId', title: 'Program Executive Summary', built: true, owner: 'portfolio' },
  { path: '/portfolio/:programId/dashboard', title: 'Program Dashboard', built: true, owner: 'portfolio', purpose: 'Portfolio Metrics + Covenant Status & Review, watch threshold, print' },
  { path: '/portfolio/:programId/deals/:dealId', title: 'Deal page', built: true, owner: 'portfolio', purpose: 'Deal Metrics + covenant detail, prev/next deal' },
  { path: '/reports', title: 'Reports', nav: 'main', owner: 'portfolio' },
  { path: '/reports/:reportId', title: 'Report viewer', owner: 'portfolio' },
  { path: '/data-room', title: 'Data room', nav: 'main', owner: 'portfolio' },
  { path: '/notifications', title: 'Notifications', nav: 'main', owner: 'shell' },
  { path: '/whats-new', title: "What's new", nav: 'main', owner: 'shell' },
  { path: '/help', title: 'Help & support', nav: 'main', owner: 'shell' },
  { path: '/settings/profile', title: 'Profile', nav: 'account', owner: 'shell' },
  { path: '/settings/team', title: 'Team members', nav: 'account', roles: ['investor_admin', 'manager_admin'], owner: 'shell' },
]
