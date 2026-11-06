import type { Role } from './roles'

/** The seeded sample users (a copy of seed/users.json; the web container mounts only web/ and contracts/, so the seed file
 * is not reachable at run time). A test keeps this copy equal to the seed. The "Sign in as (POC)" menu lists them and
 * sends the chosen id as X-User. Names are generic samples, emails use example.com. */
export type SeedUser = { id: string; email: string; name: string; role: Role; partner_slug: string | null }

export const SEED_USERS: SeedUser[] = [
  { id: '00000000-0000-4000-8000-000000000001', email: 'tao.admin@example.com', name: 'A. Patel', role: 'tao_admin', partner_slug: null },
  { id: '00000000-0000-4000-8000-000000000002', email: 'tao.admin2@example.com', name: 'R. Okafor', role: 'tao_admin', partner_slug: null },
  { id: '00000000-0000-4000-8000-000000000003', email: 'tao.analyst@example.com', name: 'J. Moreau', role: 'tao_analyst', partner_slug: null },
  { id: '00000000-0000-4000-8000-000000000004', email: 'tao.analyst2@example.com', name: 'S. Lindqvist', role: 'tao_analyst', partner_slug: null },
  { id: '00000000-0000-4000-8000-000000000005', email: 'investor.admin@example.com', name: 'M. Chen', role: 'investor_admin', partner_slug: 'investor' },
  { id: '00000000-0000-4000-8000-000000000006', email: 'investor.viewer@example.com', name: 'D. Alvarez', role: 'investor_viewer', partner_slug: 'investor' },
  { id: '00000000-0000-4000-8000-000000000007', email: 'manager.admin@example.com', name: 'K. Novak', role: 'manager_admin', partner_slug: 'manager' },
  { id: '00000000-0000-4000-8000-000000000008', email: 'manager.viewer@example.com', name: 'L. Haddad', role: 'manager_viewer', partner_slug: 'manager' },
]

export const seedUser = (id: string | null | undefined) => (id ? SEED_USERS.find(u => u.id === id) : undefined)
