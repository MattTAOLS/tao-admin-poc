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


# ---- H2: approve always re-runs; a publish re-runs the later months in review ----
def july_deal(closing_delta: float = 0.0):
    """The month before the Moneda August object, as a fixture: the same object with its closing balance and contract
    count set to August's opening ones (so August opens where July closed). closing_delta: a re-issue that moves it."""
    d = reference_deal(DEAL)
    d["tranche_balance"]["closing"] = d["tranche_balance"]["opening"] + closing_delta
    d["contracts"]["closing"] = d["contracts"]["opening"]
    d["collection_period"] = "July 2026"
    return d


def publish_acknowledged(client, period, deal, replace=False):
    data = {"deal_slug": DEAL, "collection_period": period, **({"replace": "true"} if replace else {})}
    r = client.post(f"{API}/uploads", headers=TAO, data=data, files={"file": ("Moneda-SETTREP.pdf", make_pdf(3), "application/pdf")})
    assert r.status_code == 201, r.text
    uid = r.json()["id"]
    worker_writes(uid, deal)
    for _ in range(3):                                         # approve re-runs with the real context: resolve what it finds
        acknowledge_blocks(client, uid)
        r = client.post(f"{API}/uploads/{uid}/approve", headers=TAO)
        if r.status_code == 200:
            break
    assert r.status_code == 200 and r.json()["status"] == "published", r.text
    return uid


@pytest.fixture
def july_and_august(client):
    july = publish_acknowledged(client, "2026-07", july_deal())
    august = in_review(client, "2026-08", reference_deal(DEAL))
    assert open_blocks(client, august) == [], [(f["rule_id"], f["message"]) for f in open_blocks(client, august)]
    return july, august


def test_h2_reissue_of_the_prior_month_reruns_the_later_review(client, july_and_august):
    july, august = july_and_august
    new = publish_acknowledged(client, "2026-07", july_deal(closing_delta=5000.0), replace=True)
    blocks = open_blocks(client, august)                       # nobody touched August: the publish re-ran it
    assert [f["rule_id"] for f in blocks] == ["R11"] and blocks[0]["difference"] == -5000.0
    pub = client.get(f"{API}/audit", headers=TAO, params={"upload_id": new, "action": "publish"}).json()[0]
    assert pub["detail"]["rerun_upload_ids"] == [august]
    r = client.post(f"{API}/uploads/{august}/approve", headers=TAO)
    assert r.status_code == 409 and r.json()["code"] == "open_block_findings" and "R11" in r.json()["message"]
    assert client.get(f"{API}/uploads/{august}", headers=TAO).json()["status"] == "needs_review"


def test_h2_approve_reruns_the_rules_without_value_edits(client, july_and_august):
    """The prior changes behind the review's back (no re-run happened): approve still sees it."""
    july, august = july_and_august
    with db.session() as s:
        pub = s.scalars(select(Publication).where(Publication.upload_id == july)).one()
        deal = copy.deepcopy(pub.deal)
        deal["tranche_balance"]["closing"] += 5000.0
        pub.deal = deal
        s.commit()
    assert open_blocks(client, august) == []                   # stored findings are stale
    r = client.post(f"{API}/uploads/{august}/approve", headers=TAO)
    assert r.status_code == 409 and r.json()["code"] == "open_block_findings" and "R11" in r.json()["message"]
    assert [f["rule_id"] for f in open_blocks(client, august)] == ["R11"]          # and the reviewer now sees why


def test_h2_first_publication_of_a_month_reruns_the_next_month_in_review(client):
    sept = in_review(client, "2026-09", reference_deal(DEAL))
    before = {f["rule_id"] for f in open_blocks(client, sept)}
    assert "R11" not in before                                 # no prior published yet: nothing to compare
    aug = publish(client, "2026-08")
    assert "R11" in {f["rule_id"] for f in open_blocks(client, sept)}             # the August object does not open where it closed
    pub = client.get(f"{API}/audit", headers=TAO, params={"upload_id": aug, "action": "publish"}).json()[0]
    assert pub["detail"]["rerun_upload_ids"] == [sept]


# ---- H3: review actions are atomic ----
def race(monkeypatch, second):
    """The interleaving the audit used: the first request reads the upload, then the second request runs to its commit,
    then the first carries on with what it read. Returns the list the second request's response lands in."""
    from app import main
    real, got = main.lock_upload, []

    def lock_then_let_the_other_win(s, upload_id):
        u = real(s, upload_id)
        if not got:
            got.append(None)
            got[0] = second()
        return u
    monkeypatch.setattr(main, "lock_upload", lock_then_let_the_other_win)
    return got


@pytest.fixture
def clean(client):
    uid = upload(client, period="2026-08").json()["id"]
    worker_writes(uid, reference_deal(DEAL))
    return uid


def state(uid):
    with db.session() as s:
        return {"status": s.get(SetrepUpload, uid).status,
                "publications": len(s.scalars(select(Publication).where(Publication.upload_id == uid)).all()),
                "versions": len(s.scalars(select(PublicationVersion)).all()),
                "published_notes": len(s.scalars(select(Notification).where(Notification.kind == "report_published")).all()),
                "rejected_notes": len(s.scalars(select(Notification).where(Notification.kind == "report_rejected")).all()),
                "publish_entries": len(s.scalars(select(ReviewAction).where(ReviewAction.upload_id == uid, ReviewAction.action == "publish")).all())}


def _approve(client, uid):
    return client.post(f"{API}/uploads/{uid}/approve", headers=TAO)


def _reject(client, uid):
    return client.post(f"{API}/uploads/{uid}/reject", headers=TAO, json={"reason": "wrong file"})


def _reextract(client, uid):
    return client.post(f"{API}/uploads/{uid}/reextract", headers=TAO, json={"pages": [2]})


def test_h3_two_approvals_publish_once(client, clean, monkeypatch):
    from test_users import A1, AN
    for person in (A1, AN):                                    # someone to notify, so a second publish would show
        assert client.put(f"{API}/users/{person}/subscriptions", headers=TAO,
                          json=[{"program_slug": "f-pil-2-0", "deal_slug": None, "channels": ["in_app"]}]).status_code == 200
    from fastapi.testclient import TestClient
    from app.main import app
    other = TestClient(app)
    got = race(monkeypatch, lambda: _approve(other, clean))
    first = _approve(client, clean)
    assert sorted([first.status_code, got[0].status_code]) == [200, 409]
    assert first.status_code == 409 and first.json()["code"] == "bad_state"
    st = state(clean)
    assert st["status"] == "published" and st["publications"] == 1 and st["versions"] == 0 and st["publish_entries"] == 1
    told = client.get(f"{API}/audit", headers=TAO, params={"upload_id": clean, "action": "publish"}).json()[0]["detail"]["recipients"]
    assert len(told) >= 1 and st["published_notes"] == len(told)          # one notification per recipient, not two


@pytest.mark.parametrize("first,second,winner_status", [
    (_approve, _reject, "rejected"), (_reject, _approve, "published"),
    (_approve, _reextract, "extracting"), (_reextract, _approve, "published"),
    (_reextract, _reject, "rejected"),                         # (reject first, re-extract second is a valid order: both succeed)
    (_reject, _reject, "rejected"), (_reextract, _reextract, "extracting")])
def test_h3_two_actions_at_once_exactly_one_wins(client, clean, monkeypatch, queue, first, second, winner_status):
    from fastapi.testclient import TestClient
    from app.main import app
    other = TestClient(app)
    jobs_before = len(queue.jobs)
    got = race(monkeypatch, lambda: second(other, clean))
    r1 = first(client, clean)
    assert got[0].status_code in (200, 202), got[0].text       # the request that committed first wins
    assert r1.status_code == 409 and r1.json()["code"] == "bad_state", r1.text
    st = state(clean)
    assert st["status"] == winner_status
    assert st["publications"] == (1 if winner_status == "published" else 0) and st["versions"] == 0
    assert st["publish_entries"] == st["publications"]
    assert st["rejected_notes"] == 0 or winner_status == "rejected"
    assert st["published_notes"] == 0 or winner_status == "published"
    assert len(queue.jobs) - jobs_before == (1 if winner_status == "extracting" else 0)        # no orphan job


def test_h3_correction_decided_once(client, monkeypatch):
    from fastapi.testclient import TestClient
    from app import main
    uid = publish(client, "2026-08")
    r = client.post(f"{API}/uploads/{uid}/corrections", headers=TAO,
                    json={"edits": [{"pointer": "/period_history/3/principal", "value": 646826.71}], "reason": "principal re-read on page 2 as 646,826.71"})
    assert r.status_code == 200 and r.json()["status"] == "needs_review", r.text
    kid = r.json()["id"]
    other = TestClient(main.app)
    got = race(monkeypatch, lambda: other.post(f"{API}/corrections/{kid}/reject", headers=TAO, json={"reason": "R05 does not close"}))
    r1 = client.post(f"{API}/corrections/{kid}/reject", headers=TAO, json={"reason": "second reviewer, same time"})
    assert got[0].status_code == 200 and r1.status_code == 409 and r1.json()["code"] == "bad_state"
    assert len(client.get(f"{API}/audit", headers=TAO, params={"upload_id": uid, "action": "correction_reject"}).json()) == 1


# ---- M2: re-extract of a failed upload that a newer upload replaced ----
def test_m2_reextract_of_a_superseded_failed_upload_is_409_and_queues_nothing(client, queue):
    old = upload(client, period="2026-08").json()["id"]
    with db.session() as s:
        s.get(SetrepUpload, old).status = "extraction_failed"
        s.commit()
    new = upload(client, period="2026-08")
    assert new.status_code == 201, new.text
    jobs = len(queue.jobs)
    r = _reextract(client, old)
    assert r.status_code == 409 and r.json()["code"] == "upload_in_progress", r.text
    assert len(queue.jobs) == jobs
    assert client.get(f"{API}/uploads/{old}", headers=TAO).json()["status"] == "extraction_failed"
    assert client.get(f"{API}/audit", headers=TAO, params={"upload_id": old, "action": "reextract"}).json() == []
    # with the newer upload rejected, the failed one can be re-extracted again
    assert _reject(client, new.json()["id"]).status_code == 200
    r = _reextract(client, old)
    assert r.status_code == 202 and r.json()["status"] == "extracting" and queue.jobs[-1]["upload_id"] == old and queue.jobs[-1]["pass"] == 2


def test_m2_queue_down_leaves_the_upload_as_it_was(client, clean):
    from app import jobs
    from app.main import app

    class Down:
        def push(self, job):
            raise ConnectionError("redis is down")
    app.dependency_overrides[jobs.get_queue] = lambda: Down()
    r = _reextract(client, clean)
    assert r.status_code == 503 and r.json()["code"] == "queue_unavailable"
    assert client.get(f"{API}/uploads/{clean}", headers=TAO).json()["status"] == "needs_review"
