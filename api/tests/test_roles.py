"""Role gate tests — the tenancy boundary in one file. Every route in openapi.yaml should get a line here."""
from fastapi.testclient import TestClient
from app.main import app
c = TestClient(app)
TAO = {"X-Role": "tao_admin"}; ANALYST = {"X-Role": "tao_analyst"}
INV = {"X-Role": "investor_viewer", "X-Partner": "investor"}

def test_health(): assert c.get("/api/v1/health").status_code == 200
def test_partner_cannot_list_uploads(): assert c.get("/api/v1/uploads", headers=INV).status_code == 403
def test_partner_needs_partner_header(): assert c.get("/api/v1/published/portfolio", headers={"X-Role": "investor_viewer"}).status_code == 403
def test_partner_wrong_partner_header(): assert c.get("/api/v1/published/portfolio", headers={"X-Role": "investor_viewer", "X-Partner": "manager"}).status_code == 403
def test_analyst_cannot_approve(): assert c.post("/api/v1/uploads/x/approve", headers=ANALYST).status_code == 403
def test_unknown_role(): assert c.get("/api/v1/uploads", headers={"X-Role": "root"}).status_code == 403
def test_tao_lists_uploads(): assert c.get("/api/v1/uploads", headers=TAO).status_code == 200
def test_partner_portfolio_is_filtered():
    r = c.get("/api/v1/published/portfolio", headers=INV); assert r.status_code == 200 and r.json()["partner"] == "investor"

# ---- one line per contract route: who may not call it (gate runs before any lookup or body validation) ----
import pytest
U = "/api/v1/uploads/00000000-0000-4000-8000-000000000000"
F = U + "/findings/00000000-0000-4000-8000-000000000001"
MGR = {"X-Role": "manager_admin", "X-Partner": "manager"}
TAO_ONLY = [("post", "/api/v1/uploads"), ("get", "/api/v1/uploads"), ("get", U), ("get", U + "/extraction"), ("get", U + "/findings"),
            ("post", U + "/reextract"), ("get", U + "/pages/1.png"), ("get", U + "/file"),
            ("get", "/api/v1/master/programs"), ("get", "/api/v1/master/deals"), ("get", "/api/v1/master/covenants")]
ADMIN_ONLY = [("post", F + "/override"), ("post", U + "/approve"), ("post", U + "/reject"), ("put", "/api/v1/master/programs"),
              ("put", "/api/v1/master/deals"), ("put", "/api/v1/master/covenants"), ("post", "/api/v1/published/regenerate"), ("get", "/api/v1/audit")]

@pytest.mark.parametrize("method,path", TAO_ONLY + ADMIN_ONLY)
@pytest.mark.parametrize("h", [INV, MGR])
def test_partner_roles_blocked_from_intake(method, path, h): assert c.request(method, path, headers=h).status_code == 403

@pytest.mark.parametrize("method,path", ADMIN_ONLY)
def test_analyst_blocked_from_admin_routes(method, path): assert c.request(method, path, headers=ANALYST).status_code == 403
