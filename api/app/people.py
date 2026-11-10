"""Wave C people: users, subscriptions, display and notification preferences, system settings (contract abdda6d).
Row -> contract dict, defaults, and the checks the routes in main.py share. No routes here."""
import datetime as dt, re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from .auth import TAO, PARTNER, COMPANY_ADMINS
from .models import AppUser, Subscription, UserPref, NotificationPref, SystemSetting, Program, Deal, Partner
from . import views

ROLES = ["tao_admin", "tao_analyst", "investor_admin", "investor_viewer", "manager_admin", "manager_viewer"]
KINDS = ["mention", "reply", "report_needs_review", "report_published", "correction_published", "covenant_changed", "report_rejected",
         "user_change", "system", "adverse_media", "negative_news", "report_late"]
PARTNER_KINDS = ["report_published", "correction_published", "user_change", "adverse_media", "negative_news"]    # what a partner role can receive
COMPANY_KINDS = ["adverse_media", "negative_news"]                             # partners: only while company profiles are on
REQUIRED = {"covenant_changed", "correction_published"}                        # in_app cannot be switched off (422 required)
TABS = {"mentions": ["mention", "reply"],
        "reports": ["report_needs_review", "report_published", "correction_published", "covenant_changed", "report_rejected",
                    "adverse_media", "negative_news", "report_late"],
        "system": ["user_change", "system"]}
DISPLAY_DEFAULTS = {"time_zone": "America/Toronto", "date_format": "D MMM YYYY", "number_format": "1,234.56"}
DATE_FORMATS = ["D MMM YYYY", "YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"]
NUMBER_FORMATS = ["1,234.56", "1 234,56"]


class Refused(Exception):
    """A contract error: the route turns it into {code, message} with the status."""
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def kinds_for(role: str) -> list[str]:
    return list(KINDS) if role in TAO else list(PARTNER_KINDS)


# ---- settings ----
def _builtin_prefs(role: str) -> list[dict]:
    """The out-of-the-box notification_defaults (D10 section 4): everything in-app; TAO gets published reports as a daily digest."""
    return [{"kind": k, "in_app": True, "digest": "daily" if role in TAO and k == "report_published" else "instant"} for k in kinds_for(role)]


DEFAULT_TEMPLATES = {
    "new_report": "The {collection_period} settlement report for {deal_name} ({program_name}) is now available in your portal. "
                  "Covenant summary: {covenant_summary}.",
    "correction": "We have corrected the {collection_period} report for {deal_name}. What changed: {change_list}. Reason: {reason}. "
                  "The earlier version stays in your history."}
SETTING_KEYS = ["partner_notifications_enabled", "reporting_calendar", "notification_defaults", "publish_note_templates", "company_feeds",
                "company_profiles_partner_enabled"]
FEED_SOURCES = ["google_news", "gdelt"]
FEED_DEFAULTS = {"enabled": False, "run_at": "06:00", "time_zone": "America/Toronto", "sources": list(FEED_SOURCES), "daily_cap": 200}
RUN_AT = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def setting_default(key: str):
    return {"partner_notifications_enabled": False, "reporting_calendar": {}, "notification_defaults": {r: _builtin_prefs(r) for r in ROLES},
            "publish_note_templates": dict(DEFAULT_TEMPLATES), "company_feeds": {**FEED_DEFAULTS, "sources": list(FEED_SOURCES)},
            "company_profiles_partner_enabled": False}[key]


def _stored(key: str, value):
    """company_feeds stored before wave D was a placeholder ({}): read it over the defaults so every field is there."""
    if key == "company_feeds" and isinstance(value, dict):
        return {**setting_default(key), **value}
    return value


def get_setting(s: Session, key: str):
    row = s.get(SystemSetting, key)
    return setting_default(key) if row is None else _stored(key, row.value)


def setting_dict(s: Session, key: str) -> dict:
    row = s.get(SystemSetting, key)
    if row is None:
        return {"key": key, "value": setting_default(key), "updated_at": None, "updated_by": None}
    return {"key": key, "value": _stored(key, row.value), "updated_at": views.iso(row.updated_at), "updated_by": row.updated_by}


def _check_prefs(role: str, rows, where: str) -> list[dict]:
    """A NotificationPref list for one role: known kinds the role can receive, each once, required kinds left on."""
    if not isinstance(rows, list):
        raise Refused(422, "invalid", f"{where} must be a list of notification preferences")
    out, seen, allowed = [], set(), kinds_for(role)
    for r in rows:
        if not isinstance(r, dict) or r.get("kind") not in KINDS or not isinstance(r.get("in_app"), bool) or r.get("digest") not in ("instant", "daily"):
            raise Refused(422, "invalid", f"{where}: each entry needs kind, in_app (true/false) and digest (instant/daily)")
        if r["kind"] not in allowed:
            raise Refused(422, "invalid", f"{where}: {role} cannot receive {r['kind']}")
        if r["kind"] in seen:
            raise Refused(422, "invalid", f"{where}: {r['kind']} appears twice")
        if r["kind"] in REQUIRED and not r["in_app"]:
            raise Refused(422, "required", f"{r['kind']} cannot be switched off")
        seen.add(r["kind"])
        out.append({"kind": r["kind"], "in_app": r["in_app"], "digest": r["digest"]})
    return out


def check_setting(s: Session, key: str, value):
    """The value, checked against its key's shape (422 invalid)."""
    if key == "partner_notifications_enabled":
        if not isinstance(value, bool):
            raise Refused(422, "invalid", "partner_notifications_enabled is true or false")
    elif key == "reporting_calendar":
        if not isinstance(value, dict):
            raise Refused(422, "invalid", "reporting_calendar is {deal_slug: expected day 1-31}")
        for slug, day in value.items():
            if s.get(Deal, slug) is None:
                raise Refused(422, "invalid", f"reporting_calendar: no deal {slug}")
            if not isinstance(day, int) or isinstance(day, bool) or not 1 <= day <= 31:
                raise Refused(422, "invalid", f"reporting_calendar: {slug} needs a day from 1 to 31")
    elif key == "notification_defaults":
        if not isinstance(value, dict) or any(r not in ROLES for r in value):
            raise Refused(422, "invalid", "notification_defaults is {role: [NotificationPref]} for the six roles")
        value = {r: _check_prefs(r, rows, f"notification_defaults.{r}") for r, rows in value.items()}
    elif key == "publish_note_templates":
        if not isinstance(value, dict) or not value or set(value) - {"new_report", "correction"} or not all(isinstance(v, str) for v in value.values()):
            raise Refused(422, "invalid", "publish_note_templates is {new_report: text, correction: text}")
        value = {**get_setting(s, key), **value}
    elif key == "company_feeds":
        value = check_feeds(get_setting(s, key), value)
    elif key == "company_profiles_partner_enabled":
        if not isinstance(value, bool):
            raise Refused(422, "invalid", "company_profiles_partner_enabled is true or false")
    return value


def check_feeds(current: dict, value) -> dict:
    """company_feeds: {enabled: bool, run_at: 'HH:MM', time_zone: IANA, sources: subset of [google_news, gdelt], daily_cap:
    1-5000 requests per source per day (wave E, default 200)}. Fields left
    out keep their current value (the defaults while unset)."""
    if not isinstance(value, dict):
        raise Refused(422, "invalid", "company_feeds is {enabled, run_at, time_zone, sources, daily_cap}")
    extra = set(value) - set(FEED_DEFAULTS)
    if extra:
        raise Refused(422, "invalid", f"company_feeds: unknown field(s) {', '.join(sorted(extra))}")
    out = {**FEED_DEFAULTS, **(current or {}), **value}
    if not isinstance(out["enabled"], bool):
        raise Refused(422, "invalid", "company_feeds.enabled is true or false")
    if not isinstance(out["run_at"], str) or not RUN_AT.match(out["run_at"]):
        raise Refused(422, "invalid", "company_feeds.run_at is HH:MM (24-hour)")
    if not isinstance(out["time_zone"], str):
        raise Refused(422, "invalid", "company_feeds.time_zone is an IANA time zone")
    check_time_zone(out["time_zone"])
    src = out["sources"]
    if not isinstance(src, list) or any(x not in FEED_SOURCES for x in src) or len(set(src)) != len(src):
        raise Refused(422, "invalid", "company_feeds.sources is a list drawn from google_news, gdelt, each once")
    cap = out["daily_cap"]
    if not isinstance(cap, int) or isinstance(cap, bool) or not 1 <= cap <= 5000:
        raise Refused(422, "invalid", "company_feeds.daily_cap is a whole number of requests per source per day, 1 to 5000")
    return {k: out[k] for k in FEED_DEFAULTS}


# ---- notification preferences ----
def default_prefs(s: Session, role: str) -> dict[str, dict]:
    """kind -> pref for a role: the notification_defaults setting over the built-in defaults."""
    out = {p["kind"]: dict(p) for p in _builtin_prefs(role)}
    for p in (get_setting(s, "notification_defaults") or {}).get(role) or []:
        if p.get("kind") in out:
            out[p["kind"]] = {"kind": p["kind"], "in_app": bool(p.get("in_app", True)), "digest": p.get("digest") or "instant"}
    return out


def prefs(s: Session, u: AppUser) -> list[dict]:
    """One row per kind the user's role can receive: their own choice, else the default. Required kinds always in_app."""
    out = default_prefs(s, u.role)
    for p in s.scalars(select(NotificationPref).where(NotificationPref.user_id == u.id)).all():
        if p.kind in out:
            out[p.kind] = {"kind": p.kind, "in_app": p.in_app, "digest": p.digest}
    return [{**out[k], "in_app": out[k]["in_app"] or k in REQUIRED, "required": k in REQUIRED} for k in kinds_for(u.role)]


def wants(s: Session, u: AppUser, kind: str) -> bool:
    """Whether a notification of this kind is created for the user (switched-off kinds are not)."""
    if kind in REQUIRED:
        return True
    if kind not in kinds_for(u.role):
        return False
    p = s.get(NotificationPref, (u.id, kind))
    return p.in_app if p is not None else default_prefs(s, u.role)[kind]["in_app"]


def set_prefs(s: Session, u: AppUser, rows: list[dict]) -> None:
    """PUT semantics: the given kinds are stored; kinds left out go back to the defaults (their rows are removed)."""
    rows = _check_prefs(u.role, rows, "body")
    for p in s.scalars(select(NotificationPref).where(NotificationPref.user_id == u.id)).all():
        s.delete(p)
    s.flush()
    for r in rows:
        s.add(NotificationPref(user_id=u.id, **r))
    s.flush()


# ---- display ----
def display(s: Session, u: AppUser | None) -> dict:
    p = s.get(UserPref, u.id) if u is not None else None
    return {k: (getattr(p, k, None) or v) for k, v in DISPLAY_DEFAULTS.items()}


def check_time_zone(tz: str) -> None:
    try:
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        raise Refused(422, "invalid", f"unknown time zone {tz}")


# ---- users ----
def program_name(s: Session, slug: str) -> str:
    p = s.get(Program, slug)
    return p.name if p else slug


def subscriptions(s: Session, user_id: str) -> list[Subscription]:
    return list(s.scalars(select(Subscription).where(Subscription.user_id == user_id)
                          .order_by(Subscription.program_slug, Subscription.deal_slug.is_not(None), Subscription.deal_slug)).all())


def subscription_dict(x: Subscription) -> dict:
    return {"program_slug": x.program_slug, "deal_slug": x.deal_slug, "channels": list(x.channels or ["in_app"])}


def receives_summary(s: Session, user_id: str) -> str:
    """'All MOVE Trust deals; Moneda Capital Corp., Stride Capital (F-PIL 2.0)', programs in name order, deals in name
    order; 'Nothing yet' when there are no subscriptions."""
    by_program: dict[str, set] = {}
    for x in subscriptions(s, user_id):
        by_program.setdefault(x.program_slug, set()).add(x.deal_slug)
    if not by_program:
        return "Nothing yet"
    parts = []
    for slug in sorted(by_program, key=lambda k: program_name(s, k)):
        deals = by_program[slug]
        if None in deals:
            parts.append(f"All {program_name(s, slug)} deals")
        else:
            names = sorted((s.get(Deal, d).name if s.get(Deal, d) else d) for d in deals)
            parts.append(f"{', '.join(names)} ({program_name(s, slug)})")
    return "; ".join(parts)


def user_dict(s: Session, u: AppUser) -> dict:
    return {"id": u.id, "email": u.email, "name": u.name, "role": u.role, "partner_slug": u.partner_slug, "status": u.status,
            "created_at": views.iso(u.created_at), "last_active_at": views.iso(u.last_active_at), "deactivated_at": views.iso(u.deactivated_at),
            "deactivation_reason": u.deactivation_reason, "receives_summary": receives_summary(s, u.id)}


def user_audit(u: AppUser) -> dict:
    """What a user_change entry records as before / after (no derived fields)."""
    return {"email": u.email, "name": u.name, "role": u.role, "partner_slug": u.partner_slug, "status": u.status}


def check_role_partner(s: Session, role: str, partner: str | None) -> None:
    """TAO roles carry no partner; a partner role carries its own (investor_* -> investor, manager_* -> manager)."""
    if role in TAO:
        if partner is not None:
            raise Refused(422, "role_partner_mismatch", f"{role} is a TAO role and takes no partner_slug")
        return
    if partner is not None and s.get(Partner, partner) is None:
        raise Refused(422, "unknown_partner", f"no partner {partner}")
    if partner != PARTNER[role]:
        raise Refused(422, "role_partner_mismatch", f"{role} belongs to partner {PARTNER[role]}")


def check_company_admin_scope(c, role: str, partner: str | None) -> None:
    """A Company Admin may name only its own partner's admin or viewer role (409 other_partner)."""
    if c.is_admin:
        return
    if role not in PARTNER or PARTNER[role] != c.partner or partner != c.partner:
        raise Refused(409, "other_partner", f"a Company Admin manages only {c.partner} users ({c.partner}_admin or {c.partner}_viewer)")


def email_taken(s: Session, email: str, other_than: str | None = None) -> bool:
    q = select(AppUser.id).where(func.lower(AppUser.email) == email.lower())
    if other_than:
        q = q.where(AppUser.id != other_than)
    return s.scalar(q) is not None


def is_last_admin(s: Session, u: AppUser, role_after: str, partner_after: str | None, status_after: str) -> bool:
    """Would this change leave no active tao_admin, or u's partner without an active Company Admin?"""
    if u.status != "active":
        return False
    if u.role == "tao_admin" and not (role_after == "tao_admin" and status_after == "active"):
        others = s.scalar(select(func.count()).select_from(AppUser).where(AppUser.role == "tao_admin", AppUser.status == "active", AppUser.id != u.id))
        return others == 0
    if u.role in COMPANY_ADMINS and not (role_after == u.role and partner_after == u.partner_slug and status_after == "active"):
        others = s.scalar(select(func.count()).select_from(AppUser).where(AppUser.role == u.role, AppUser.partner_slug == u.partner_slug,
                                                                         AppUser.status == "active", AppUser.id != u.id))
        return others == 0
    return False


def check_subscriptions(s: Session, u: AppUser, rows: list) -> list[dict]:
    """The new list, checked: programs and deals exist, a deal is in its program, each (program, deal) once, in_app only
    (email is 422 email_later), and a partner user only on programs shared with their partner (422 not_visible)."""
    out, seen = [], set()
    for r in rows:
        prog = s.get(Program, r.program_slug)
        if prog is None:
            raise Refused(422, "unknown_program", f"no program {r.program_slug}")
        if r.deal_slug is not None:
            d = s.get(Deal, r.deal_slug)
            if d is None:
                raise Refused(422, "unknown_deal", f"no deal {r.deal_slug}")
            if d.program_slug != prog.slug:
                raise Refused(422, "invalid", f"{r.deal_slug} is not in {prog.slug}")
        if "email" in r.channels:
            raise Refused(422, "email_later", "email notifications come later; phase 2 is in-app only")
        if u.partner_slug is not None and u.partner_slug not in views.partner_slugs(s, prog):
            raise Refused(422, "not_visible", f"{prog.name} is not shared with {u.partner_slug}")
        key = (r.program_slug, r.deal_slug)
        if key in seen:
            raise Refused(422, "invalid", f"{r.program_slug} {r.deal_slug or '(all deals)'} appears twice")
        seen.add(key)
        out.append({"program_slug": r.program_slug, "deal_slug": r.deal_slug, "channels": list(dict.fromkeys(r.channels))})
    return out


def replace_subscriptions(s: Session, u: AppUser, rows: list[dict]) -> None:
    for x in subscriptions(s, u.id):
        s.delete(x)
    s.flush()
    for r in rows:
        s.add(Subscription(user_id=u.id, **r))
    s.flush()
