"""Migration runner (phase 2, wave 0). PostgreSQL only: SQLite tests keep Base.metadata.create_all.

At API start-up `run()` applies every db/migrations/NNN_*.sql that is not yet in `schema_migrations`, in file order,
each in its own transaction together with its schema_migrations row. A session advisory lock makes a second API process
wait until the first has finished, then find nothing to do.

Baseline. Before the runner, postgres initdb applied the files on an empty volume and later files were applied by hand,
so an existing database can have the app tables and no schema_migrations. The runner then records as applied each of
001-006 whose change is visible in the catalog (BASELINE below) and runs everything else. 007 is never baselined: it is
idempotent and simply runs again. Every migration from 007 on must be idempotent (IF NOT EXISTS), because the runner
did not exist when 007 was applied by hand, and so a later baseline can never misjudge it.

Files are split into statements here (pg8000 and psycopg both accept one statement per execute): `--` comments are
dropped, and `;` ends a statement outside single-quoted strings. Dollar-quoted bodies are not supported; keep
functions out of migrations or extend the splitter."""
import logging, os, pathlib, re, sys
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

log = logging.getLogger("api.migrate")


def _say(msg: str, *args) -> None:
    """Log, and print to stderr: uvicorn only configures its own loggers, and the operator should see what ran."""
    log.info(msg, *args)
    print("migrate: " + (msg % args), file=sys.stderr, flush=True)
LOCK_KEY = 0x7A0_AD31                     # any constant; the same in every API process
FILE = re.compile(r"^(\d{3})_[\w-]+\.sql$")

# file number -> SQL that returns true when that file's change is already in the database (pre-runner databases only)
BASELINE = {
    "001": "select to_regclass('public.setrep_upload') is not null",
    "002": "select not exists (select 1 from pg_constraint where conname = 'setrep_upload_deal_slug_collection_period_status_key')",
    "003": "select coalesce((select numeric_precision = 20 from information_schema.columns where table_schema = 'public' "
           "and table_name = 'covenant_definition' and column_name = 'threshold'), false)",
    "004": "select to_regclass('public.program_partner') is not null and exists (select 1 from information_schema.columns "
           "where table_schema = 'public' and table_name = 'covenant_definition' and column_name = 'unit')",
    "005": "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finding' "
           "and column_name = 'targets')",
    "006": "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'setrep_upload' "
           "and column_name = 'replaces_upload_id')",
}


def migrations_dir() -> pathlib.Path:
    env = os.environ.get("MIGRATIONS_DIR")
    if env:
        return pathlib.Path(env)
    return pathlib.Path(__file__).resolve().parents[2] / "db" / "migrations"


def files(folder: pathlib.Path | None = None) -> list[tuple[str, pathlib.Path]]:
    folder = folder or migrations_dir()
    out = [(m.group(1), p) for p in sorted(folder.glob("*.sql")) if (m := FILE.match(p.name))]
    nums = [n for n, _ in out]
    if len(nums) != len(set(nums)):
        raise RuntimeError(f"two migration files share a number in {folder}: {nums}")
    return out


def statements(sql: str) -> list[str]:
    out, buf, i, quoted = [], [], 0, False
    while i < len(sql):
        ch = sql[i]
        if quoted:
            buf.append(ch)
            if ch == "'":
                if sql[i + 1:i + 2] == "'":       # '' inside a string
                    buf.append("'"); i += 1
                else:
                    quoted = False
        elif ch == "'":
            quoted = True; buf.append(ch)
        elif sql.startswith("--", i):
            j = sql.find("\n", i)
            i = len(sql) if j < 0 else j
            continue
        elif ch == ";":
            out.append("".join(buf)); buf = []
        else:
            buf.append(ch)
        i += 1
    out.append("".join(buf))
    return [s.strip() for s in out if s.strip()]


def _baseline(conn: Connection, numbers: list[str]) -> list[str]:
    """Pre-runner database (app tables, no schema_migrations): the 001-006 files whose change is already there."""
    if not conn.execute(text(BASELINE["001"])).scalar():
        return []                                  # empty database: nothing to baseline
    done = []
    for n in numbers:
        probe = BASELINE.get(n)
        if probe is not None and conn.execute(text(probe)).scalar():
            done.append(n)
    return done


def run(engine: Engine, folder: pathlib.Path | None = None) -> list[str]:
    """Apply pending migrations; returns the file names applied by this call (empty on a no-op start)."""
    if engine.dialect.name != "postgresql":
        return []
    todo = files(folder)
    applied_now: list[str] = []
    with engine.connect() as conn:
        conn.execute(text("select pg_advisory_lock(:k)"), {"k": LOCK_KEY})
        conn.commit()
        try:
            fresh_table = conn.execute(text("select to_regclass('public.schema_migrations') is null")).scalar()
            if fresh_table:
                baseline = _baseline(conn, [n for n, _ in todo])
                conn.execute(text("create table if not exists schema_migrations (version text primary key, file_name text not null, "
                                  "applied_at timestamptz not null default now(), baseline boolean not null default false)"))
                for n, p in todo:
                    if n in baseline:
                        conn.execute(text("insert into schema_migrations (version, file_name, baseline) values (:v, :f, true)"),
                                     {"v": n, "f": p.name})
                conn.commit()
                if baseline:
                    _say("baselined an existing database: %s recorded as already applied", ", ".join(baseline))
            done = set(conn.execute(text("select version from schema_migrations")).scalars().all())
            for n, p in todo:
                if n in done:
                    continue
                try:
                    for stmt in statements(p.read_text(encoding="utf-8")):
                        conn.exec_driver_sql(stmt)
                    conn.execute(text("insert into schema_migrations (version, file_name) values (:v, :f)"), {"v": n, "f": p.name})
                    conn.commit()
                except Exception:
                    conn.rollback()
                    log.exception("migration %s failed; nothing from it was applied", p.name)
                    raise
                applied_now.append(p.name)
                _say("applied %s", p.name)
        finally:
            conn.rollback()
            conn.execute(text("select pg_advisory_unlock(:k)"), {"k": LOCK_KEY})
            conn.commit()
    if not applied_now:
        _say("schema up to date (%d files)", len(todo))
    return applied_now
