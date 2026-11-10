import { useLocation } from 'react-router-dom'
import { Card, formatPeriod } from '@/design/components'
import { roleLabel, type Role } from '../roles'
import { useSession } from '../session'
import { ADMIN_PAGES, PARTNER_PAGES } from '../pages'
import type { DateFormat, DisplayPrefs, Features, NotificationKind, NumberFormat } from '../types'

export type ShellId = 'admin' | 'investor' | 'manager'
export const shellFromPath = (pathname: string): ShellId =>
  pathname.startsWith('/investor') ? 'investor' : pathname.startsWith('/manager') ? 'manager' : 'admin'
export const shellBase = (s: ShellId) => (s === 'admin' ? '' : '/' + s)
export const profilePath = (s: ShellId) => (s === 'admin' ? '/admin/settings/profile' : `/${s}/settings/profile`)
export const notificationsPath = (s: ShellId) => (s === 'admin' ? '/admin/notifications' : `/${s}/notifications`)
/** Kinds only TAO users receive (decision S3: report_late). */
export const TAO_ONLY_KINDS: NotificationKind[] = ['report_late']

export function useShell(): ShellId { return shellFromPath(useLocation().pathname) }

const PORTAL_PREFIX = /^\/(admin|investor|manager)(?=[/?#]|$)/
const routeRegex = (pattern: string) => new RegExp('^' + pattern.replace(/:[^/]+/g, '[^/]+') + '/?$')
/** Where a notification's Open button goes. The API sends links with the portal prefix; one without it
 * (`/settings/profile`) gets the current portal's. A link to a page this portal does not have, or that the role (or a
 * feature that is off) cannot open, goes to the person's Profile instead of a No access or Not found page. */
export function notificationTarget(link: string | null | undefined, shell: ShellId, role: string, features?: Features | null): string {
  const fallback = profilePath(shell)
  if (typeof link !== 'string' || !link.startsWith('/') || link.startsWith('//')) return fallback
  const full = PORTAL_PREFIX.test(link) ? link : (shell === 'admin' ? '/admin' : '/' + shell) + link
  const pathname = full.split(/[?#]/)[0]
  const pages = shell === 'admin' ? ADMIN_PAGES : PARTNER_PAGES.map(p => ({ ...p, path: '/' + shell + p.path }))
  const page = pages.find(p => routeRegex(p.path).test(pathname))
  if (!page) return fallback
  if (page.roles && !page.roles.includes(role)) return fallback
  if (page.feature && features && !features[page.feature]) return fallback
  return full
}

export const DEFAULT_DISPLAY: Required<DisplayPrefs> = { time_zone: 'America/Toronto', date_format: 'D MMM YYYY', number_format: '1,234.56' }
export const withDefaults = (d: DisplayPrefs | undefined): Required<DisplayPrefs> => ({ ...DEFAULT_DISPLAY, ...(d ?? {}) })

/** Parts of a date-time in a time zone. Falls back to Toronto if the zone is not known to the browser. */
function parts(iso: string, tz: string) {
  const d = new Date(iso)
  const fmt = (zone: string) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' })
  let f: Intl.DateTimeFormat
  try { f = fmt(tz) } catch { f = fmt(DEFAULT_DISPLAY.time_zone) }
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]))
  const n = new Intl.DateTimeFormat('en-GB', { timeZone: f.resolvedOptions().timeZone, month: '2-digit' }).format(d)
  return { y: p.year, mon: p.month, mm: n, dd: String(p.day).padStart(2, '0'), d: String(Number(p.day)), wd: p.weekday, hm: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` }
}

/** A calendar date in the person's date format: 7 Aug 2026, 2026-08-07, 08/07/2026 or 07/08/2026. */
export function formatDate(iso: string, prefs?: DisplayPrefs) {
  const { time_zone, date_format } = withDefaults(prefs)
  const p = parts(iso, time_zone)
  const map: Record<DateFormat, string> = {
    'D MMM YYYY': `${p.d} ${p.mon} ${p.y}`, 'YYYY-MM-DD': `${p.y}-${p.mm}-${p.dd}`,
    'MM/DD/YYYY': `${p.mm}/${p.dd}/${p.y}`, 'DD/MM/YYYY': `${p.dd}/${p.mm}/${p.y}`,
  }
  return map[date_format] ?? map['D MMM YYYY']
}
export const formatDateTime = (iso: string, prefs?: DisplayPrefs) => `${formatDate(iso, prefs)} ${parts(iso, withDefaults(prefs).time_zone).hm}`
export const formatTime = (iso: string, prefs?: DisplayPrefs) => parts(iso, withDefaults(prefs).time_zone).hm
/** YYYY-MM-DD of an instant in the zone, for grouping by day. */
export const dayKey = (iso: string, prefs?: DisplayPrefs) => { const p = parts(iso, withDefaults(prefs).time_zone); return `${p.y}-${p.mm}-${p.dd}` }

/** An amount to the cent in the person's number format (1,234.56 or 1 234,56). Stored figures never change. */
export function formatAmount(v: number | null | undefined, nf: NumberFormat = '1,234.56') {
  if (v == null || !Number.isFinite(v)) return '—'
  // A value that rounds to zero carries no minus sign (audit L21).
  const s = v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/^-(?=[0.,]*$)/, '')
  return nf === '1 234,56' ? s.replace(/,/g, ' ').replace('.', ',') : s
}
/** A collection period as Aug 2026, never as a day. */
export const periodLabel = (p: string | null | undefined) => (p ? formatPeriod(p) : '')

/** Shown on person-only pages in role-only mode: a plain request to sign in as a user. */
export function SignInNote({ what, role }: { what: string; role: Role }) {
  const { fallback, userId } = useSession()
  return (
    <Card className="acct-signin" title="Sign in as a user" headingLevel={2}>
      <p>{what} belong to a person. You are using the role <b>{roleLabel(role)}</b> without a user.</p>
      <p>Open <b>Sign in as (POC)</b> at the bottom of the sidebar and pick a sample user. It stands in for real sign-in: there is no password in the POC.</p>
      {userId && fallback && (
        <p className="acct-muted">The API did not accept the chosen user ({fallback === 'no_user' ? 'it answered without a user' : fallback}), so the app is working by role only. An older API without users does this; everything else still works.</p>
      )}
    </Card>
  )
}
