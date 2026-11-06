"""Database access for the news worker. SQLAlchemy Core tables that mirror the columns of db/migrations/010 and 012 this
worker reads and writes, so the same code runs against PostgreSQL (compose) and SQLite (tests). The worker never creates
or migrates tables in PostgreSQL; the API applies the migrations at start-up. `create_all` exists for the SQLite tests."""
import datetime as dt
import os
import uuid

from sqlalchemy import (JSON, Column, DateTime, Integer, MetaData, String, Table, Text, UniqueConstraint, Uuid,
                        create_engine, select, update)
from sqlalchemy.dialects.postgresql import JSONB

Json = JSON(none_as_null=True).with_variant(JSONB(none_as_null=True), "postgresql")
Id = Uuid(as_uuid=False).with_variant(String(36), "sqlite")

meta = MetaData()

company = Table(
    "company", meta,
    Column("slug", Text, primary_key=True),
    Column("name", Text, nullable=False),
    Column("aliases", Json, nullable=False, default=list),
)

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
    UniqueConstraint("company_slug", "url", "category"),
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
    rows = conn.execute(select(company.c.slug, company.c.name, company.c.aliases).order_by(company.c.slug)).all()
    return [{"slug": r.slug, "name": r.name, "aliases": list(r.aliases or [])} for r in rows]


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


def existing_urls(conn, slug):
    return {r[0] for r in conn.execute(select(news_item.c.url).where(news_item.c.company_slug == slug))}


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


def finish_run(conn, run_id, status, now, companies_n, items, adverse, errors):
    conn.execute(update(news_run).where(news_run.c.id == run_id)
                 .values(status=status, finished_at=now, companies=companies_n, items_added=items,
                         adverse_added=adverse, errors=errors))


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


def insert_adverse(conn, row):
    conn.execute(adverse_item.insert().values(**row))
