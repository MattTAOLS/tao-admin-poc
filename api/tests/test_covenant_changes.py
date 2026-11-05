"""Wave B covenant changes (contract CovenantChange): never an in-place update. correct supersedes the current row and
inserts its replacement; new_version inserts a later effective_from; add inserts a new legal_ref. Each writes a master_change
entry with before / after and the reason, and re-runs the rules on the deal's uploads in needs_review. The seed supersedes
only its own rows (risk R11)."""
import json
from conftest import TAO, ANALYST, reference_deal
from test_review import pending, worker_writes, findings, DEAL  # noqa: F401  (pending is a fixture)
from test_uploads import upload
from app import db, seed
from app.models import CovenantDefinition, Publication

M = "/api/v1/master/covenants"
WHY = "Amendment 3 lowers the delinquency ceiling"


def rows(client, **params):
    return client.get(M, headers=TAO, params={"deal_slug": DEAL, **params}).json()


def ref(rs, legal_ref):
    return [r for r in rs if r["legal_ref"] == legal_ref]


def put(client, body, h=TAO):
    return client.put(M, headers=h, json=body)


def test_correct_supersedes_and_keeps_history(client):
    e = ref(rows(client), "SLFA 9.1 (e)")[0]
    assert e["origin"] == "seed" and e["superseded_at"] is None and e["changed_by"] is None
    r = put(client, dict(e, threshold=0.04, mode="correct", reason="the record was keyed as 3.5%; SLFA says 4%"))
    assert r.status_code == 200, r.text
    out = r.json()
    new = out["definition"]
    assert out["superseded_id"] == e["id"] and new["id"] != e["id"] and new["supersedes_id"] == e["id"]
    assert new["threshold"] == 0.04 and new["effective_from"] == e["effective_from"] and new["origin"] == "ui"
    assert new["changed_by"] == "tao_admin" and new["change_reason"] == "the record was keyed as 3.5%; SLFA says 4%"
    assert out["rerun_upload_ids"] == []
    assert [x["id"] for x in ref(rows(client), "SLFA 9.1 (e)")] == [new["id"]]                    # current rows only
    hist = ref(rows(client, include_history="true"), "SLFA 9.1 (e)")
    assert {x["id"] for x in hist} == {e["id"], new["id"]}
    old = next(x for x in hist if x["id"] == e["id"])
    assert old["superseded_at"] and old["threshold"] == 0.035                                        # the old row is untouched
    assert ref(rows(client, as_of="2026-08-31"), "SLFA 9.1 (e)")[0]["id"] == new["id"]
    assert len(ref(rows(client, as_of="2026-08-31", include_history="true"), "SLFA 9.1 (e)")) == 2
    a = client.get("/api/v1/audit", headers=TAO, params={"action": "master_change"}).json()[0]
    assert a["reason"] == "the record was keyed as 3.5%; SLFA says 4%" and a["upload_id"] is None
    d = a["detail"]
    assert d["entity"] == "covenant_definition" and d["mode"] == "correct" and d["key"] == new["id"] and d["superseded_id"] == e["id"]
    assert d["before"]["threshold"] == 0.035 and d["after"]["threshold"] == 0.04 and a["deal_slug"] == DEAL
    # the superseded row cannot be corrected again; the current one can
    again = put(client, dict(e, threshold=0.045, mode="correct", reason="another fix to the same row"))
    assert again.status_code == 409 and again.json()["code"] == "not_current"
    assert put(client, dict(new, threshold=0.045, mode="correct", reason="another fix to the same row")).status_code == 200


def test_correct_validation(client):
    e = ref(rows(client), "SLFA 9.1 (e)")[0]
    body = dict(e, mode="correct", reason=WHY)
    assert put(client, {k: v for k, v in body.items() if k != "id"}).status_code == 422                        # needs the id
    assert put(client, dict(body, id="00000000-0000-4000-8000-000000000000")).status_code == 404
    r = put(client, dict(body, effective_from="2025-01-01"))
    assert r.status_code == 422 and "new_version" in r.json()["message"]
    assert put(client, dict(body, legal_ref="SLFA 9.1 (f)")).status_code == 422                               # fixed on a correction
    assert put(client, dict(body, reason="too short")).status_code == 422                                      # B6: 10 characters
    assert put(client, dict(body, reason="          x")).status_code == 422                                     # spaces do not count
    assert put(client, {k: v for k, v in body.items() if k != "mode"}).status_code == 422
    assert put(client, dict(body, mode="upsert")).status_code == 422
    assert put(client, body, h=ANALYST).status_code == 403
    assert len(ref(rows(client, include_history="true"), "SLFA 9.1 (e)")) == 1                                 # nothing written


def test_new_version_must_be_later(client):
    e = ref(rows(client), "SLFA 9.1 (e)")[0]
    body = {k: v for k, v in e.items() if k != "id"} | {"mode": "new_version", "reason": WHY, "threshold": 0.03}
    for when in (e["effective_from"], "2020-01-01"):
        r = put(client, dict(body, effective_from=when))
        assert r.status_code == 409 and r.json()["code"] == "effective_not_later"
    r = put(client, dict(body, effective_from="2027-01-01"))
    assert r.status_code == 200 and r.json()["superseded_id"] is None and r.json()["definition"]["supersedes_id"] is None
    assert put(client, dict(body, effective_from="2026-12-01")).json()["code"] == "effective_not_later"      # now later than 2027 only
    in_force = {d: ref(rows(client, as_of=d), "SLFA 9.1 (e)")[0]["threshold"] for d in ("2026-12-31", "2027-01-31")}
    assert in_force == {"2026-12-31": 0.035, "2027-01-31": 0.03}                                               # past periods keep theirs
    a = client.get("/api/v1/audit", headers=TAO, params={"action": "master_change"}).json()[0]["detail"]
    assert a["mode"] == "new_version" and a["before"]["id"] == e["id"] and a["after"]["effective_from"] == "2027-01-01"
    r = put(client, dict(body, legal_ref="SLFA 99", effective_from="2027-01-01"))
    assert r.status_code == 422 and "mode=add" in r.json()["message"]


def test_add_new_legal_ref_only(client):
    e = ref(rows(client), "SLFA 9.1 (e)")[0]
    body = {k: v for k, v in e.items() if k != "id"} | {"mode": "add", "reason": "covenant 9.1 (k) from Amendment 3"}
    r = put(client, body)
    assert r.status_code == 409 and r.json()["code"] == "exists"
    r = put(client, dict(body, legal_ref="SLFA 9.1 (k)", description="Minimum liquidity", kind="floor", threshold=1000000.0, unit="currency"))
    assert r.status_code == 200, r.text
    d = r.json()["definition"]
    assert d["origin"] == "ui" and d["legal_ref"] == "SLFA 9.1 (k)" and d["change_reason"] == "covenant 9.1 (k) from Amendment 3"
    assert ref(rows(client), "SLFA 9.1 (k)")[0]["id"] == d["id"]
    assert client.get("/api/v1/audit", headers=TAO, params={"action": "master_change"}).json()[0]["detail"]["before"] is None


def test_change_reruns_open_reviews_r14(client, pending):
    uid, ex_id = pending
    assert not [f for f in findings(client, uid) if f["rule_id"] == "R14"]
    other = upload(client, period="2026-09", deal="f-pil-2-0-stride-capital").json()                           # another deal: not re-run
    e = ref(rows(client), "SLFA 9.1 (e)")[0]
    r = put(client, dict(e, threshold=0.04, mode="correct", reason="the record was keyed as 3.5%; SLFA says 4%"))
    assert r.json()["rerun_upload_ids"] == [uid] and other["id"] not in r.json()["rerun_upload_ids"]
    r14 = [f for f in findings(client, uid) if f["rule_id"] == "R14" and f["status"] == "open"]
    assert len(r14) == 1 and r14[0]["our_value"] == 0.04 and r14[0]["report_value"] == 0.035
    assert r14[0]["context"]["legal_ref"] == "SLFA 9.1 (e)"
    # a new version from next year does not touch the August review: R14 stays as it was
    put(client, {k: v for k, v in r.json()["definition"].items() if k != "id"} | {"mode": "new_version", "reason": WHY, "effective_from": "2027-01-01",
                                                                                  "threshold": 0.03})
    r14 = [f for f in findings(client, uid) if f["rule_id"] == "R14" and f["status"] == "open"]
    assert len(r14) == 1 and r14[0]["our_value"] == 0.04


def test_published_periods_are_not_touched(client):
    u = upload(client, period="2026-08").json()
    worker_writes(u["id"], reference_deal(DEAL))
    assert client.post(f"/api/v1/uploads/{u['id']}/approve", headers=TAO).status_code == 200
    with db.session() as s:
        before = s.query(Publication).one().deal
    e = ref(rows(client), "SLFA 9.1 (e)")[0]
    r = put(client, dict(e, threshold=0.04, mode="correct", reason="the record was keyed as 3.5%; SLFA says 4%"))
    assert r.json()["rerun_upload_ids"] == []
    with db.session() as s:
        pub = s.query(Publication).one()
        assert pub.deal == before and pub.version == 1


def test_seed_rerun_keeps_ui_changes(client, tmp_path):
    """R11: corrected, versioned and added rows survive a seed run; the seed still supersedes its own rows."""
    e = ref(rows(client), "SLFA 9.1 (e)")[0]
    corrected = put(client, dict(e, threshold=0.04, mode="correct", reason="the record was keyed as 3.5%; SLFA says 4%")).json()["definition"]
    h = ref(rows(client), "SLFA 9.1 (h)")[0]
    later = put(client, {k: v for k, v in h.items() if k != "id"} | {"mode": "new_version", "reason": WHY, "effective_from": "2027-01-01",
                                                                   "threshold": 1.2}).json()["definition"]
    added = put(client, {k: v for k, v in e.items() if k != "id"} | {"mode": "add", "reason": "covenant 9.1 (k) from Amendment 3",
                                                                   "legal_ref": "SLFA 9.1 (k)"}).json()["definition"]
    before = {r["id"] for r in rows(client)}
    with db.session() as s:
        assert seed.load(s)["covenant_definitions_superseded"] == 0
    assert {r["id"] for r in rows(client)} == before                                         # nothing re-inserted, nothing superseded
    assert ref(rows(client), "SLFA 9.1 (e)")[0]["id"] == corrected["id"]
    assert {later["id"], added["id"]} <= before
    # a changed seed file supersedes the seed row it changed, never a ui row
    root = tmp_path / "seed"
    root.mkdir()
    for f in seed.SEED.glob("*.json"):
        (root / f.name).write_text(f.read_text(encoding="utf-8"), encoding="utf-8")
    data = json.loads((root / "covenant_definitions.json").read_text(encoding="utf-8"))
    for r in data:
        if r["deal_slug"] == DEAL and r["legal_ref"] in ("SLFA 9.1 (h)", "SLFA 9.1 (e)"):
            r["source"] = "re-keyed"
    (root / "covenant_definitions.json").write_text(json.dumps(data), encoding="utf-8")
    with db.session() as s:
        assert seed.load(s, root)["covenant_definitions_superseded"] == 1                    # 9.1 (h) seed row only
        cur = s.query(CovenantDefinition).filter_by(deal_slug=DEAL, superseded_at=None).all()
        by = {}
        for c in cur:
            by.setdefault(c.legal_ref, []).append(c)
        assert [c.id for c in by["SLFA 9.1 (e)"]] == [corrected["id"]]                     # the ui correction holds the slot
        assert sorted((c.origin, c.source == "re-keyed") for c in by["SLFA 9.1 (h)"]) == [("seed", True), ("ui", False)]
        assert [c.id for c in by["SLFA 9.1 (k)"]] == [added["id"]]


def test_context_carries_covenants_recorded(client):
    """Parity with worker/validate (Rules b66f61e): master.covenants_recorded = the deal's current definitions at any date,
    so R14 tells "none recorded" (one note) from "not in force yet" (Stride December 2025: one note per covenant)."""
    from app import review
    from app.models import SetrepUpload
    with db.session() as s:
        def ctx(deal, period):
            u = SetrepUpload(deal_slug=deal, collection_period=period, file_name="x.pdf", file_path="", uploaded_by="test", status="rejected")
            s.add(u); s.flush()
            return review.build_context(s, u).master
        stride = ctx("f-pil-2-0-stride-capital", "2025-12")
        assert stride["covenants"] == [] and stride["covenants_recorded"] == 4
        assert ctx("f-pil-2-0-stride-capital", "2026-08")["covenants_recorded"] == 4
        move = ctx("move-trust-dynamic-capital", "2026-08")
        assert move["covenants"] == [] and move["covenants_recorded"] == 0
        s.rollback()
    # a correction supersedes one row and inserts one: still 7 current rows for Moneda, not 8
    e = ref(rows(client), "SLFA 9.1 (e)")[0]
    put(client, dict(e, threshold=0.04, mode="correct", reason="the record was keyed as 3.5%; SLFA says 4%"))
    with db.session() as s:
        u = SetrepUpload(deal_slug=DEAL, collection_period="2026-08", file_name="x.pdf", file_path="", uploaded_by="test", status="rejected")
        s.add(u); s.flush()
        assert review.build_context(s, u).master["covenants_recorded"] == 7
        s.rollback()
