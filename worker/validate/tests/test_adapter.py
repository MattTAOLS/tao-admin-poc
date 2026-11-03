"""Adapter tests against SQLite with the columns of db/migrations/001_init.sql (types simplified: jsonb -> text,
uuid -> text). The SQL in adapter.py is portable, so the same queries run here and on Postgres."""
import json, pathlib, uuid
import pytest
from sqlalchemy import create_engine, text
from worker.validate import adapter
from rules.tests.fixtures import make_fixtures as mf

DDL = """
create table partner (slug text primary key, name text, kind text, status text);
create table program (slug text primary key, name text, partner_slug text, currency text, "limit" numeric, warehouse_limit numeric);
create table deal (slug text primary key, name text, program_slug text, servicer text, template_id text);
create table covenant_definition (id text primary key, deal_slug text, legal_ref text, description text, kind text, threshold numeric, threshold_rule text,
  watch_buffer_pct numeric, effective_from date, source text);
create table setrep_upload (id text primary key, deal_slug text, collection_period text, reporting_period text, file_name text, file_path text, page_count int,
  uploaded_by text, uploaded_at text, status text, reject_reason text);
create table extraction (id text primary key, upload_id text, pass int, meta text, deal text, sources text, confidence numeric, created_at text);
create table finding (id text primary key, extraction_id text, rule_id text, layer text, severity text, message text, fields text, our_value text, report_value text,
  difference numeric, tolerance numeric, unit text, source_page int, context text, status text, resolution text, created_at text);
create table publication (id text primary key, upload_id text, deal_slug text, collection_period text, published_by text, published_at text, deal text, rollup_version int);
"""

@pytest.fixture
def conn():
    eng = create_engine("sqlite://")
    with eng.begin() as c:
        for stmt in DDL.strip().split(";"):
            if stmt.strip(): c.execute(text(stmt))
        for p in mf.seed("programs.json"):
            c.execute(text('insert into program values (:slug, :name, :partner_slug, :currency, :limit, :warehouse_limit)'), p)
        for d in mf.seed("deals.json"):
            c.execute(text("insert into deal values (:slug, :name, :program_slug, :servicer, :template_id)"), d)
        for x in mf.seed("covenant_definitions.json"):
            c.execute(text("insert into covenant_definition values (:id, :deal_slug, :legal_ref, :description, :kind, :threshold, :threshold_rule, :watch_buffer_pct, :effective_from, :source)"),
                      {**x, "id": str(uuid.uuid4()), "threshold_rule": json.dumps(x["threshold_rule"]) if x["threshold_rule"] else None})
        yield c

def add_upload(c, deal, upload_slug=None, period="2026-08", reporting="2026-07"):
    uid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    c.execute(text("insert into setrep_upload (id, deal_slug, collection_period, reporting_period, file_name, file_path, uploaded_by, status) values (:id, :s, :p, :r, 'f.pdf', '/data/f.pdf', 'tao_admin', 'extracting')"),
              {"id": uid, "s": upload_slug or deal["deal_slug"], "p": period, "r": reporting})
    c.execute(text("insert into extraction (id, upload_id, pass, meta, deal, sources) values (:id, :u, 1, :m, :d, '{}')"),
              {"id": eid, "u": uid, "m": json.dumps({**mf.META, "upload_id": uid}), "d": json.dumps(deal)})
    return uid, eid

def publish(c, deal_slug, period, deal_obj, at="2026-07-15T14:02:00Z"):
    c.execute(text("insert into publication (id, upload_id, deal_slug, collection_period, published_by, published_at, deal, rollup_version) values (:id, :u, :s, :p, 'tao_admin', :at, :d, 1)"),
              {"id": str(uuid.uuid4()), "u": str(uuid.uuid4()), "s": deal_slug, "p": period, "at": at, "d": json.dumps(deal_obj)})

def test_moneda_with_prior_publication_is_clean(conn):
    d = mf.load_deal(mf.MONEDA); publish(conn, d["deal_slug"], "2026-07", mf.prior_from_history(d))
    _, eid = add_upload(conn, d)
    fs = adapter.validate_extraction(adapter.SqlStore(conn), eid)
    assert fs == [], [f["message"] for f in fs]

def test_context_is_built_from_the_database(conn):
    d = mf.load_deal(mf.MONEDA); publish(conn, d["deal_slug"], "2026-06", {"collection_period": "June 2026"}); publish(conn, d["deal_slug"], "2026-07", mf.prior_from_history(d))
    uid, _ = add_upload(conn, d)
    store = adapter.SqlStore(conn)
    ctx = adapter.build_context(store, store.upload(uid), d)
    assert ctx.prior["collection_period"] == "July 2026"
    assert ctx.master["program"] == {"slug": "f-pil-2-0", "name": "F-PIL 2.0", "partner_slug": "investor", "currency": "CAD", "limit": 150000000.0, "warehouse_limit": 5000000.0}
    assert len(ctx.master["covenant_definitions"]) == 7 and ctx.master["covenant_definitions"][0]["threshold_rule"]["on"] == "/tranche_balance/closing"
    assert ctx.published_periods == {"2026-06": "2026-07-15T14:02:00Z", "2026-07": "2026-07-15T14:02:00Z"}
    assert ctx.upload["deal_name"] == "Moneda Capital Corp."

def test_period_already_published_and_wrong_deal_block(conn):
    d = mf.load_deal(mf.MONEDA); publish(conn, d["deal_slug"], "2026-08", d, at="2026-08-12T16:40:00Z")
    _, eid = add_upload(conn, d, upload_slug="f-pil-2-0-stride-capital")
    fs = adapter.validate_extraction(adapter.SqlStore(conn), eid)
    assert sorted(f["rule_id"] for f in fs if f["severity"] == "block") == ["R13"]   # R12 checks Stride's periods: none
    _, eid2 = add_upload(conn, d)
    fs2 = adapter.validate_extraction(adapter.SqlStore(conn), eid2)
    assert [f["rule_id"] for f in fs2 if f["severity"] == "block"] == ["R12"] and all(f["extraction_id"] == eid2 for f in fs2)

def test_reporting_period_comes_from_the_upload(conn):
    d = mf.load_deal(mf.MONEDA)
    _, eid = add_upload(conn, d, reporting="2026-06")
    fs = adapter.validate_extraction(adapter.SqlStore(conn), eid)
    assert [f["rule_id"] for f in fs] == ["R04"] and "reporting period 2026-06" in fs[0]["message"]

def test_pass_2_flow_and_persistence(conn):
    d = mf.load_deal(mf.MONEDA); bad = json.loads(json.dumps(d))
    bad["period_history"][3]["principal"] = 647926.71
    _, e1 = add_upload(conn, bad); store = adapter.SqlStore(conn)
    f1 = adapter.validate_extraction(store, e1)
    assert [f["rule_id"] for f in f1] == ["R05"] and adapter.retry_pages(f1) == [2]
    _, e2 = add_upload(conn, d)
    f2 = adapter.validate_extraction(store, e2)
    cleared = adapter.resolved_by_pass_2(f1, f2)
    assert [f["status"] for f in cleared] == ["resolved_by_pass_2"] and adapter.counts(f2 + cleared) == {"block": 0, "review": 0, "note": 0}
    assert adapter.insert_findings(conn, f1) == 1
    row = conn.execute(text("select rule_id, severity, context, our_value from finding")).one()
    assert row.rule_id == "R05" and json.loads(row.context)["principal"] == 647926.71 and json.loads(row.our_value) == 15018971.52

def test_missing_extraction_raises(conn):
    with pytest.raises(LookupError): adapter.validate_extraction(adapter.SqlStore(conn), str(uuid.uuid4()))
