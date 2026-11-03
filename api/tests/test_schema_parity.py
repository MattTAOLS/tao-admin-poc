"""The worker writes with raw SQL. A database built by create_all must accept those writes the way migration 001 does:
ids are the dashed text the API returns, and timestamps default on the server when the insert omits them."""
import json, uuid
from sqlalchemy import text
from conftest import TAO
from test_uploads import upload
from app import db


def test_raw_sql_extraction_with_dashed_id_and_no_created_at(client):
    u = upload(client).json()
    assert len(u["id"]) == 36 and u["id"].count("-") == 4
    ex_id = str(uuid.uuid4())
    meta = {"upload_id": u["id"], "pass": 1, "template_id": "fpil-2.0-settrep-v1", "page_count": 3, "reporting_period": "2026-08"}
    js = "CAST(:{} AS jsonb)" if db.engine().dialect.name == "postgresql" else ":{}"
    with db.engine().begin() as c:
        n = c.execute(text("update setrep_upload set status = 'needs_review' where id = :id"), {"id": u["id"]}).rowcount
        assert n == 1                                            # dashed id matches the stored row
        c.execute(text(f"insert into extraction (id, upload_id, pass, meta, deal, sources) values (:id, :uid, 1, "
                       f"{js.format('meta')}, {js.format('deal')}, {js.format('sources')})"),
                  {"id": ex_id, "uid": u["id"], "meta": json.dumps(meta), "deal": json.dumps({"deal_slug": "f-pil-2-0-moneda-capital-corp"}),
                   "sources": "{}"})
        c.execute(text("insert into review_action (id, upload_id, actor_role, action) values (:id, :uid, 'worker', 'extract')"),
                  {"id": str(uuid.uuid4()), "uid": u["id"]})
    r = client.get(f"/api/v1/uploads/{u['id']}/extraction", headers=TAO)
    assert r.status_code == 200, r.text
    ex = r.json()
    assert ex["id"] == ex_id and ex["upload_id"] == u["id"] and ex["created_at"] and ex["meta"]["reporting_period"] == "2026-08"
    up = client.get(f"/api/v1/uploads/{u['id']}", headers=TAO).json()
    assert up["status"] == "needs_review" and up["latest_extraction_id"] == ex_id
    assert any(a["action"] == "extract" and a["at"] for a in client.get("/api/v1/audit", headers=TAO, params={"upload_id": u["id"]}).json())
