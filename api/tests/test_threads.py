"""Wave C comment threads (contract Thread, Comment): TAO only, writes need a user; mentions of active TAO users only;
author-only edits with the old text in the audit log; resolve / reopen by any TAO Admin or the starter; threads carry over
to a correction (same upload) and are listed on a corrected re-issue (new upload)."""
import pytest
from conftest import TAO, ANALYST, INV, reference_deal, make_pdf
from test_review import worker_writes, broken_deal, DEAL
from test_uploads import upload
from test_users import A1, A2, AN, IV, H, code

V1 = "/api/v1"
AN2 = "00000000-0000-4000-8000-000000000004"
INTEREST = "/period_history/3/interest"


@pytest.fixture
def pending(client):
    u = upload(client, period="2026-08").json()
    worker_writes(u["id"], broken_deal())
    r05 = next(f for f in client.get(V1 + f"/uploads/{u['id']}/findings", headers=TAO).json() if f["rule_id"] == "R05")
    return u["id"], r05["id"]


def start(client, uid, who=AN, anchor=None, body="R05 gap is exactly 100.00; principal on page 2?", mentions=()):
    return client.post(V1 + f"/uploads/{uid}/threads", headers=H(who), json={"anchor": anchor or {"pointer": INTEREST}, "body": body,
                                                                               "mentions": list(mentions)})


def notes(client, uid, kind):
    return [n for n in client.get(V1 + "/notifications", headers=H(uid)).json() if n["kind"] == kind]


def test_start_thread_on_a_finding_with_a_mention(client, pending):
    uid, fid = pending
    r = start(client, uid, anchor={"finding_id": fid}, mentions=[A1])
    assert r.status_code == 201, r.text
    t = r.json()
    assert t["anchor"] == {"finding_id": fid, "rule_id": "R05"} and t["status"] == "open" and t["version"] is None
    assert t["created_by"] == {"id": AN, "name": "J. Moreau"} and t["resolved_by"] is None
    [c] = t["comments"]
    assert c["author"]["name"] == "J. Moreau" and c["mentions"] == [A1] and c["edited_at"] is None
    [n] = notes(client, A1, "mention")
    assert n["thread_id"] == t["id"] and n["link"] == f"/admin/uploads/queue/{uid}?thread={t['id']}" and n["title"].startswith("J. Moreau mentioned you")
    assert notes(client, AN, "mention") == [] and notes(client, A2, "mention") == []
    a = client.get(V1 + "/audit", headers=TAO, params={"upload_id": uid, "action": "comment"}).json()[0]
    assert a["actor_label"] == "J. Moreau" and a["detail"]["body"] == c["body"] and a["detail"]["mentions"] == [A1]
    assert a["detail"]["anchor"] == {"finding_id": fid, "rule_id": "R05"}
    assert client.get(V1 + "/audit", headers=ANALYST, params={"scope": "reports", "action": "comment"}).json()        # Reports side


def test_anchor_and_mention_errors(client, pending):
    uid, fid = pending
    other = upload(client, period="2026-10").json()["id"]
    worker_writes(other, broken_deal())
    assert code(start(client, other, anchor={"finding_id": fid})) == (422, "invalid")                 # finding of another upload
    assert code(start(client, uid, anchor={"pointer": "/no/such/value"})) == (422, "invalid")
    assert code(start(client, uid, anchor={"finding_id": fid, "pointer": INTEREST})) == (422, "invalid")
    assert code(start(client, uid, anchor={"rule_id": "R05"})) == (422, "invalid")                    # neither
    assert code(start(client, uid, mentions=[IV])) == (422, "bad_mention")                              # partner user
    assert code(start(client, uid, mentions=["00000000-0000-4000-8000-0000000000ff"])) == (422, "bad_mention")
    client.post(V1 + f"/users/{A2}/deactivate", headers=TAO, json={"reason": "left"})
    assert code(start(client, uid, mentions=[A2])) == (422, "bad_mention")                              # deactivated
    assert start(client, uid, body="").status_code == 422 and start(client, uid, body="x" * 4001).status_code == 422
    assert code(client.post(V1 + "/uploads/00000000-0000-4000-8000-000000000000/threads", headers=H(AN),
                            json={"anchor": {"pointer": INTEREST}, "body": "x"})) == (404, "not_found")


def test_users_and_roles(client, pending):
    uid, _ = pending
    assert code(client.post(V1 + f"/uploads/{uid}/threads", headers=TAO, json={"anchor": {"pointer": INTEREST}, "body": "x"})) == (401, "user_required")
    assert client.get(V1 + f"/uploads/{uid}/threads", headers=ANALYST).json() == []                       # reading needs no user
    assert code(client.get(V1 + f"/uploads/{uid}/threads", headers=H(IV))) == (403, "tao_only")


def test_reply_mentions_and_edits(client, pending):
    uid, _ = pending
    t = start(client, uid).json()
    r = client.post(V1 + f"/threads/{t['id']}/comments", headers=H(A1), json={"body": "Agree. Same pattern as June."})
    assert r.status_code == 201
    [rep] = notes(client, AN, "reply")
    assert rep["title"].startswith("A. Patel replied") and rep["body"] == "Agree. Same pattern as June."
    assert notes(client, A1, "reply") == []                                                           # not the replier
    # A2 replies and mentions AN: AN gets the mention only (once); A1 gets a reply
    client.post(V1 + f"/threads/{t['id']}/comments", headers=H(A2), json={"body": "@J. Moreau acknowledging", "mentions": [AN]})
    assert len(notes(client, AN, "mention")) == 1 and len(notes(client, AN, "reply")) == 1
    assert len(notes(client, A1, "reply")) == 1
    # edit: author only; the old text is in the audit entry; only a newly added mention notifies
    first = t["comments"][0]["id"]
    assert code(client.patch(V1 + f"/comments/{first}", headers=H(A1), json={"body": "hijack"})) == (403, "not_author")
    r = client.patch(V1 + f"/comments/{first}", headers=H(AN), json={"body": "R05 gap is 100.00, page 2 principal", "mentions": [AN2]})
    assert r.status_code == 200 and r.json()["edited_at"] and r.json()["body"] == "R05 gap is 100.00, page 2 principal"
    e = client.get(V1 + "/audit", headers=TAO, params={"upload_id": uid, "action": "comment_edit"}).json()[0]
    assert e["detail"]["before"]["body"] == t["comments"][0]["body"] and e["detail"]["after"]["mentions"] == [AN2]
    assert len(notes(client, AN2, "mention")) == 1
    client.patch(V1 + f"/comments/{first}", headers=H(AN), json={"body": "same mentions again", "mentions": [AN2]})
    assert len(notes(client, AN2, "mention")) == 1
    assert code(client.patch(V1 + "/comments/00000000-0000-4000-8000-0000000000aa", headers=H(AN), json={"body": "x"})) == (404, "not_found")


def test_resolve_and_reopen_rules(client, pending):
    uid, _ = pending
    t = start(client, uid, who=AN).json()
    assert code(client.post(V1 + f"/threads/{t['id']}/resolve", headers=H(AN2))) == (403, "forbidden")      # another analyst
    r = client.post(V1 + f"/threads/{t['id']}/resolve", headers=H(AN))                                          # the starter
    assert r.status_code == 200 and r.json()["status"] == "resolved" and r.json()["resolved_by"]["id"] == AN
    assert code(client.post(V1 + f"/threads/{t['id']}/resolve", headers=H(A1))) == (409, "bad_state")
    assert code(client.post(V1 + f"/threads/{t['id']}/comments", headers=H(A1), json={"body": "late"})) == (409, "bad_state")
    assert code(client.post(V1 + f"/threads/{t['id']}/reopen", headers=H(AN2))) == (403, "forbidden")
    r = client.post(V1 + f"/threads/{t['id']}/reopen", headers=H(A1))                                           # any TAO Admin
    assert r.status_code == 200 and r.json()["status"] == "open" and r.json()["resolved_at"] is None
    assert code(client.post(V1 + f"/threads/{t['id']}/reopen", headers=H(A1))) == (409, "bad_state")
    acts = [a["action"] for a in client.get(V1 + "/audit", headers=TAO, params={"upload_id": uid}).json()]
    assert acts[:3] == ["thread_reopen", "thread_resolve", "comment"]
    second = start(client, uid, who=A1).json()
    client.post(V1 + f"/threads/{second['id']}/resolve", headers=H(A1))
    assert [x["id"] for x in client.get(V1 + f"/uploads/{uid}/threads", headers=TAO).json()] == [t["id"], second["id"]]     # open first
    assert [x["id"] for x in client.get(V1 + f"/uploads/{uid}/threads?status=resolved", headers=TAO).json()] == [second["id"]]
    assert code(client.post(V1 + "/threads/nope/resolve", headers=H(A1))) == (404, "not_found")


def test_threads_carry_over_to_correction_and_reissue(client):
    u = upload(client, period="2026-08").json()
    worker_writes(u["id"], reference_deal(DEAL))
    before = start(client, u["id"]).json()
    assert before["version"] is None
    client.post(V1 + f"/uploads/{u['id']}/approve", headers=TAO)
    v1 = start(client, u["id"], body="after publish").json()
    assert v1["version"] == 1
    k = client.post(V1 + f"/uploads/{u['id']}/corrections", headers=TAO, json={"edits": [{"pointer": INTEREST, "value": 86705.51}],
                    "reason": "servicer restated interest in the cover letter"}).json()
    assert k["status"] == "published"
    listed = client.get(V1 + f"/uploads/{u['id']}/threads", headers=TAO).json()
    assert [(x["id"], x["version"]) for x in listed] == [(before["id"], None), (v1["id"], 1)]
    assert start(client, u["id"], body="on version 2").json()["version"] == 2
    # corrected re-issue: the new upload lists the replaced upload's threads, each with its own upload_id
    new = client.post(V1 + "/uploads", headers=TAO, data={"deal_slug": DEAL, "collection_period": "2026-08", "replace": "true"},
                      files={"file": ("Moneda-202608 -SETTREP.pdf", make_pdf(3), "application/pdf")}).json()
    worker_writes(new["id"], reference_deal(DEAL))
    mine = start(client, new["id"], body="on the re-issue").json()
    listed = client.get(V1 + f"/uploads/{new['id']}/threads", headers=TAO).json()
    assert len(listed) == 4 and {x["upload_id"] for x in listed} == {u["id"], new["id"]} and mine["id"] in [x["id"] for x in listed]
    assert len(client.get(V1 + f"/uploads/{u['id']}/threads", headers=TAO).json()) == 3                  # the old one does not list the new
