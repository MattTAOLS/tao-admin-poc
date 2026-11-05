"""Migration runner (app/migrate.py). The splitter and the SQLite no-op always run. The PostgreSQL scenarios need a
throwaway server: TEST_MIGRATE_URL=postgresql+pg8000://postgres:pw@127.0.0.1:15433/postgres. Each scenario creates and
drops its own database there."""
import os, threading, uuid
import pytest
from sqlalchemy import create_engine, text
from app import migrate

ADMIN_URL = os.environ.get("TEST_MIGRATE_URL")
ALL = [p.name for _, p in migrate.files()]
needs_pg = pytest.mark.skipif(not ADMIN_URL, reason="set TEST_MIGRATE_URL to a throwaway PostgreSQL to run the runner scenarios")


def test_statements_split_on_semicolons_outside_comments_and_strings():
    sql = ("-- a comment; with a semicolon\ncreate table t (a text default 'x;y', b text default 'it''s');\n"
           "alter table t add column c int; -- trailing; comment\n\n;\ninsert into t (a) values ('--not a comment')")
    assert migrate.statements(sql) == ["create table t (a text default 'x;y', b text default 'it''s')", "alter table t add column c int",
                                       "insert into t (a) values ('--not a comment')"]


def test_every_migration_file_splits_and_numbers_are_unique():
    nums = [n for n, _ in migrate.files()]
    assert nums == sorted(nums) and len(nums) == len(set(nums)) and nums[:8] == [f"{i:03d}" for i in range(1, 9)]
    for _, p in migrate.files():
        assert migrate.statements(p.read_text(encoding="utf-8")), p.name


def test_sqlite_is_left_to_create_all():
    assert migrate.run(create_engine("sqlite://")) == []


@pytest.fixture
def pg():
    """A fresh empty database on the throwaway server; yields its engine."""
    admin = create_engine(ADMIN_URL, isolation_level="AUTOCOMMIT")
    name = "mig_" + uuid.uuid4().hex[:10]
    with admin.connect() as c:
        c.execute(text(f"create database {name}"))
    eng = create_engine(ADMIN_URL.rsplit("/", 1)[0] + "/" + name)
    yield eng
    eng.dispose()
    with admin.connect() as c:
        c.execute(text(f"drop database {name} with (force)"))
    admin.dispose()


def by_hand(eng, upto: str):
    """What initdb plus hand-applied files left behind: files 001..upto, no schema_migrations."""
    with eng.begin() as c:
        for n, p in migrate.files():
            if n <= upto:
                for stmt in migrate.statements(p.read_text(encoding="utf-8")):
                    c.exec_driver_sql(stmt)


def recorded(eng) -> dict[str, bool]:
    with eng.connect() as c:
        return {v: b for v, b in c.execute(text("select version, baseline from schema_migrations order by version")).all()}


def has_column(eng, table, column) -> bool:
    with eng.connect() as c:
        return bool(c.execute(text("select count(*) from information_schema.columns where table_name = :t and column_name = :c"),
                              {"t": table, "c": column}).scalar())


def has_index(eng, name) -> bool:
    with eng.connect() as c:
        return c.execute(text("select to_regclass(:n) is not null"), {"n": "public." + name}).scalar()


@needs_pg
def test_fresh_database_is_built_by_the_runner_alone(pg):
    assert migrate.run(pg) == ALL
    assert recorded(pg) == {f"{i:03d}": False for i in range(1, len(ALL) + 1)}
    assert has_column(pg, "covenant_definition", "superseded_at") and has_index(pg, "review_action_at")
    assert has_column(pg, "setrep_upload", "replaces_upload_id") and has_index(pg, "setrep_upload_active_period")
    assert migrate.run(pg) == []                                          # second start: no-op


@needs_pg
def test_existing_database_at_006_baselines_and_runs_007_on(pg):
    by_hand(pg, "006")
    with pg.begin() as c:                                                 # data that must survive
        c.execute(text("insert into partner (slug, name, kind) values ('investor', 'Investor', 'investor')"))
    assert migrate.run(pg) == ALL[6:]
    rec = recorded(pg)
    assert [v for v, b in rec.items() if b] == ["001", "002", "003", "004", "005", "006"]
    assert [v for v, b in rec.items() if not b] == [f"{i:03d}" for i in range(7, len(ALL) + 1)]
    assert has_column(pg, "covenant_definition", "superseded_at") and has_index(pg, "review_action_at")
    with pg.connect() as c:
        assert c.execute(text("select count(*) from partner")).scalar() == 1
    assert migrate.run(pg) == []


@needs_pg
def test_existing_database_with_007_applied_by_hand(pg):
    by_hand(pg, "007")
    assert migrate.run(pg) == ALL[6:]                                     # 007 again, harmlessly (idempotent)
    assert [v for v, b in recorded(pg).items() if b] == ["001", "002", "003", "004", "005", "006"]
    assert has_index(pg, "covenant_definition_current") and has_index(pg, "review_action_at")
    assert migrate.run(pg) == []


@needs_pg
def test_older_database_at_004_gets_005_and_006_too(pg):
    by_hand(pg, "004")
    assert migrate.run(pg) == ALL[4:]
    assert [v for v, b in recorded(pg).items() if b] == ["001", "002", "003", "004"]
    assert has_column(pg, "finding", "targets") and has_column(pg, "setrep_upload", "replaces_upload_id")


@needs_pg
def test_two_processes_starting_together_migrate_once(pg):
    other = create_engine(pg.url)
    out, errors = {}, []
    barrier = threading.Barrier(2)

    def start(name, eng):
        barrier.wait()
        try:
            out[name] = migrate.run(eng)
        except Exception as e:                                           # pragma: no cover - the failure we guard against
            errors.append(e)

    threads = [threading.Thread(target=start, args=("a", pg)), threading.Thread(target=start, args=("b", other))]
    [t.start() for t in threads]; [t.join() for t in threads]
    other.dispose()
    assert errors == []
    assert sorted([out["a"], out["b"]], key=len) == [[], ALL]
    assert len(recorded(pg)) == len(ALL)


@needs_pg
def test_a_failing_migration_leaves_nothing_behind(pg, tmp_path):
    for _, p in migrate.files():
        (tmp_path / p.name).write_text(p.read_text(encoding="utf-8"), encoding="utf-8")
    (tmp_path / "999_broken.sql").write_text("create table half_done (a int);\nselect * from no_such_table;\n", encoding="utf-8")
    with pytest.raises(Exception):
        migrate.run(pg, tmp_path)
    assert "999" not in recorded(pg) and not has_index(pg, "half_done")
    assert len(recorded(pg)) == len(ALL)                                  # the good files before it are kept
    (tmp_path / "999_broken.sql").write_text("create table if not exists half_done (a int);\n", encoding="utf-8")
    assert migrate.run(pg, tmp_path) == ["999_broken.sql"]


@needs_pg
def test_009_wave_b_is_idempotent_and_marks_ui_covenants(pg):
    """009 on a database that has a covenant created through the old PUT (a master_change entry keyed by its id): that row
    becomes origin=ui, seed rows stay seed, and running the file again changes nothing."""
    by_hand(pg, "008")
    with pg.begin() as c:
        c.execute(text("insert into partner (slug, name, kind) values ('investor', 'Investor', 'investor')"))
        c.execute(text("insert into program (slug, name, partner_slug, \"limit\") values ('p', 'P', 'investor', 1)"))
        c.execute(text("insert into deal (slug, name, program_slug, servicer, template_id) values ('d', 'D', 'p', 's', 't')"))
        for cid in ("00000000-0000-4000-8000-0000000000a1", "00000000-0000-4000-8000-0000000000a2"):
            c.execute(text("insert into covenant_definition (id, deal_slug, legal_ref, description, kind, effective_from) "
                           "values (:i, 'd', :r, 'x', 'ceiling', '2022-12-09')"), {"i": cid, "r": cid[-2:]})
        c.execute(text("insert into review_action (actor_role, action, detail) values ('tao_admin', 'master_change', "
                       "cast(:d as jsonb))"), {"d": '{"entity": "covenant_definition", "key": "00000000-0000-4000-8000-0000000000a2"}'})
    assert migrate.run(pg) == ALL[6:]                                     # 007, 008 again (idempotent), then 009
    sql = next(p for n, p in migrate.files() if n == "009").read_text(encoding="utf-8")
    with pg.begin() as c:                                                   # idempotent: the whole file again
        for stmt in migrate.statements(sql):
            c.exec_driver_sql(stmt)
    with pg.connect() as c:
        origins = dict(c.execute(text("select id::text, origin from covenant_definition order by id")).all())
    assert origins == {"00000000-0000-4000-8000-0000000000a1": "seed", "00000000-0000-4000-8000-0000000000a2": "ui"}
    for table, col in [("covenant_definition", "supersedes_id"), ("covenant_definition", "change_reason"), ("publication", "version"),
                       ("publication_version", "deal"), ("correction", "note_to_partners"), ("value_edit", "reverted_at")]:
        assert has_column(pg, table, col), (table, col)
    assert has_index(pg, "correction_one_pending") and has_index(pg, "value_edit_upload")
