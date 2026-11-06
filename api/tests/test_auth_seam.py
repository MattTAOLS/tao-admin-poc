"""Wave C auth seam (risk R1): X-User resolves to the same Caller (role, partner) plus user id and name; without it the demo
headers behave exactly as before (test_roles.py is unchanged and still passes)."""
import datetime as dt
import pytest
from conftest import TAO, INV
from test_uploads import upload
from app import db
from app.models import AppUser

ADMIN = "00000000-0000-4000-8000-000000000001"          # seed/users.json: A. Patel, tao_admin
ANALYST_ID = "00000000-0000-4000-8000-000000000003"     # J. Moreau, tao_analyst
INV_ADMIN = "00000000-0000-4000-8000-000000000005"      # M. Chen, investor_admin
MGR_VIEWER = "00000000-0000-4000-8000-000000000008"     # L. Haddad, manager_viewer


def U(uid: str, **extra) -> dict:
    return {"X-User": uid, **extra}


def set_user(uid: str, **values):
    with db.session() as s:
        u = s.get(AppUser, uid)
        for k, v in values.items():
            setattr(u, k, v)
        s.commit()


def test_seed_users_loaded():
    with db.session() as s:
        assert s.get(AppUser, ADMIN).name == "A. Patel" and s.get(AppUser, INV_ADMIN).partner_slug == "investor"


def test_user_role_and_partner_come_from_the_user(client):
    assert client.get("/api/v1/uploads", headers=U(ADMIN)).status_code == 200
    r = client.get("/api/v1/published/portfolio", headers=U(INV_ADMIN))
    assert r.status_code == 200 and r.json()["partner"] == "investor"
    assert client.get("/api/v1/published/portfolio", headers=U(MGR_VIEWER)).json()["partner"] == "manager"


def test_demo_headers_are_ignored_when_x_user_is_sent(client):
    # a partner user cannot become TAO by adding X-Role, nor switch partner with X-Partner
    assert client.get("/api/v1/uploads", headers=U(INV_ADMIN, **{"X-Role": "tao_admin"})).status_code == 403
    r = client.get("/api/v1/published/portfolio", headers=U(INV_ADMIN, **{"X-Role": "manager_viewer", "X-Partner": "manager"}))
    assert r.json()["partner"] == "investor"
    # and a TAO user does not lose access because of a stray partner header
    assert client.get("/api/v1/uploads", headers=U(ADMIN, **{"X-Role": "investor_viewer"})).status_code == 200


@pytest.mark.parametrize("uid", ["00000000-0000-4000-8000-0000000000ff", "not-a-uuid", ""])
def test_unknown_user_is_401(client, uid):
    r = client.get("/api/v1/published/portfolio", headers=U(uid, **TAO))
    assert r.status_code == 401 and r.json()["code"] == "unknown_user"


def test_deactivated_user_is_401(client):
    set_user(ANALYST_ID, status="deactivated")
    r = client.get("/api/v1/uploads", headers=U(ANALYST_ID, **TAO))
    assert r.status_code == 401 and r.json()["code"] == "inactive_user"


def test_no_role_and_no_user_is_422_as_before(client):
    r = client.get("/api/v1/uploads")
    assert r.status_code == 422 and r.json()["code"] == "invalid"


def test_gates_unchanged_for_users(client):
    assert client.post("/api/v1/uploads/x/approve", headers=U(ANALYST_ID)).status_code == 403
    assert client.get("/api/v1/audit?scope=platform", headers=U(ANALYST_ID)).status_code == 403
    assert client.get("/api/v1/master/programs", headers=U(MGR_VIEWER)).status_code == 403


def test_audit_names_the_user_and_upload_keeps_the_role(client):
    u = upload(client, headers=U(ANALYST_ID)).json()
    assert u["uploaded_by"] == "tao_analyst"
    a = client.get("/api/v1/audit", headers=TAO, params={"upload_id": u["id"]}).json()[0]
    assert a["actor_role"] == "tao_analyst" and a["actor_label"] == "J. Moreau" and a["actor_user_id"] == ANALYST_ID
    demo = upload(client, period="2026-10").json()
    a = client.get("/api/v1/audit", headers=TAO, params={"upload_id": demo["id"]}).json()[0]
    assert a["actor_label"] == "tao_admin" and a["actor_user_id"] is None


def test_last_active_is_set_and_throttled(client):
    with db.session() as s:
        assert s.get(AppUser, ADMIN).last_active_at is None
    client.get("/api/v1/uploads", headers=U(ADMIN))
    with db.session() as s:
        first = s.get(AppUser, ADMIN).last_active_at
    assert first is not None
    client.get("/api/v1/uploads", headers=U(ADMIN))
    with db.session() as s:
        assert s.get(AppUser, ADMIN).last_active_at == first             # within five minutes: not written again
    set_user(ADMIN, last_active_at=dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=1))
    client.get("/api/v1/uploads", headers=U(ADMIN))
    with db.session() as s:
        t = s.get(AppUser, ADMIN).last_active_at
        t = t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)
        assert dt.datetime.now(dt.timezone.utc) - t < dt.timedelta(minutes=1)
