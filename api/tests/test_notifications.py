"""Wave C notifications (contract Notification, Recipients): hooks on publish, correction, needs_review, reject, extraction
failure; partner notifications behind partner_notifications_enabled; reads filtered through partner_filter (risk R7)."""
import datetime as dt
import pytest
from sqlalchemy import text
from conftest import TAO, INV, reference_deal
from test_review import worker_writes, broken_deal, DEAL
from test_uploads import upload
from test_users import A1, A2, AN, IA, IV, MA, MV, H, code

AN2 = "00000000-0000-4000-8000-000000000004"
from app import db
from app.models import Notification, SetrepUpload, AppUser, new_id

V1 = "/api/v1"
PERIOD = "2026-08"
INTEREST = "/period_history/3/interest"
PRINCIPAL = "/period_history/3/principal"
FPIL = [{"program_slug": "f-pil-2-0", "deal_slug": None, "channels": ["in_app"]}]


def subscribe(client, uid, subs=FPIL):
    assert client.put(V1 + f"/users/{uid}/subscriptions", headers=TAO, json=subs).status_code == 200


def partners_on(client, on=True):
    assert client.put(V1 + "/settings/partner_notifications_enabled", headers=TAO, json={"value": on, "reason": "test switch"}).status_code == 200


def mine(client, uid, **params):
    r = client.get(V1 + "/notifications", headers=H(uid), params=params)
    assert r.status_code == 200, r.text
    return r.json()


def kinds(client, uid, **params):
    return [n["kind"] for n in mine(client, uid, **params) if n["kind"] != "user_change"]


def in_review(client, deal=None, period=PERIOD):
    u = upload(client, period=period).json()
    worker_writes(u["id"], deal or reference_deal(DEAL))
    return u["id"]


def approve(client, uid, note=None):
    r = client.post(V1 + f"/uploads/{uid}/approve", headers=H(A2), json={"note_to_partners": note} if note is not None else None)
    assert r.status_code == 200, r.text
    return r


@pytest.fixture
def people(client):
    for uid in (A1, AN, IV, MV):
        subscribe(client, uid)
    return None


def test_recipients_reasons(client, people):
    client.post(V1 + f"/users/{AN}/deactivate", headers=TAO, json={"reason": "on leave"})
    client.put(V1 + "/me/notification-prefs", headers=H(A2), json=[])           # A2 is not subscribed
    uid = in_review(client)
    r = client.get(V1 + f"/uploads/{uid}/recipients", headers=TAO)
    assert r.status_code == 200
    rec = r.json()
    assert [(x["user_id"], x["channels"]) for x in rec["notified"]] == [(A1, ["in_app"])]
    why = {x["user_id"]: x["reason"] for x in rec["not_notified"]}
    assert why == {AN: "deactivated", A2: "not_subscribed", AN2: "not_subscribed",
                   IV: "partner_notifications_off", MV: "partner_notifications_off", IA: "not_subscribed", MA: "not_subscribed"}
    partners_on(client)
    client.put(V1 + "/me/notification-prefs", headers=H(A1), json=[{"kind": "report_published", "in_app": False, "digest": "daily"}])
    rec = client.get(V1 + f"/uploads/{uid}/recipients", headers=H(AN2)).json()          # the other analyst, via X-User
    assert {x["user_id"] for x in rec["notified"]} == {IV, MV}
    assert {x["user_id"]: x["reason"] for x in rec["not_notified"]}[A1] == "switched_off"
    # unshare F-PIL from manager: MV is not_visible, whatever they subscribe to
    client.put(V1 + "/master/programs", headers=TAO, json={"slug": "f-pil-2-0", "name": "F-PIL 2.0", "partner_slugs": ["investor"], "limit": 150000000.0,
                                                           "warehouse_limit": 5000000.0})
    rec = client.get(V1 + f"/uploads/{uid}/recipients", headers=TAO).json()
    assert {x["user_id"]: x["reason"] for x in rec["not_notified"]}[MV] == "not_visible"
    assert client.get(V1 + f"/uploads/{uid}/recipients", headers=INV).status_code == 403


def test_publish_notifies_tao_and_partners_only_when_switched_on(client, people):
    uid = in_review(client)
    approve(client, uid, note="Moneda August is in.")
    [n] = [n for n in mine(client, A1) if n["kind"] == "report_published"]
    assert n["note_from_tao"] == "Moneda August is in." and n["version"] == 1 and n["deal_slug"] == DEAL and n["collection_period"] == PERIOD
    assert n["title"] == "Report published: Moneda Capital Corp. · August 2026" and n["read_at"] is None and n["upload_id"] == uid
    assert n["link"] == f"/admin/portfolio/f-pil-2-0/deals/{DEAL}?period={PERIOD}"
    assert kinds(client, IV) == [] and kinds(client, MV) == []                   # partner notifications are off by default
    entry = client.get(V1 + "/audit", headers=TAO, params={"upload_id": uid, "action": "publish"}).json()[0]
    assert entry["detail"]["note_to_partners"] == "Moneda August is in." and entry["detail"]["recipients"] == [A1, AN]
    d = client.get(V1 + f"/published/programs/f-pil-2-0/deals/{DEAL}", headers=INV).json()
    assert d["versions"][0]["note_to_partners"] == "Moneda August is in."
    # correction with partners switched on: everyone subscribed gets it, with the changes and the note
    partners_on(client)
    r = client.post(V1 + f"/uploads/{uid}/corrections", headers=TAO, json={"edits": [{"pointer": INTEREST, "value": 86705.51}],
                    "reason": "servicer restated interest in the cover letter", "note_to_partners": "Interest restated."})
    assert r.json()["status"] == "published"
    for who in (A1, IV, MV):
        [c] = [n for n in mine(client, who) if n["kind"] == "correction_published"]
        assert c["version"] == 2 and c["note_from_tao"] == "Interest restated."
        assert c["changes"] == [{"pointer": INTEREST, "label": "Period history, interest", "old_value": 86704.51, "new_value": 86705.51}]
    assert [n["link"] for n in mine(client, IV) if n["kind"] == "correction_published"] == [f"/investor/portfolio/f-pil-2-0/deals/{DEAL}?period={PERIOD}"]
    assert kinds(client, AN) == ["correction_published", "report_published"]
    versions = client.get(V1 + f"/published/programs/f-pil-2-0/deals/{DEAL}", headers=INV).json()["versions"]
    assert [(v["version"], v["note_to_partners"]) for v in versions] == [(1, "Moneda August is in."), (2, "Interest restated.")]


def test_approve_note_limit_and_empty_body(client):
    uid = in_review(client)
    assert client.post(V1 + f"/uploads/{uid}/approve", headers=TAO, json={"note_to_partners": "x" * 2001}).status_code == 422
    assert client.post(V1 + f"/uploads/{uid}/approve", headers=TAO).json()["status"] == "published"


def test_switched_off_kind_is_not_created(client, people):
    client.put(V1 + "/me/notification-prefs", headers=H(A1), json=[{"kind": "report_published", "in_app": False, "digest": "instant"}])
    approve(client, in_review(client))
    assert "report_published" not in kinds(client, A1) and "report_published" in kinds(client, AN)


def test_needs_review_and_covenant_changed_and_failure_are_sent_once(client, people):
    uid = in_review(client)
    first = kinds(client, A1)
    assert first.count("report_needs_review") == 1
    assert kinds(client, A1).count("report_needs_review") == 1                  # the second read finds the event already sent
    n = next(n for n in mine(client, A1) if n["kind"] == "report_needs_review")
    assert n["link"] == f"/admin/uploads/queue/{uid}" and "Uploaded by tao_admin" in n["body"]
    assert "report_needs_review" not in kinds(client, IV)                         # TAO only
    # R19 notes on the extraction become covenant_changed for subscribed TAO users
    with db.session() as s:
        r19 = s.execute(text("select count(*) from finding f join extraction e on e.id = f.extraction_id "
                             "where e.upload_id = :u and f.rule_id = 'R19'"), {"u": uid}).scalar()
    assert first.count("covenant_changed") == r19
    # a user added later does not get old events
    subscribe(client, A2)
    assert "report_needs_review" not in kinds(client, A2)
    up = upload(client, period="2026-10").json()
    with db.session() as s:
        s.get(SetrepUpload, up["id"]).status = "extraction_failed"
        s.commit()
    sys_n = [n for n in mine(client, A1, tab="system") if n["kind"] == "system"]
    assert len(sys_n) == 1 and sys_n[0]["title"].startswith("Extraction failed: Moneda Capital Corp.") and sys_n[0]["upload_id"] == up["id"]


def test_reject_and_queued_correction_notify_tao(client, people):
    uid = in_review(client)
    client.post(V1 + f"/uploads/{uid}/reject", headers=H(A2), json={"reason": "wrong period selected"})
    [n] = [n for n in mine(client, A1) if n["kind"] == "report_rejected"]
    assert n["body"] == "Reason: wrong period selected. By R. Okafor." and "report_rejected" not in kinds(client, IV)
    uid = in_review(client)
    approve(client, uid)
    r = client.post(V1 + f"/uploads/{uid}/corrections", headers=TAO, json={"edits": [{"pointer": PRINCIPAL, "value": 1.0}], "reason": "a correction that opens a block"})
    assert r.json()["status"] == "needs_review"
    titles = [n["title"] for n in mine(client, AN) if n["kind"] == "report_needs_review"]
    assert any(t.startswith("Correction needs review: Moneda Capital Corp.") for t in titles)
    client.post(V1 + f"/corrections/{r.json()['id']}/reject", headers=TAO, json={"reason": "not needed"})
    assert any(n["title"].startswith("Correction rejected") for n in mine(client, AN) if n["kind"] == "report_rejected")


def test_tabs_unread_read_and_read_all(client, people):
    approve(client, in_review(client))
    assert code(client.get(V1 + "/notifications", headers=TAO)) == (401, "user_required")
    c = client.get(V1 + "/notifications/unread-count", headers=H(A1)).json()
    assert c["total"] == c["mentions"] + c["reports"] + c["system"] and c["reports"] == 1 and c["system"] == 1     # published; user_change
    reports = mine(client, A1, tab="reports")
    assert reports and all(n["kind"] in ("report_needs_review", "report_published", "correction_published", "covenant_changed", "report_rejected")
                           for n in reports)
    one = reports[0]["id"]
    r = client.post(V1 + f"/notifications/{one}/read", headers=H(A1))
    assert r.status_code == 200 and r.json()["read_at"]
    assert one not in [n["id"] for n in mine(client, A1, unread=True)]
    assert one in [n["id"] for n in mine(client, A1, unread=False)]
    assert code(client.post(V1 + f"/notifications/{one}/read", headers=H(AN))) == (404, "not_found")          # someone else's
    assert client.post(V1 + "/notifications/read-all?tab=system", headers=H(A1)).json() == {"marked": 1}
    left = client.get(V1 + "/notifications/unread-count", headers=H(A1)).json()
    assert left["system"] == 0 and left["reports"] == c["reports"] - 1
    assert client.post(V1 + "/notifications/read-all", headers=H(A1)).json()["marked"] == left["total"]
    assert client.get(V1 + "/notifications/unread-count", headers=H(A1)).json()["total"] == 0
    assert len(mine(client, A1, limit=1)) == 1 and mine(client, A1, limit=1, offset=1)[0]["id"] != mine(client, A1, limit=1)[0]["id"]


def test_user_change_notification_reaches_the_user(client):
    subscribe(client, IV)
    [n] = [n for n in mine(client, IV) if n["kind"] == "user_change"]
    assert n["link"] == "/settings/profile" and "All F-PIL 2.0 deals" in n["body"]


# ---- R7: partners never see another partner's notification, nor a TAO comment ----
def test_partner_never_sees_another_partners_notification(client, people):
    partners_on(client)
    approve(client, in_review(client))
    iv, mv = mine(client, IV), mine(client, MV)
    assert iv and mv and not {n["id"] for n in iv} & {n["id"] for n in mv}
    for n in mv:
        assert code(client.post(V1 + f"/notifications/{n['id']}/read", headers=H(IV))) == (404, "not_found")
    assert client.post(V1 + "/notifications/read-all", headers=H(IV)).json()["marked"] == len([n for n in iv if not n["read_at"]])
    assert all(n["read_at"] is None for n in mine(client, MV))                       # IV's read-all left MV's alone
    # TAO stops sharing F-PIL with manager: MV's F-PIL notifications drop out on read (partner_filter again)
    client.put(V1 + "/master/programs", headers=TAO, json={"slug": "f-pil-2-0", "name": "F-PIL 2.0", "partner_slugs": ["investor"], "limit": 150000000.0,
                                                           "warehouse_limit": 5000000.0})
    assert [n for n in mine(client, MV) if n["deal_slug"]] == []
    assert client.get(V1 + "/notifications/unread-count", headers=H(MV)).json()["reports"] == 0
    stale = next(n for n in mv if n["deal_slug"])
    assert code(client.post(V1 + f"/notifications/{stale['id']}/read", headers=H(MV))) == (404, "not_found")
    assert [n["deal_slug"] for n in mine(client, IV) if n["deal_slug"]]                # investor still sees them


def test_partner_never_sees_a_tao_comment(client):
    """Even if a mention or reply row ever named a partner user (say, a TAO user later moved to a partner role), a partner's
    reads drop TAO-only kinds; and every comment route is 403 for partner roles."""
    uid = in_review(client)
    with db.session() as s:
        for kind in ("mention", "reply", "report_needs_review", "covenant_changed", "system"):
            s.add(Notification(id=new_id(), user_id=IV, kind=kind, title="J. Moreau mentioned you", body="internal TAO comment text",
                               link=f"/admin/uploads/queue/{uid}", upload_id=uid, deal_slug=DEAL, collection_period=PERIOD))
        s.commit()
    assert mine(client, IV) == [] and client.get(V1 + "/notifications/unread-count", headers=H(IV)).json()["total"] == 0
    assert client.post(V1 + "/notifications/read-all", headers=H(IV)).json()["marked"] == 0
    for h in (H(IV), H(MA), INV):
        assert client.get(V1 + f"/uploads/{uid}/threads", headers=h).status_code == 403
        assert client.post(V1 + f"/uploads/{uid}/threads", headers=h, json={"anchor": {"pointer": INTEREST}, "body": "hi"}).status_code == 403


def test_old_notifications_are_purged(client, people):
    approve(client, in_review(client))
    old = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=400)
    with db.session() as s:
        s.execute(text("update notification set created_at = :t where user_id = :u"), {"t": old.isoformat() if db.engine().dialect.name == "sqlite" else old, "u": A1})
        s.commit()
    assert mine(client, A1) == []


def test_every_kind_links_to_a_real_app_route(client, people):
    """Lead's link table: review queue (+ ?thread=), portfolio deal page per shell, program record, User management / profile."""
    import re
    partners_on(client)
    subscribe(client, AN2)
    uid = in_review(client, deal=broken_deal())
    fid = next(f["id"] for f in client.get(V1 + f"/uploads/{uid}/findings", headers=TAO).json() if f["rule_id"] == "R05")
    mine(client, A1)                                                           # sweep: report_needs_review
    t = client.post(V1 + f"/uploads/{uid}/threads", headers=H(AN), json={"anchor": {"finding_id": fid}, "body": "look", "mentions": [A1]}).json()
    client.post(V1 + f"/threads/{t['id']}/comments", headers=H(AN2), json={"body": "agree"})
    client.post(V1 + f"/uploads/{uid}/reject", headers=TAO, json={"reason": "wrong period"})
    ok = in_review(client, period="2026-08")          # after the reject, the same month again, clean
    approve(client, ok)
    assert client.post(V1 + f"/uploads/{ok}/corrections", headers=TAO, json={"edits": [{"pointer": INTEREST, "value": 86705.51}], "reason": "restated by the servicer"}).json()["status"] == "published"
    failed = upload(client, period="2026-10").json()["id"]
    with db.session() as s:
        s.get(SetrepUpload, failed).status = "extraction_failed"
        from app.models import Finding, Extraction
        ex = s.query(Extraction).filter(Extraction.upload_id == ok).first()
        s.commit()
    # a covenant change: an R19 note on an upload newly in review
    cov = in_review(client, period="2026-11")
    with db.session() as s:
        ex = s.query(Extraction).filter(Extraction.upload_id == cov).first()
        s.add(Finding(extraction_id=ex.id, rule_id="R19", layer="covenant", severity="note", message="status changed", fields=[],
                      our_value="OK", report_value="WATCH", context={"legal_ref": "9.1 (c)", "prior_status": "OK", "status": "WATCH"}))
        s.commit()
    tao_q = re.compile(r"^/admin/uploads/queue/[0-9a-f-]{36}$")
    expect = {
        "report_needs_review": tao_q, "report_rejected": tao_q,
        "mention": re.compile(rf"^/admin/uploads/queue/{uid}\?thread={t['id']}$"), "reply": re.compile(rf"^/admin/uploads/queue/{uid}\?thread={t['id']}$"),
        "report_published": re.compile(rf"^/admin/portfolio/f-pil-2-0/deals/{DEAL}\?period=\d{{4}}-\d{{2}}$"),
        "correction_published": re.compile(rf"^/admin/portfolio/f-pil-2-0/deals/{DEAL}\?period=2026-08$"),
        "covenant_changed": re.compile(r"^/admin/partners/investor/programs/f-pil-2-0$"),
        "system": re.compile(r"^/admin/settings/users$"), "user_change": re.compile(r"^/admin/settings/users$")}
    seen = {}
    for who in (A1, AN):
        for n in mine(client, who, limit=200):
            seen.setdefault(n["kind"], []).append(n["link"])
    assert set(seen) == set(expect), set(expect) ^ set(seen)
    for kind, links in seen.items():
        assert all(expect[kind].match(x) for x in links), (kind, links)
    partner = {n["kind"]: n["link"] for n in mine(client, IV, limit=200)}
    assert partner["report_published"] == f"/investor/portfolio/f-pil-2-0/deals/{DEAL}?period=2026-08"
    assert partner["correction_published"] == f"/investor/portfolio/f-pil-2-0/deals/{DEAL}?period=2026-08"
    assert partner["user_change"] == "/settings/profile"
    assert {n["kind"]: n["link"] for n in mine(client, MV)}["report_published"].startswith("/manager/portfolio/f-pil-2-0/deals/")
