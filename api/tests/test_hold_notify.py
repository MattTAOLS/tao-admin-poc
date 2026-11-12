"""Save (On hold) on the review page and per-person notify choices on approve (contract 1aaf359, migration 016).
A hold is a marker on a needs_review upload, not a status; notify choices change one publish, never a subscription."""
import pytest
from conftest import TAO, ANALYST, INV, MGR
from app import db, jobs
from app.main import app
from app.models import SetrepUpload
from test_review import DEAL
from test_users import A1, A2, AN, IA, IV, MA, MV, H, code
from test_notifications import AN2, PERIOD, in_review, kinds, mine, partners_on, people, subscribe   # noqa: F401 (people is a fixture)

V1 = "/api/v1"
NAMES = {A1: "A. Patel", A2: "R. Okafor", AN: "J. Moreau", AN2: "S. Lindqvist", IA: "M. Chen", IV: "D. Alvarez", MA: "K. Novak", MV: "L. Haddad"}
GHOST = "00000000-0000-4000-8000-0000000000ff"


def hold(client, uid, body=None, headers=None):
    return client.post(V1 + f"/uploads/{uid}/hold", headers=headers or H(A1), json=body)


def release(client, uid, headers=None):
    return client.delete(V1 + f"/uploads/{uid}/hold", headers=headers or H(A1))


def get(client, uid):
    return client.get(V1 + f"/uploads/{uid}", headers=TAO).json()


def audit(client, uid, action):
    return client.get(V1 + "/audit", headers=TAO, params={"upload_id": uid, "action": action}).json()


def columns(uid):
    with db.session() as s:
        u = s.get(SetrepUpload, uid)
        return u.held_at, u.held_by, u.held_by_label, u.hold_note, u.draft_note_to_partners, u.draft_notify


def subs(client, uid):
    return client.get(V1 + f"/users/{uid}/subscriptions", headers=TAO).json()


# ---- hold lifecycle ----
def test_hold_save_again_and_release(client, people):
    uid = in_review(client)
    assert get(client, uid)["hold"] is None and get(client, uid)["draft"] is None
    r = hold(client, uid, {"note": "  waiting for the servicer's cover letter  ", "note_to_partners": "August is in.",
                           "notify": {"add": [A2], "remove": [AN]}})
    assert r.status_code == 200, r.text
    u = r.json()
    assert u["status"] == "needs_review"                                         # a marker, not a status
    assert u["hold"]["by"] == {"id": A1, "name": "A. Patel"} and u["hold"]["by_label"] == "A. Patel"
    assert u["hold"]["note"] == "waiting for the servicer's cover letter" and u["hold"]["at"]
    assert u["draft"] == {"note_to_partners": "August is in.", "notify": {"add": [A2], "remove": [AN]}}
    [row] = [x for x in client.get(V1 + "/uploads", headers=ANALYST, params={"status": "needs_review"}).json() if x["id"] == uid]
    assert row["hold"] == u["hold"] and row["draft"] == u["draft"]               # list and detail agree; the analyst reads it
    [e] = audit(client, uid, "hold")
    assert e["actor_user_id"] == A1 and e["reason"] == "waiting for the servicer's cover letter"
    assert e["detail"] == {"note": "waiting for the servicer's cover letter", "has_draft_note": True,
                           "notify_add": ["R. Okafor"], "notify_remove": ["J. Moreau"]}
    # saving again: the note is replaced (not sent = none), held_at / held_by move, fields not sent keep the draft
    first_at = u["hold"]["at"]
    u = hold(client, uid, {}, headers=H(A2)).json()
    assert u["hold"]["by"] == {"id": A2, "name": "R. Okafor"} and u["hold"]["note"] is None and u["hold"]["at"] >= first_at
    assert u["draft"] == {"note_to_partners": "August is in.", "notify": {"add": [A2], "remove": [AN]}}
    u = hold(client, uid, {"note": "", "note_to_partners": None}).json()         # sent as null: cleared; notify not sent: kept
    assert u["hold"]["note"] is None and u["draft"] == {"note_to_partners": None, "notify": {"add": [A2], "remove": [AN]}}
    u = hold(client, uid, {"notify": None}).json()
    assert u["hold"] is not None and u["draft"] is None
    u = hold(client, uid, {"note_to_partners": "Draft two.", "notify": {"add": [], "remove": []}}).json()
    assert u["draft"] == {"note_to_partners": "Draft two.", "notify": {"add": [], "remove": []}}
    assert len(audit(client, uid, "hold")) == 5
    # release: plain needs_review again, the draft stays
    r = release(client, uid)
    assert r.status_code == 200 and r.json()["hold"] is None and r.json()["status"] == "needs_review"
    assert r.json()["draft"] == {"note_to_partners": "Draft two.", "notify": {"add": [], "remove": []}}
    assert columns(uid)[:4] == (None, None, None, None)
    assert code(release(client, uid)) == (409, "bad_state")
    assert [e["action"] for e in audit(client, uid, "hold_release")] == ["hold_release"]


def test_empty_body_marks_on_hold(client):
    uid = in_review(client)
    r = client.post(V1 + f"/uploads/{uid}/hold", headers=H(A1))
    assert r.status_code == 200 and r.json()["hold"]["note"] is None and r.json()["draft"] is None
    assert audit(client, uid, "hold")[0]["detail"] == {"note": None, "has_draft_note": False, "notify_add": [], "notify_remove": []}


def test_role_only_mode_has_a_label_and_no_user(client):
    uid = in_review(client)
    u = hold(client, uid, {"note": "back on Monday"}, headers=TAO).json()
    assert u["hold"]["by"] is None and u["hold"]["by_label"] == "TAO Admin" and u["hold"]["note"] == "back on Monday"
    assert columns(uid)[1:3] == (None, "TAO Admin")


def test_approve_clears_hold_and_draft(client, people):
    uid = in_review(client)
    hold(client, uid, {"note": "check interest", "note_to_partners": "Draft.", "notify": {"remove": [AN]}})
    u = client.post(V1 + f"/uploads/{uid}/approve", headers=H(A1), json={"note_to_partners": "Final."}).json()
    assert u["status"] == "published" and u["hold"] is None and u["draft"] is None
    assert columns(uid) == (None, None, None, None, None, None)
    assert AN in audit(client, uid, "publish")[0]["detail"]["recipients"]        # the saved draft is not applied by itself
    assert code(release(client, uid)) == (409, "bad_state") and code(hold(client, uid)) == (409, "bad_state")


def test_reject_clears_hold_and_draft(client):
    uid = in_review(client)
    hold(client, uid, {"note": "check interest", "note_to_partners": "Draft."})
    u = client.post(V1 + f"/uploads/{uid}/reject", headers=TAO, json={"reason": "wrong file"}).json()
    assert u["status"] == "rejected" and u["hold"] is None and u["draft"] is None
    assert columns(uid) == (None, None, None, None, None, None)


def test_reextract_clears_the_hold_and_keeps_the_draft(client, queue):
    uid = in_review(client)
    hold(client, uid, {"note": "page 2 looks off", "note_to_partners": "Draft."})
    u = client.post(V1 + f"/uploads/{uid}/reextract", headers=ANALYST, json={"pages": [2]}).json()
    assert u["status"] == "extracting" and u["hold"] is None and u["draft"] == {"note_to_partners": "Draft.", "notify": {"add": [], "remove": []}}
    assert columns(uid)[:4] == (None, None, None, None)
    with db.session() as s:                                   # the worker hands it back: no hold comes back with it
        s.get(SetrepUpload, uid).status = "needs_review"
        s.commit()
    assert get(client, uid)["hold"] is None


def test_reextract_that_cannot_queue_leaves_the_hold(client):
    uid = in_review(client)
    held = hold(client, uid, {"note": "page 2 looks off"}).json()["hold"]

    class Down:
        def push(self, job):
            raise ConnectionError("redis is down")
    app.dependency_overrides[jobs.get_queue] = lambda: Down()
    assert code(client.post(V1 + f"/uploads/{uid}/reextract", headers=TAO, json={"pages": [2]})) == (503, "queue_unavailable")
    assert get(client, uid)["status"] == "needs_review" and get(client, uid)["hold"] == held


def test_a_hold_never_shows_outside_needs_review(client):
    """Any other path out of needs_review (here: the worker failing a re-run) must not show a hold."""
    uid = in_review(client)
    hold(client, uid, {"note": "x"})
    with db.session() as s:
        s.get(SetrepUpload, uid).status = "extraction_failed"
        s.commit()
    assert get(client, uid)["hold"] is None and code(release(client, uid)) == (409, "bad_state")
    u = client.post(V1 + f"/uploads/{uid}/reject", headers=TAO, json={"reason": "failed twice"}).json()
    assert u["hold"] is None and columns(uid)[:4] == (None, None, None, None)


# ---- permissions and bad states ----
@pytest.mark.parametrize("h, want", [(ANALYST, "admin_only"), (H(AN), "admin_only"), (INV, "admin_only"), (MGR, "admin_only"), (H(IA), "admin_only")])
def test_only_tao_admin_holds_and_releases(client, h, want):
    uid = in_review(client)
    assert code(hold(client, uid, {"note": "x"}, headers=h)) == (403, want)
    hold(client, uid, {"note": "x"})
    assert code(release(client, uid, headers=h)) == (403, want)
    assert get(client, uid)["hold"]["note"] == "x"


def test_hold_bad_states_and_unknown_upload(client, queue):
    from test_uploads import upload
    assert code(hold(client, GHOST)) == (404, "not_found") and code(release(client, GHOST)) == (404, "not_found")
    assert code(hold(client, "nope")) == (404, "not_found")
    fresh = upload(client, period="2026-10").json()["id"]                         # received: not yet in review
    assert code(hold(client, fresh)) == (409, "bad_state") and code(release(client, fresh)) == (409, "bad_state")
    uid = in_review(client)
    assert code(release(client, uid)) == (409, "bad_state")                      # in review but not on hold
    assert release(client, uid).json()["message"] == "the upload is not on hold"
    assert code(hold(client, uid, {"note": "x" * 1001})) == (422, "invalid")
    assert code(hold(client, uid, {"note_to_partners": "x" * 2001})) == (422, "invalid")
    assert code(hold(client, uid, {"notify": {"add": ["not-a-uuid"]}})) == (422, "invalid")
    assert get(client, uid)["hold"] is None
    client.post(V1 + f"/uploads/{uid}/approve", headers=TAO)
    assert code(hold(client, uid)) == (409, "bad_state")


# ---- recipients: can_change ----
def test_recipients_can_change_per_reason(client, people):
    client.post(V1 + f"/users/{AN}/deactivate", headers=TAO, json={"reason": "on leave"})
    client.put(V1 + "/me/notification-prefs", headers=H(AN2), json=[{"kind": "report_published", "in_app": False, "digest": "instant"}])
    uid = in_review(client)
    rec = client.get(V1 + f"/uploads/{uid}/recipients", headers=TAO).json()
    assert [(x["user_id"], x["can_change"]) for x in rec["notified"]] == [(A1, True)]
    got = {x["user_id"]: (x["reason"], x["can_change"]) for x in rec["not_notified"]}
    assert got == {AN: ("deactivated", False), A2: ("not_subscribed", True), AN2: ("switched_off", False),   # not subscribed AND switched off: their choice wins
                   IA: ("partner_notifications_off", False), IV: ("partner_notifications_off", False),
                   MA: ("partner_notifications_off", False), MV: ("partner_notifications_off", False)}
    # partner notifications on: partner users who can see the deal become changeable (subscribed ones are notified)
    partners_on(client)
    client.put(V1 + "/master/programs", headers=TAO, json={"slug": "f-pil-2-0", "name": "F-PIL 2.0", "partner_slugs": ["investor"],
                                                           "limit": 150000000.0, "warehouse_limit": 5000000.0})
    rec = client.get(V1 + f"/uploads/{uid}/recipients", headers=TAO).json()
    assert [(x["user_id"], x["can_change"]) for x in rec["notified"]] == [(A1, True), (IV, True)]
    got = {x["user_id"]: (x["reason"], x["can_change"]) for x in rec["not_notified"]}
    assert got[IA] == ("not_subscribed", True) and got[MA] == ("not_visible", False) and got[MV] == ("not_visible", False)
    # the lists are the computed defaults: a saved draft does not move anyone
    hold(client, uid, {"notify": {"add": [A2, IA], "remove": [A1]}})
    assert client.get(V1 + f"/uploads/{uid}/recipients", headers=TAO).json() == rec


# ---- notify validation (approve and Save validate alike; nothing is written) ----
def test_notify_choices_that_are_refused(client, people):
    client.post(V1 + f"/users/{AN}/deactivate", headers=TAO, json={"reason": "on leave"})
    client.put(V1 + "/me/notification-prefs", headers=H(AN2), json=[{"kind": "report_published", "in_app": False, "digest": "instant"}])
    client.put(V1 + "/master/programs", headers=TAO, json={"slug": "f-pil-2-0", "name": "F-PIL 2.0", "partner_slugs": ["investor"],
                                                           "limit": 150000000.0, "warehouse_limit": 5000000.0})
    uid = in_review(client)
    cases = [
        ({"add": [GHOST]}, f"notify.add names an unknown user: {GHOST}"),
        ({"remove": [GHOST]}, f"notify.remove names an unknown user: {GHOST}"),
        ({"add": [AN]}, "J. Moreau cannot be added: their account is deactivated"),
        ({"add": [MV]}, "L. Haddad cannot be added: they may not see this deal"),
        ({"add": [AN2]}, "S. Lindqvist cannot be added: they switched this notification off in their profile"),
        ({"add": [IV]}, "D. Alvarez cannot be added: partner notifications are switched off in System settings"),   # subscribed partner user
        ({"add": [IA]}, "M. Chen cannot be added: partner notifications are switched off in System settings"),      # the global switch wins
        ({"add": [A1]}, "A. Patel is already notified; they cannot be added"),
        ({"add": [A2], "remove": [A2]}, "R. Okafor is in both the add and the remove list"),
        ({"add": [A1], "remove": [A1]}, "A. Patel is in both the add and the remove list"),
        ({"remove": [A2]}, "R. Okafor is not on the notified list; they cannot be left out"),
        ({"remove": [IV]}, "D. Alvarez is not on the notified list; they cannot be left out"),
        ({"add": [A2, A2]}, "notify.add names the same person twice"),
    ]
    for notify, message in cases:
        for r in (client.post(V1 + f"/uploads/{uid}/approve", headers=H(A1), json={"notify": notify}), hold(client, uid, {"note": "n", "notify": notify})):
            assert r.status_code == 422 and r.json() == {"code": "invalid", "message": message}, (notify, r.text)
    u = get(client, uid)
    assert u["status"] == "needs_review" and u["hold"] is None and u["draft"] is None        # nothing published, nothing saved
    assert audit(client, uid, "publish") == [] and audit(client, uid, "hold") == []
    assert "report_published" not in kinds(client, A1)
    assert client.get(V1 + f"/published/programs/f-pil-2-0/deals/{DEAL}", headers=INV, params={"period": PERIOD}).status_code == 404


# ---- approve with notify ----
def test_approve_with_add_and_remove_notifies_exactly_those(client, people):
    partners_on(client)                                                          # computed: A1, AN, IV, MV
    before = {who: subs(client, who) for who in NAMES}
    uid = in_review(client)
    hold(client, uid, {"note": "last look", "note_to_partners": "Draft.", "notify": {"add": [A2, IA], "remove": [AN, MV]}})
    r = client.post(V1 + f"/uploads/{uid}/approve", headers=H(A1),
                    json={"note_to_partners": "Moneda August is in.", "notify": {"add": [A2, IA], "remove": [AN, MV]}})
    assert r.status_code == 200 and r.json()["status"] == "published" and r.json()["hold"] is None and r.json()["draft"] is None
    for who in (A1, IV, A2, IA):                                                 # (notified - remove) + add, once each
        [n] = [n for n in mine(client, who) if n["kind"] == "report_published"]
        assert n["note_from_tao"] == "Moneda August is in." and n["upload_id"] == uid and n["version"] == 1
    assert [n["link"] for n in mine(client, IA) if n["kind"] == "report_published"] == [f"/investor/portfolio/f-pil-2-0/deals/{DEAL}?period={PERIOD}"]
    for who in (AN, MV, AN2, MA):                                                # removed subscribers and the untouched get none
        assert "report_published" not in kinds(client, who)
    d = audit(client, uid, "publish")[0]["detail"]
    assert d["recipients"] == [A1, IV, A2, IA]
    assert d["notified_added"] == [{"id": A2, "name": "R. Okafor"}, {"id": IA, "name": "M. Chen"}]
    assert d["notified_removed"] == [{"id": AN, "name": "J. Moreau"}, {"id": MV, "name": "L. Haddad"}]
    assert {who: subs(client, who) for who in NAMES} == before                   # this publish only: no subscription changed
    assert client.get(V1 + "/me/notification-prefs", headers=H(A2)).status_code == 200
    # the computed list is untouched: the next publish or correction of this deal starts from it again
    rec = client.get(V1 + f"/uploads/{uid}/recipients", headers=TAO).json()
    assert [x["user_id"] for x in rec["notified"]] == [A1, AN, IV, MV]


@pytest.mark.parametrize("body", [None, {}, {"notify": None}, {"notify": {}}, {"notify": {"add": [], "remove": []}}])
def test_empty_or_missing_notify_is_as_before(client, people, body):
    uid = in_review(client)
    assert client.post(V1 + f"/uploads/{uid}/approve", headers=H(A1), json=body).status_code == 200
    d = audit(client, uid, "publish")[0]["detail"]
    assert d["recipients"] == [A1, AN] and d["notified_added"] == [] and d["notified_removed"] == []


def test_partner_user_cannot_be_added_while_partner_notifications_are_off_then_can(client, people):
    uid = in_review(client)
    assert code(client.post(V1 + f"/uploads/{uid}/approve", headers=H(A1), json={"notify": {"add": [IA]}})) == (422, "invalid")
    partners_on(client)
    r = client.post(V1 + f"/uploads/{uid}/approve", headers=H(A1), json={"notify": {"add": [IA], "remove": [IV, MV]}})
    assert r.status_code == 200
    assert "report_published" in kinds(client, IA) and "report_published" not in kinds(client, IV) + kinds(client, MV)


# ---- audit ----
def test_hold_actions_are_reports_scope_and_in_the_activity_trail(client):
    uid = in_review(client)
    hold(client, uid, {"note": "waiting"})
    release(client, uid)
    A = V1 + "/audit"
    trail = [e["action"] for e in client.get(A, headers=ANALYST, params={"upload_id": uid, "scope": "reports"}).json()]
    assert trail[:2] == ["hold_release", "hold"]
    assert [e["action"] for e in client.get(A, headers=TAO, params={"scope": "reports", "action": "hold"}).json()] == ["hold"]
    assert client.get(A, headers=TAO, params={"scope": "platform", "action": "hold"}).json() == []
    assert client.get(A, headers=TAO, params={"scope": "platform", "action": "hold_release"}).json() == []
    e = client.get(A, headers=TAO, params={"action": "hold_release"}).json()[0]
    assert e["upload_id"] == uid and e["deal_slug"] == DEAL and e["collection_period"] == PERIOD and e["detail"] == {"note": "waiting"}
    assert [x["action"] for x in client.get(A, headers=TAO, params={"q": "waiting", "scope": "reports"}).json()] == ["hold_release", "hold"]


# ---- nothing leaks to partner routes ----
def test_partners_never_see_hold_or_draft(client, people):
    partners_on(client)
    uid = in_review(client)
    secret, draft = "internal-hold-note-zx81", "internal-draft-note-qv42"
    hold(client, uid, {"note": secret, "note_to_partners": draft, "notify": {"remove": [IV]}})
    for h in (INV, H(IV), H(IA), MGR):
        assert client.get(V1 + f"/uploads/{uid}", headers=h).status_code == 403
        assert client.get(V1 + "/uploads", headers=h).status_code == 403
        assert client.get(V1 + f"/uploads/{uid}/recipients", headers=h).status_code == 403
        assert client.get(V1 + "/audit", headers=h, params={"upload_id": uid}).status_code == 403
    client.post(V1 + f"/uploads/{uid}/approve", headers=H(A1), json={"note_to_partners": "Public note."})
    for h in (INV, H(IV)):
        seen = "".join(client.get(V1 + path, headers=h).text for path in
                       ("/published/portfolio", "/published/programs/f-pil-2-0", f"/published/programs/f-pil-2-0/deals/{DEAL}",
                        "/notifications" if "X-User" in h else "/published/portfolio"))
        assert secret not in seen and draft not in seen and '"hold"' not in seen and '"draft"' not in seen
        assert "held_" not in seen and "draft_notify" not in seen
    assert "Public note." in client.get(V1 + f"/published/programs/f-pil-2-0/deals/{DEAL}", headers=INV).text
