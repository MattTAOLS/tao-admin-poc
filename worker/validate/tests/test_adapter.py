"""Adapter tests against SQLite with the columns of db/migrations/001_init.sql (types simplified: jsonb -> text,
uuid -> text, defaults kept). The SQL in adapter.py is portable, so the same statements run on PostgreSQL."""
import json, os, pathlib, subprocess, sys, uuid
import pytest
from sqlalchemy import create_engine, text
from worker.validate import adapter
from rules.tests.fixtures import make_fixtures as mf

ROOT = pathlib.Path(__file__).resolve().parents[3]
DDL = """
create table partner (slug text primary key, name text, kind text, status text);
create table program (slug text primary key, name text, partner_slug text, currency text, "limit" numeric, warehouse_limit numeric);
create table deal (slug text primary key, name text, program_slug text, servicer text, template_id text);
create table covenant_definition (id text primary key, deal_slug text, legal_ref text, description text, kind text, threshold numeric, threshold_rule text,
  watch_buffer_pct numeric, effective_from date, source text);
create table setrep_upload (id text primary key, deal_slug text, collection_period text, reporting_period text, file_name text, file_path text, page_count int,
  uploaded_by text, uploaded_at text default current_timestamp, status text default 'received', reject_reason text);
create table extraction (id text primary key, upload_id text, pass int, meta text, deal text, sources text, confidence numeric, created_at text default current_timestamp);
create table finding (id text primary key, extraction_id text, rule_id text, layer text, severity text, message text, fields text, our_value text, report_value text,
  difference numeric, tolerance numeric, unit text, source_page int, context text, status text default 'open', resolution text, created_at text default current_timestamp);
create table review_action (id text primary key, upload_id text, finding_id text, actor_role text, actor_label text, action text, reason text, detail text, at text default current_timestamp);
create table publication (id text primary key, upload_id text, deal_slug text, collection_period text, published_by text, published_at text, deal text, rollup_version int);
"""

def setup_db(c):
    for stmt in DDL.strip().split(";"):
        if stmt.strip(): c.execute(text(stmt))
    for p in mf.seed("programs.json"):
        c.execute(text('insert into program values (:slug, :name, :partner_slug, :currency, :limit, :warehouse_limit)'), p)
    for d in mf.seed("deals.json"):
        c.execute(text("insert into deal values (:slug, :name, :program_slug, :servicer, :template_id)"), d)
    for x in mf.seed("covenant_definitions.json"):
        c.execute(text("insert into covenant_definition values (:id, :deal_slug, :legal_ref, :description, :kind, :threshold, :threshold_rule, :watch_buffer_pct, :effective_from, :source)"),
                  {**x, "id": str(uuid.uuid4()), "threshold_rule": json.dumps(x["threshold_rule"]) if x["threshold_rule"] else None})

@pytest.fixture
def conn():
    with create_engine("sqlite://").begin() as c:
        setup_db(c); yield c

def new_upload(c, deal_slug="f-pil-2-0-moneda-capital-corp", period="2026-08", status="received", reporting=None):
    uid = str(uuid.uuid4())
    c.execute(text("insert into setrep_upload (id, deal_slug, collection_period, reporting_period, file_name, file_path, page_count, uploaded_by, status) values (:id, :s, :p, :r, 'f.pdf', '/data/f.pdf', 16, 'tao_admin', :st)"),
              {"id": uid, "s": deal_slug, "p": period, "r": reporting, "st": status})
    return uid

def doc(deal, **meta): return {"meta": {**mf.META, **meta}, "deal": deal, "sources": {}}

def publish(c, deal_slug, period, deal_obj, at="2026-07-15T14:02:00Z"):
    c.execute(text("insert into publication (id, upload_id, deal_slug, collection_period, published_by, published_at, deal, rollup_version) values (:id, :u, :s, :p, 'tao_admin', :at, :d, 1)"),
              {"id": str(uuid.uuid4()), "u": str(uuid.uuid4()), "s": deal_slug, "p": period, "at": at, "d": json.dumps(deal_obj)})

def status(c, uid): return c.execute(text("select status from setrep_upload where id = :id"), {"id": uid}).scalar()

def moneda_with_r05_error():
    d = mf.load_deal(mf.MONEDA); d["period_history"][3]["principal"] = 647926.71; return d

class FakeQueue:
    def __init__(self, fail=False): self.jobs, self.fail = [], fail
    def __call__(self, job):
        if self.fail: raise ConnectionError("redis down")
        self.jobs.append(job)

# ---------- handle_extraction ----------
def test_pass_1_clean_goes_to_needs_review(conn):
    d = mf.load_deal(mf.MONEDA); publish(conn, d["deal_slug"], "2026-07", mf.prior_from_history(d))
    uid = new_upload(conn); q = FakeQueue()
    assert adapter.mark_extracting(uid, conn=conn) and status(conn, uid) == "extracting"
    out = adapter.handle_extraction({"upload_id": uid, "pass": 1}, doc(d, reporting_period="2026-07"), conn=conn, enqueue=q)
    assert out["status"] == "needs_review" and out["counts"] == {"block": 0, "review": 0, "note": 0} and q.jobs == []
    row = conn.execute(text("select upload_id, pass, meta from extraction where id = :id"), {"id": out["extraction_id"]}).one()
    assert row[0] == uid and row[1] == 1
    assert json.loads(row.meta)["upload_id"] == uid
    assert conn.execute(text("select reporting_period from setrep_upload where id = :id"), {"id": uid}).scalar() == "2026-07"
    assert status(conn, uid) == "needs_review"

def test_pass_1_block_queues_pass_2_then_pass_2_resolves(conn):
    uid = new_upload(conn, status="extracting"); q = FakeQueue()
    out1 = adapter.handle_extraction({"upload_id": uid, "pass": 1}, doc(moneda_with_r05_error()), conn=conn, enqueue=q)
    assert out1["status"] == "extracting" and status(conn, uid) == "extracting"
    assert q.jobs == [{"upload_id": uid, "pass": 2, "pages": [2]}] and out1["counts"]["block"] == 1
    stored = conn.execute(text("select rule_id, status, extraction_id from finding")).all()
    assert [(r.rule_id, r.status) for r in stored] == [("R05", "open")] and stored[0].extraction_id == out1["extraction_id"]
    # pass 2 re-reads page 2 and gets the principal right
    out2 = adapter.handle_extraction(q.jobs[0], doc(mf.load_deal(mf.MONEDA), pages_reread=[2]), conn=conn, enqueue=q)
    assert out2["status"] == "needs_review" and out2["counts"] == {"block": 0, "review": 0, "note": 0} and len(q.jobs) == 1
    assert conn.execute(text("select status from finding where rule_id = 'R05'")).scalar() == "resolved_by_pass_2"
    assert conn.execute(text("select count(*) from extraction where upload_id = :u"), {"u": uid}).scalar() == 2
    assert status(conn, uid) == "needs_review"

def test_pass_2_keeps_findings_it_still_produces(conn):
    uid = new_upload(conn, status="extracting"); q = FakeQueue()
    adapter.handle_extraction({"upload_id": uid, "pass": 1}, doc(moneda_with_r05_error()), conn=conn, enqueue=q)
    out2 = adapter.handle_extraction(q.jobs[0], doc(moneda_with_r05_error()), conn=conn, enqueue=q)
    assert out2["counts"]["block"] == 1 and status(conn, uid) == "needs_review"
    assert sorted(r.status for r in conn.execute(text("select status from finding"))) == ["open", "open"]

def test_pass_1_without_queue_goes_to_needs_review(conn):
    uid = new_upload(conn, status="extracting")
    out = adapter.handle_extraction({"upload_id": uid, "pass": 1}, doc(moneda_with_r05_error()), conn=conn, enqueue=False)
    assert out["status"] == "needs_review" and status(conn, uid) == "needs_review"
    uid2 = new_upload(conn, deal_slug="f-pil-2-0-stride-capital", status="extracting")
    d = mf.load_deal(mf.STRIDE); d["period_history"][3]["principal"] += 1000
    out2 = adapter.handle_extraction({"upload_id": uid2, "pass": 1}, doc(d), conn=conn, enqueue=FakeQueue(fail=True))
    assert out2["status"] == "needs_review" and status(conn, uid2) == "needs_review"

def test_period_already_published_blocks_through_handle(conn):
    d = mf.load_deal(mf.MONEDA); publish(conn, d["deal_slug"], "2026-08", d, at="2026-08-12T16:40:00Z")
    uid = new_upload(conn, status="extracting")
    out = adapter.handle_extraction({"upload_id": uid, "pass": 1}, doc(d), conn=conn, enqueue=FakeQueue())
    assert out["status"] == "needs_review" and out["counts"]["block"] == 1     # R12 is review-by-person, not a retry
    assert conn.execute(text("select rule_id from finding where severity = 'block'")).scalar() == "R12"

# ---------- status writes ----------
def test_mark_extracting_only_from_received(conn):
    uid = new_upload(conn, status="extracting"); assert not adapter.mark_extracting(uid, conn=conn) and status(conn, uid) == "extracting"
    uid2 = new_upload(conn, status="needs_review"); assert not adapter.mark_extracting(uid2, conn=conn) and status(conn, uid2) == "needs_review"

def test_mark_failed_sets_status_and_audits(conn, caplog):
    uid = new_upload(conn, status="extracting")
    adapter.mark_failed(uid, "pdfplumber: no text layer on page 2", conn=conn)
    assert status(conn, uid) == "extraction_failed"
    a = conn.execute(text("select actor_role, action, reason, detail from review_action where upload_id = :u"), {"u": uid}).one()
    assert (a.actor_role, a.action, a.reason) == ("system", "extract", "pdfplumber: no text layer on page 2") and json.loads(a.detail) == {"status": "extraction_failed"}
    assert "no text layer" in caplog.text

def test_connection_from_database_url(tmp_path, monkeypatch):
    url = f"sqlite:///{(tmp_path / 'w.db').as_posix()}"
    with create_engine(url).begin() as c:
        setup_db(c); uid = new_upload(c)
    monkeypatch.setenv("DATABASE_URL", url); monkeypatch.setattr(adapter, "_ENGINE", None)
    assert adapter.mark_extracting(uid)
    out = adapter.handle_extraction({"upload_id": uid, "pass": 1}, doc(mf.load_deal(mf.MONEDA)), enqueue=False)
    with create_engine(url).connect() as c:
        assert status(c, uid) == "needs_review" and c.execute(text("select count(*) from extraction")).scalar() == 1
    assert out["status"] == "needs_review"

# ---------- context parity with api/app/review.py ----------
def test_context_has_the_api_shape(conn):
    d = mf.load_deal(mf.MONEDA); publish(conn, d["deal_slug"], "2026-06", {"collection_period": "June 2026"}); publish(conn, d["deal_slug"], "2026-07", mf.prior_from_history(d))
    conn.execute(text("insert into covenant_definition values ('future', 'f-pil-2-0-moneda-capital-corp', 'SLFA 9.1 (e)', 'Delinquency Ratio', 'ceiling', 0.03, null, 0.1, '2026-09-01', 'amendment')"))
    uid = new_upload(conn, status="extracting", reporting="2026-07")
    store = adapter.SqlStore(conn); ctx = adapter.build_context(store, store.upload(uid), d)
    assert ctx.prior["collection_period"] == "July 2026"
    assert set(ctx.master) == {"program", "deal", "covenants"}
    assert ctx.master["program"] == {"slug": "f-pil-2-0", "name": "F-PIL 2.0", "partner_slug": "investor", "currency": "CAD", "limit": 150000000.0, "warehouse_limit": 5000000.0}
    assert ctx.master["deal"] == {"slug": "f-pil-2-0-moneda-capital-corp", "name": "Moneda Capital Corp.", "program_slug": "f-pil-2-0", "servicer": "Moneda Capital Corp.", "template_id": "fpil-2.0-settrep-v1"}
    covs = ctx.master["covenants"]
    assert len(covs) == 7 and set(covs[0]) == {"id", "deal_slug", "legal_ref", "description", "kind", "threshold", "threshold_rule", "watch_buffer_pct", "effective_from", "source"}
    assert next(c for c in covs if c["legal_ref"] == "SLFA 9.1 (e)")["threshold"] == 0.035          # 2026-09 amendment not yet in force
    assert next(c for c in covs if c["legal_ref"] == "SLFA 9.1 (c)")["threshold_rule"]["on"] == "/tranche_balance/closing"
    assert ctx.published_periods == {"2026-06": "2026-07-15T14:02:00Z", "2026-07": "2026-07-15T14:02:00Z"}   # dict: membership like the API's set, plus the date
    assert set(ctx.upload) == {"id", "deal_slug", "program_slug", "partner_slug", "collection_period", "reporting_period", "status", "file_name", "page_count",
                               "uploaded_by", "uploaded_at", "finding_counts", "latest_extraction_id", "published_at", "reject_reason", "replaces_upload_id"}
    assert ctx.upload["replaces_upload_id"] is None          # no migration-006 column in this database: tolerated
    assert ctx.upload["program_slug"] == "f-pil-2-0" and ctx.upload["reporting_period"] == "2026-07"

def test_wrong_deal_selected_blocks(conn):
    uid = new_upload(conn, deal_slug="f-pil-2-0-stride-capital", status="extracting")
    out = adapter.handle_extraction({"upload_id": uid, "pass": 1}, doc(mf.load_deal(mf.MONEDA)), conn=conn, enqueue=FakeQueue())
    assert [r.rule_id for r in conn.execute(text("select rule_id from finding where severity = 'block'"))] == ["R13"] and out["status"] == "needs_review"

def test_missing_extraction_raises(conn):
    with pytest.raises(LookupError): adapter.validate_extraction(adapter.SqlStore(conn), str(uuid.uuid4()))

def test_importable_as_validate_like_the_container():
    """Container: /app holds main.py, validate/, rules/, contracts/; `import validate` must work with /app on the path."""
    code = "import sys; sys.path[:0] = [sys.argv[1], sys.argv[2]]; import validate; print(validate.handle_extraction.__module__)"
    out = subprocess.run([sys.executable, "-c", code, str(ROOT / "worker"), str(ROOT)], capture_output=True, text=True, cwd=str(ROOT / "worker"))
    assert out.returncode == 0 and out.stdout.strip() == "validate.adapter", out.stderr

# ---------- history chaining (extend injected by worker/main.py; a fake stands in for worker/extract/history.py) ----------
class FakeExtend:
    """Chains like history.extend should: prior period rows before the current one, prior covenants, and records
    what it was called with. `tamper` lets a test change the current row to prove the rules see the chained doc."""
    def __init__(self, tamper=None, fail=False): self.calls, self.tamper, self.fail = [], tamper, fail
    def __call__(self, prior, ex):
        self.calls.append((prior, ex))
        if self.fail: raise KeyError("period_history")
        d = ex["deal"]
        d["period_history"] = prior["period_history"] + d["period_history"]
        d["aging_history"] = d["aging_history"] + prior["aging_history"]
        d["prior_covenants"] = prior["covenants"]
        ex["meta"]["chained_periods"] = [r["period"] for r in d["period_history"]]
        if self.tamper: self.tamper(d)
        return ex

def stored_deal(c, eid): return json.loads(c.execute(text("select deal from extraction where id = :id"), {"id": eid}).scalar())

def test_extend_called_with_prior_publication_and_stored(conn):
    full = mf.load_deal(mf.MONEDA); prior = mf.prior_state(full)
    publish(conn, full["deal_slug"], "2026-06", {"collection_period": "June 2026", "period_history": []})
    publish(conn, full["deal_slug"], "2026-07", prior)
    uid = new_upload(conn, status="extracting"); ext = FakeExtend()
    out = adapter.handle_extraction({"upload_id": uid, "pass": 1}, doc(mf.single_month(full)), conn=conn, enqueue=FakeQueue(), extend=ext)
    assert len(ext.calls) == 1 and ext.calls[0][0] == prior            # the 2026-07 publication, not 2026-06
    d = stored_deal(conn, out["extraction_id"])
    assert [r["period"] for r in d["period_history"]] == ["2026-05", "2026-06", "2026-07", "2026-08"] and d["period_history"] == full["period_history"]
    meta = json.loads(conn.execute(text("select meta from extraction where id = :id"), {"id": out["extraction_id"]}).scalar())
    assert meta["chained_periods"] == ["2026-05", "2026-06", "2026-07", "2026-08"] and meta["upload_id"] == uid
    assert out["status"] == "needs_review" and out["counts"] == {"block": 0, "review": 0, "note": 0}

def test_findings_come_from_the_extended_document(conn):
    full = mf.load_deal(mf.MONEDA); publish(conn, full["deal_slug"], "2026-07", mf.prior_state(full))
    uid = new_upload(conn, status="extracting")
    def tamper(d): d["period_history"][-1]["principal"] += 1000      # only the chained document has the error
    out = adapter.handle_extraction({"upload_id": uid, "pass": 1}, doc(mf.single_month(full)), conn=conn, enqueue=False, extend=FakeExtend(tamper))
    assert [r.rule_id for r in conn.execute(text("select rule_id from finding where extraction_id = :e"), {"e": out["extraction_id"]})] == ["R05"]

def test_no_prior_stores_extraction_unchanged(conn):
    uid = new_upload(conn, status="extracting"); ext = FakeExtend(); single = mf.single_month(mf.load_deal(mf.MONEDA))
    out = adapter.handle_extraction({"upload_id": uid, "pass": 1}, doc(single), conn=conn, enqueue=False, extend=ext)
    assert ext.calls == [] and stored_deal(conn, out["extraction_id"]) == single

def test_extend_failure_stores_unchained_with_note(conn, caplog):
    full = mf.load_deal(mf.MONEDA); publish(conn, full["deal_slug"], "2026-07", mf.prior_state(full))
    uid = new_upload(conn, status="extracting"); single = mf.single_month(full)
    out = adapter.handle_extraction({"upload_id": uid, "pass": 1}, doc(single), conn=conn, enqueue=False, extend=FakeExtend(fail=True))
    assert stored_deal(conn, out["extraction_id"]) == single and out["status"] == "needs_review" and status(conn, uid) == "needs_review"
    meta = json.loads(conn.execute(text("select meta from extraction where id = :id"), {"id": out["extraction_id"]}).scalar())
    assert len(meta["notes"]) == 1 and "2026-07" in meta["notes"][0] and "KeyError" in meta["notes"][0]
    assert "history chaining failed" in caplog.text

# ---------- override targets ----------
def test_targets_stored_when_the_column_exists(conn, caplog):
    uid = new_upload(conn, status="extracting")
    out = adapter.handle_extraction({"upload_id": uid, "pass": 1}, doc(moneda_with_r05_error()), conn=conn, enqueue=False)
    assert "no targets column" in caplog.text                      # 001 schema: findings stored, targets skipped
    conn.execute(text("alter table finding add column targets text"))
    uid2 = new_upload(conn, deal_slug="f-pil-2-0-stride-capital", status="extracting")
    d = mf.load_deal(mf.STRIDE); d["period_history"][3]["principal"] += 1000
    out2 = adapter.handle_extraction({"upload_id": uid2, "pass": 1}, doc(d), conn=conn, enqueue=False)
    row = conn.execute(text("select targets, our_value, report_value from finding where extraction_id = :e and rule_id = 'R05'"), {"e": out2["extraction_id"]}).one()
    assert json.loads(row.targets)[:2] == ["/period_history/3/closing_balance", "/tranche_balance/closing"]
    assert conn.execute(text("select targets from finding where extraction_id = :e"), {"e": out["extraction_id"]}).scalar() is None

# ---------- corrected re-issues ----------
def test_reissue_chains_onto_the_month_before_and_r12_names_the_replacement(conn):
    """A re-issue of August (replaces_upload_id = the published August upload): extend and ctx.prior both use the
    July publication, never the August one being replaced; R12 blocks with the re-issue message and the date."""
    conn.execute(text("alter table finding add column targets text"))                    # migration 005
    conn.execute(text("alter table setrep_upload add column replaces_upload_id text"))   # migration 006
    full = mf.load_deal(mf.MONEDA); july = mf.prior_state(full)
    publish(conn, full["deal_slug"], "2026-07", july)
    publish(conn, full["deal_slug"], "2026-08", {**full, "collection_period": "August 2026", "marker": "published August"}, at="2026-08-12T16:40:00Z")
    publish(conn, full["deal_slug"], "2026-09", {"collection_period": "September 2026"}, at="2026-09-14T10:00:00Z")
    old = new_upload(conn, status="published")
    uid = new_upload(conn, status="extracting")
    conn.execute(text("update setrep_upload set replaces_upload_id = :o where id = :u"), {"o": old, "u": uid})
    ext = FakeExtend(); store = adapter.SqlStore(conn)
    ctx = adapter.build_context(store, store.upload(uid), full)
    assert ctx.prior == july and ctx.upload["replaces_upload_id"] == old
    out = adapter.handle_extraction({"upload_id": uid, "pass": 1}, doc(mf.single_month(full)), conn=conn, enqueue=FakeQueue(), extend=ext)
    assert ext.calls[0][0] == july and "marker" not in ext.calls[0][0]
    assert stored_deal(conn, out["extraction_id"])["period_history"] == full["period_history"]
    row = conn.execute(text("select severity, message, context, targets from finding where extraction_id = :e and rule_id = 'R12'"), {"e": out["extraction_id"]}).one()
    assert row.severity == "block" and row.message == ("Corrected re-issue: replaces the 2026-08 report published 2026-08-12T16:40:00Z. "
                                                       "Later published months (2026-09) still carry the earlier figures for 2026-08.")
    c = json.loads(row.context)
    assert c["replaces_upload_id"] == old and c["later_periods"] == ["2026-09"] and c["published_at"] == "2026-08-12T16:40:00Z"
    assert out["counts"]["block"] == 1 and out["status"] == "needs_review"

def test_prior_publication_skips_the_replaced_month():
    pubs = [{"collection_period": p, "deal": {"p": p}} for p in ("2026-06", "2026-07", "2026-08", "2026-09")]
    assert adapter.prior_publication(pubs, "2026-08")["collection_period"] == "2026-07"
    assert adapter.prior_publication(pubs, "2026-06") is None
