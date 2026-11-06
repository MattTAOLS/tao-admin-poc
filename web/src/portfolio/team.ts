/** Team members (D8 c): types from contracts/openapi.yaml (AppUser, Subscription, Me) and the pure logic behind the page:
 * the subscription tree, the role words and the error messages for the /users codes. */
import type { Role } from '@/shell/roles'

export type AppUser = {
  id: string; email: string; name: string; role: Role; partner_slug: string | null
  status: 'active' | 'deactivated'; created_at: string
  last_active_at?: string | null; deactivated_at?: string | null; deactivation_reason?: string | null
  receives_summary?: string
}
export type Channel = 'in_app' | 'email'
export type Subscription = { program_slug: string; deal_slug: string | null; channels: Channel[] }
export type Me = { user: AppUser | null; role: Role; partner_slug: string | null }

/** A program shared with the partner, with its deals, as the tree lists it. */
export type TreeProgram = { slug: string; name: string; deals: { slug: string; name: string }[] }
/** Per program: all = "All deals in this program, including new ones"; deals = the ticked deals when all is off. */
export type Picks = Record<string, { all: boolean; deals: string[] }>

export const isCompanyAdmin = (r: Role) => r === 'investor_admin' || r === 'manager_admin'
export const roleWord = (r: Role) => r.endsWith('_admin') ? 'Company Admin' : r.endsWith('_viewer') ? 'Viewer' : r
export const partnerName = (slug: string) => slug.charAt(0).toUpperCase() + slug.slice(1)

/** Subscriptions to tree picks, limited to the shared programs. A program entry (deal_slug null) means all deals and
 * wins over deal entries; deals the program no longer has, and programs no longer shared, drop out (note 10). */
export function toPicks(subs: Subscription[], programs: TreeProgram[]): Picks {
  const out: Picks = {}
  for (const p of programs) {
    const mine = subs.filter(s => s.program_slug === p.slug)
    const known = new Set(p.deals.map(d => d.slug))
    out[p.slug] = mine.some(s => s.deal_slug === null)
      ? { all: true, deals: [] }
      : { all: false, deals: p.deals.map(d => d.slug).filter(d => mine.some(s => s.deal_slug === d) && known.has(d)) }
  }
  return out
}

/** Tree picks to the PUT body. In-app only in phase 2 (email is refused with 422 email_later). */
export function toSubscriptions(picks: Picks, programs: TreeProgram[]): Subscription[] {
  const out: Subscription[] = []
  for (const p of programs) {
    const pk = picks[p.slug]
    if (!pk) continue
    if (pk.all) out.push({ program_slug: p.slug, deal_slug: null, channels: ['in_app'] })
    else for (const d of p.deals) if (pk.deals.includes(d.slug)) out.push({ program_slug: p.slug, deal_slug: d.slug, channels: ['in_app'] })
  }
  return out
}

export const samePicks = (a: Picks, b: Picks, programs: TreeProgram[]) =>
  JSON.stringify(toSubscriptions(a, programs)) === JSON.stringify(toSubscriptions(b, programs))

/** Ticked deals out of all, for the program row count. "All" counts every deal. */
export function pickedCount(pk: { all: boolean; deals: string[] } | undefined, total: number) {
  if (!pk) return 0
  return pk.all ? total : pk.deals.length
}

/** What the person sees for an API error code on the users routes (contracts/openapi.yaml Error). */
export function errorText(e: { code?: string; message?: string }, partner: string): string {
  const who = partnerName(partner)
  switch (e.code) {
    case 'self_change': return 'You can’t change your own role or deactivate yourself. Ask another Company Admin.'
    case 'last_admin': return `${who} must keep at least one active Company Admin. Make someone else a Company Admin first.`
    case 'email_taken': return 'That email is already used by another account.'
    case 'other_partner': return `You can only add Company Admins or Viewers at ${who}.`
    case 'already_active': return 'This person is already active.'
    case 'already_deactivated': return 'This person is already deactivated.'
    case 'not_visible': return `One of these programs is no longer shared with ${who}. Reload the page and try again.`
    case 'email_later': return 'Email delivery is coming later; reports arrive in-app for now.'
    case 'unknown_program': case 'unknown_deal': return 'One of these programs or deals no longer exists. Reload the page and try again.'
    case 'role_partner_mismatch': return 'That role does not belong to this company.'
    case 'company_admin_only': return 'Only a Company Admin can manage the team.'
    default: return e.message || 'The request failed. Try again in a moment.'
  }
}

export function initials(name: string) {
  const parts = name.replace(/[^\p{L}\s.]/gu, '').split(/[\s.]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
}

const DT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Toronto' })
const D = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Toronto' })
export const fmtDateTime = (iso?: string | null) => iso ? DT.format(new Date(iso)) : 'Never'
export const fmtDate = (iso?: string | null) => iso ? D.format(new Date(iso)) : ''
