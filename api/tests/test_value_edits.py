"""Wave B value edits while in review (contract ValueEdit): a TAO Admin changes one extracted number; the edit is stored
beside the extraction, the rules re-run with every edit in force, and approve writes the edit into the published deal with a
data_corrections row (choice manual). Fixture `pending`: Moneda 2026-08 with principal -100 on the current period row, so
R05 blocks (ours 15,020,071.52 vs report 15,019,971.52)."""
from conftest import TAO, ANALYST, INV, MGR, reference_deal
from test_review import pending, findings, worker_writes, DEAL, R05_TARGETS  # noqa: F401  (pending is a fixture)
from test_uploads import upload
from app import db
from app.models import Extraction

PRINCIPAL = "/period_history/3/principal"
FIX = "page 2 prints 646,926.71; extraction dropped 100"


def edit(client, uid, pointer=PRINCIPAL, value=646926.71, reason=FIX, h=TAO):
    return client.post(f"/api/v1/uploads/{uid}/edits", headers=h, json={"pointer": pointer, "value": value, "reason": reason})


def revert(client, uid, edit_id, reason="edit was keyed on the wrong row", h=TAO):
    return client.post(f"/api/v1/uploads/{uid}/edits/{edit_id}/revert", headers=h, json={"reason": reason})


def upload_of(client, uid):
    return client.get(f"/api/v1/uploads/{uid}", headers=TAO).json()


def test_edit_reruns_rules_and_audits(client, pending):
    uid, ex_id = pending
    assert upload_of(client, uid)["active_edit_count"] == 0 and upload_of(client, uid)["finding_counts"]["block"] >= 1
    r = edit(client, uid)
    assert r.status_code == 200, r.text
    out = r.json()
    e = out["edit"]
    assert e["pointer"] == PRINCIPAL and e["old_value"] == 646826.71 and e["new_value"] == 646926.71 and e["reason"] == FIX
    assert e["upload_id"] == uid and e["correction_id"] is None and e["actor_role"] == "tao_admin" and e["reverted_at"] is None
    assert out["finding_counts"]["block"] == 0                                                   # R05 closes on the edited value
    r05 = next(f for f in findings(client, uid) if f["rule_id"] == "R05")
    assert r05["status"] == "closed"
    u = upload_of(client, uid)
    assert u["active_edit_count"] == 1 and u["finding_counts"]["block"] == 0
    a = client.get("/api/v1/audit", headers=TAO, params={"upload_id": uid, "action": "value_edit"}).json()
    assert len(a) == 1 and a[0]["reason"] == FIX
    assert a[0]["detail"]["pointer"] == PRINCIPAL and a[0]["detail"]["old_value"] == 646826.71 and a[0]["detail"]["new_value"] == 646926.71
    with db.session() as s:                                                                      # the extraction row is not rewritten
        assert s.get(Extraction, ex_id).deal["period_history"][3]["principal"] == 646826.71
    listed = client.get(f"/api/v1/uploads/{uid}/edits", headers=ANALYST).json()                 # analysts read edits
    assert [x["id"] for x in listed] == [e["id"]]


def test_edit_validation(client, pending):
    uid, _ = pending
    for body, code in [({"pointer": "/no/such/field"}, 422), ({"pointer": "/deal_name"}, 422), ({"value": 646826.71}, 422),
                       ({"reason": "too short"}, 422), ({"pointer": "/contracts/top_movers/0/tranche", "value": 2.5}, 422),
                       ({"pointer": "relative/path"}, 422)]:
        kw = {"pointer": PRINCIPAL, "value": 646926.71, "reason": FIX} | body
        r = edit(client, uid, **kw)
        assert r.status_code == code and r.json()["code"] == "invalid", (body, r.text)
    assert edit(client, uid, h=ANALYST).status_code == 403
    assert edit(client, uid, h=INV).status_code == 403
    r = edit(client, uid, pointer="/contracts/top_movers/0/tranche", value=3)                    # a whole number stays whole
    assert r.status_code == 200 and r.json()["edit"]["new_value"] == 3
    assert client.get(f"/api/v1/uploads/{uid}/edits", headers=MGR).status_code == 403
    assert len(client.get(f"/api/v1/uploads/{uid}/edits", headers=TAO).json()) == 1


def test_edit_state_gate(client):
    u = upload(client).json()                                                                    # received: nothing to edit yet
    r = edit(client, u["id"])
    assert r.status_code == 409 and r.json()["code"] == "bad_state"
    u = upload(client, period="2026-08").json()
    worker_writes(u["id"], reference_deal(DEAL))
    assert client.post(f"/api/v1/uploads/{u['id']}/approve", headers=TAO).status_code == 200
    r = edit(client, u["id"], value=1.0)
    assert r.status_code == 409 and r.json()["code"] == "bad_state" and "correction" in r.json()["message"]


def test_revert_restores_and_audits(client, pending):
    uid, _ = pending
    e1 = edit(client, uid, value=646900.00, reason="first reading of page 2").json()["edit"]
    e2 = edit(client, uid, reason=FIX).json()["edit"]
    assert e2["old_value"] == 646900.00                                                          # old = the previous edit
    assert upload_of(client, uid)["active_edit_count"] == 1                                      # one pointer, one value in force
    r = revert(client, uid, e2["id"])
    assert r.status_code == 200 and r.json()["edit"]["reverted_at"] and r.json()["edit"]["reverted_by"] == "tao_admin"
    assert r.json()["finding_counts"]["block"] >= 1                                              # back to 646,900: R05 open again
    a = client.get("/api/v1/audit", headers=TAO, params={"upload_id": uid, "action": "value_edit_revert"}).json()
    assert len(a) == 1 and a[0]["detail"]["edit_id"] == e2["id"] and a[0]["detail"]["value_now"] == 646900.00
    assert a[0]["detail"]["edit_in_force_id"] == e1["id"]
    again = revert(client, uid, e2["id"])
    assert again.status_code == 409 and again.json()["code"] == "already_reverted"
    assert revert(client, uid, e1["id"], reason="x").status_code == 422
    assert revert(client, uid, e1["id"], h=ANALYST).status_code == 403
    assert revert(client, uid, "00000000-0000-4000-8000-000000000000").status_code == 404
    assert revert(client, uid, e1["id"]).status_code == 200
    assert upload_of(client, uid)["active_edit_count"] == 0
    r05 = next(f for f in findings(client, uid) if f["rule_id"] == "R05")
    assert r05["status"] == "open" and r05["our_value"] == 15020071.52                           # the extracted value again
    assert [x["id"] for x in client.get(f"/api/v1/uploads/{uid}/edits", headers=TAO).json()] == [e2["id"], e1["id"]]   # newest first


def test_approve_publishes_edit_with_manual_correction(client, pending):
    uid, _ = pending
    e = edit(client, uid).json()["edit"]
    r = client.post(f"/api/v1/uploads/{uid}/approve", headers=TAO)
    assert r.status_code == 200, r.text
    d = client.get(f"/api/v1/published/programs/f-pil-2-0/deals/{DEAL}", headers=INV).json()
    assert d["period_history"][3]["principal"] == 646926.71
    man = [c for c in d["data_corrections"] if c.get("choice") == "manual"]
    assert man == [{"period": "2026-08", "record": "period_history", "field": "3/principal", "old_value": 646826.71, "new_value": 646926.71,
                    "applied": man[0]["applied"], "reason": FIX, "choice": "manual", "edit_id": e["id"], "by": "tao_admin"}]
    a = client.get("/api/v1/audit", headers=TAO, params={"upload_id": uid, "action": "approve"}).json()[0]
    assert a["detail"]["value_edits"][0]["edit_id"] == e["id"]
    assert revert(client, uid, e["id"]).json()["code"] == "bad_state"                            # published: a correction now


def test_manual_edit_replaces_override_on_the_same_pointer(client, pending):
    """Risk R3: use_ours writes ours to every R05 target; a later manual edit on one of them wins there, the override still
    writes the others, and the audit keeps both the override and the edit."""
    uid, _ = pending
    r05 = next(f for f in findings(client, uid) if f["rule_id"] == "R05")
    assert client.post(f"/api/v1/uploads/{uid}/findings/{r05['id']}/override", headers=TAO,
                       json={"choice": "use_ours", "reason": "roll-forward closes on ours"}).status_code == 200
    ptr = "/program/program_amount"
    assert ptr in R05_TARGETS
    r = edit(client, uid, pointer=ptr, value=15020000.00, reason="facility statement on page 3 shows 15,020,000.00")
    assert r.status_code == 200, r.text
    e = r.json()["edit"]
    a = client.get("/api/v1/audit", headers=TAO, params={"upload_id": uid}).json()
    assert {"override", "value_edit"} <= {x["action"] for x in a}
    ve = next(x for x in a if x["action"] == "value_edit")
    assert ve["detail"]["replaces_override_finding_ids"] == [r05["id"]]
    assert client.post(f"/api/v1/uploads/{uid}/approve", headers=TAO).status_code == 200
    d = client.get(f"/api/v1/published/programs/f-pil-2-0/deals/{DEAL}", headers=INV).json()
    assert d["program"]["program_amount"] == 15020000.00                                        # the edit, not the override
    assert d["tranche_balance"]["closing"] == 15020071.52                                        # override still writes the rest
    rows = {(c["record"], c["field"]): c for c in d["data_corrections"] if c.get("choice") in ("manual", "use_ours")}
    assert rows[("program", "program_amount")]["choice"] == "manual" and rows[("program", "program_amount")]["edit_id"] == e["id"]
    assert rows[("tranche_balance", "closing")]["choice"] == "use_ours"
    assert len([c for c in d["data_corrections"] if c.get("record") == "program" and c.get("field") == "program_amount"]) == 1
    assert [x["action"] for x in client.get("/api/v1/audit", headers=TAO, params={"upload_id": uid}).json()
            if x["action"] in ("override", "value_edit")] == ["value_edit", "override"]               # both kept


def test_apply_overrides_skips_pointer_held_by_manual_edit():
    """R3 at the unit level: the override's other targets are written; the edited pointer is reported as replaced."""
    from app import review
    from app.models import Finding, ValueEdit
    deal = {"a": {"x": 1.0, "y": 1.0}}
    f = Finding(id="f1", rule_id="R05", status="overridden", targets=["/a/x", "/a/y"], our_value=2.0, report_value=1.0,
                resolution={"choice": "use_ours", "reason": "ours"})
    e = ValueEdit(id="e1", pointer="/a/x", new_value=3.0, reason="manual reading", actor_role="tao_admin")
    base = review.apply_edits(deal, {"/a/x": e})
    out, corr = review.apply_overrides(base, [f], "2026-08", manual={"/a/x": e})
    assert out["a"] == {"x": 3.0, "y": 2.0} and deal["a"] == {"x": 1.0, "y": 1.0}
    assert corr[0] == {"pointer": "/a/x", "finding_id": "f1", "rule_id": "R05", "choice": "use_ours", "applied": False,
                       "why": "replaced by a manual edit", "edit_id": "e1"}
    assert [(c["field"], c["choice"]) for c in corr[1:]] == [("y", "use_ours")]
    out, rows = review.manual_corrections(deal, out, {"/a/x": e}, "2026-08")
    assert [(c["field"], c["choice"], c["old_value"], c["new_value"], c["edit_id"]) for c in out["data_corrections"] if c["choice"] == "manual"] ==         [("x", "manual", 1.0, 3.0, "e1")]
