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
              ("put", "/api/v1/master/deals"), ("put", "/api/v1/master/covenants"), ("post", "/api/v1/published/regenerate"), ("get", "/api/v1/audit"),
              ("get", "/api/v1/audit?scope=platform"), ("get", "/api/v1/audit/months?scope=platform"),
              ("get", "/api/v1/audit/export.csv?scope=platform&month=2026-11")]
# scope=reports: both TAO roles read it, partners never (test_audit.py covers the analyst side)
TAO_ONLY += [("get", "/api/v1/audit?scope=reports"), ("get", "/api/v1/audit/months?scope=reports"),
             ("get", "/api/v1/audit/export.csv?scope=reports&month=2026-11")]

@pytest.mark.parametrize("method,path", TAO_ONLY + ADMIN_ONLY)
@pytest.mark.parametrize("h", [INV, MGR])
def test_partner_roles_blocked_from_intake(method, path, h): assert c.request(method, path, headers=h).status_code == 403

@pytest.mark.parametrize("method,path", ADMIN_ONLY)
def test_analyst_blocked_from_admin_routes(method, path): assert c.request(method, path, headers=ANALYST).status_code == 403

# ---- wave B: value edits, corrections, covenant history. tao_admin writes; tao_analyst reads the GETs; partners get 403 ----
E = U + "/edits"
K = "/api/v1/corrections/00000000-0000-4000-8000-000000000002"
WAVE_B_READS = [("get", E), ("get", U + "/corrections"), ("get", "/api/v1/corrections"), ("get", "/api/v1/corrections?status=needs_review"),
                ("get", K), ("get", "/api/v1/master/covenants?include_history=true")]
WAVE_B_WRITES = [("post", E), ("post", E + "/00000000-0000-4000-8000-000000000003/revert"), ("post", U + "/corrections"),
                 ("post", K + "/approve"), ("post", K + "/reject")]

@pytest.mark.parametrize("method,path", WAVE_B_READS + WAVE_B_WRITES)
@pytest.mark.parametrize("h", [INV, MGR, {"X-Role": "investor_admin", "X-Partner": "investor"}, {"X-Role": "manager_viewer", "X-Partner": "manager"}])
def test_partner_roles_blocked_from_wave_b(method, path, h): assert c.request(method, path, headers=h).status_code == 403

@pytest.mark.parametrize("method,path", WAVE_B_WRITES)
def test_analyst_blocked_from_wave_b_writes(method, path): assert c.request(method, path, headers=ANALYST).status_code == 403

@pytest.mark.parametrize("method,path", WAVE_B_READS)
def test_analyst_reads_wave_b(method, path): assert c.request(method, path, headers=ANALYST).status_code in (200, 404)
