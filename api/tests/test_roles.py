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
                 ("post", K + "/approve"), ("post", K + "/reject"), ("post", K + "/findings/00000000-0000-4000-8000-000000000004/override")]

@pytest.mark.parametrize("method,path", WAVE_B_READS + WAVE_B_WRITES)
@pytest.mark.parametrize("h", [INV, MGR, {"X-Role": "investor_admin", "X-Partner": "investor"}, {"X-Role": "manager_viewer", "X-Partner": "manager"}])
def test_partner_roles_blocked_from_wave_b(method, path, h): assert c.request(method, path, headers=h).status_code == 403

@pytest.mark.parametrize("method,path", WAVE_B_WRITES)
def test_analyst_blocked_from_wave_b_writes(method, path): assert c.request(method, path, headers=ANALYST).status_code == 403

@pytest.mark.parametrize("method,path", WAVE_B_READS)
def test_analyst_reads_wave_b(method, path): assert c.request(method, path, headers=ANALYST).status_code in (200, 404)

# ---- wave C: people, notifications, comments, settings ----
W = "/api/v1/users/00000000-0000-4000-8000-000000000001"
T = "/api/v1/threads/00000000-0000-4000-8000-000000000005"
WAVE_C_TAO = [("get", U + "/recipients"), ("get", U + "/threads"), ("post", U + "/threads"), ("post", T + "/comments"),
              ("patch", "/api/v1/comments/00000000-0000-4000-8000-000000000006"), ("post", T + "/resolve"), ("post", T + "/reopen")]
WAVE_C_ADMIN = [("get", "/api/v1/settings"), ("put", "/api/v1/settings/partner_notifications_enabled")]
WAVE_C_USERS = [("get", "/api/v1/users"), ("post", "/api/v1/users"), ("get", W), ("patch", W), ("post", W + "/deactivate"),
                ("post", W + "/reactivate"), ("get", W + "/subscriptions"), ("put", W + "/subscriptions")]
WAVE_C_SELF = [("patch", "/api/v1/me"), ("get", "/api/v1/me/notification-prefs"), ("put", "/api/v1/me/notification-prefs"),
               ("get", "/api/v1/notifications"), ("get", "/api/v1/notifications/unread-count"),
               ("post", "/api/v1/notifications/00000000-0000-4000-8000-000000000007/read"), ("post", "/api/v1/notifications/read-all")]
VIEWERS = [INV, {"X-Role": "manager_viewer", "X-Partner": "manager"}]

@pytest.mark.parametrize("method,path", WAVE_C_TAO + WAVE_C_ADMIN)
@pytest.mark.parametrize("h", [INV, MGR, {"X-Role": "investor_admin", "X-Partner": "investor"}, {"X-Role": "manager_viewer", "X-Partner": "manager"}])
def test_partner_roles_blocked_from_wave_c(method, path, h): assert c.request(method, path, headers=h).status_code == 403

@pytest.mark.parametrize("method,path", WAVE_C_ADMIN)
def test_analyst_blocked_from_settings(method, path): assert c.request(method, path, headers=ANALYST).status_code == 403

@pytest.mark.parametrize("method,path", WAVE_C_USERS)
@pytest.mark.parametrize("h", [ANALYST] + VIEWERS)
def test_users_routes_need_tao_admin_or_company_admin(method, path, h):
    r = c.request(method, path, headers=h); assert r.status_code == 403 and r.json()["code"] == "company_admin_only"

@pytest.mark.parametrize("method,path", WAVE_C_SELF)
@pytest.mark.parametrize("h", [TAO, ANALYST, INV, MGR])
def test_routes_about_one_person_need_a_user(method, path, h):
    r = c.request(method, path, headers=h); assert r.status_code == 401 and r.json()["code"] == "user_required"

@pytest.mark.parametrize("h", [TAO, ANALYST, INV, MGR])
def test_me_reads_in_demo_mode(h): assert c.get("/api/v1/me", headers=h).json()["user"] is None

@pytest.mark.parametrize("method,path", WAVE_C_TAO)
def test_comment_writes_need_a_user_for_tao(method, path):
    if method == "get": assert c.request(method, path, headers=ANALYST).status_code in (200, 404)
    else: assert c.request(method, path, headers=ANALYST).status_code == 401

def test_unknown_user_is_401_everywhere(): assert c.get("/api/v1/me", headers={"X-User": "00000000-0000-4000-8000-0000000000ff"}).status_code == 401

def test_analyst_may_read_only_the_mention_list():
    assert c.get("/api/v1/users?partner_slug=tao&status=active", headers=ANALYST).status_code == 200
    assert c.get("/api/v1/users?partner_slug=tao", headers=ANALYST).status_code == 403
