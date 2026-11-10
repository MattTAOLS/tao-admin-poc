"""Fixes from the application-wide bug audit (docs/audit/tao-admin-poc-bug-audit_Report_v1.md), one section per audit id."""
import copy, json
import pytest
from sqlalchemy import select
from conftest import TAO, ANALYST, INV, MGR, reference_deal, make_pdf
from test_review import worker_writes, findings, DEAL
from test_uploads import upload
from app import db, review
from app.models import (Extraction, Finding, SetrepUpload, Publication, PublicationVersion, Notification, ReviewAction, Program, Deal,
                        Partner)

API = "/api/v1"


def publish(client, period, deal=None):
    u = upload(client, period=period).json()
    worker_writes(u["id"], deal or reference_deal(DEAL))
    r = client.post(f"{API}/uploads/{u['id']}/approve", headers=TAO)
    assert r.status_code == 200 and r.json()["status"] == "published", r.text
    return u["id"]


def in_review(client, period, deal):
    """An upload in needs_review whose findings were produced with the real context (prior = the published month before)."""
    u = upload(client, period=period).json()
    worker_writes(u["id"], deal)
    with db.session() as s:
        up = s.get(SetrepUpload, u["id"])
        review.rerun(s, up, s.scalars(select(Extraction).where(Extraction.upload_id == up.id)).one())
        s.commit()
    return u["id"]


def open_blocks(client, uid, rule=None):
    return [f for f in findings(client, uid) if f["severity"] == "block" and f["status"] == "open" and (rule is None or f["rule_id"] == rule)]


def acknowledge_blocks(client, uid, keep=None):
    for f in open_blocks(client, uid):
        if f["id"] != keep:
            r = client.post(f"{API}/uploads/{uid}/findings/{f['id']}/override", headers=TAO, json={"choice": "acknowledge", "reason": "fixture noise"})
            assert r.status_code == 200, r.text


# ---- H1: a resolution stays with its own finding ----
def restated_twice():
    """The Moneda August object with one deliberate change: total equity restated for Jun-26 and for Jul-26."""
    d = reference_deal(DEAL)
    for row in d["ratio_history"][-2:]:
        row["total_equity"] += 1000.0
    return d


def test_h1_resolution_does_not_move_to_another_finding_of_the_same_rule(client):
    publish(client, "2026-08")
    uid = in_review(client, "2026-09", restated_twice())
    r11 = sorted((f for f in open_blocks(client, uid, "R11") if f["context"].get("restatement")), key=lambda f: f["context"]["month"])
    assert [f["context"]["month"] for f in r11] == ["2026-06", "2026-07"] and r11[0]["fields"] == r11[1]["fields"]
    first, second = r11
    r = client.post(f"{API}/uploads/{uid}/findings/{first['id']}/override", headers=TAO,
                    json={"choice": "restatement", "reason": "servicer restated June equity"})
    assert r.status_code == 200, r.text
    n = len(reference_deal(DEAL)["ratio_history"])
    r = client.post(f"{API}/uploads/{uid}/edits", headers=TAO, json={"pointer": f"/ratio_history/{n - 2}/total_equity", "value": 6839888.0,
                                                                     "reason": "June equity re-read from page 9: not restated"})
    assert r.status_code == 200, r.text
    by_id = {f["id"]: f for f in findings(client, uid)}
    assert by_id[second["id"]]["status"] == "open" and by_id[second["id"]]["resolution"] is None      # never reviewed
    assert by_id[first["id"]]["context"]["month"] == "2026-06"                                        # the acceptance did not move
    assert [f["id"] for f in open_blocks(client, uid, "R11") if f["context"].get("restatement")] == [second["id"]]
    acknowledge_blocks(client, uid, keep=second["id"])                     # every other block resolved: only the second holds
    r = client.post(f"{API}/uploads/{uid}/approve", headers=TAO)
    assert r.status_code == 409 and r.json()["code"] == "open_block_findings" and r.json()["message"].startswith("1 block") and "R11" in r.json()["message"]


def test_h1_finding_key_tells_findings_of_one_rule_apart():
    a = {"rule_id": "R11", "fields": ["/period_history"], "context": {"month": "2026-06", "field": "ratio_history.total_equity", "value": 1.0}}
    b = {**a, "context": {**a["context"], "month": "2026-07"}}
    same = {**a, "context": {**a["context"], "value": 2.0}}                # the numbers changed, the finding is the same one
    assert review.finding_key(a) != review.finding_key(b) and review.finding_key(a) == review.finding_key(same)
    stored = Finding(rule_id="R11", fields=["/period_history"], context=dict(a["context"]))
    assert review.finding_key(stored) == review.finding_key(a)
    assert review.finding_key({"rule_id": "R05", "fields": None, "context": None}) == ("R05", (), ())


def test_h1_correction_keeps_a_review_resolution_on_its_own_finding_only(client):
    """A correction re-runs the rules on the published deal: the restatement accepted in review stays accepted, the
    other restatement of the same rule (never resolved) is open on the correction."""
    publish(client, "2026-08")
    uid = in_review(client, "2026-09", restated_twice())
    with db.session() as s:
        up = s.get(SetrepUpload, uid)
        ex = s.scalars(select(Extraction).where(Extraction.upload_id == uid)).one()
        fs = s.scalars(select(Finding).where(Finding.extraction_id == ex.id)).all()
        june = next(f for f in fs if f.rule_id == "R11" and (f.context or {}).get("month") == "2026-06")
        review.resolve(june, "restatement", "servicer restated June equity", "tao_admin")
        s.flush()
        out = review.correction_findings(s, up, ex.deal)
        r11 = {f["context"]["month"]: f for f in out if f["rule_id"] == "R11" and f["context"].get("restatement")}
        assert r11["2026-06"]["status"] == "accepted_as_restatement" and r11["2026-07"]["status"] == "open"
        # the correction's own stored findings: an override on one is not carried to the other on the re-run
        mine = [dict(f, id=f"k{i}") for i, f in enumerate(out)]
        july = next(f for f in mine if f["rule_id"] == "R11" and f["context"].get("month") == "2026-07")
        july["status"], july["resolution"] = "overridden", {"choice": "acknowledge"}
        deal = copy.deepcopy(ex.deal)
        deal["ratio_history"][-1]["total_equity"] -= 1000.0                # July no longer restated; June still is
        again = review.correction_findings(s, up, deal, previous=mine)
        left = [f for f in again if f["rule_id"] == "R11" and f["context"].get("restatement")]
        assert [(f["context"]["month"], f["status"]) for f in left] == [("2026-06", "accepted_as_restatement")]
        s.rollback()
