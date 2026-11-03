"""Review flow: the worker's writes are simulated (extraction + findings straight into the DB, as worker/validate
will do); everything after that goes through the API. The deal is the real Moneda 2026-08 object, re-labelled as
the next period, with one deliberate change (principal -100 on the current period row) so R05 fires: ours 15,020,071.52 vs report
15,019,971.52. R05's targets come from the rules: the current closing balance and every copy of it."""
import json
import pytest
from rules import run
from rules.engine import Context
from conftest import TAO, ANALYST, INV, MGR, reference_deal
from test_uploads import upload
from app import db
from app.models import Extraction, Finding, SetrepUpload, Publication

DEAL = "f-pil-2-0-moneda-capital-corp"


R05_TARGETS = ["/period_history/3/closing_balance", "/tranche_balance/closing", "/period_history/3/closing_amount",
               "/tranche_amount/closing", "/program/program_amount"]                  # every copy of the closing balance


def worker_writes(upload_id: str, deal: dict, pass_: int = 1, status: str = "needs_review", targets: bool = True) -> str:
    meta = {"upload_id": upload_id, "pass": pass_, "template_id": "fpil-2.0-settrep-v1", "page_count": 3,
            "extracted_at": "2026-11-03T00:00:00Z", "engine": {"text_layer": "pdfplumber", "model": "claude"}, "reporting_period": "2026-07"}
    with db.session() as s:
        ex = Extraction(upload_id=upload_id, pass_=pass_, meta=meta, deal=deal, sources={})
        s.add(ex); s.flush()
        for f in run({"meta": meta, "deal": deal, "sources": {}}, Context(), phases=(1, 2)):
            f.pop("id"); f.pop("created_at"); f["extraction_id"] = ex.id
            if not targets:
                f.pop("targets", None)                    # a finding the rules gave no value to change
            s.add(Finding(**f))
        s.get(SetrepUpload, upload_id).status = status
        s.commit()
        return ex.id


def broken_deal():
    d = reference_deal(DEAL)
    cur = next(p for p in d["period_history"] if p["collection_period"] == d["collection_period"])
    cur["principal"] -= 100.0
    return d


@pytest.fixture
def pending(client):
    """An upload for Moneda 2026-08 in needs_review with one open R05 block finding."""
    u = upload(client, period="2026-08").json()
    ex_id = worker_writes(u["id"], broken_deal())
    return u["id"], ex_id


def findings(client, uid):
    return client.get(f"/api/v1/uploads/{uid}/findings", headers=TAO).json()


def test_extraction_route_and_pass_param(client, pending):
    uid, ex1 = pending
    r = client.get(f"/api/v1/uploads/{uid}/extraction", headers=ANALYST)
    assert r.status_code == 200 and r.json()["id"] == ex1 and r.json()["pass"] == 1 and r.json()["deal"]["deal_slug"] == DEAL
    ex2 = worker_writes(uid, reference_deal(DEAL), pass_=2)
    assert client.get(f"/api/v1/uploads/{uid}/extraction", headers=TAO).json()["id"] == ex2
    assert client.get(f"/api/v1/uploads/{uid}/extraction", headers=TAO, params={"pass": 1}).json()["id"] == ex1
    assert client.get(f"/api/v1/uploads/{uid}/extraction", headers=TAO, params={"pass": 3}).status_code == 422
    assert client.get(f"/api/v1/uploads/{uid}/extraction", headers=INV).status_code == 403
    u = client.get(f"/api/v1/uploads/{uid}", headers=TAO).json()
    assert u["latest_extraction_id"] == ex2 and u["reporting_period"] == "2026-07"


def test_extraction_404_before_worker_runs(client):
    u = upload(client).json()
    assert client.get(f"/api/v1/uploads/{u['id']}/extraction", headers=TAO).status_code == 404
    assert client.get(f"/api/v1/uploads/{u['id']}/findings", headers=TAO).json() == []


def test_findings_route_and_counts(client, pending):
    uid, ex_id = pending
    fs = findings(client, uid)
    r05 = [f for f in fs if f["rule_id"] == "R05"]
    assert len(r05) == 1 and r05[0]["severity"] == "block" and r05[0]["extraction_id"] == ex_id and r05[0]["status"] == "open"
    assert abs(r05[0]["difference"] - (-100.0)) < 0.01 and r05[0]["our_value"] == 15020071.52 and r05[0]["report_value"] == 15019971.52
    assert r05[0]["targets"] == R05_TARGETS
    counts = client.get(f"/api/v1/uploads/{uid}", headers=TAO).json()["finding_counts"]
    assert counts["block"] == sum(1 for f in fs if f["severity"] == "block")
    assert client.get(f"/api/v1/uploads/{uid}/findings", headers=MGR).status_code == 403


def test_findings_validate_against_contract(client, pending):
    import jsonschema
    from conftest import ROOT
    schema = json.loads((ROOT / "contracts" / "finding.schema.json").read_text(encoding="utf-8"))
    for f in findings(client, pending[0]):
        jsonschema.validate(f, schema)


def test_approve_refused_while_block_open(client, pending):
    uid, _ = pending
    r = client.post(f"/api/v1/uploads/{uid}/approve", headers=TAO)
    assert r.status_code == 409 and r.json()["code"] == "open_block_findings" and "R05" in r.json()["message"]
    assert client.get(f"/api/v1/uploads/{uid}", headers=TAO).json()["status"] == "needs_review"


def test_override_resolves_reruns_and_audits(client, pending):
    uid, _ = pending
    r05 = next(f for f in findings(client, uid) if f["rule_id"] == "R05")
    assert client.post(f"/api/v1/uploads/{uid}/findings/{r05['id']}/override", headers=ANALYST,
                       json={"choice": "use_report", "reason": "servicer confirmed"}).status_code == 403
    assert client.post(f"/api/v1/uploads/{uid}/findings/{r05['id']}/override", headers=TAO,
                       json={"choice": "use_report", "reason": "x"}).status_code == 422
    r = client.post(f"/api/v1/uploads/{uid}/findings/{r05['id']}/override", headers=TAO,
                    json={"choice": "use_report", "reason": "servicer confirmed the closing balance"})
    assert r.status_code == 200, r.text
    after = {f["id"]: f for f in r.json()}
    assert after[r05["id"]]["status"] == "overridden"                       # same id survives the re-run
    res = after[r05["id"]]["resolution"]
    assert res["by"] == "tao_admin" and res["choice"] == "use_report" and res["reason"] == "servicer confirmed the closing balance"
    assert sum(1 for f in after.values() if f["rule_id"] == "R05") == 1      # re-run did not duplicate it
    again = client.post(f"/api/v1/uploads/{uid}/findings/{r05['id']}/override", headers=TAO, json={"choice": "acknowledge", "reason": "again"})
    assert again.status_code == 409 and again.json()["code"] == "not_open"
    audit = client.get("/api/v1/audit", headers=TAO, params={"upload_id": uid}).json()
    ov = [a for a in audit if a["action"] == "override"]
    assert len(ov) == 1 and ov[0]["finding_id"] == r05["id"] and ov[0]["reason"] == "servicer confirmed the closing balance"
    assert client.get(f"/api/v1/uploads/{uid}", headers=TAO).json()["finding_counts"]["block"] == 0


def test_restatement_choice_is_recorded_as_restate(client, pending):
    uid, _ = pending
    r05 = next(f for f in findings(client, uid) if f["rule_id"] == "R05")
    r = client.post(f"/api/v1/uploads/{uid}/findings/{r05['id']}/override", headers=TAO, json={"choice": "restatement", "reason": "prior month restated"})
    assert next(f for f in r.json() if f["id"] == r05["id"])["status"] == "accepted_as_restatement"
    assert [a["action"] for a in client.get("/api/v1/audit", headers=TAO, params={"upload_id": uid}).json()][0] == "restate"


def test_override_unknown_finding_404(client, pending):
    uid, _ = pending
    assert client.post(f"/api/v1/uploads/{uid}/findings/00000000-0000-4000-8000-000000000000/override", headers=TAO,
                       json={"choice": "acknowledge", "reason": "n/a"}).status_code == 404


def test_approve_publishes_and_regenerates(client, pending):
    uid, ex_id = pending
    r05 = next(f for f in findings(client, uid) if f["rule_id"] == "R05")
    client.post(f"/api/v1/uploads/{uid}/findings/{r05['id']}/override", headers=TAO, json={"choice": "use_report", "reason": "confirmed"})
    assert client.post(f"/api/v1/uploads/{uid}/approve", headers=ANALYST).status_code == 403
    r = client.post(f"/api/v1/uploads/{uid}/approve", headers=TAO)
    assert r.status_code == 200, r.text
    u = r.json()
    assert u["status"] == "published" and u["published_at"]
    with db.session() as s:
        pub = s.query(Publication).filter_by(upload_id=uid).one()
        assert pub.collection_period == "2026-08" and pub.published_by == "tao_admin" and pub.deal["deal_slug"] == DEAL
    actions = [a["action"] for a in client.get("/api/v1/audit", headers=TAO, params={"upload_id": uid}).json()]
    assert {"approve", "publish", "regenerate"} <= set(actions)
    approve_entry = next(a for a in client.get("/api/v1/audit", headers=TAO, params={"upload_id": uid}).json() if a["action"] == "approve")
    assert approve_entry["detail"]["overrides_used"] == [r05["id"]]
    d = client.get(f"/api/v1/published/programs/f-pil-2-0/deals/{DEAL}", headers=INV).json()
    assert d["upload_id"] == uid and d["published_by"] == "tao_admin" and d["published_at"]
    assert client.post(f"/api/v1/uploads/{uid}/approve", headers=TAO).status_code == 409          # already published
    again = upload(client, period="2026-08")
    assert again.status_code == 409 and again.json()["code"] == "already_published"                # R12 now holds


def test_use_ours_changes_published_value_and_records_corrections(client, pending):
    uid, _ = pending
    r05 = next(f for f in findings(client, uid) if f["rule_id"] == "R05")
    r = client.post(f"/api/v1/uploads/{uid}/findings/{r05['id']}/override", headers=TAO,
                    json={"choice": "use_ours", "reason": "page 2 principal re-read; roll-forward closes on ours"})
    assert r.status_code == 200 and next(f for f in r.json() if f["id"] == r05["id"])["targets"] == R05_TARGETS   # re-run keeps targets
    assert client.post(f"/api/v1/uploads/{uid}/approve", headers=TAO).status_code == 200
    d = client.get(f"/api/v1/published/programs/f-pil-2-0/deals/{DEAL}", headers=INV).json()
    assert d["tranche_balance"]["closing"] == 15020071.52 and d["period_history"][3]["closing_balance"] == 15020071.52
    assert d["tranche_balance"]["opening"] == reference_deal(DEAL)["tranche_balance"]["opening"]          # nothing else re-derived
    for ptr in R05_TARGETS:
        rec, *rest = ptr.strip("/").split("/")
        node = d[rec]
        for t in rest: node = node[int(t)] if t.isdigit() else node[t]
        assert node == 15020071.52, ptr
    corr = [c for c in d["data_corrections"] if c.get("finding_id") == r05["id"]]
    assert [(c["record"], c["field"]) for c in corr] == [("period_history", "3/closing_balance"), ("tranche_balance", "closing"),
                                                         ("period_history", "3/closing_amount"), ("tranche_amount", "closing"),
                                                         ("program", "program_amount")]
    for c in corr:
        assert c["old_value"] == 15019971.52 and c["new_value"] == 15020071.52 and c["period"] == "2026-08" and c["rule_id"] == "R05"
        assert c["choice"] == "use_ours" and c["reason"].startswith("page 2") and len(c["applied"]) == 10
    a = client.get("/api/v1/audit", headers=TAO, params={"upload_id": uid, "action": "approve"}).json()
    assert len(a) == 1 and len(a[0]["detail"]["corrections"]) == 5
    # the R05 identity holds on what was published: opening - components = the closing we wrote
    cur = d["period_history"][3]
    assert round(cur["opening_balance"] - cur["principal"] - cur["principal_prepayments"] - cur["losses"]
                 - (cur.get("charge_off") or 0) + (cur.get("new_funded") or 0) - (cur.get("ineligible_buyback") or 0), 2) == 15020071.52
    published = {k: v for k, v in d.items() if k not in ("published_at", "published_by", "upload_id", "published_period", "available_periods")}
    assert not [f for f in run({"meta": {"upload_id": uid}, "deal": published, "sources": {}}, Context(), phases=(1, 2))
                if f["rule_id"] == "R05"]
    with db.session() as s:                                                    # the extraction itself is untouched
        ex = s.query(Extraction).filter_by(upload_id=uid).one()
        assert ex.deal["tranche_balance"]["closing"] == 15019971.52


def test_use_report_with_same_value_writes_no_correction(client, pending):
    uid, _ = pending
    r05 = next(f for f in findings(client, uid) if f["rule_id"] == "R05")
    client.post(f"/api/v1/uploads/{uid}/findings/{r05['id']}/override", headers=TAO, json={"choice": "use_report", "reason": "servicer confirmed"})
    client.post(f"/api/v1/uploads/{uid}/approve", headers=TAO)
    d = client.get(f"/api/v1/published/programs/f-pil-2-0/deals/{DEAL}", headers=INV).json()
    assert d["tranche_balance"]["closing"] == 15019971.52 and not any(c.get("finding_id") for c in d.get("data_corrections") or [])


def test_value_choice_without_targets_is_409(client):
    u = upload(client, period="2026-08").json()
    worker_writes(u["id"], broken_deal(), targets=False)
    r05 = next(f for f in findings(client, u["id"]) if f["rule_id"] == "R05")
    assert "targets" not in r05
    for choice in ("use_ours", "use_report"):
        r = client.post(f"/api/v1/uploads/{u['id']}/findings/{r05['id']}/override", headers=TAO, json={"choice": choice, "reason": "try it"})
        assert r.status_code == 409 and r.json()["code"] == "no_target"
    assert client.post(f"/api/v1/uploads/{u['id']}/findings/{r05['id']}/override", headers=TAO,
                       json={"choice": "acknowledge", "reason": "known"}).status_code == 200


def _extra_finding(upload_id, **kw):
    """A finding the rules could raise on another field, added as the worker would (to stage overlaps)."""
    with db.session() as s:
        ex = s.query(Extraction).filter_by(upload_id=upload_id).one()
        f = Finding(extraction_id=ex.id, layer="covenant", severity="review", message="staged", status="open", **kw)
        s.add(f); s.commit()
        return f.id


def test_conflicting_corrections_refuse_approve(client, pending):
    uid, _ = pending
    r05 = next(f for f in findings(client, uid) if f["rule_id"] == "R05")
    other = _extra_finding(uid, rule_id="R17", fields=["/tranche_balance/closing"], targets=["/tranche_balance/closing"],
                           our_value=15000000.0, report_value=15019971.52)
    # staged finding first: a later re-run would close an open finding the rules do not raise themselves
    assert client.post(f"/api/v1/uploads/{uid}/findings/{other}/override", headers=TAO, json={"choice": "use_ours", "reason": "staged"}).status_code == 200
    assert client.post(f"/api/v1/uploads/{uid}/findings/{r05['id']}/override", headers=TAO, json={"choice": "use_ours", "reason": "page 2"}).status_code == 200
    r = client.post(f"/api/v1/uploads/{uid}/approve", headers=TAO)
    assert r.status_code == 409 and r.json()["code"] == "conflicting_corrections"
    assert r.json()["conflicts"][0]["pointer"] == "/tranche_balance/closing"
    assert client.get(f"/api/v1/uploads/{uid}", headers=TAO).json()["status"] == "needs_review"


def test_agreeing_corrections_write_once(client, pending):
    uid, _ = pending
    r05 = next(f for f in findings(client, uid) if f["rule_id"] == "R05")
    other = _extra_finding(uid, rule_id="R17", fields=["/tranche_amount/closing"], targets=["/tranche_amount/closing"],
                           our_value=15020071.52, report_value=15019971.52)
    assert client.post(f"/api/v1/uploads/{uid}/findings/{other}/override", headers=TAO, json={"choice": "use_ours", "reason": "same value"}).status_code == 200
    assert client.post(f"/api/v1/uploads/{uid}/findings/{r05['id']}/override", headers=TAO, json={"choice": "use_ours", "reason": "page 2"}).status_code == 200
    assert client.post(f"/api/v1/uploads/{uid}/approve", headers=TAO).status_code == 200
    d = client.get(f"/api/v1/published/programs/f-pil-2-0/deals/{DEAL}", headers=INV).json()
    assert [c["field"] for c in d["data_corrections"] if c.get("record") == "tranche_amount"] == ["closing"]


def test_correction_that_breaks_another_rule_refuses_approve(client, pending):
    uid, _ = pending
    r05 = next(f for f in findings(client, uid) if f["rule_id"] == "R05")
    bad = _extra_finding(uid, rule_id="R17", fields=["/tranche_balance/opening"], targets=["/tranche_balance/opening"],
                         our_value=1.0, report_value=15792784.34)
    assert client.post(f"/api/v1/uploads/{uid}/findings/{bad}/override", headers=TAO, json={"choice": "use_ours", "reason": "staged bad value"}).status_code == 200
    assert client.post(f"/api/v1/uploads/{uid}/findings/{r05['id']}/override", headers=TAO, json={"choice": "use_report", "reason": "servicer right"}).status_code == 200
    r = client.post(f"/api/v1/uploads/{uid}/approve", headers=TAO)
    assert r.status_code == 409 and r.json()["code"] == "correction_inconsistent", r.text
    assert r.json()["findings"] and all("rule_id" in f for f in r.json()["findings"])
    with db.session() as s:
        assert s.query(Publication).filter_by(upload_id=uid).count() == 0


def test_approve_clean_report(client):
    u = upload(client, period="2026-08").json()
    worker_writes(u["id"], reference_deal(DEAL))
    assert client.post(f"/api/v1/uploads/{u['id']}/approve", headers=TAO).json()["status"] == "published"


def test_approve_needs_review_state(client):
    u = upload(client).json()
    r = client.post(f"/api/v1/uploads/{u['id']}/approve", headers=TAO)
    assert r.status_code == 409 and r.json()["code"] == "bad_state"


def test_reextract_queues_pass_two(client, pending, queue):
    uid, _ = pending
    assert client.post(f"/api/v1/uploads/{uid}/reextract", headers=INV, json={"pages": [2]}).status_code == 403
    assert client.post(f"/api/v1/uploads/{uid}/reextract", headers=TAO, json={"pages": []}).status_code == 422
    assert client.post(f"/api/v1/uploads/{uid}/reextract", headers=TAO, json={"pages": [9]}).status_code == 422
    r = client.post(f"/api/v1/uploads/{uid}/reextract", headers=ANALYST, json={"pages": [2, 2, 3]})
    assert r.status_code == 202 and r.json()["status"] == "extracting"
    assert queue.jobs[-1] == {"upload_id": uid, "pass": 2, "pages": [2, 3]}
    assert client.post(f"/api/v1/uploads/{uid}/reextract", headers=TAO, json={"pages": [2]}).status_code == 409
    audit = client.get("/api/v1/audit", headers=TAO, params={"upload_id": uid}).json()
    assert audit[0]["action"] == "reextract" and audit[0]["detail"]["pages"] == [2, 3]


def test_reject(client, pending):
    uid, _ = pending
    assert client.post(f"/api/v1/uploads/{uid}/reject", headers=ANALYST, json={"reason": "wrong deal"}).status_code == 403
    assert client.post(f"/api/v1/uploads/{uid}/reject", headers=TAO, json={}).status_code == 422
    r = client.post(f"/api/v1/uploads/{uid}/reject", headers=TAO, json={"reason": "wrong deal on the cover"})
    assert r.status_code == 200 and r.json()["status"] == "rejected" and r.json()["reject_reason"] == "wrong deal on the cover"
    assert client.post(f"/api/v1/uploads/{uid}/reject", headers=TAO, json={"reason": "again"}).status_code == 409
    assert client.post(f"/api/v1/uploads/{uid}/approve", headers=TAO).status_code == 409
    a = client.get("/api/v1/audit", headers=TAO, params={"upload_id": uid}).json()[0]
    assert a["action"] == "reject" and a["reason"] == "wrong deal on the cover"
