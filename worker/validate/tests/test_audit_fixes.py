"""Bug-audit fixes in the adapter: H6 (reviewer resolutions survive a re-extraction), M6 (pass-2 pages come from this
report's pages), M8 (uploads whose job was lost are failed so the operator can re-extract)."""
import datetime as dt, json
from sqlalchemy import text
from worker.validate import adapter
from rules.tests.fixtures import make_fixtures as mf
from .test_adapter import FakeQueue, conn, doc, moneda_with_r05_error, new_upload, publish, status   # noqa: F401 (conn is a fixture)

RESOLUTION = {"by": "tao_admin", "at": "2026-08-13T09:00:00Z", "choice": "acknowledge", "reason": "Corrected re-issue agreed with the servicer"}

def resolve(c, extraction_id, rule_id, status_="overridden", resolution=RESOLUTION):
    c.execute(text("update finding set status = :s, resolution = :r where extraction_id = :e and rule_id = :rule"),
              {"s": status_, "r": json.dumps(resolution), "e": extraction_id, "rule": rule_id})

def handle(c, job, document, **kw):
    """handle_extraction, then give the stored extraction its own second: SQLite's current_timestamp has one-second
    resolution, PostgreSQL's now() does not tie between transactions."""
    handle.n = getattr(handle, "n", 0) + 1
    out = adapter.handle_extraction(job, document, conn=c, **kw)
    c.execute(text("update extraction set created_at = :t where id = :id"), {"t": f"2026-11-10 10:{handle.n // 60:02d}:{handle.n % 60:02d}", "id": out["extraction_id"]})
    return out

def findings_of(c, extraction_id):
    return [dict(r._mapping) for r in c.execute(text("select rule_id, status, resolution, severity from finding where extraction_id = :e"), {"e": extraction_id})]

# ---------- H6 ----------
def test_h6_acknowledged_block_keeps_its_resolution_after_reextract(conn):
    """The audit's case: acknowledge an R12 block with a reason, re-extract; R12 must not come back open."""
    d = mf.load_deal(mf.MONEDA); publish(conn, d["deal_slug"], "2026-08", d, at="2026-08-12T16:40:00Z")
    uid = new_upload(conn, status="extracting")
    out1 = handle(conn, {"upload_id": uid, "pass": 1}, doc(d), enqueue=FakeQueue())
    assert out1["counts"]["block"] == 1 and out1["carried"] == 0
    resolve(conn, out1["extraction_id"], "R12")
    conn.execute(text("update setrep_upload set status = 'extracting' where id = :id"), {"id": uid})      # the API's reextract
    out2 = handle(conn, {"upload_id": uid, "pass": 2, "pages": [2]}, doc(d, pages_reread=[2]), enqueue=FakeQueue())
    assert out2["status"] == "needs_review" and out2["counts"]["block"] == 0 and out2["carried"] == 1
    r12 = [f for f in findings_of(conn, out2["extraction_id"]) if f["rule_id"] == "R12"]
    assert len(r12) == 1 and r12[0]["status"] == "overridden" and json.loads(r12[0]["resolution"]) == RESOLUTION
    # the pass-1 finding keeps its own record
    old = [f for f in findings_of(conn, out1["extraction_id"]) if f["rule_id"] == "R12"]
    assert old[0]["status"] == "overridden"

def test_h6_resolution_survives_a_second_reextract(conn):
    d = mf.load_deal(mf.MONEDA); publish(conn, d["deal_slug"], "2026-08", d)
    uid = new_upload(conn, status="extracting")
    out = handle(conn, {"upload_id": uid, "pass": 1}, doc(d), enqueue=FakeQueue())
    resolve(conn, out["extraction_id"], "R12")
    for _ in range(2):
        conn.execute(text("update setrep_upload set status = 'extracting' where id = :id"), {"id": uid})
        out = handle(conn, {"upload_id": uid, "pass": 2, "pages": [14]}, doc(d, pages_reread=[14]), enqueue=FakeQueue())
        assert out["carried"] == 1 and out["counts"]["block"] == 0

def test_h6_finding_whose_values_changed_starts_open(conn):
    """R05 overridden on the pass-1 numbers; the re-read gives a different closing gap: same rule and fields, other
    values, so the reviewer decides again."""
    uid = new_upload(conn, status="extracting")
    out1 = handle(conn, {"upload_id": uid, "pass": 1}, doc(moneda_with_r05_error()), enqueue=False)
    resolve(conn, out1["extraction_id"], "R05", resolution={**RESOLUTION, "choice": "use_report"})
    d2 = moneda_with_r05_error(); d2["period_history"][3]["principal"] += 250.0
    out2 = handle(conn, {"upload_id": uid, "pass": 2, "pages": [2]}, doc(d2, pages_reread=[2]), enqueue=False)
    r05 = [f for f in findings_of(conn, out2["extraction_id"]) if f["rule_id"] == "R05"]
    assert out2["carried"] == 0 and [f["status"] for f in r05] == ["open"] and r05[0]["resolution"] is None
    # the same numbers again: carried
    out3 = handle(conn, {"upload_id": uid, "pass": 2, "pages": [2]}, doc(d2, pages_reread=[2]), enqueue=False)
    assert out3["carried"] == 0      # nothing resolved on out2's findings
    resolve(conn, out3["extraction_id"], "R05", resolution={**RESOLUTION, "choice": "use_report"})
    out4 = handle(conn, {"upload_id": uid, "pass": 2, "pages": [2]}, doc(d2, pages_reread=[2]), enqueue=False)
    assert out4["carried"] == 1 and out4["counts"]["block"] == 0

def test_h6_open_and_pass_2_statuses_are_not_carried(conn):
    uid = new_upload(conn, status="extracting"); q = FakeQueue()
    out1 = handle(conn, {"upload_id": uid, "pass": 1}, doc(moneda_with_r05_error()), enqueue=q)
    out2 = handle(conn, q.jobs[0], doc(moneda_with_r05_error()), enqueue=q)
    assert out2["carried"] == 0 and out2["counts"]["block"] == 1

def test_h6_same_finding_rules():
    base = {"rule_id": "R08", "fields": ["/cnl_by_period/2"], "severity": "block", "our_value": 10.0, "report_value": 12.0, "difference": 2.0, "unit": "currency",
            "context": {"vintage": "Dec-22 - Nov-23", "gross": 30.0}, "targets": ["/cnl_by_period/2/cumulative_net_losses"]}
    same = json.loads(json.dumps(base)); same["our_value"] = 10        # 10 and 10.0 after a database round trip
    assert adapter.same_finding(base, same)
    for change in ({"report_value": 12.5}, {"context": {"vintage": "Dec-23 - Nov-24", "gross": 30.0}}, {"context": {"vintage": "Dec-22 - Nov-23", "gross": 31.0}},
                   {"fields": ["/cnl_by_period/3"]}, {"rule_id": "R17"}, {"targets": []}, {"severity": "review"}):
        assert not adapter.same_finding(base, {**base, **change}), change

def test_h6_one_resolution_resolves_one_finding():
    old = [{"rule_id": "R01", "fields": ["meta:/unplaced"], "severity": "block", "context": {"count": 1}, "status": "overridden", "resolution": RESOLUTION}]
    new = [{"rule_id": "R01", "fields": ["meta:/unplaced"], "severity": "block", "context": {"count": 1}, "status": "open", "resolution": None} for _ in range(2)]
    assert len(adapter.carry_resolutions(old, new)) == 1 and [f["status"] for f in new] == ["overridden", "open"]

# ---------- M6 ----------
def test_m6_pass_2_pages_come_from_this_reports_pages(conn):
    """Dynamic Capital, aging broken: the automatic pass 2 must re-read page 15 (where this report prints aging),
    not the F-PIL page 11 of the rules.yaml hint."""
    d = mf.load_deal("move-trust-dynamic-capital.dashboard.json"); d["aging_history"][0]["closing_balance"] += 1000.0
    uid = new_upload(conn, deal_slug=d["deal_slug"], period="2026-07", status="extracting"); q = FakeQueue()
    out = handle(conn, {"upload_id": uid, "pass": 1}, doc(d, template_id="move-trust-settrep-v1"), enqueue=q)
    r07 = conn.execute(text("select source_page from finding where extraction_id = :e and rule_id = 'R07'"), {"e": out["extraction_id"]}).scalar()
    assert r07 == 15 and q.jobs and 15 in q.jobs[0]["pages"] and 11 not in q.jobs[0]["pages"]

# ---------- M8 ----------
NOW = dt.datetime(2026, 11, 10, 12, 0, tzinfo=dt.timezone.utc)

def aged(c, uid, minutes):
    c.execute(text("update setrep_upload set uploaded_at = :t where id = :id"), {"t": (NOW - dt.timedelta(minutes=minutes)).strftime("%Y-%m-%d %H:%M:%S"), "id": uid})
    return uid

def test_m8_stuck_uploads_are_failed_with_a_reason_and_audited(conn):
    stuck = aged(conn, new_upload(conn, status="extracting"), 60)
    lost = aged(conn, new_upload(conn, deal_slug="f-pil-2-0-stride-capital", status="received"), 60)
    assert sorted(adapter.recover_stale(queued_ids=[], conn=conn, now=NOW)) == sorted([stuck, lost])
    assert status(conn, stuck) == "extraction_failed" and status(conn, lost) == "extraction_failed"
    a = conn.execute(text("select actor_role, action, reason, detail from review_action where upload_id = :u"), {"u": stuck}).one()
    assert (a.actor_role, a.action) == ("system", "extract") and "Re-extract" in a.reason and json.loads(a.detail) == {"status": "extraction_failed"}
    assert adapter.recover_stale(queued_ids=[], conn=conn, now=NOW) == []      # nothing left to recover

def test_m8_queued_recent_and_settled_uploads_are_left_alone(conn):
    queued = aged(conn, new_upload(conn, status="received"), 60)
    recent = aged(conn, new_upload(conn, deal_slug="f-pil-2-0-stride-capital", status="extracting"), 2)
    review = aged(conn, new_upload(conn, deal_slug="f-pil-2-0-xpedite-leasing", status="needs_review"), 600)
    assert adapter.recover_stale(queued_ids=[queued], conn=conn, now=NOW) == []
    assert (status(conn, queued), status(conn, recent), status(conn, review)) == ("received", "extracting", "needs_review")

def test_m8_a_reextract_just_queued_counts_as_activity(conn):
    """An old upload sent back for re-extraction: the API's audit row is recent, so the upload is not failed while its
    job is being worked on."""
    uid = aged(conn, new_upload(conn, status="extracting"), 600)
    conn.execute(text("insert into review_action (id, upload_id, actor_role, action, at) values ('a1', :u, 'tao_admin', 'reextract', :t)"),
                 {"u": uid, "t": (NOW - dt.timedelta(minutes=1)).strftime("%Y-%m-%d %H:%M:%S")})
    assert adapter.recover_stale(queued_ids=[], conn=conn, now=NOW) == [] and status(conn, uid) == "extracting"
    assert adapter.recover_stale(queued_ids=[], conn=conn, now=NOW + dt.timedelta(minutes=30)) == [uid]

def test_m8_threshold_from_the_environment(conn, monkeypatch):
    uid = aged(conn, new_upload(conn, status="extracting"), 5)
    assert adapter.recover_stale(queued_ids=[], conn=conn, now=NOW) == []
    monkeypatch.setenv("WORKER_STALE_MINUTES", "3")
    assert adapter.recover_stale(queued_ids=[], conn=conn, now=NOW) == [uid]


# ---------- finding identity (Lead note on H1 / H6) ----------
def r11(month, field, prior_value, value):
    return {"rule_id": "R11", "severity": "review", "fields": ["/period_history", "/ratio_history", "prior:/period_history"], "our_value": prior_value, "report_value": value,
            "difference": value - prior_value, "unit": "percent_points", "status": "open", "resolution": None,
            "context": {"month": month, "field": field, "prior_value": prior_value, "value": value, "prior_period": "July 2026", "restatement": True}}

def test_key_tells_two_restatements_apart():
    """Two R11 restatements share rule id and fields; month and field are the identity, as in api/app/review.finding_key."""
    a, b, c = r11("May-26", "ratio_history.loss_ratio_pct", 0.01, 0.02), r11("Jun-26", "ratio_history.loss_ratio_pct", 0.01, 0.02), r11("May-26", "ratio_history.delinquency_ratio_pct", 0.01, 0.02)
    assert len({adapter._key(a), adapter._key(b), adapter._key(c)}) == 3
    assert adapter._key(a) == adapter._key(json.loads(json.dumps(a)))
    assert adapter._key(a) == ("R11", tuple(a["fields"]), (("month", "May-26"), ("field", "ratio_history.loss_ratio_pct")))

def test_resolution_carries_to_the_same_month_only():
    accepted = {**r11("May-26", "ratio_history.loss_ratio_pct", 0.01, 0.02), "status": "accepted_as_restatement", "resolution": {**RESOLUTION, "choice": "restatement"}}
    new = [r11("Jun-26", "ratio_history.loss_ratio_pct", 0.01, 0.02), r11("May-26", "ratio_history.loss_ratio_pct", 0.01, 0.02)]
    pairs = adapter.carry_resolutions([accepted], new)
    assert len(pairs) == 1 and [f["status"] for f in new] == ["open", "accepted_as_restatement"]

def test_pass_2_resolves_only_the_restatement_that_went_away():
    may, jun = {**r11("May-26", "ratio_history.loss_ratio_pct", 0.01, 0.02), "id": "f-may"}, {**r11("Jun-26", "ratio_history.loss_ratio_pct", 0.01, 0.02), "id": "f-jun"}
    cleared = adapter.resolved_by_pass_2([may, jun], [r11("Jun-26", "ratio_history.loss_ratio_pct", 0.01, 0.02)])
    assert [f["id"] for f in cleared] == ["f-may"]

def test_rules_are_idempotent_on_rerun(conn):
    """Same stored extraction, run twice: the same findings in the same order with the same keys, fields and contexts."""
    d = moneda_with_r05_error(); d["aging_history"][0]["closing_balance"] += 10.0; publish(conn, d["deal_slug"], "2026-07", mf.prior_from_history(d))
    uid = new_upload(conn, status="extracting")
    out = handle(conn, {"upload_id": uid, "pass": 1}, doc(d, pages_without_text=[9], unplaced=["aging.closing"]), enqueue=False)
    store = adapter.SqlStore(conn)
    strip = lambda fs: [{k: v for k, v in f.items() if k not in ("id", "created_at")} for f in fs]
    one, two = adapter.validate_extraction(store, out["extraction_id"]), adapter.validate_extraction(store, out["extraction_id"])
    assert strip(one) == strip(two) and len(one) >= 4
    keys = [adapter._key(f) for f in one]
    assert len(keys) == len(set(keys)), "every finding of one run has its own identity"
