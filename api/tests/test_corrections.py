"""Wave B corrections after publish (contract Correction, decision B1): edits apply to the live published deal, the rules
re-run on it, and with no open block it publishes at once as version n+1 (the old version kept in publication_version);
otherwise it waits in the approval queue and the live version stays until approve or reject."""
import pytest
from conftest import TAO, ANALYST, INV, MGR, reference_deal, make_pdf
from test_review import worker_writes, DEAL
from test_uploads import upload
from app import db, review
from app.models import Correction, Publication, PublicationVersion, SetrepUpload

PERIOD = "2026-08"
INTEREST = "/period_history/3/interest"                 # read by no blocking rule: a clean correction
PRINCIPAL = "/period_history/3/principal"               # feeds R05: a correction that opens a block
WHY = "servicer restated interest in the 2026-09 cover letter"
DEAL_URL = f"/api/v1/published/programs/f-pil-2-0/deals/{DEAL}"


@pytest.fixture
def published(client):
    u = upload(client, period=PERIOD).json()
    worker_writes(u["id"], reference_deal(DEAL))
    assert client.post(f"/api/v1/uploads/{u['id']}/approve", headers=TAO).json()["status"] == "published"
    return u["id"]


def correct(client, uid, edits, reason=WHY, note=None, h=TAO):
    body = {"edits": [{"pointer": p, "value": v} for p, v in edits], "reason": reason}
    if note is not None:
        body["note_to_partners"] = note
    return client.post(f"/api/v1/uploads/{uid}/corrections", headers=h, json=body)


def test_clean_correction_publishes_next_version(client, published):
    uid = published
    r = correct(client, uid, [(INTEREST, 86705.51)], note="Interest for August restated by the servicer.")
    assert r.status_code == 200, r.text
    k = r.json()
    assert k["status"] == "published" and k["version"] == 2 and k["finding_counts"]["block"] == 0, k
    assert k["deal_slug"] == DEAL and k["collection_period"] == PERIOD and k["created_by"] == "tao_admin" and k["decided_by"] == "tao_admin"
    assert k["note_to_partners"] == "Interest for August restated by the servicer." and k["reason"] == WHY
    [e] = k["edits"]
    assert e["pointer"] == INTEREST and e["old_value"] == 86704.51 and e["new_value"] == 86705.51 and e["correction_id"] == k["id"]
    for h in (INV, MGR):
        d = client.get(DEAL_URL, headers=h).json()
        assert d["version"] == 2 and d["period_history"][3]["interest"] == 86705.51
        assert [(v["version"], v["current"], v["correction_id"]) for v in d["versions"]] == [(1, False, None), (2, True, k["id"])]
        assert d["versions"][1]["reason"] == WHY
    old = client.get(DEAL_URL, headers=INV, params={"version": 1}).json()
    assert old["version"] == 1 and old["period_history"][3]["interest"] == 86704.51 and old["upload_id"] == uid
    assert not [c for c in old.get("data_corrections") or [] if c.get("choice") == "manual"]
    assert client.get(DEAL_URL, headers=INV, params={"version": 3}).status_code == 404
    assert client.get(DEAL_URL, headers=INV, params={"version": 0}).status_code == 422
    u = client.get(f"/api/v1/uploads/{uid}", headers=TAO).json()
    assert u["published_version"] == 2 and u["pending_correction_id"] is None and u["active_edit_count"] == 0
    acts = [a["action"] for a in client.get("/api/v1/audit", headers=TAO, params={"upload_id": uid}).json()]
    assert acts[:3] == ["regenerate", "publish", "correction"]
    c_entry = client.get("/api/v1/audit", headers=TAO, params={"upload_id": uid, "action": "correction"}).json()[0]
    assert c_entry["reason"] == WHY and c_entry["detail"]["edits"] == [{"pointer": INTEREST, "old_value": 86704.51, "new_value": 86705.51}]
    assert client.get("/api/v1/audit", headers=TAO, params={"upload_id": uid, "action": "publish"}).json()[0]["detail"]["version"] == 2
    assert [x["id"] for x in client.get("/api/v1/corrections", headers=ANALYST, params={"status": "published"}).json()] == [k["id"]]
    assert [x["id"] for x in client.get(f"/api/v1/uploads/{uid}/corrections", headers=ANALYST).json()] == [k["id"]]
    assert [x["correction_id"] for x in client.get(f"/api/v1/uploads/{uid}/edits", headers=TAO).json()] == [k["id"]]
    with db.session() as s:
        pub = s.query(Publication).one()
        assert pub.version == 2 and pub.rollup_version == 2 and pub.correction_id == k["id"]
        assert [(v.version, v.upload_id) for v in s.query(PublicationVersion).all()] == [(1, uid)]
    # a second correction becomes version 3
    assert correct(client, uid, [(INTEREST, 86704.51)], reason="servicer withdrew the interest restatement").json()["version"] == 3
    assert [v["version"] for v in client.get(DEAL_URL, headers=INV).json()["versions"]] == [1, 2, 3]


def test_data_corrections_shape_for_the_partner_page(client, published):
    """UI-Partner groups rows by edit_id and labels them "Corrected by TAO · version n"."""
    k = correct(client, published, [(INTEREST, 86705.51), ("/period_history/3/recoveries", 64171.0)]).json()
    rows = [c for c in client.get(DEAL_URL, headers=INV).json()["data_corrections"] if c.get("choice") == "manual"]
    ids = {e["pointer"]: e["id"] for e in k["edits"]}
    assert len(rows) == 2
    for row, (ptr, old, new) in zip(rows, [(INTEREST, 86704.51, 86705.51), ("/period_history/3/recoveries", 64170.0, 64171.0)]):
        assert {"period", "record", "field", "old_value", "new_value", "applied", "reason", "choice", "edit_id", "version", "correction_id"} <= set(row)
        assert row["period"] == PERIOD and row["record"] == "period_history" and row["field"] == ptr.split("/", 2)[2]
        assert row["old_value"] == old and row["new_value"] == new and row["reason"] == WHY and len(row["applied"]) == 10
        assert row["choice"] == "manual" and row["edit_id"] == ids[ptr] and row["version"] == 2 and row["correction_id"] == k["id"]


def test_blocking_correction_waits_in_queue_then_reject(client, published):
    uid = published
    r = correct(client, uid, [(PRINCIPAL, 646826.71)], reason="principal re-read on page 2 as 646,826.71")
    assert r.status_code == 200, r.text
    k = r.json()
    assert k["status"] == "needs_review" and k["version"] == 2 and k["finding_counts"]["block"] >= 1 and k["decided_at"] is None
    d = client.get(DEAL_URL, headers=INV).json()
    assert d["version"] == 1 and d["period_history"][3]["principal"] == 646926.71                 # live version stays
    assert client.get(f"/api/v1/uploads/{uid}", headers=TAO).json()["pending_correction_id"] == k["id"]
    again = correct(client, uid, [(INTEREST, 86705.51)])
    assert again.status_code == 409 and again.json()["code"] == "correction_pending"
    assert [x["id"] for x in client.get("/api/v1/corrections", headers=TAO, params={"status": "needs_review"}).json()] == [k["id"]]
    one = client.get(f"/api/v1/corrections/{k['id']}", headers=ANALYST).json()
    assert any(f["rule_id"] == "R05" and f["severity"] == "block" and f["status"] == "open" for f in one["findings"])
    r = client.post(f"/api/v1/corrections/{k['id']}/approve", headers=TAO)
    assert r.status_code == 409 and r.json()["code"] == "open_block_findings" and "R05" in r.json()["message"]
    assert client.post(f"/api/v1/corrections/{k['id']}/approve", headers=ANALYST).status_code == 403
    assert client.post(f"/api/v1/corrections/{k['id']}/reject", headers=TAO, json={}).status_code == 422
    r = client.post(f"/api/v1/corrections/{k['id']}/reject", headers=TAO, json={"reason": "R05 does not close; ask the servicer"})
    assert r.status_code == 200 and r.json()["status"] == "rejected" and r.json()["reject_reason"] == "R05 does not close; ask the servicer"
    assert client.post(f"/api/v1/corrections/{k['id']}/reject", headers=TAO, json={"reason": "again"}).json()["code"] == "bad_state"
    assert client.post(f"/api/v1/corrections/{k['id']}/approve", headers=TAO).json()["code"] == "bad_state"
    a = client.get("/api/v1/audit", headers=TAO, params={"upload_id": uid, "action": "correction_reject"}).json()
    assert len(a) == 1 and a[0]["detail"]["correction_id"] == k["id"]
    assert client.get(DEAL_URL, headers=INV).json()["version"] == 1
    assert client.get(f"/api/v1/uploads/{uid}", headers=TAO).json()["pending_correction_id"] is None
    assert correct(client, uid, [(INTEREST, 86705.51)]).json()["status"] == "published"            # free again
    assert client.get(f"/api/v1/corrections/00000000-0000-4000-8000-000000000000", headers=TAO).status_code == 404


def test_queued_correction_approve(client, published):
    """Approve re-runs the rules; once nothing blocks it publishes the queued version (the block is cleared here in the
    stored corrected deal, standing in for a change of master data or prior month)."""
    uid = published
    k = correct(client, uid, [(PRINCIPAL, 646826.71)], reason="principal re-read on page 2 as 646,826.71").json()
    with db.session() as s:                                                         # stale-version guard first
        s.query(Publication).one().version = 5; s.commit()
    assert client.post(f"/api/v1/corrections/{k['id']}/approve", headers=TAO).json()["code"] == "bad_state"
    with db.session() as s:
        s.query(Publication).one().version = 1
        row = s.get(Correction, k["id"])
        deal = dict(row.deal)
        ph = [dict(p) for p in deal["period_history"]]
        ph[3]["principal"] = 646926.71
        deal["period_history"] = ph
        row.deal = deal
        s.commit()
    r = client.post(f"/api/v1/corrections/{k['id']}/approve", headers=TAO)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "published" and r.json()["decided_by"] == "tao_admin"
    assert client.get(DEAL_URL, headers=INV).json()["version"] == 2
    acts = [a["action"] for a in client.get("/api/v1/audit", headers=TAO, params={"upload_id": uid}).json()]
    assert acts[:3] == ["regenerate", "publish", "correction_approve"]


def test_correction_gates(client, published):
    uid = published
    assert correct(client, uid, [(INTEREST, 1.0)], h=ANALYST).status_code == 403
    assert correct(client, uid, [(INTEREST, 1.0)], h=INV).status_code == 403
    assert correct(client, uid, [(INTEREST, 1.0)], reason="short").status_code == 422
    for edits in ([("/nope", 1.0)], [("/deal_name", 1.0)], [(INTEREST, 86704.51)], [(INTEREST, 1.0), (INTEREST, 2.0)]):
        r = correct(client, uid, edits)
        assert r.status_code == 422 and r.json()["code"] == "invalid", edits
    assert client.post(f"/api/v1/uploads/{uid}/corrections", headers=TAO, json={"edits": [], "reason": WHY}).status_code == 422
    pending = upload(client, period="2026-09").json()
    r = correct(client, pending["id"], [(INTEREST, 1.0)])
    assert r.status_code == 409 and r.json()["code"] == "bad_state"
    assert client.get("/api/v1/corrections", headers=TAO).json() == []


def test_reissue_archives_a_version_and_blocks_corrections_of_the_old_upload(client, published):
    new = client.post("/api/v1/uploads", headers=TAO, data={"deal_slug": DEAL, "collection_period": PERIOD, "replace": "true"},
                      files={"file": ("Moneda-202608 -SETTREP.pdf", make_pdf(3), "application/pdf")}).json()
    d = reference_deal(DEAL); d["source_file"] = "Moneda-202608 -SETTREP (corrected).pdf"
    worker_writes(new["id"], d)
    assert client.post(f"/api/v1/uploads/{new['id']}/approve", headers=TAO).status_code == 200
    dd = client.get(DEAL_URL, headers=INV).json()
    assert dd["version"] == 2 and [(v["version"], v["reason"]) for v in dd["versions"]] == [(1, None), (2, "corrected re-issue")]
    assert client.get(DEAL_URL, headers=INV, params={"version": 1}).json()["upload_id"] == published
    assert client.get(f"/api/v1/uploads/{published}", headers=TAO).json()["published_version"] == 1
    assert client.get(f"/api/v1/uploads/{new['id']}", headers=TAO).json()["published_version"] == 2
    r = correct(client, published, [(INTEREST, 86705.51)])
    assert r.status_code == 409 and r.json()["code"] == "bad_state" and "re-issue" in r.json()["message"]
    assert correct(client, new["id"], [(INTEREST, 86705.51)]).json()["version"] == 3


def test_correction_changes_the_prior_next_month_sees(client, published):
    """Risk R4: a correction of month N is the prior of month N+1's review, and N+1's open review is re-run."""
    nxt = upload(client, period="2026-09").json()
    worker_writes(nxt["id"], reference_deal(DEAL))
    with db.session() as s:
        assert review.build_context(s, s.get(SetrepUpload, nxt["id"])).prior["period_history"][3]["interest"] == 86704.51
    k = correct(client, published, [(INTEREST, 86705.51)]).json()
    assert k["status"] == "published"
    with db.session() as s:
        prior = review.build_context(s, s.get(SetrepUpload, nxt["id"])).prior
        assert prior["period_history"][3]["interest"] == 86705.51
        assert any(c.get("correction_id") == k["id"] for c in prior["data_corrections"])
    pub = client.get("/api/v1/audit", headers=TAO, params={"upload_id": published, "action": "publish"}).json()[0]
    assert pub["detail"]["rerun_upload_ids"] == [nxt["id"]]


def test_audit_detail_shape_for_the_audit_page(client, published):
    want = [{"pointer": PRINCIPAL, "old_value": 646926.71, "new_value": 646826.71}]
    k = correct(client, published, [(PRINCIPAL, 646826.71)], reason="principal re-read on page 2 as 646,826.71").json()
    client.post(f"/api/v1/corrections/{k['id']}/reject", headers=TAO, json={"reason": "R05 does not close"})
    k2 = correct(client, published, [(INTEREST, 86705.51)]).json()
    a = client.get("/api/v1/audit", headers=TAO, params={"upload_id": published}).json()
    rej = next(x for x in a if x["action"] == "correction_reject")["detail"]
    assert rej["edits"] == want and rej["version"] == 2
    first = [x for x in a if x["action"] == "correction"][-1]["detail"]
    assert first["edits"] == want and first["version"] == 2
    assert [x for x in a if x["action"] == "correction"][0]["detail"]["edits"] == [{"pointer": INTEREST, "old_value": 86704.51, "new_value": 86705.51}]
    k3 = correct(client, published, [(PRINCIPAL, 646826.71)], reason="principal re-read on page 2 as 646,826.71").json()
    with db.session() as s:                                     # clear the block in the stored deal, as in test_queued_correction_approve
        row = s.get(Correction, k3["id"]); deal = dict(row.deal); ph = [dict(p) for p in deal["period_history"]]
        ph[3]["principal"] = 646926.71; deal["period_history"] = ph; row.deal = deal; s.commit()
    assert client.post(f"/api/v1/corrections/{k3['id']}/approve", headers=TAO).status_code == 200
    appr = client.get("/api/v1/audit", headers=TAO, params={"upload_id": published, "action": "correction_approve"}).json()[0]["detail"]
    assert appr["edits"] == want and appr["version"] == k2["version"] + 1
