import type { Role } from './roles'

/** Wave C shapes from contracts/openapi.yaml (Me, AppUser, Notification, NotificationPref, UnreadCount, Subscription). */
export type AppUser = {
  id: string; email: string; name: string; role: Role; partner_slug: string | null; status: 'active' | 'deactivated'
  created_at: string; last_active_at?: string | null; receives_summary?: string
}
export type DateFormat = 'D MMM YYYY' | 'YYYY-MM-DD' | 'MM/DD/YYYY' | 'DD/MM/YYYY'
export type NumberFormat = '1,234.56' | '1 234,56'
export type DisplayPrefs = { time_zone?: string; date_format?: DateFormat; number_format?: NumberFormat }
export type Me = { user: AppUser | null; role: Role; partner_slug: string | null; display: DisplayPrefs }
export type MePatch = { name?: string; time_zone?: string; date_format?: DateFormat; number_format?: NumberFormat }

export type NotificationKind = 'mention' | 'reply' | 'report_needs_review' | 'report_published' | 'correction_published'
  | 'covenant_changed' | 'report_rejected' | 'user_change' | 'system'
export type NotificationTab = 'all' | 'mentions' | 'reports' | 'system'
export type NotificationChange = { pointer?: string; label?: string; old_value?: number; new_value?: number }
export type AppNotification = {
  id: string; kind: NotificationKind; title: string; body?: string | null; link: string
  upload_id?: string | null; deal_slug?: string | null; collection_period?: string | null; version?: number | null
  thread_id?: string | null; note_from_tao?: string | null; changes?: NotificationChange[] | null
  created_at: string; read_at: string | null
}
export type UnreadCount = { total: number; mentions: number; reports: number; system: number }
export type NotificationPref = { kind: NotificationKind; in_app: boolean; digest: 'instant' | 'daily'; required?: boolean }
export type Subscription = { program_slug: string; deal_slug: string | null; channels: ('in_app' | 'email')[] }
export type AuditRow = {
  id: string; at: string; actor_role: string; actor_label?: string; action: string; upload_id: string | null
  reason?: string | null; deal_slug?: string | null; deal_name?: string | null; collection_period?: string | null
  detail?: Record<string, unknown>
}
