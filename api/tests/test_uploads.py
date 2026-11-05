import pathlib
import pytest
from conftest import TAO, ANALYST, INV, MGR, make_pdf
from app import db, seed, jobs
from app.main import app

DEAL = "f-pil-2-0-moneda-capital-corp"


def upload(client, period="2026-09", deal=DEAL, pdf=None, headers=TAO, name="Moneda-202609 -SETTREP.pdf"):
    return client.post("/api/v1/uploads", headers=headers, data={"deal_slug": deal, "collection_period": period},
                       files={"file": (name, pdf if pdf is not None else make_pdf(3), "application/pdf")})


def test_create_upload_stores_file_counts_pages_and_queues(client, queue):
    r = upload(client)
    assert r.status_code == 201, r.text
    u = r.json()
    assert u["status"] == "received" and u["page_count"] == 3 and u["program_slug"] == "f-pil-2-0" and u["partner_slug"] == "investor"
    assert u["uploaded_by"] == "tao_admin" and u["file_name"] == "Moneda-202609 -SETTREP.pdf" and u["finding_counts"] == {"block": 0, "review": 0, "note": 0}
    assert queue.jobs == [{"upload_id": u["id"], "pass": 1, "template_id": "fpil-2.0-settrep-v1"}]
    from app.db import file_store
    assert (file_store() / "uploads" / u["id"] / "source.pdf").read_bytes()[:5] == b"%PDF-"
    audit = client.get("/api/v1/audit", headers=TAO, params={"upload_id": u["id"]}).json()
    assert [a["action"] for a in audit] == ["upload"]


def test_analyst_may_upload(client):
    assert upload(client, headers=ANALYST).status_code == 201


@pytest.mark.parametrize("h", [INV, MGR])
def test_partner_cannot_upload(client, h, queue):
    assert upload(client, headers=h).status_code == 403 and queue.jobs == []


def test_upload_validation(client):
    assert upload(client, period="2026-13").status_code == 422
    assert upload(client, deal="no-such-deal").status_code == 422
    r = upload(client, pdf=b"not a pdf")
    assert r.status_code == 422 and r.json()["code"] == "not_a_pdf"


def test_r12_precheck_refuses_published_period(client, queue):
    with db.session() as s:
        seed.load_reference_publications(s)
    r = upload(client, period="2026-08")
    assert r.status_code == 409 and r.json()["code"] == "already_published"
    assert queue.jobs == []


def test_one_active_upload_per_deal_period_but_rejected_can_repeat(client):
    first = upload(client).json()
    r = upload(client)
    assert r.status_code == 409 and r.json()["code"] == "upload_in_progress"
    assert client.post(f"/api/v1/uploads/{first['id']}/reject", headers=TAO, json={"reason": "wrong file"}).status_code == 200
    second = upload(client)
    assert second.status_code == 201
    assert client.post(f"/api/v1/uploads/{second.json()['id']}/reject", headers=TAO, json={"reason": "wrong again"}).status_code == 200
    assert upload(client).status_code == 201


def test_queue_down_marks_upload_failed(client):
    class Down:
        def push(self, job): raise ConnectionError("redis down")
    app.dependency_overrides[jobs.get_queue] = lambda: Down()
    r = upload(client)
    assert r.status_code == 201 and r.json()["status"] == "extraction_failed" and r.json()["failure_reason"] == "queue unavailable"
    assert client.get(f"/api/v1/uploads/{r.json()['id']}", headers=ANALYST).json()["failure_reason"] == "queue unavailable"


def test_worker_failure_reason_is_on_the_upload(client):
    from worker.validate.adapter import mark_failed
    u = upload(client).json()
    assert u["failure_reason"] is None
    with db.engine().begin() as c:
        mark_failed(u["id"], "no template matched page 1", conn=c)
    got = client.get(f"/api/v1/uploads/{u['id']}", headers=ANALYST).json()
    assert got["status"] == "extraction_failed" and got["failure_reason"] == "no template matched page 1"
    assert [x["failure_reason"] for x in client.get("/api/v1/uploads", headers=TAO, params={"status": "extraction_failed"}).json()] == [got["failure_reason"]]


def test_list_and_filter_uploads(client):
    a = upload(client).json()
    b = upload(client, deal="f-pil-2-0-stride-capital").json()
    client.post(f"/api/v1/uploads/{b['id']}/reject", headers=TAO, json={"reason": "duplicate"})
    all_ = client.get("/api/v1/uploads", headers=ANALYST).json()
    assert {u["id"] for u in all_} == {a["id"], b["id"]}
    assert [u["id"] for u in client.get("/api/v1/uploads", headers=TAO, params={"status": "rejected"}).json()] == [b["id"]]
    assert [u["id"] for u in client.get("/api/v1/uploads", headers=TAO, params={"deal_slug": DEAL}).json()] == [a["id"]]
    assert client.get("/api/v1/uploads", headers=TAO, params={"status": "bogus"}).status_code == 422


def test_get_upload(client):
    u = upload(client).json()
    assert client.get(f"/api/v1/uploads/{u['id']}", headers=TAO).json()["id"] == u["id"]
    assert client.get(f"/api/v1/uploads/{u['id']}", headers=INV).status_code == 403
    r = client.get("/api/v1/uploads/00000000-0000-4000-8000-000000000000", headers=TAO)
    assert r.status_code == 404 and r.json() == {"code": "not_found", "message": "no such upload"}
    assert client.get("/api/v1/uploads/not-a-uuid", headers=TAO).status_code == 404


def test_page_image_renders_at_110_dpi_and_caches(client):
    u = upload(client).json()
    r = client.get(f"/api/v1/uploads/{u['id']}/pages/2.png", headers=ANALYST)
    assert r.status_code == 200 and r.headers["content-type"] == "image/png" and r.content[:4] == b"\x89PNG"
    from PIL import Image
    import io
    w, h = Image.open(io.BytesIO(r.content)).size
    assert (w, h) == (round(612 * 110 / 72), round(792 * 110 / 72))
    from app.db import file_store
    assert (file_store() / "uploads" / u["id"] / "pages" / "110" / "2.png").exists()
    assert client.get(f"/api/v1/uploads/{u['id']}/pages/2.png", headers=TAO).content == r.content
    assert client.get(f"/api/v1/uploads/{u['id']}/pages/2.png?dpi=110", headers=TAO).content == r.content
    assert client.get(f"/api/v1/uploads/{u['id']}/pages/4.png", headers=TAO).status_code == 404
    assert client.get(f"/api/v1/uploads/{u['id']}/pages/0.png", headers=TAO).status_code == 404
    assert client.get(f"/api/v1/uploads/{u['id']}/pages/1.png", headers=INV).status_code == 403


def test_page_image_at_each_dpi_is_cached_separately(client):
    from PIL import Image
    import io
    from app.db import file_store
    u = upload(client).json()
    base = f"/api/v1/uploads/{u['id']}/pages/2.png"
    small = client.get(base, headers=TAO).content                          # 110 cached first
    for dpi in (110, 200, 300):
        r = client.get(base, headers=TAO, params={"dpi": dpi})
        assert r.status_code == 200 and r.headers["content-type"] == "image/png"
        w, h = Image.open(io.BytesIO(r.content)).size                     # never a cached 110 (PDFium may round up a pixel)
        assert abs(w - 612 * dpi / 72) <= 1 and abs(h - 792 * dpi / 72) <= 1, (dpi, w, h)
        assert (file_store() / "uploads" / u["id"] / "pages" / str(dpi) / "2.png").exists()
        assert client.get(base, headers=TAO, params={"dpi": dpi}).content == r.content
    assert client.get(base, headers=TAO, params={"dpi": 300}).content != small
    assert client.get(base, headers=INV, params={"dpi": 300}).status_code == 403


def test_page_image_rejects_other_dpi(client):
    u = upload(client).json()
    for bad in ("72", "150", "301", "abc", "0"):
        r = client.get(f"/api/v1/uploads/{u['id']}/pages/1.png", headers=TAO, params={"dpi": bad})
        assert r.status_code == 422 and r.json()["code"] == "invalid", bad


def test_file_route_returns_the_pdf(client):
    pdf = make_pdf(2)
    u = upload(client, pdf=pdf).json()
    r = client.get(f"/api/v1/uploads/{u['id']}/file", headers=TAO)
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf" and r.content == pdf
    assert client.get(f"/api/v1/uploads/{u['id']}/file", headers=MGR).status_code == 403
