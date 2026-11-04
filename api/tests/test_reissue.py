"""Corrected re-issue of a published month: upload with replace=true, approve swaps the publication."""
import pytest
from conftest import TAO, INV, MGR, reference_deal, make_pdf
from test_review import worker_writes, DEAL
from app import db
from app.models import Publication

PERIOD = "2026-08"


def post(client, replace=None, period=PERIOD):
    data = {"deal_slug": DEAL, "collection_period": period}
    if replace is not None:
        data["replace"] = "true" if replace else "false"
    return client.post("/api/v1/uploads", headers=TAO, data=data,
                       files={"file": ("Moneda-202608 -SETTREP.pdf", make_pdf(3), "application/pdf")})


@pytest.fixture
def published(client):
    u = post(client).json()
    worker_writes(u["id"], reference_deal(DEAL))
    assert client.post(f"/api/v1/uploads/{u['id']}/approve", headers=TAO).json()["status"] == "published"
    return u["id"]


def corrected_deal():
    d = reference_deal(DEAL)
    d["source_file"] = "Moneda-202608 -SETTREP (corrected).pdf"           # one deliberate change: the re-issued file
    return d


def test_published_period_without_flag_is_409(client, published):
    for flag in (None, False):
        r = post(client, replace=flag)
        assert r.status_code == 409 and r.json()["code"] == "already_published"


def test_replace_without_publication_is_422(client):
    r = post(client, replace=True)
    assert r.status_code == 422 and r.json()["code"] == "nothing_to_replace"


def test_reissue_links_and_swaps_publication_on_approve(client, published, queue):
    r = post(client, replace=True)
    assert r.status_code == 201, r.text
    new = r.json()
    assert new["replaces_upload_id"] == published and new["replaced_by_upload_id"] is None and new["status"] == "received"
    assert queue.jobs[-1] == {"upload_id": new["id"], "pass": 1, "template_id": "fpil-2.0-settrep-v1"}
    assert post(client, replace=True).json()["code"] == "upload_in_progress"            # one active upload still holds
    old = client.get(f"/api/v1/uploads/{published}", headers=TAO).json()
    assert old["status"] == "published" and old["replaced_by_upload_id"] is None          # not until approve
    worker_writes(new["id"], corrected_deal())
    assert client.post(f"/api/v1/uploads/{new['id']}/approve", headers=TAO).json()["status"] == "published"
    with db.session() as s:
        pubs = s.query(Publication).filter_by(deal_slug=DEAL, collection_period=PERIOD).all()
        assert len(pubs) == 1 and pubs[0].upload_id == new["id"] and pubs[0].rollup_version == 2
    old = client.get(f"/api/v1/uploads/{published}", headers=TAO).json()
    assert old["status"] == "published" and old["replaced_by_upload_id"] == new["id"]
    for h in (INV, MGR):
        d = client.get(f"/api/v1/published/programs/f-pil-2-0/deals/{DEAL}", headers=h).json()
        assert d["upload_id"] == new["id"] and d["source_file"].endswith("(corrected).pdf")
    prog = client.get("/api/v1/published/programs/f-pil-2-0", headers=INV).json()
    assert next(x for x in prog["deals"] if x["deal_slug"] == DEAL)["source_file"].endswith("(corrected).pdf")
    pub = client.get("/api/v1/audit", headers=TAO, params={"upload_id": new["id"], "action": "publish"}).json()
    assert pub[0]["detail"]["replaced_upload_id"] == published
    up = client.get("/api/v1/audit", headers=TAO, params={"upload_id": new["id"], "action": "upload"}).json()
    assert up[0]["detail"]["replaces_upload_id"] == published
    assert [a["action"] for a in client.get("/api/v1/audit", headers=TAO, params={"upload_id": published, "action": "publish"}).json()] == ["publish"]


def test_rejected_reissue_leaves_original_publication(client, published):
    new = post(client, replace=True).json()
    worker_writes(new["id"], corrected_deal())
    assert client.post(f"/api/v1/uploads/{new['id']}/reject", headers=TAO, json={"reason": "still wrong"}).json()["status"] == "rejected"
    with db.session() as s:
        assert s.query(Publication).filter_by(deal_slug=DEAL, collection_period=PERIOD).one().upload_id == published
    assert client.get(f"/api/v1/uploads/{published}", headers=TAO).json()["replaced_by_upload_id"] is None
    assert client.get(f"/api/v1/published/programs/f-pil-2-0/deals/{DEAL}", headers=INV).json()["upload_id"] == published
    assert post(client, replace=True).status_code == 201                                  # can try again


def test_override_context_carries_replaces_upload_id(client, published):
    from app import review
    from app.models import SetrepUpload
    new = post(client, replace=True).json()
    with db.session() as s:
        ctx = review.build_context(s, s.get(SetrepUpload, new["id"]))
        assert ctx.upload["replaces_upload_id"] == published and PERIOD in ctx.published_periods
        pub_at = s.query(Publication).filter_by(deal_slug=DEAL, collection_period=PERIOD).one().published_at
        assert isinstance(ctx.published_periods, dict) and ctx.published_periods[PERIOD][:10] == pub_at.isoformat()[:10]


def test_rerun_r12_message_carries_publication_date(client, published):
    """Override on a re-issue re-runs the rules with the API's Context; R12 must name the date, not 'earlier'."""
    new = post(client, replace=True).json()
    ex_id = worker_writes(new["id"], corrected_deal())
    published_at = client.get(f"/api/v1/uploads/{published}", headers=TAO).json()["published_at"]
    # store R12 as an older set-based Context produced it ("published earlier"); the override re-run must replace that
    from rules import run
    from rules.engine import Context
    from app.models import Extraction, Finding
    with db.session() as s:
        ex = s.get(Extraction, ex_id)
        old = [f for f in run({"meta": ex.meta, "deal": ex.deal, "sources": {}},
                              Context(published_periods={PERIOD}, upload={"replaces_upload_id": published}), phases=(1, 2)) if f["rule_id"] == "R12"]
        assert len(old) == 1 and "earlier" in old[0]["message"]
        f = old[0]; f.pop("id"); f.pop("created_at"); f["extraction_id"] = ex_id
        s.add(Finding(**f)); s.commit()
    r12 = next(f for f in client.get(f"/api/v1/uploads/{new['id']}/findings", headers=TAO).json() if f["rule_id"] == "R12")
    r = client.post(f"/api/v1/uploads/{new['id']}/findings/{r12['id']}/override", headers=TAO,
                    json={"choice": "acknowledge", "reason": "servicer re-issued the month"})
    assert r.status_code == 200, r.text
    after = next(f for f in r.json() if f["id"] == r12["id"])
    assert after["status"] == "overridden" and after["context"]["published_at"] == published_at
    assert published_at in after["message"] and "earlier" not in after["message"].split("published")[1][:12]
