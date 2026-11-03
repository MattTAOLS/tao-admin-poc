"""Database engine and session. DATABASE_URL is PostgreSQL in compose; tests and local runs may use SQLite.
FILE_STORE is where uploaded PDFs and rendered page images live."""
import os, pathlib
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, Session

REPO = pathlib.Path(__file__).resolve().parents[2]
_engine = None
_Session = None


def database_url() -> str:
    return os.environ.get("DATABASE_URL") or f"sqlite:///{REPO / 'data' / 'tao_admin.sqlite'}"


def file_store() -> pathlib.Path:
    return pathlib.Path(os.environ.get("FILE_STORE") or REPO / "data" / "filestore")


def engine():
    global _engine, _Session
    if _engine is None:
        url = database_url()
        kw = {"future": True}
        if url.startswith("sqlite"):
            if "///" in url and ":memory:" not in url:
                pathlib.Path(url.split("///", 1)[-1]).parent.mkdir(parents=True, exist_ok=True)
            kw["connect_args"] = {"check_same_thread": False}
        _engine = create_engine(url, **kw)
        if url.startswith("sqlite"):
            @event.listens_for(_engine, "connect")
            def _fk_on(dbapi_conn, _):
                dbapi_conn.execute("pragma foreign_keys=on")
        _Session = sessionmaker(bind=_engine, expire_on_commit=False, future=True)
    return _engine


def reset():
    """Drop the cached engine (tests switch DATABASE_URL between sessions)."""
    global _engine, _Session
    if _engine is not None:
        _engine.dispose()
    _engine = _Session = None


def session() -> Session:
    engine()
    return _Session()


def get_db():
    s = session()
    try:
        yield s
    finally:
        s.close()


def create_all():
    """SQLite / tests only. PostgreSQL is built from db/migrations by the postgres container."""
    from .models import Base
    Base.metadata.create_all(engine())
