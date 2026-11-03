"""Published views and the tenancy boundary. Publications are the 12 real deal objects (seed --reference-publications)."""
import json, math
import pytest
from conftest import TAO, ANALYST, INV, MGR, REF
from app import db, seed
from app.models import Program

P = "/api/v1/published"
INV_ADMIN = {"X-Role": "investor_admin", "X-Partner": "investor"}
MGR_ADMIN = {"X-Role": "manager_admin", "X-Partner": "manager"}


@pytest.fixture(autouse=True)
def published():
    with db.session() as s:
        seed.load_reference_publications(s)


def give_program_to_manager(slug="f-pil-2-0"):
    with db.session() as s:
        s.get(Program, slug).partner_slug = "manager"; s.commit()


def test_portfolio_tao_sees_all(client):
    r = client.get(f"{P}/portfolio", headers=ANALYST).json()
    assert r["partner"] is None and {p["program"]["slug"] for p in r["programs"]} == {"move-trust", "f-pil-2-0"}
    fpil = next(p for p in r["programs"] if p["program"]["slug"] == "f-pil-2-0")
    assert fpil["period"] == "2026-08" and fpil["deal_count"] == 3 and fpil["covenant_totals"] == {"BREACH": 0, "WATCH": 3, "OK": 22, "AVAILABLE": 0}
    assert {d["deal_slug"] for d in fpil["deals"]} == {"f-pil-2-0-moneda-capital-corp", "f-pil-2-0-stride-capital", "f-pil-2-0-xpedite-leasing"}
    assert set(fpil["deals"][0]) == {"deal_slug", "deal_name", "collection_period", "worst_status", "covenant_summary", "closing_tranche_balance"}


def test_portfolio_is_partner_filtered(client):
    assert {p["program"]["slug"] for p in client.get(f"{P}/portfolio", headers=INV).json()["programs"]} == {"move-trust", "f-pil-2-0"}
    r = client.get(f"{P}/portfolio", headers=MGR).json()
    assert r == {"partner": "manager", "programs": []}
    give_program_to_manager()
    assert [p["program"]["slug"] for p in client.get(f"{P}/portfolio", headers=MGR_ADMIN).json()["programs"]] == ["f-pil-2-0"]
    assert [p["program"]["slug"] for p in client.get(f"{P}/portfolio", headers=INV_ADMIN).json()["programs"]] == ["move-trust"]


@pytest.mark.parametrize("slug", ["f-pil-2-0", "move-trust"])
def test_program_matches_real_aggregate(client, slug):
    real = json.loads((REF / f"program-{slug}.dashboard.json").read_text(encoding="utf-8"))
    r = client.get(f"{P}/programs/{slug}", headers=INV)
    assert r.status_code == 200
    got = r.json()
    assert set(real) <= set(got)
    assert got["period"] == real["period"] and got["covenant_totals"] == real["covenant_totals"] and got["deal_count"] == real["deal_count"]
    for k, v in real["portfolio_totals"].items():
        if isinstance(v, (int, float)):
            assert math.isclose(got["portfolio_totals"][k], v, rel_tol=1e-9, abs_tol=0.005), k
    assert sorted(d["deal_slug"] for d in got["deals"]) == sorted(d["deal_slug"] for d in real["deals"])
    assert got["available_periods"] == [real["period"]]


def test_program_period_param(client):
    assert client.get(f"{P}/programs/f-pil-2-0", headers=TAO, params={"period": "2026-08"}).status_code == 200
    assert client.get(f"{P}/programs/f-pil-2-0", headers=TAO, params={"period": "2026-07"}).status_code == 404
    assert client.get(f"{P}/programs/f-pil-2-0", headers=TAO, params={"period": "Aug 2026"}).status_code == 422
    assert client.get(f"{P}/programs/nope", headers=TAO).status_code == 404


def test_deal_route(client):
    r = client.get(f"{P}/programs/f-pil-2-0/deals/f-pil-2-0-stride-capital", headers=INV)
    assert r.status_code == 200
    d = r.json()
    real = json.loads((REF / "f-pil-2-0-stride-capital.dashboard.json").read_text(encoding="utf-8"))
    assert {k: d[k] for k in real} == real
    assert d["published_by"] == "seed" and d["upload_id"] and d["published_at"] and d["published_period"] == "2026-08"
    assert client.get(f"{P}/programs/f-pil-2-0/deals/f-pil-2-0-stride-capital", headers=TAO, params={"period": "2026-07"}).status_code == 404
    assert client.get(f"{P}/programs/move-trust/deals/f-pil-2-0-stride-capital", headers=TAO).status_code == 404   # wrong program
    assert client.get(f"{P}/programs/f-pil-2-0/deals/nope", headers=TAO).status_code == 404


# ---- negative tenancy: another partner's resources look missing (404), never forbidden-but-present ----
@pytest.mark.parametrize("h", [MGR, MGR_ADMIN])
def test_manager_cannot_read_investor_program_or_deal(client, h):
    r = client.get(f"{P}/programs/f-pil-2-0", headers=h)
    assert r.status_code == 404 and r.json()["code"] == "not_found"
    assert client.get(f"{P}/programs/move-trust/deals/move-trust-vcc-iv-lp", headers=h).status_code == 404
    assert client.get(f"{P}/programs/move-trust/deals/move-trust-vcc-iv-lp", headers=h, params={"period": "2026-07"}).status_code == 404


def test_investor_cannot_read_manager_program_after_reassignment(client):
    give_program_to_manager()
    assert client.get(f"{P}/programs/f-pil-2-0", headers=INV).status_code == 404
    assert client.get(f"{P}/programs/f-pil-2-0/deals/f-pil-2-0-moneda-capital-corp", headers=INV).status_code == 404
    assert client.get(f"{P}/programs/f-pil-2-0/deals/f-pil-2-0-moneda-capital-corp", headers=MGR).status_code == 200
    assert client.get(f"{P}/programs/move-trust", headers=INV).status_code == 200


@pytest.mark.parametrize("path", ["portfolio", "programs/f-pil-2-0", "programs/f-pil-2-0/deals/f-pil-2-0-stride-capital"])
def test_partner_role_must_match_partner_header(client, path):
    assert client.get(f"{P}/{path}", headers={"X-Role": "investor_viewer", "X-Partner": "manager"}).status_code == 403
    assert client.get(f"{P}/{path}", headers={"X-Role": "manager_viewer"}).status_code == 403
    assert client.get(f"{P}/{path}", headers={}).status_code == 422          # X-Role missing


def test_regenerate(client):
    assert client.post(f"{P}/regenerate", headers=ANALYST, json={}).status_code == 403
    assert client.post(f"{P}/regenerate", headers=INV_ADMIN, json={}).status_code == 403
    r = client.post(f"{P}/regenerate", headers=TAO, json={"program_slug": "f-pil-2-0"})
    assert r.status_code == 202 and r.json() == {"queued": True, "programs": ["f-pil-2-0"], "publications": 3}
    assert client.post(f"{P}/regenerate", headers=TAO).json()["publications"] == 12
    assert client.post(f"{P}/regenerate", headers=TAO, json={"program_slug": "nope"}).status_code == 404
    a = client.get("/api/v1/audit", headers=TAO).json()
    assert [x["action"] for x in a[:2]] == ["regenerate", "regenerate"]


def test_audit_route(client):
    assert client.get("/api/v1/audit", headers=ANALYST).status_code == 403
    assert client.get("/api/v1/audit", headers=INV_ADMIN).status_code == 403
    a = client.get("/api/v1/audit", headers=TAO).json()
    assert len(a) == 12 and {x["action"] for x in a} == {"publish"}
    assert set(a[0]) >= {"id", "at", "actor_role", "action", "upload_id"}
    one = a[0]["upload_id"]
    assert [x["upload_id"] for x in client.get("/api/v1/audit", headers=TAO, params={"upload_id": one}).json()] == [one]
    assert client.get("/api/v1/audit", headers=TAO, params={"upload_id": "x"}).status_code == 422
