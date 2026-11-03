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
