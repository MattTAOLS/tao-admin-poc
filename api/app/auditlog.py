"""Audit log reads for GET /audit, /audit/months and /audit/export.csv (phase 2 wave A, contract 9764f69).

Scope is derived from the action, never stored, so no row moves: reports = entries with an upload_id, plus publish and
regenerate (a manual regenerate has no upload) and company notes; platform = everything else (master_change, export, later user and settings
changes). Months are calendar months in America/Toronto. The `extract` rows that views.failure_reason reads stay as they are."""
import csv, datetime as dt, io, json
from zoneinfo import ZoneInfo
from sqlalchemy import Select, Text, and_, cast, func, not_, or_, select, text
from sqlalchemy.orm import Session
from .models import Deal, ReviewAction, SetrepUpload

TZ = ZoneInfo("America/Toronto")
SCOPES = ("reports", "platform")
# company notes (wave D) go where comments go: the reports log, which both TAO roles read. company_change, adverse_change
# and news_run are platform entries like master_change.
REPORT_ACTIONS_WITHOUT_UPLOAD = ("publish", "regenerate", "company_note", "company_note_edit")


def is_reports():
    return or_(ReviewAction.upload_id.is_not(None), ReviewAction.action.in_(REPORT_ACTIONS_WITHOUT_UPLOAD))


def scope_of(a: ReviewAction) -> str:
    return "reports" if a.upload_id is not None or a.action in REPORT_ACTIONS_WITHOUT_UPLOAD else "platform"


def month_bounds(month: str) -> tuple[dt.datetime, dt.datetime]:
    """[start, end) of a Toronto calendar month, in UTC."""
    y, m = int(month[:4]), int(month[5:7])
    start = dt.datetime(y, m, 1, tzinfo=TZ)
    end = dt.datetime(y + (m == 12), m % 12 + 1, 1, tzinfo=TZ)
    return start.astimezone(dt.timezone.utc), end.astimezone(dt.timezone.utc)


def month_of(t: dt.datetime) -> str:
    if t.tzinfo is None:                       # SQLite drops the zone; everything is stored in UTC
        t = t.replace(tzinfo=dt.timezone.utc)
    return t.astimezone(TZ).strftime("%Y-%m")


def _like(q: str) -> str:
    return "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def query(s: Session, *, scope: str | None = None, month: str | None = None, q: str | None = None, actor_role: str | None = None,
          deal_slug: str | None = None, upload_id: str | None = None, action: str | None = None, actor_user_id: str | None = None,
          columns=None) -> Select:
    """Entries matching every filter given; joined to the upload and its deal so search and deal_slug see them."""
    stmt = (select(*(columns or [ReviewAction]))
            .outerjoin(SetrepUpload, SetrepUpload.id == ReviewAction.upload_id)
            .outerjoin(Deal, Deal.slug == SetrepUpload.deal_slug))
    if scope == "reports":
        stmt = stmt.where(is_reports())
    elif scope == "platform":
        stmt = stmt.where(and_(ReviewAction.upload_id.is_(None), not_(ReviewAction.action.in_(REPORT_ACTIONS_WITHOUT_UPLOAD))))
    if month:
        start, end = month_bounds(month)
        stmt = stmt.where(ReviewAction.at >= start, ReviewAction.at < end)
    if upload_id:
        stmt = stmt.where(ReviewAction.upload_id == upload_id)
    if action:
        stmt = stmt.where(ReviewAction.action == action)
    if actor_role:
        stmt = stmt.where(ReviewAction.actor_role == actor_role)
    if actor_user_id:
        stmt = stmt.where(ReviewAction.actor_user_id == actor_user_id)
    if deal_slug:
        stmt = stmt.where(or_(SetrepUpload.deal_slug == deal_slug, ReviewAction.detail["deal_slug"].as_string() == deal_slug))
    if q:
        pat = _like(q)
        fields = [ReviewAction.action, ReviewAction.actor_role, ReviewAction.actor_label, ReviewAction.reason,
                  Deal.name, SetrepUpload.deal_slug, SetrepUpload.file_name, cast(ReviewAction.upload_id, Text), cast(ReviewAction.detail, Text)]
        stmt = stmt.where(or_(*(f.ilike(pat, escape="\\") for f in fields)))
    return stmt


JOINED = [ReviewAction, SetrepUpload.deal_slug, SetrepUpload.collection_period, Deal.name]


def _with_deal(s: Session, rows) -> list[tuple[ReviewAction, str | None, str | None, str | None]]:
    """(entry, deal_slug, deal_name, collection_period): the upload's deal and period, else detail.deal_slug /
    detail.collection_period (deal name looked up); all None for a platform entry that names no deal."""
    out, names = [], {}
    for a, slug, period, name in rows:
        d = a.detail or {}
        if slug is None and isinstance(d.get("deal_slug"), str):
            slug = d["deal_slug"]
            if slug not in names:
                deal = s.get(Deal, slug)
                names[slug] = deal.name if deal else None
            name = names[slug]
        if period is None and isinstance(d.get("collection_period"), str):
            period = d["collection_period"]
        out.append((a, slug, name, period))
    return out


def entries(s: Session, limit: int, offset: int, **filters) -> list[dict]:
    """AuditEntry dicts, newest first, with deal_slug, deal_name and collection_period."""
    from .views import audit_dict
    stmt = query(s, columns=JOINED, **filters).order_by(ReviewAction.at.desc(), ReviewAction.id.desc()).limit(limit).offset(offset)
    return [{**audit_dict(a), "deal_slug": slug, "deal_name": name, "collection_period": period}
            for a, slug, name, period in _with_deal(s, s.execute(stmt).all())]


def months(s: Session, scope: str, q: str | None = None) -> list[dict]:
    """[{month, count}] newest first. PostgreSQL groups in SQL; SQLite buckets in Python (it has no time zones)."""
    if s.get_bind().dialect.name == "postgresql":
        m = func.to_char(func.timezone("America/Toronto", ReviewAction.at), "YYYY-MM").label("month")
        rows = s.execute(query(s, scope=scope, q=q, columns=[m, func.count().label("n")]).group_by(text("1")).order_by(text("1 desc"))).all()   # by position: bound params differ per clause on pg8000
        return [{"month": r.month, "count": r.n} for r in rows]
    counts: dict[str, int] = {}
    for t in s.scalars(query(s, scope=scope, q=q, columns=[ReviewAction.at])).all():
        k = month_of(t)
        counts[k] = counts.get(k, 0) + 1
    return [{"month": k, "count": counts[k]} for k in sorted(counts, reverse=True)]


CSV_COLUMNS = ["at", "at_toronto", "scope", "action", "actor", "deal", "period", "upload_id", "finding_id", "reason", "detail", "id"]


def _actor(a: ReviewAction) -> str:
    return a.actor_role if not a.actor_label or a.actor_label == a.actor_role else f"{a.actor_label} ({a.actor_role})"


def export_csv(s: Session, scope: str, month: str) -> tuple[str, int]:
    """One month of one scope, newest first, one row per entry (contract column list); deal = name, else slug; detail as
    compact JSON. Rows are read before the caller writes its export entry, so an export never lists itself."""
    stmt = query(s, scope=scope, month=month, columns=JOINED).order_by(ReviewAction.at.desc(), ReviewAction.id.desc())
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(CSV_COLUMNS)
    n = 0
    for a, slug, name, period in _with_deal(s, s.execute(stmt).all()):
        at = a.at if a.at.tzinfo else a.at.replace(tzinfo=dt.timezone.utc)
        w.writerow([at.isoformat(), at.astimezone(TZ).isoformat(), scope_of(a), a.action, _actor(a), name or slug or "", period or "",
                    a.upload_id or "", a.finding_id or "", a.reason or "", json.dumps(a.detail or {}, sort_keys=True, default=str), a.id])
        n += 1
    return buf.getvalue(), n
