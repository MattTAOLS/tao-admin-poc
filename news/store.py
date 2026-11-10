"""Database access for the news worker. SQLAlchemy Core tables that mirror the columns of db/migrations/001, 010, 012 and
013 this worker reads and writes, so the same code runs against PostgreSQL (compose) and SQLite (tests). The worker never creates
or migrates tables in PostgreSQL; the API applies the migrations at start-up. `create_all` exists for the SQLite tests."""
import datetime as dt
import os
import uuid

from sqlalchemy import (JSON, Boolean, Column, DateTime, Float, Integer, MetaData, String, Table, Text,
                        UniqueConstraint, Uuid, create_engine, select, update)
from sqlalchemy.dialects.postgresql import JSONB

Json = JSON(none_as_null=True).with_variant(JSONB(none_as_null=True), "postgresql")
Id = Uuid(as_uuid=False).with_variant(String(36), "sqlite")

meta = MetaData()

company = Table(
    "company", meta,
    Column("slug", Text, primary_key=True),
    Column("name", Text, nullable=False),
    Column("aliases", Json, nullable=False, default=list),
    Column("industry", Text),
    Column("headquarters", Text),
    Column("news_context_terms", Json, nullable=False, default=list),
    Column("news_exclusions", Json, nullable=False, default=list),
    Column("news_languages", Json, nullable=False, default=lambda: ["en", "fr"]),
)

# Read only: the program names of a company's deals, for the Claude check.
program = Table("program", meta, Column("slug", Text, primary_key=True), Column("name", Text, nullable=False))
deal = Table("deal", meta, Column("slug", Text, primary_key=True), Column("program_slug", Text),
             Column("company_slug", Text))

system_setting = Table(
    "system_setting", meta,
    Column("key", Text, primary_key=True),
    Column("value", Json),
    Column("updated_at", DateTime(timezone=True)),
    Column("updated_by", Text),
)

news_run = Table(
    "news_run", meta,
    Column("id", Id, primary_key=True),
    Column("trigger", Text, nullable=False),
    Column("status", Text, nullable=False, default="queued"),
    Column("queued_at", DateTime(timezone=True), nullable=False),
    Column("started_at", DateTime(timezone=True)),
    Column("finished_at", DateTime(timezone=True)),
    Column("companies", Integer, nullable=False, default=0),
    Column("items_added", Integer, nullable=False, default=0),
    Column("adverse_added", Integer, nullable=False, default=0),
    Column("errors", Json, nullable=False, default=list),
    Column("stats", Json, nullable=False, default=dict),
)

news_item = Table(
    "news_item", meta,
    Column("id", Id, primary_key=True),
    Column("company_slug", Text, nullable=False),
    Column("run_id", Id),
    Column("source", Text, nullable=False),
    Column("title", Text, nullable=False),
    Column("url", Text, nullable=False),
    Column("publisher", Text),
    Column("published_at", DateTime(timezone=True)),
    Column("sentiment", Text, nullable=False),
    Column("found_at", DateTime(timezone=True), nullable=False),
    Column("source_date", DateTime(timezone=True)),
    Column("date_status", Text, nullable=False, default="source_only"),
    Column("resolved_url", Text),
    Column("sources", Json, nullable=False, default=list),
    Column("language", Text),
    Column("check_status", Text, nullable=False, default="unchecked"),
    Column("check_confidence", Float),
    Column("check_reason", Text),
    Column("check_model", Text),
    Column("checked_at", DateTime(timezone=True)),
    Column("description", Text),
    UniqueConstraint("company_slug", "url"),
)

adverse_item = Table(
    "adverse_item", meta,
    Column("id", Id, primary_key=True),
    Column("company_slug", Text, nullable=False),
    Column("news_item_id", Id),
    Column("category", Text, nullable=False),
    Column("title", Text, nullable=False),
    Column("url", Text, nullable=False),
    Column("publisher", Text),
    Column("found_at", DateTime(timezone=True), nullable=False),
    Column("state", Text, nullable=False, default="open"),
    Column("note", Text),
    Column("state_by", Id),
    Column("state_at", DateTime(timezone=True)),
    UniqueConstraint("company_slug", "url", "category"),
)

news_source = Table(
    "news_source", meta,
    Column("provider", Text, primary_key=True),
    Column("enabled", Boolean, nullable=False, default=False),
    Column("secrets_enc", Text),
    Column("secrets_last4", Json, nullable=False, default=dict),
    Column("config", Json, nullable=False, default=dict),
    Column("last_test_at", DateTime(timezone=True)),
    Column("last_test_ok", Boolean),
    Column("last_test_message", Text),
    Column("updated_at", DateTime(timezone=True)),
    Column("updated_by", Id),
)


def utcnow():
    return dt.datetime.now(dt.timezone.utc)


def new_id():
    return str(uuid.uuid4())


def as_utc(value):
    """SQLite hands back naive datetimes; they were written as UTC."""
    if value is None:
        return None
    return value.replace(tzinfo=dt.timezone.utc) if value.tzinfo is None else value


def engine(url=None):
    url = url or os.environ.get("DATABASE_URL", "postgresql+psycopg://tao:tao@localhost:5432/tao_admin")
    return create_engine(url, pool_pre_ping=True, future=True)


def create_all(eng):
    """SQLite tests only."""
    meta.create_all(eng)


# --- reads -------------------------------------------------------------------------------------------------------

def read_setting(conn, key):
    row = conn.execute(select(system_setting.c.value).where(system_setting.c.key == key)).first()
    return None if row is None else row[0]


def companies(conn):
    rows = conn.execute(select(company).order_by(company.c.slug)).mappings().all()
    progs = {}
    for r in conn.execute(select(deal.c.company_slug, program.c.name).select_from(
            deal.join(program, deal.c.program_slug == program.c.slug)).where(deal.c.company_slug.is_not(None))):
        progs.setdefault(r[0], [])
        if r[1] not in progs[r[0]]:
            progs[r[0]].append(r[1])
    return [{"slug": r["slug"], "name": r["name"], "aliases": list(r["aliases"] or []), "industry": r["industry"],
             "headquarters": r["headquarters"], "news_context_terms": list(r["news_context_terms"] or []),
             "news_exclusions": list(r["news_exclusions"] or []),
             "news_languages": list(r["news_languages"] or ["en", "fr"]), "programs": sorted(progs.get(r["slug"], []))}
            for r in rows]


def schedule_run_times(conn, since):
    """queued_at of every scheduled run since `since` (UTC)."""
    rows = conn.execute(select(news_run.c.queued_at)
                        .where(news_run.c.trigger == "schedule", news_run.c.queued_at >= since)).all()
    return [as_utc(r[0]) for r in rows]


def queued_runs(conn):
    rows = conn.execute(select(news_run.c.id).where(news_run.c.status == "queued")
                        .order_by(news_run.c.queued_at)).all()
    return [str(r[0]) for r in rows]


def get_run(conn, run_id):
    row = conn.execute(select(news_run).where(news_run.c.id == run_id)).mappings().first()
    return dict(row) if row else None


def companies_with_items(conn):
    """Slugs that already have news_item rows; the others get the first-search window."""
    return {r[0] for r in conn.execute(select(news_item.c.company_slug).distinct())}


def existing_urls(conn, slug):
    """Canonical forms of every link and publisher URL on file for the company (any check status)."""
    from urls import canonical
    out = set()
    for u, ru in conn.execute(select(news_item.c.url, news_item.c.resolved_url).where(news_item.c.company_slug == slug)):
        out.add(canonical(u))
        if ru:
            out.add(canonical(ru))
    return out


def items_to_check(conn, statuses):
    rows = conn.execute(select(news_item).where(news_item.c.check_status.in_(list(statuses)))
                        .order_by(news_item.c.company_slug, news_item.c.found_at)).mappings().all()
    return [dict(r) for r in rows]


def adverse_categories(conn, slug, url):
    return {r[0] for r in conn.execute(select(adverse_item.c.category).where(
        adverse_item.c.company_slug == slug, adverse_item.c.url == url))}


def news_sources(conn):
    return [dict(r) for r in conn.execute(select(news_source).order_by(news_source.c.provider)).mappings()]


def news_source_row(conn, provider):
    row = conn.execute(select(news_source).where(news_source.c.provider == provider)).mappings().first()
    return dict(row) if row else None


def calls_since(conn, since, exclude_run=None):
    """Requests per source in runs started since `since` (UTC), from news_run.stats.calls."""
    q = select(news_run.c.id, news_run.c.stats).where(news_run.c.started_at >= since)
    total = {}
    for rid, stats in conn.execute(q):
        if exclude_run is not None and str(rid) == str(exclude_run):
            continue
        for k, v in ((stats or {}).get("calls") or {}).items():
            try:
                total[k] = total.get(k, 0) + int(v)
            except (TypeError, ValueError):
                pass
    return total


# --- writes ------------------------------------------------------------------------------------------------------

def insert_run(conn, trigger, now, status="queued"):
    rid = new_id()
    conn.execute(news_run.insert().values(id=rid, trigger=trigger, status=status, queued_at=now, companies=0,
                                          items_added=0, adverse_added=0, errors=[]))
    return rid


def claim_run(conn, run_id, now):
    """queued -> running. False when someone else already moved it."""
    res = conn.execute(update(news_run).where(news_run.c.id == run_id, news_run.c.status == "queued")
                       .values(status="running", started_at=now))
    return res.rowcount == 1


def finish_run(conn, run_id, status, now, companies_n, items, adverse, errors, stats=None):
    values = dict(status=status, finished_at=now, companies=companies_n, items_added=items, adverse_added=adverse,
                  errors=errors)
    if stats is not None:
        values["stats"] = stats
    conn.execute(update(news_run).where(news_run.c.id == run_id).values(**values))


def save_progress(conn, run_id, companies_n, items, adverse, errors, stats):
    """Counts and stats as the run goes, so the screen (and the daily cap) see them before it ends."""
    conn.execute(update(news_run).where(news_run.c.id == run_id).values(
        companies=companies_n, items_added=items, adverse_added=adverse, errors=errors, stats=stats))


def fail_stale_running(conn, now):
    """A run left `running` by a stopped worker would block Run now (409 run_active) for ever."""
    ids = [str(r[0]) for r in conn.execute(select(news_run.c.id).where(news_run.c.status == "running"))]
    for rid in ids:
        conn.execute(update(news_run).where(news_run.c.id == rid).values(
            status="failed", finished_at=now,
            errors=[{"company_slug": None, "source": "worker", "message": "worker restarted during the run"}]))
    return ids


def insert_item(conn, row):
    conn.execute(news_item.insert().values(**row))


def update_item(conn, item_id, values):
    conn.execute(update(news_item).where(news_item.c.id == item_id).values(**values))


def insert_adverse(conn, row):
    conn.execute(adverse_item.insert().values(**row))


def dismiss_open_adverse(conn, news_item_id, note, now):
    """Open adverse items of an excluded story become dismissed (by the check: state_by null). Reviewed and dismissed
    ones are left as they are. Returns how many changed."""
    res = conn.execute(update(adverse_item).where(adverse_item.c.news_item_id == news_item_id,
                                                  adverse_item.c.state == "open")
                       .values(state="dismissed", note=note, state_by=None, state_at=now))
    return res.rowcount


def set_test_result(conn, provider, at, ok, message):
    conn.execute(update(news_source).where(news_source.c.provider == provider).values(
        last_test_at=at, last_test_ok=ok, last_test_message=message))
