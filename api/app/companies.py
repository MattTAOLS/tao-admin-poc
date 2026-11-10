"""Wave D companies (contract lead/wave-d): company rows and records, the computed profile sections (insights), next report
due, news and adverse media reads. Every figure is read from each deal's latest publication, the same deal object
/published/* serves; nothing is re-extracted. No routes here, and no partner scoping either: main.py works out which deals
the caller may see (partner_filter, visible_programs) and passes them in.

Months. ratio_history months are 'Jul-26'; everything here speaks 'YYYY-MM'. A publication's ratio month is the last month
of its ratio_history (MOVE Trust: the collection_period; F-PIL 2.0: one month earlier, the reporting period), so a
covenant-history cell for month M is "published" when the deal has a publication whose ratio month is M."""
import calendar, datetime as dt, statistics
from zoneinfo import ZoneInfo
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import Session
from .models import (Company, CompanyContact, CompanyFollow, CompanyNote, Deal, Program, Publication, SetrepUpload, NewsItem, NewsRun,
                     AdverseItem, AppUser, utcnow)
from . import people, views, review

TZ = ZoneInfo("America/Toronto")
WINDOW = 13                                           # months of ratio_history on the profile (decisions D2, D3)
LATE_AFTER = 5                                        # business days after due_on (decision D8)
RANK = {"OK": 1, "WATCH": 2, "BREACH": 3}
METRICS = {  # ratio_history field -> (label, unit, bad direction when no covenant says: up = a ceiling, down = a floor)
    "delinquency_ratio_pct": ("Delinquency ratio", "fraction", "up"),
    "rolling_3month_loss_ratio_pct": ("Rolling 3-month loss ratio", "fraction", "up"),
    "rolling_12month_loss_ratio_pct": ("Rolling 12-month loss ratio", "fraction", "up"),
    "loss_ratio_pct": ("Loss ratio", "fraction", "up"),
    "interest_coverage_ratio": ("Interest coverage ratio", "ratio", "down"),
    "debt_equity_ratio": ("Debt to equity ratio", "ratio", "up"),
    "total_equity": ("Total equity", "currency", "down"),
}
LOSS_FIELDS = ("rolling_3month_loss_ratio_pct", "rolling_12month_loss_ratio_pct")
PEER_RANGE_FACTOR = 10                                # D4: a peer is listed, not drawn, past 10x this deal's range
UTILIZATION_HIGH = 0.85
OBLIGOR_NEAR = 0.9


def chart_anchor(field: str) -> str:
    """The id of the section on the company page that shows `field` (audit L18). The page's section ids: record (with
    "Next report due"), chart-<metric> (performance charts and the featured covenant), loss-ratios (both rolling loss
    ratios share one card, there is no chart-rolling_* id), obligors, pool-balance, covenant-history, restatements, news,
    adverse. Every signal anchor is one of these."""
    return "loss-ratios" if field in LOSS_FIELDS else f"chart-{field}"


def today() -> dt.date:
    """Today in America/Toronto (tests replace this)."""
    return dt.datetime.now(TZ).date()


def _checks():
    review._rules()                                   # puts the repo root on sys.path when run from api/
    from rules import checks
    return checks


def _num(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def month_key(m) -> str | None:
    """'Jul-26' | 'July 2026' | '2026-07' -> '2026-07'."""
    return _checks().period_key(m)


def add_months(key: str, n: int) -> str:
    return _checks().add_months(key, n)


def _months_between(a: str, b: str) -> int:
    """b - a in months."""
    return (int(b[:4]) * 12 + int(b[5:7])) - (int(a[:4]) * 12 + int(a[5:7]))


def _aware(t: dt.datetime | None) -> dt.datetime | None:
    return t.replace(tzinfo=dt.timezone.utc) if t is not None and t.tzinfo is None else t


# ---- publications ----
def latest_pub(s: Session, deal_slug: str) -> Publication | None:
    return s.scalars(select(Publication).where(Publication.deal_slug == deal_slug).order_by(Publication.collection_period.desc())).first()


def ratio_rows(deal: dict) -> dict[str, dict]:
    """ratio_history keyed by 'YYYY-MM' (rows whose month does not parse are skipped), in month order."""
    out = {}
    for r in deal.get("ratio_history") or []:
        k = month_key(r.get("month"))
        if k:
            out[k] = r
    return dict(sorted(out.items()))


def ratio_lag(pub: Publication) -> int:
    """Months between a publication's collection_period and its ratio month (0 MOVE Trust, 1 F-PIL 2.0)."""
    rows = ratio_rows(pub.deal)
    return _months_between(list(rows)[-1], pub.collection_period) if rows else 0


def latest_value(deal: dict, field: str) -> tuple[str | None, float | None, float | None]:
    """(month, value, prior month's value) for the newest ratio_history row that carries `field`."""
    rows = ratio_rows(deal)
    for k in reversed(list(rows)):
        v = rows[k].get(field)
        if _num(v):
            prior = rows.get(add_months(k, -1), {}).get(field)
            return k, v, prior if _num(prior) else None
    return None, None, None


# ---- next report (decision D8) ----
def business_days_after(start: dt.date, end: dt.date) -> int:
    """Mon-Fri days in (start, end]."""
    if end <= start:
        return 0
    n, d = 0, start + dt.timedelta(days=1)
    while d <= end:
        n += d.weekday() < 5
        d += dt.timedelta(days=1)
    return n


def next_report(s: Session, deal: Deal, pub: Publication | None, now: dt.date | None = None) -> dict | None:
    """period = latest_period + 1. due_on = the reporting_calendar day in the month the next settlement falls in, found by the
    latest publication's offset between settlement_date and collection_period, clamped to the month's last day. Late once
    5 business days have passed after due_on with no upload of that period. business_days_late counts the business days
    after due_on while nothing of that period was uploaded (0 before due_on or once an upload exists)."""
    day = (people.get_setting(s, "reporting_calendar") or {}).get(deal.slug)
    if pub is None or not isinstance(day, int):
        return None
    period = add_months(pub.collection_period, 1)
    settled = _checks().parse_date(pub.deal.get("settlement_date"))
    offset = _months_between(pub.collection_period, f"{settled.year:04d}-{settled.month:02d}") if settled else 0
    due_month = add_months(period, offset)
    y, m = int(due_month[:4]), int(due_month[5:7])
    due_on = dt.date(y, m, min(day, calendar.monthrange(y, m)[1]))
    received = s.scalar(select(func.count()).select_from(SetrepUpload).where(SetrepUpload.deal_slug == deal.slug,
                                                                           SetrepUpload.collection_period == period)) > 0
    days = 0 if received else business_days_after(due_on, now or today())
    return {"period": period, "due_on": due_on.isoformat(), "late": days >= LATE_AFTER, "business_days_late": days}


def deal_ref(s: Session, deal: Deal, pub: Publication | None = None, now: dt.date | None = None) -> dict:
    pub = pub if pub is not None else latest_pub(s, deal.slug)
    program = s.get(Program, deal.program_slug)
    worst = (pub.deal.get("worst_status") if pub else None)
    return {"deal_slug": deal.slug, "deal_name": deal.name, "program_slug": deal.program_slug, "program_name": program.name if program else deal.program_slug,
            "latest_period": pub.collection_period if pub else None, "worst_status": worst if worst in RANK else None,
            "next_report": next_report(s, deal, pub, now)}


# ---- screening state ----
def screened(s: Session, company: Company | None) -> bool:
    """True once a news run that covered this company finished (status ok or partial) after the company was created.
    A run for one company (Run now on its profile, news_run.company_slug) covers that company only; a re-check searches
    nothing, so it screens no one."""
    if company is None:
        return False
    return s.scalar(select(func.count()).select_from(NewsRun).where(
        NewsRun.status.in_(("ok", "partial")), NewsRun.finished_at.is_not(None), NewsRun.finished_at >= company.created_at,
        NewsRun.trigger != "recheck", or_(NewsRun.company_slug.is_(None), NewsRun.company_slug == company.slug))) > 0


def _following(s: Session, user_id: str | None, slug: str) -> bool:
    return bool(user_id) and s.get(CompanyFollow, (user_id, slug)) is not None


# ---- rows ----
def row(s: Session, slug: str, name: str, company: Company | None, deals: list[Deal], tao: bool, user_id: str | None,
        now: dt.date | None = None) -> dict:
    """CompanyRow over the deals the caller may see. `company` is None for an unlinked deal shown as its own row."""
    pubs = {d.slug: latest_pub(s, d.slug) for d in deals}
    refs = [deal_ref(s, d, pubs[d.slug], now) for d in deals]
    statuses = [r["worst_status"] for r in refs if r["worst_status"]]
    breach = watch = 0
    balances, delinq = [], []
    for d in deals:
        p = pubs[d.slug]
        if p is None:
            continue
        for c in p.deal.get("covenants") or []:
            breach += c.get("status") == "BREACH"
            watch += c.get("status") == "WATCH"
        bal = (p.deal.get("tranche_balance") or {}).get("closing")
        if _num(bal):
            balances.append(bal)
        _, v, prior = latest_value(p.deal, "delinquency_ratio_pct")
        if v is not None:
            delinq.append((v, prior))
    direction = None
    if delinq:
        v, prior = max(delinq, key=lambda x: x[0])
        if prior is not None:
            direction = "up" if v > prior + 1e-12 else "down" if v < prior - 1e-12 else "flat"
    ok = screened(s, company)
    open_items = s.scalar(select(func.count()).select_from(AdverseItem).where(AdverseItem.company_slug == slug, AdverseItem.state == "open",
                                                                             adverse_visible())) if company else 0
    news = 0
    if company is not None and ok:
        news = s.scalar(select(func.count()).select_from(NewsItem).where(NewsItem.company_slug == slug, recent_confirmed(7)))
    state = "not_screened" if not ok else ("to_review" if tao and open_items else "clear")
    out = {"slug": slug, "name": name, "deals": refs, "industry": company.industry if company else None,
           "status": max(statuses, key=RANK.get) if statuses else None, "breach": breach, "watch": watch,
           "balance": float(sum(balances)) if balances else None,
           "delinquency": {"min": min(v for v, _ in delinq) if delinq else None, "max": max(v for v, _ in delinq) if delinq else None,
                           "direction": direction},
           "news_7d": news, "adverse": {"state": state, "to_review": open_items if tao else 0},
           "following": _following(s, user_id, slug) if company else False}
    if tao:
        out["notes"] = s.scalar(select(func.count()).select_from(CompanyNote).where(CompanyNote.company_slug == slug,
                                                                                     CompanyNote.removed_at.is_(None))) if company else 0
    return out


# ---- the record ----
def author(s: Session, user_id: str | None) -> dict | None:
    if user_id is None:
        return None
    u = s.get(AppUser, user_id)
    return {"id": user_id, "name": u.name if u else user_id}


def contact_dict(c: CompanyContact) -> dict:
    return {"id": c.id, "name": c.name, "role": c.role, "email": c.email, "receives": c.receives}


def contacts(s: Session, slug: str) -> list[CompanyContact]:
    return list(s.scalars(select(CompanyContact).where(CompanyContact.company_slug == slug, CompanyContact.removed_at.is_(None))
                          .order_by(CompanyContact.created_at, CompanyContact.id)).all())


def vintage_start(r: dict) -> str | None:
    """Start month of one cnl_by_period vintage: 'Dec-22 ‒ Nov-23', 'Sep 2018 - Aug 2019', 'Apr 2021 - Mar 2022' (annual_period),
    '2016H1' / '2016H2'. A vintage with no date (Finloc's semi_annual_period 1, 2, ...) gives None."""
    import re
    for label in (r.get("period"), r.get("annual_period")):
        if not isinstance(label, str) or not label.strip():
            continue
        first = re.split(r"\s+[-‒–—]\s+|\s*[‒–—]\s*", label.strip())[0].strip()
        if m := re.fullmatch(r"(\d{4})\s*H([12])", first):
            return f"{m[1]}-{'01' if m[2] == '1' else '07'}"
        k = month_key(first)
        if k:
            return k
    return None


def first_vintage(s: Session, deals: list[Deal]) -> str | None:
    starts = []
    for d in deals:
        p = latest_pub(s, d.slug)
        for r in (p.deal.get("cnl_by_period") or []) if p else []:
            k = vintage_start(r)
            if k:
                starts.append(k)
    return min(starts) if starts else None


def record(c: Company, deal_slugs: list[str] | None = None) -> dict:
    """The record fields a company_change entry records (deal links go in their own `deals` entry)."""
    return {"slug": c.slug, "name": c.name, "aliases": list(c.aliases or []), "industry": c.industry, "naics": c.naics,
            "headquarters": c.headquarters, "website": c.website, "relationship_since": c.relationship_since,
            "owner_user_id": c.owner_user_id}


def company_dict(s: Session, c: Company | None, deals: list[Deal], tao: bool, user_id: str | None, fallback: Deal | None = None,
                 now: dt.date | None = None) -> dict:
    """Company over the visible deals. Partners: owner null. An unlinked deal (c None, fallback the deal) reads as a company
    named after the deal with no record fields."""
    since, source = (c.relationship_since, "record") if c is not None and c.relationship_since else (first_vintage(s, deals), "first_vintage")
    if since is None:
        source = None
    if c is None:
        pub = latest_pub(s, fallback.slug)
        return {"slug": fallback.slug, "name": fallback.name, "aliases": [], "industry": None, "naics": None, "headquarters": None,
                "website": None, "relationship_since": since, "relationship_since_source": source, "owner": None,
                "deals": [deal_ref(s, d, None, now) for d in deals], "contacts": [], "following": False,
                "updated_at": views.iso(pub.published_at if pub else utcnow())}
    out = {"slug": c.slug, "name": c.name, "aliases": list(c.aliases or []), "industry": c.industry, "naics": c.naics,
           "headquarters": c.headquarters, "website": c.website, "relationship_since": since, "relationship_since_source": source,
           "owner": author(s, c.owner_user_id) if tao else None, "deals": [deal_ref(s, d, None, now) for d in deals],
           "contacts": [contact_dict(x) for x in contacts(s, c.slug)], "following": _following(s, user_id, c.slug),
           "updated_at": views.iso(c.updated_at)}
    if tao:
        out["news_search"] = news_search(c)
    return out


# ---- per-company news search settings (wave E, decision E7; TAO only) ----
NEWS_LANGUAGES = ("en", "fr")
MAX_TERMS = 30


def news_search(c: Company) -> dict:
    return {"context_terms": list(c.news_context_terms or []), "exclusions": list(c.news_exclusions or []),
            "languages": list(c.news_languages or NEWS_LANGUAGES)}


def check_news_search(current: dict, value) -> dict:
    """CompanyNewsSearch, checked (people.Refused 422 invalid). Fields left out keep their current value. Terms are trimmed,
    at least 2 characters, deduplicated ignoring case (the first spelling stays), at most 30 per list; languages a non-empty
    subset of en, fr."""
    if not isinstance(value, dict):
        raise people.Refused(422, "invalid", "news_search is {context_terms, exclusions, languages}")
    extra = set(value) - {"context_terms", "exclusions", "languages"}
    if extra:
        raise people.Refused(422, "invalid", f"news_search: unknown field(s) {', '.join(sorted(map(str, extra)))}")
    out = dict(current)
    for k in ("context_terms", "exclusions"):
        if k not in value:
            continue
        xs = value[k]
        if not isinstance(xs, list) or not all(isinstance(x, str) for x in xs):
            raise people.Refused(422, "invalid", f"news_search.{k} is a list of words or phrases")
        seen, terms = set(), []
        for x in (" ".join(x.split()) for x in xs):
            if len(x) < 2:
                raise people.Refused(422, "invalid", f"news_search.{k}: each entry needs at least 2 characters")
            if x.casefold() not in seen:
                seen.add(x.casefold()); terms.append(x)
        if len(terms) > MAX_TERMS:
            raise people.Refused(422, "invalid", f"news_search.{k}: at most {MAX_TERMS} entries")
        out[k] = terms
    if "languages" in value:
        langs = value["languages"]
        if not isinstance(langs, list) or not langs or any(x not in NEWS_LANGUAGES for x in langs):
            raise people.Refused(422, "invalid", "news_search.languages is a non-empty list drawn from en, fr")
        out["languages"] = list(dict.fromkeys(langs))
    return out


# ---- notes, news, adverse ----
def note_dict(s: Session, n: CompanyNote) -> dict:
    return {"id": n.id, "company_slug": n.company_slug, "author": author(s, n.author_id), "body": n.body,
            "mentions": [author(s, m) for m in n.mentions or []], "collection_period": n.collection_period,
            "created_at": views.iso(n.created_at), "edited_at": views.iso(n.edited_at)}


def news_date():
    """When a news item happened, for sorting and the `days` filter: its confirmed published date, else the date the search
    source gave (source_date), else when the worker found it. Counts and alerts do not use this: see recent_confirmed."""
    return func.coalesce(NewsItem.published_at, NewsItem.source_date, NewsItem.found_at)


def recent_confirmed(days: int = 7):
    """Wave E (E3): a story counts as recent (news_7d, negative_news / adverse_media) only when the Claude check kept it and
    its publish date is confirmed and within `days`. Unchecked, pending and excluded stories never count."""
    return and_(NewsItem.check_status == "kept", NewsItem.date_status == "confirmed", NewsItem.published_at.is_not(None),
                NewsItem.published_at >= utcnow() - dt.timedelta(days=days))


HIDDEN_CHECKS = ("excluded", "pending")
NEWS_INCLUDE = {None: (), "excluded": ("excluded",), "pending": ("pending",), "all": HIDDEN_CHECKS}


def news_visible(tao: bool, include: str | None = None):
    """Partners: kept stories only. TAO: kept and unchecked (from before wave E), plus excluded and / or pending on request."""
    if not tao:
        return NewsItem.check_status == "kept"
    return NewsItem.check_status.in_(("kept", "unchecked") + NEWS_INCLUDE[include])


def adverse_visible():
    """Adverse items whose story the check excluded, or has not checked yet (pending), are hidden from every list and count.
    Items with no story, or an unchecked one from before wave E, stay."""
    hidden = select(NewsItem.id).where(NewsItem.check_status.in_(HIDDEN_CHECKS))
    return or_(AdverseItem.news_item_id.is_(None), AdverseItem.news_item_id.not_in(hidden))


def news_dict(n: NewsItem, tao: bool = False) -> dict:
    """NewsItem. url is the publisher URL where the worker resolved one. check: TAO only."""
    out = {"id": n.id, "company_slug": n.company_slug, "title": n.title, "url": n.resolved_url or n.url, "publisher": n.publisher,
           "published_at": views.iso(n.published_at), "source_date": views.iso(n.source_date),
           "date_status": n.date_status or ("confirmed" if n.published_at else "unknown"), "source": n.source,
           "sources": list(n.sources or []) or [n.source], "language": n.language if n.language in ("en", "fr") else None,
           "sentiment": n.sentiment, "found_at": views.iso(n.found_at)}
    if tao:
        out["check"] = {"status": n.check_status or "unchecked",
                        "confidence": float(n.check_confidence) if n.check_confidence is not None else None,
                        "reason": n.check_reason, "model": n.check_model, "checked_at": views.iso(n.checked_at)}
    return out


def adverse_dict(s: Session, a: AdverseItem) -> dict:
    return {"id": a.id, "company_slug": a.company_slug, "news_item_id": a.news_item_id, "category": a.category, "title": a.title,
            "url": a.url, "publisher": a.publisher, "found_at": views.iso(a.found_at), "state": a.state, "note": a.note,
            "state_by": author(s, a.state_by), "state_at": views.iso(a.state_at)}


def run_dict(r: NewsRun) -> dict:
    return {"id": r.id, "trigger": r.trigger, "status": r.status, "queued_at": views.iso(r.queued_at), "started_at": views.iso(r.started_at),
            "finished_at": views.iso(r.finished_at), "companies": r.companies or 0, "items_added": r.items_added or 0,
            "adverse_added": r.adverse_added or 0, "errors": list(r.errors or []), "stats": dict(r.stats or {}),
            "company_slug": r.company_slug}


# ---- insights ----
def _limit(deal: dict, field: str) -> dict | None:
    """The first ceiling / floor covenant whose metric reads this ratio_history field ("(Definitions)" trigger tests excluded:
    they are measured on another basis)."""
    ch = _checks()
    for c in deal.get("covenants") or []:
        if c.get("kind") not in ("ceiling", "floor") or not _num(c.get("threshold")) or "definitions" in (c.get("legal_ref") or "").lower():
            continue
        m = ch.covenant_metric(c)
        if m and m[1] == field:
            return {"legal_ref": c["legal_ref"], "threshold": c["threshold"], "kind": c["kind"]}
    return None


def _per_company(pairs: list[tuple]) -> list[float]:
    """One value per company (decision D3): a company with several deals counts once, at the median of its deals' values."""
    by: dict[str, list[float]] = {}
    for d, v in pairs:
        by.setdefault(d.company_slug or d.slug, []).append(v)
    return [statistics.median(v) for v in by.values()]


def _median(vals):
    return statistics.median(vals) if len(vals) >= 2 else None


def _mean(vals):
    return sum(vals) / len(vals) if len(vals) >= 2 else None


def _series(rows: dict[str, dict], months: list[str], field: str) -> list[dict]:
    return [{"month": m, "value": rows[m][field] if m in rows and _num(rows[m].get(field)) else None} for m in months]


def _rising(points: list[dict], bad: str) -> bool:
    """The last three month-to-month moves all go the bad way (consecutive months with values)."""
    vals = [p["value"] for p in points]
    if len(vals) < 4 or any(v is None for v in vals[-4:]):
        return False
    tail = vals[-4:]
    moves = [b - a for a, b in zip(tail, tail[1:])]
    return all(x > 0 for x in moves) if bad == "up" else all(x < 0 for x in moves)


def _extent(points: list[dict]) -> float | None:
    vals = [abs(p["value"]) for p in points if p["value"] is not None]
    return max(vals) if vals else None


def _restatements(deal: dict) -> list[dict]:
    out = []
    for r in deal.get("restatements") or []:
        rep = [x for x in r.get("as_reported") or [] if isinstance(x, dict)]
        if not rep:
            continue
        changed = rep[0].get("source_period")
        for a, b in zip(rep, rep[1:]):
            if a.get("value") != b.get("value"):
                changed = b.get("source_period")
        out.append({"month": month_key(r.get("month")) or r.get("month"), "field": r.get("field"), "first_reported": rep[0].get("value"),
                    "now": rep[-1].get("value"), "changed_in": changed, "type": "restated_by_company"})
    for k in deal.get("data_corrections") or []:
        if not isinstance(k, dict) or not isinstance(k.get("applied"), str):
            continue
        field = f"{k['record']}.{k['field']}" if k.get("record") and k.get("field") else (k.get("field") or k.get("record"))
        out.append({"month": k.get("period"), "field": field, "first_reported": k.get("old_value") if _num(k.get("old_value")) else None,
                    "now": k.get("new_value") if _num(k.get("new_value")) else None, "changed_in": k["applied"], "type": "tao_correction"})
    return out


def _covenant_history(s: Session, deal_row: Deal, pub: Publication, months: list[str], rows: dict[str, dict]) -> list[dict]:
    ch = _checks()
    deal = pub.deal
    buffer = deal.get("watch_buffer_pct") if _num(deal.get("watch_buffer_pct")) else 0.1
    by_month: dict[str, Publication] = {}                      # ratio month -> the publication that reported it
    for p in s.scalars(select(Publication).where(Publication.deal_slug == deal_row.slug)).all():
        by_month[add_months(p.collection_period, -ratio_lag(p))] = p
    defs_by_month = {m: [views.covenant_dict(x) for x in views.covenants_as_of(s, deal_row.slug, review.period_end(m))] for m in months}
    out = []
    for c in deal.get("covenants") or []:
        metric = ch.covenant_metric(c) if c.get("kind") in ("ceiling", "floor") else None
        field = metric[1] if metric else None
        trigger = "definitions" in (c.get("legal_ref") or "").lower()
        cells = []
        for m in months:
            p = by_month.get(m)
            if p is not None:
                same = [x for x in p.deal.get("covenants") or [] if x.get("legal_ref") == c.get("legal_ref")]
                hit = next((x for x in same if x.get("description") == c.get("description")), same[0] if len(same) == 1 else None)
                st = hit.get("status") if hit else None
                cells.append({"month": m, "status": st if st in ("BREACH", "WATCH", "OK", "AVAILABLE") else None,
                              "source": "published" if hit else None})
                continue
            v = rows.get(m, {}).get(field) if field else None
            if trigger or not _num(v):
                cells.append({"month": m, "status": None, "source": None})
                continue
            cands = [x for x in defs_by_month[m] if ch._ref(x["legal_ref"]) == ch._ref(c.get("legal_ref"))]
            if len(cands) > 1:
                cands = [x for x in cands if (ch.covenant_metric(x) or (None, None))[1] == field] or cands
            th = ch.resolve_threshold(cands[0], deal) if cands else None
            kind = cands[0]["kind"] if cands else None
            st = ch.derive_status(v, th, kind, buffer) if _num(th) and kind in ("ceiling", "floor") else None
            cells.append({"month": m, "status": st, "source": "recomputed" if st else None})
        out.append({"legal_ref": c.get("legal_ref"), "description": c.get("description"), "cells": cells})
    return out


def insights(s: Session, deal_row: Deal, pub: Publication, now: dt.date | None = None) -> dict:
    deal = pub.deal
    rows = ratio_rows(deal)
    months = list(rows)[-WINDOW:]
    if not months:                                             # no ratio history (Meridian): the 13 months to the report
        months = [add_months(pub.collection_period, -i) for i in range(WINDOW - 1, -1, -1)]
    peers = []                   # (deal, latest publication, ratio rows) of the program's deals of OTHER companies
    mine = deal_row.company_slug or deal_row.slug                 # a deal on no company is its own company
    for d in s.scalars(select(Deal).where(Deal.program_slug == deal_row.program_slug, Deal.slug != deal_row.slug).order_by(Deal.slug)).all():
        if (d.company_slug or d.slug) == mine:
            continue
        p = latest_pub(s, d.slug)
        if p is not None:
            peers.append((d, p, ratio_rows(p.deal)))
    series, signals = [], []
    for field, (label, unit, bad) in METRICS.items():
        if not any(_num(rows[m].get(field)) for m in months if m in rows):
            continue
        med, mean, counts = [], [], []
        for m in months:
            vals = _per_company([(d, pr[m][field]) for d, _, pr in peers if m in pr and _num(pr[m].get(field))])
            med.append({"month": m, "value": _median(vals)})
            mean.append({"month": m, "value": _mean(vals)})
            counts.append({"month": m, "count": len(vals)})
        lim = _limit(deal, field)
        points = _series(rows, months, field)
        series.append({"metric": field, "label": label, "unit": unit, "deal": points, "program_median": med, "program_mean": mean,
                       "peers_in_month": counts, "limit": lim})
        way = ("up" if lim["kind"] == "ceiling" else "down") if lim else bad
        if _rising(points, way):
            signals.append({"kind": "rising_3m", "severity": "rising", "title": f"{label} {'rising' if way == 'up' else 'falling'} 3 months running",
                            "detail": f"{label} moved {'up' if way == 'up' else 'down'} in each of the last 3 months, to {_fmt(points[-1]['value'], unit)} in {_month(points[-1]['month'])}.",
                            "anchor": chart_anchor(field)})
    loss_peers = []
    for field in LOSS_FIELDS:
        mine = _series(rows, months, field)
        if all(p["value"] is None for p in mine):
            continue
        ext = _extent(mine) or 0.0
        for d, _, pr in peers:
            ps = _series(pr, months, field)
            if all(p["value"] is None for p in ps):
                continue
            loss_peers.append({"deal_slug": d.slug, "deal_name": d.name, "metric": field, "series": ps,
                               "drawn": not ((_extent(ps) or 0.0) > PEER_RANGE_FACTOR * ext)})
    balance = []
    mine_ph = sorted({p.get("period") for p in deal.get("period_history") or [] if isinstance(p.get("period"), str)})
    for m in mine_ph:
        vals = []
        for d, p, _ in peers:
            r = next((x for x in p.deal.get("period_history") or [] if x.get("period") == m), None)
            if r and _num(r.get("opening_balance")) and _num(r.get("closing_balance")) and r["opening_balance"]:
                vals.append((d, (r["closing_balance"] - r["opening_balance"]) / r["opening_balance"]))
        balance.append({"month": m, "value": _median(_per_company(vals))})
    late = late_signal(next_report(s, deal_row, pub, now))
    signals = _signals(s, deal_row, pub, series) + signals + ([late] if late else [])
    return {"deal_slug": deal_row.slug, "collection_period": pub.collection_period, "signals": signals, "series": series,
            "loss_peers": loss_peers, "balance_median_change": balance,
            "covenant_history": _covenant_history(s, deal_row, pub, months, rows), "restatements": _restatements(deal)}


def _pct(x: float) -> str:
    return f"{x * 100:.2f}%"


def _fmt(x, unit: str | None) -> str:
    """A value as people read it: fraction 0.0131 -> 1.31%, ratio 7.65 -> 7.65x, currency -> $1,606,020."""
    if not _num(x):
        return "n/a"
    if unit == "fraction":
        return _pct(x)
    if unit == "ratio":
        return f"{x:.2f}x"
    if unit == "currency":
        return f"${x:,.0f}"
    return f"{x:,.2f}"


def _month(m: str) -> str:
    """'2026-07' -> 'Jul 2026'."""
    try:
        return dt.date(int(m[:4]), int(m[5:7]), 1).strftime("%b %Y")
    except (TypeError, ValueError):
        return str(m)


def _signals(s: Session, deal_row: Deal, pub: Publication, series: list[dict]) -> list[dict]:
    """covenant_near_limit, obligor_near_limit, losses_high, utilization_high, restated (rising_3m and report_late are added
    by insights)."""
    deal, out = pub.deal, []
    charted = {x["metric"] for x in series}
    ch = _checks()
    for c in deal.get("covenants") or []:
        if c.get("status") != "WATCH":
            continue
        m = ch.covenant_metric(c) if c.get("kind") in ("ceiling", "floor") else None
        anchor = chart_anchor(m[1]) if m and m[1] in charted else "covenant-history"
        label, unit = (METRICS[m[1]][0], METRICS[m[1]][1]) if m and m[1] in METRICS else (c.get("legal_ref"), None)
        out.append({"kind": "covenant_near_limit", "severity": "watch", "title": f"{c.get('legal_ref')} near its limit",
                    "detail": f"{label} {_fmt(c.get('current_value'), unit)} against a {c.get('kind')} of {_fmt(c.get('threshold'), unit)}, "
                              "inside the program watch buffer.",
                    "anchor": anchor})
    obligors = [o for o in deal.get("top10_obligors") or [] if isinstance(o, dict)]
    if obligors:
        top = max(obligors, key=lambda o: o.get("obligor_concentration_pct") or 0)
        pct, lim = top.get("obligor_concentration_pct"), top.get("concentration_limit_pct")
        amt, cap = top.get("aggregate_contract_amount"), top.get("concentration_limit_per_obligor")
        use = None
        if _num(pct) and _num(lim) and lim > 0:
            use, what = pct / lim, f"{_pct(pct)} of the pool against a limit of {_pct(lim)}"
        elif _num(amt) and _num(cap) and cap > 0:
            use, what = amt / cap, f"{_fmt(amt, 'currency')} against a per-obligor limit of {_fmt(cap, 'currency')}"
        if use is not None and use > OBLIGOR_NEAR:
            out.append({"kind": "obligor_near_limit", "severity": "watch", "title": f"{top.get('obligor_name') or 'Largest obligor'} above 90% of its limit",
                        "detail": f"Largest obligor: {what} ({use * 100:.0f}% used).", "anchor": "obligors"})
    ph = sorted((p for p in deal.get("period_history") or [] if isinstance(p.get("period"), str) and _num(p.get("losses"))), key=lambda p: p["period"])
    if len(ph) >= 2 and ph[-1]["losses"] > 0 and all(ph[-1]["losses"] > p["losses"] for p in ph[:-1]):
        out.append({"kind": "losses_high", "severity": "watch", "title": "Highest monthly losses on record",
                    "detail": f"Losses of {_fmt(ph[-1]['losses'], 'currency')} in {_month(ph[-1]['period'])}, the highest of the {len(ph)} months in the report.",
                    "anchor": "loss-ratios"})
    util = (deal.get("program") or {}).get("program_utilization_pct")
    if _num(util) and util > UTILIZATION_HIGH:
        out.append({"kind": "utilization_high", "severity": "info", "title": "Facility utilization above 85%",
                    "detail": f"Program utilization is {_pct(util)} of the facility limit.", "anchor": "pool-balance"})
    rs = _restatements(deal)
    if rs:
        by = sorted({r["type"] for r in rs})
        out.append({"kind": "restated", "severity": "info", "title": "Figures restated or corrected",
                    "detail": f"{len(rs)} figure{'s' if len(rs) != 1 else ''} changed after first being reported "
                              f"({' and '.join({'restated_by_company': 'restated by the company', 'tao_correction': 'corrected by TAO'}.get(x, x) for x in by)}).",
                    "anchor": "restatements"})
    return out


def late_signal(nr: dict | None) -> dict | None:
    if not nr or not nr["late"]:
        return None
    return {"kind": "report_late", "severity": "watch", "title": f"Report for {nr['period']} is late",
            "detail": f"Expected on {nr['due_on']}; nothing uploaded {nr['business_days_late']} business days later.", "anchor": "record"}
