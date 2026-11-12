"""Wave C notifications (contract abdda6d, Notification and Recipients). In-app only; email is reserved.

Who gets what:
- report_published / correction_published: users subscribed to the deal (directly or through its program). Partner users
  only at a partner the program is shared with (the partner_filter rule: program_partner rows) and only while the setting
  partner_notifications_enabled is true. Subscribed TAO users always.
- report_needs_review, report_rejected, covenant_changed, system: subscribed TAO users.
- mention: the mentioned user; reply: the thread's other people (threads.py). user_change: the user changed.
- wave D, made in the sweep: adverse_media (a new open item, to TAO followers of the company; once a TAO Admin marks it
  reviewed, to partner followers), negative_news (a news item screened negative, to followers), report_late (a deal's next
  report late, to TAO users subscribed to the deal, once per deal and period). Partner followers only while both
  partner_notifications_enabled and company_profiles_partner_enabled are true, and only if a program of one of the
  company's deals is shared with their partner. A mention in a company note is kind mention (company_note_mentions).
  Wave E: negative_news and the TAO adverse_media alert (item opened) only for a story the Claude check kept whose publish
  date is confirmed and in the last 7 days (companies.recent_confirmed); the partner adverse_media alert (item reviewed)
  for any kept story. Unchecked, pending and excluded stories, and adverse items with no story, never.
A kind the user switched off is not created (required kinds cannot be switched off). Deactivated users get nothing.

Status changes the worker makes (needs_review, extraction_failed) happen outside the API, so `sweep` notices them when
someone reads their notifications and fans each out once (notification_event holds the keys already sent).
Reads are filtered again in main.py through partner_filter (risk R7)."""
import datetime as dt
from sqlalchemy import select, delete, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from .auth import TAO
from .models import (AppUser, Subscription, Notification, NotificationEvent, SetrepUpload, Deal, Program, Finding, Company, CompanyFollow,
                     CompanyNote, NewsItem, AdverseItem, utcnow)
from . import people, views

KEEP = dt.timedelta(days=365)                      # notifications are kept 12 months (decision C11)
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def month_label(period: str | None) -> str:
    """'2026-08' -> 'August 2026'."""
    try:
        return f"{MONTHS[int(period[5:7]) - 1]} {period[:4]}"
    except (TypeError, ValueError, IndexError):
        return period or ""


def field_label(pointer: str) -> str:
    """'/tranche_balance/interest' -> 'Tranche balance, interest' (the changed field, for correction_published)."""
    toks = [x.replace("~1", "/").replace("~0", "~").replace("_", " ") for x in pointer.split("/")[1:] if not x.isdigit()]
    return ", ".join(toks).capitalize() if toks else pointer


def notification_dict(n: Notification) -> dict:
    return {"id": n.id, "kind": n.kind, "title": n.title, "body": n.body, "link": n.link, "upload_id": n.upload_id, "deal_slug": n.deal_slug,
            "collection_period": n.collection_period, "version": n.version, "thread_id": n.thread_id, "note_from_tao": n.note_from_tao,
            "changes": n.changes, "created_at": views.iso(n.created_at), "read_at": views.iso(n.read_at)}


def create(s: Session, u: AppUser, kind: str, title: str, link: str, **fields) -> Notification | None:
    """One notification for one user, unless they are deactivated or switched the kind off."""
    if u.status != "active" or not people.wants(s, u, kind):
        return None
    n = Notification(user_id=u.id, kind=kind, title=title, link=link, created_at=utcnow(), **fields)
    s.add(n)
    return n


# ---- who is subscribed ----
def channels_for(subs: list[Subscription], deal: Deal) -> list[str] | None:
    """The channels a user's subscriptions give for this deal: a deal entry overrides the program entry; None if neither."""
    deal_row = next((x for x in subs if x.program_slug == deal.program_slug and x.deal_slug == deal.slug), None)
    prog_row = next((x for x in subs if x.program_slug == deal.program_slug and x.deal_slug is None), None)
    row = deal_row or prog_row
    if row is None:
        return None
    return ["in_app"]                                  # email is refused at subscribe time (email_later) in phase 2


def _subs_by_user(s: Session) -> dict[str, list[Subscription]]:
    out: dict[str, list[Subscription]] = {}
    for x in s.scalars(select(Subscription)).all():
        out.setdefault(x.user_id, []).append(x)
    return out


def recipients(s: Session, deal_slug: str, kind: str = "report_published") -> dict:
    """Who a publish of this deal would notify, and who not and why (contract Recipients), over every user.
    can_change (016): anyone notified can be left out of one publish; of the others only a not_subscribed person can be
    added by hand. A person who switched the kind off reads switched_off whether subscribed or not (their own choice
    outranks a missing subscription), so not_subscribed always means the person would receive it if added."""
    deal = s.get(Deal, deal_slug)
    program = s.get(Program, deal.program_slug)
    shared = set(views.partner_slugs(s, program))
    partners_on = people.get_setting(s, "partner_notifications_enabled") is True
    subs = _subs_by_user(s)
    notified, not_notified = [], []
    users = s.scalars(select(AppUser).order_by(AppUser.partner_slug.is_not(None), AppUser.partner_slug, AppUser.name)).all()
    for u in users:
        partner = u.role not in TAO
        channels = channels_for(subs.get(u.id, []), deal)
        reason = None
        if u.status != "active":
            reason = "deactivated"
        elif partner and u.partner_slug not in shared:
            reason = "not_visible"
        elif partner and not partners_on:             # the system switch outranks a missing subscription
            reason = "partner_notifications_off"
        elif not people.wants(s, u, kind):
            reason = "switched_off"
        elif channels is None:
            reason = "not_subscribed"
        if reason:
            not_notified.append({"user_id": u.id, "name": u.name, "partner_slug": u.partner_slug, "reason": reason,
                                 "can_change": reason == "not_subscribed"})
        else:
            notified.append({"user_id": u.id, "name": u.name, "partner_slug": u.partner_slug, "channels": channels, "can_change": True})
    return {"notified": notified, "not_notified": not_notified}


LOCKED = {"deactivated": "their account is deactivated", "not_visible": "they may not see this deal",
          "switched_off": "they switched this notification off in their profile",
          "partner_notifications_off": "partner notifications are switched off in System settings"}


class BadChoice(ValueError):
    """A notify choice that cannot be honoured; str(e) is the plain message for the 422."""


def check_choices(s: Session, deal_slug: str, add: list[str], remove: list[str]) -> tuple[list[dict], list[dict]]:
    """Validate NotifyChoices against the recipients as computed now (approve and Save both call this, before writing):
    every id a known user; add only people in not_notified with can_change; remove only people in notified; nobody in
    both. Returns the (added, removed) Recipients entries, in the order sent."""
    add, remove = [x.lower() for x in add], [x.lower() for x in remove]
    for name, ids in (("add", add), ("remove", remove)):
        if len(set(ids)) != len(ids):
            raise BadChoice(f"notify.{name} names the same person twice")
    if not add and not remove:
        return [], []
    rec = recipients(s, deal_slug)
    yes = {r["user_id"]: r for r in rec["notified"]}
    no = {r["user_id"]: r for r in rec["not_notified"]}
    for name, ids in (("add", add), ("remove", remove)):
        for i in ids:
            if i not in yes and i not in no:
                raise BadChoice(f"notify.{name} names an unknown user: {i}")
    for i in add:
        if i in remove:
            raise BadChoice(f"{(yes.get(i) or no[i])['name']} is in both the add and the remove list")
    for i in add:
        if i in yes:
            raise BadChoice(f"{yes[i]['name']} is already notified; they cannot be added")
        if not no[i]["can_change"]:
            raise BadChoice(f"{no[i]['name']} cannot be added: {LOCKED[no[i]['reason']]}")
    for i in remove:
        if i not in yes:
            raise BadChoice(f"{no[i]['name']} is not on the notified list; they cannot be left out")
    return [no[i] for i in add], [yes[i] for i in remove]


def subscribed_tao(s: Session, deal_slug: str) -> list[AppUser]:
    """Active TAO users subscribed to the deal (directly or through its program)."""
    deal = s.get(Deal, deal_slug)
    if deal is None:
        return []
    subs = _subs_by_user(s)
    users = s.scalars(select(AppUser).where(AppUser.role.in_(sorted(TAO)), AppUser.status == "active").order_by(AppUser.name)).all()
    return [u for u in users if channels_for(subs.get(u.id, []), deal) is not None]


# ---- links ----
def report_link(s: Session, u: AppUser, deal_slug: str, period: str) -> str:
    program = s.get(Deal, deal_slug).program_slug
    base = "/admin" if u.role in TAO else f"/{u.partner_slug}"
    return f"{base}/portfolio/{program}/deals/{deal_slug}?period={period}"


def review_link(upload_id: str, thread_id: str | None = None) -> str:
    return f"/admin/uploads/queue/{upload_id}" + (f"?thread={thread_id}" if thread_id else "")


def account_link(u: AppUser) -> str:
    """user_change and system: User management for a TAO Admin; the recipient's own profile page for a TAO analyst (User
    management is admin-only) and for a partner, under the partner's portal prefix (/investor, /manager) (audit M19)."""
    if u.role == "tao_admin":
        return "/admin/settings/users"
    return "/admin/settings/profile" if u.role in TAO else f"/{u.partner_slug}/settings/profile"


def covenant_link(s: Session, deal_slug: str) -> str:
    """The program record (any partner that has the program; the first one)."""
    program = s.get(Program, s.get(Deal, deal_slug).program_slug)
    return f"/admin/partners/{program.partner_slug}/programs/{program.slug}"


def _deal_name(s: Session, slug: str) -> str:
    d = s.get(Deal, slug)
    return d.name if d else slug


# ---- events ----
def published(s: Session, u_up: SetrepUpload, version: int, by: str, note: str | None, changes: list[dict] | None = None,
              correction: bool = False, add: list[str] | None = None, remove: list[str] | None = None) -> list[str]:
    """report_published (approve) or correction_published: one per notified recipient. Returns the recipient user ids.
    add / remove (016, approve only, already validated by check_choices): this publish goes to (notified - remove) + add;
    an added person gets the same notification; nobody's subscriptions or prefs change."""
    kind = "correction_published" if correction else "report_published"
    rec = recipients(s, u_up.deal_slug, kind)
    name, label = _deal_name(s, u_up.deal_slug), month_label(u_up.collection_period)
    title = f"{'Correction' if correction else 'Report'} published: {name} · {label}"
    body = (f"Version {version} published by {by}." if correction else f"Published by {by}.")
    left_out, extra = set(remove or []), set(add or [])
    to = [r["user_id"] for r in rec["notified"] if r["user_id"] not in left_out]
    to += [r["user_id"] for r in rec["not_notified"] if r["user_id"] in extra and r["can_change"]]
    ids = []
    for uid in to:
        u = s.get(AppUser, uid)
        n = create(s, u, kind, title, report_link(s, u, u_up.deal_slug, u_up.collection_period), body=body, upload_id=u_up.id,
                   deal_slug=u_up.deal_slug, collection_period=u_up.collection_period, version=version, note_from_tao=note,
                   changes=changes if correction else None)
        if n is not None:
            ids.append(u.id)
    return ids


def to_tao(s: Session, u_up: SetrepUpload, kind: str, title: str, body: str | None) -> list[str]:
    """report_needs_review, report_rejected, covenant_changed, system: subscribed TAO users of the upload's deal."""
    ids = []
    link = covenant_link(s, u_up.deal_slug) if kind == "covenant_changed" else review_link(u_up.id)   # system about an upload: its page
    for u in subscribed_tao(s, u_up.deal_slug):
        if create(s, u, kind, title, link, body=body, upload_id=u_up.id, deal_slug=u_up.deal_slug,
                  collection_period=u_up.collection_period) is not None:
            ids.append(u.id)
    return ids


def rejected(s: Session, u_up: SetrepUpload, reason: str, by: str, what: str = "Report") -> None:
    to_tao(s, u_up, "report_rejected", f"{what} rejected: {_deal_name(s, u_up.deal_slug)} · {month_label(u_up.collection_period)}",
           f"Reason: {reason}. By {by}.")


def user_changed(s: Session, u: AppUser, title: str, body: str | None = None) -> None:
    create(s, u, "user_change", title, account_link(u), body=body)


def _once(s: Session, key: str) -> bool:
    """Claim an event key; False if it was already sent (also by a concurrent request)."""
    if s.get(NotificationEvent, key) is not None:
        return False
    try:
        with s.begin_nested():
            s.add(NotificationEvent(key=key))
        return True
    except IntegrityError:
        return False


def needs_review_queued(s: Session, u_up: SetrepUpload, title_prefix: str, key: str, body: str | None) -> None:
    if _once(s, key):
        to_tao(s, u_up, "report_needs_review", f"{title_prefix}: {_deal_name(s, u_up.deal_slug)} · {month_label(u_up.collection_period)}", body)


def _uploader(s: Session, u_up: SetrepUpload) -> str:
    who = s.get(AppUser, u_up.uploaded_by_user_id) if u_up.uploaded_by_user_id else None
    return who.name if who else u_up.uploaded_by


def sweep(s: Session) -> None:
    """Fan out worker events not yet sent: an upload now in needs_review (plus covenant_changed for each R19 note on its
    latest extraction) and an upload that failed extraction. Also drops notifications older than 12 months. Commits."""
    s.execute(delete(Notification).where(Notification.created_at < utcnow() - KEEP))
    ups = s.scalars(select(SetrepUpload).where(SetrepUpload.status.in_(("needs_review", "extraction_failed")))
                    .order_by(SetrepUpload.uploaded_at)).all()
    for up in ups:
        key = f"{up.status}:{up.id}"
        if not _once(s, key):
            continue
        name, label = _deal_name(s, up.deal_slug), month_label(up.collection_period)
        if up.status == "extraction_failed":
            why = views.failure_reason(s, up)
            to_tao(s, up, "system", f"Extraction failed: {name} · {label}", f"{up.file_name}." + (f" {why}." if why else ""))
            continue
        to_tao(s, up, "report_needs_review", f"Report needs review: {name} · {label}",
               f"{up.file_name}. Extraction finished; waiting in the approval queue. Uploaded by {_uploader(s, up)}.")
        ex = views.latest_extraction(s, up.id)
        if ex is None:
            continue
        for f in s.scalars(select(Finding).where(Finding.extraction_id == ex.id, Finding.rule_id == "R19").order_by(Finding.created_at)).all():
            ctx = f.context or {}
            to_tao(s, up, "covenant_changed", f"Covenant changed: {name} · {ctx.get('legal_ref') or 'covenant'}, "
                                              f"{ctx.get('prior_status') or f.our_value} to {ctx.get('status') or f.report_value}",
                   f"{label}: {ctx.get('value')} ({ctx.get('status') or f.report_value}); prior {ctx.get('prior_value')} "
                   f"({ctx.get('prior_status') or f.our_value}).")
    company_sweep(s)
    s.commit()


# ---- wave D: companies ----
def company_link(u: AppUser, slug: str) -> str:
    return f"/admin/companies/{slug}" if u.role in TAO else f"/{u.partner_slug}/companies/{slug}"


def note_link(slug: str, note_id: str) -> str:
    return f"/admin/companies/{slug}?note={note_id}"


def _partners_may(s: Session) -> bool:
    return people.get_setting(s, "partner_notifications_enabled") is True and people.get_setting(s, "company_profiles_partner_enabled") is True


def _partner_deal(s: Session, slug: str, partner: str) -> str | None:
    """The first of the company's deals in a program shared with the partner (None: the partner cannot see the company)."""
    for d in s.scalars(select(Deal).where(Deal.company_slug == slug).order_by(Deal.slug)).all():
        if partner in views.partner_slugs(s, s.get(Program, d.program_slug)):
            return d.slug
    return None


def _followers(s: Session, slug: str) -> list[AppUser]:
    ids = s.scalars(select(CompanyFollow.user_id).where(CompanyFollow.company_slug == slug)).all()
    return [u for u in (s.get(AppUser, i) for i in ids) if u is not None and u.status == "active"]


def to_followers(s: Session, slug: str, kind: str, title: str, body: str | None, tao: bool, partners: bool) -> list[str]:
    """One notification per follower of the company: TAO followers when `tao`; partner followers when `partners` and the
    flags allow, and only those who can see the company. Returns the user ids notified."""
    first = s.scalars(select(Deal.slug).where(Deal.company_slug == slug).order_by(Deal.slug)).first()
    partners = partners and _partners_may(s)
    ids = []
    for u in _followers(s, slug):
        if u.role in TAO:
            if not tao:
                continue
            deal = first
        else:
            deal = _partner_deal(s, slug, u.partner_slug) if partners else None
            if deal is None:
                continue
        if create(s, u, kind, title, company_link(u, slug), body=body, deal_slug=deal) is not None:
            ids.append(u.id)
    return ids


def _sent(s: Session, prefix: str) -> set[str]:
    return set(s.scalars(select(NotificationEvent.key).where(NotificationEvent.key.like(prefix + "%"))).all())


def company_sweep(s: Session) -> None:
    """adverse_media, negative_news and report_late events not yet sent (notification_event keys; each goes out once).
    An adverse item still open when first seen goes to TAO followers (adverse_open:<id>); once reviewed it goes to partner
    followers (adverse_reviewed:<id>). An item dismissed before the sweep saw it goes to nobody."""
    from . import companies
    names = {c.slug: c.name for c in s.scalars(select(Company)).all()}
    # wave E (E3): the TAO alert when an item opens, and negative_news, need a story the Claude check kept with a confirmed
    # publish date in the last 7 days. The partner alert once a TAO Admin marks an item reviewed needs only a kept story (a
    # person has reviewed it: no date rule). Unchecked, pending and excluded stories, and items with no story, never alert;
    # a story that becomes eligible later (re-check) alerts then, once.
    recent = set(s.scalars(select(NewsItem.id).where(companies.recent_confirmed(7))).all())
    kept = set(s.scalars(select(NewsItem.id).where(NewsItem.check_status == "kept")).all())
    sent = _sent(s, "adverse_")
    for a in s.scalars(select(AdverseItem).order_by(AdverseItem.found_at, AdverseItem.id)).all():
        if a.news_item_id not in kept:
            continue
        k_open, k_rev = f"adverse_open:{a.id}", f"adverse_reviewed:{a.id}"
        name = names.get(a.company_slug, a.company_slug)
        if a.news_item_id in recent and k_open not in sent and _once(s, k_open) and a.state == "open":
            to_followers(s, a.company_slug, "adverse_media", f"Adverse media to review: {name} · {a.category.capitalize()}",
                         f"{a.title}" + (f" ({a.publisher})" if a.publisher else ""), tao=True, partners=False)
        if a.state == "reviewed" and k_rev not in sent and _once(s, k_rev):
            to_followers(s, a.company_slug, "adverse_media", f"Adverse media reviewed by TAO: {name} · {a.category.capitalize()}",
                         f"{a.title}." + (f" TAO note: {a.note}" if a.note else ""), tao=False, partners=True)
    sent = _sent(s, "negative_news:")
    for n in s.scalars(select(NewsItem).where(NewsItem.sentiment == "negative", companies.recent_confirmed(7))
                       .order_by(NewsItem.found_at, NewsItem.id)).all():
        key = f"negative_news:{n.id}"
        if key not in sent and _once(s, key):
            to_followers(s, n.company_slug, "negative_news", f"Negative news: {names.get(n.company_slug, n.company_slug)}",
                         f"{n.title}" + (f" ({n.publisher})" if n.publisher else ""), tao=True, partners=True)
    sent = _sent(s, "report_late:")
    for d in s.scalars(select(Deal).order_by(Deal.slug)).all():
        nr = companies.next_report(s, d, companies.latest_pub(s, d.slug))
        if not nr or not nr["late"]:
            continue
        key = f"report_late:{d.slug}:{nr['period']}"
        if key in sent or not _once(s, key):
            continue
        for u in subscribed_tao(s, d.slug):
            link = f"/admin/companies/{d.company_slug}" if d.company_slug else report_link(s, u, d.slug, add_period(nr["period"], -1))
            create(s, u, "report_late", f"Report late: {d.name} · {month_label(nr['period'])}", link,
                   body=f"Expected on {nr['due_on']}; nothing uploaded {nr['business_days_late']} business days later.",
                   deal_slug=d.slug, collection_period=nr["period"])


def add_period(period: str, n: int) -> str:
    y, m = int(period[:4]), int(period[5:7]) + n
    y += (m - 1) // 12; m = (m - 1) % 12 + 1
    return f"{y:04d}-{m:02d}"


def company_note_mentions(s: Session, note: CompanyNote, by: AppUser, new_mentions: list[str]) -> list[str]:
    """kind mention, to each newly mentioned TAO user except the author, linking to the note on the company page."""
    c = s.get(Company, note.company_slug)
    body = note.body if len(note.body) <= 280 else note.body[:277] + "..."
    ids = []
    for uid in new_mentions:
        if uid == by.id:
            continue
        u = s.get(AppUser, uid)
        if u is not None and create(s, u, "mention", f"{by.name} mentioned you: {c.name if c else note.company_slug}, analyst note",
                                    note_link(note.company_slug, note.id), body=body, collection_period=note.collection_period) is not None:
            ids.append(uid)
    return ids


def visible_to_partner(q, partner_programs: list[str]):
    """A partner's notifications: partner kinds only, and only deals of programs they can see now (or no deal)."""
    deals = select(Deal.slug).where(Deal.program_slug.in_(partner_programs))
    return q.where(Notification.kind.in_(people.PARTNER_KINDS), or_(Notification.deal_slug.is_(None), Notification.deal_slug.in_(deals)))
