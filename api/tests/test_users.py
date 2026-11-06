"""Wave C users, subscriptions, /me, notification prefs and settings (contract abdda6d). Seed users from seed/users.json."""
import pytest
from conftest import TAO, INV
from app import db
from app.models import AppUser

A1, A2 = "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"    # tao_admin x2
AN = "00000000-0000-4000-8000-000000000003"                                                # tao_analyst
IA, IV = "00000000-0000-4000-8000-000000000005", "00000000-0000-4000-8000-000000000006"    # investor admin / viewer
MA, MV = "00000000-0000-4000-8000-000000000007", "00000000-0000-4000-8000-000000000008"    # manager admin / viewer
V1 = "/api/v1"


def H(uid):
    return {"X-User": uid}


def code(r):
    return r.status_code, r.json().get("code")


def audit(client, action):
    return [a for a in client.get(V1 + "/audit", headers=TAO, params={"action": action, "scope": "platform"}).json()]


# ---- /users ----
def test_tao_admin_lists_everyone_and_filters(client):
    r = client.get(V1 + "/users", headers=H(A1))
    assert r.status_code == 200 and len(r.json()) == 8
    assert {u["role"] for u in client.get(V1 + "/users?partner_slug=tao", headers=H(A1)).json()} == {"tao_admin", "tao_analyst"}
    assert [u["id"] for u in client.get(V1 + "/users?q=novak", headers=H(A1)).json()] == [MA]
    assert client.get(V1 + "/users?status=deactivated", headers=TAO).json() == []
    u = client.get(V1 + f"/users/{IV}", headers=TAO).json()
    assert u["receives_summary"] == "None" and u["status"] == "active" and u["partner_slug"] == "investor"


def test_company_admin_sees_only_its_partner(client):
    rows = client.get(V1 + "/users?partner_slug=manager", headers=H(IA)).json()
    assert {u["id"] for u in rows} == {IA, IV}
    assert code(client.get(V1 + f"/users/{MV}", headers=H(IA))) == (404, "not_found")
    assert code(client.get(V1 + f"/users/{A1}", headers=H(IA))) == (404, "not_found")
    assert client.get(V1 + f"/users/{IV}", headers=H(IA)).status_code == 200
    # demo-mode Company Admin works the same way
    assert {u["id"] for u in client.get(V1 + "/users", headers={"X-Role": "manager_admin", "X-Partner": "manager"}).json()} == {MA, MV}


@pytest.mark.parametrize("h", [H(AN), H(IV), {"X-Role": "tao_analyst"}, INV])
def test_others_get_company_admin_only(client, h):
    assert code(client.get(V1 + "/users", headers=h)) == (403, "company_admin_only")
    assert code(client.post(V1 + "/users", headers=h, json={"email": "x@example.com", "name": "X", "role": "tao_analyst"})) == (403, "company_admin_only")


def test_create_user_rules(client):
    new = {"email": "New.Person@Example.com", "name": "N. Person", "role": "tao_analyst"}
    r = client.post(V1 + "/users", headers=H(A1), json=new)
    assert r.status_code == 201, r.text
    u = r.json()
    assert u["email"] == "new.person@example.com" and u["status"] == "active" and u["partner_slug"] is None and u["receives_summary"] == "None"
    assert code(client.post(V1 + "/users", headers=H(A1), json={**new, "email": "NEW.person@example.com"})) == (409, "email_taken")
    assert code(client.post(V1 + "/users", headers=H(A1), json={**new, "email": "b@example.com", "partner_slug": "investor"})) == (422, "role_partner_mismatch")
    assert code(client.post(V1 + "/users", headers=H(A1), json={**new, "email": "c@example.com", "role": "investor_viewer"})) == (422, "role_partner_mismatch")
    assert code(client.post(V1 + "/users", headers=H(A1), json={**new, "email": "d@example.com", "role": "investor_viewer",
                                                                 "partner_slug": "manager"})) == (422, "role_partner_mismatch")
    assert code(client.post(V1 + "/users", headers=H(A1), json={**new, "email": "e@example.com", "role": "investor_viewer",
                                                                 "partner_slug": "nobody"})) == (422, "unknown_partner")
    assert code(client.post(V1 + "/users", headers=H(A1), json={**new, "email": "not-an-email"})) == (422, "invalid")
    a = audit(client, "user_change")[0]
    assert a["detail"]["change"] == "created" and a["detail"]["before"] is None and a["detail"]["after"]["email"] == "new.person@example.com"
    assert a["actor_label"] == "A. Patel" and a["actor_user_id"] == A1


def test_company_admin_adds_only_its_own_partner(client):
    ok = client.post(V1 + "/users", headers=H(IA), json={"email": "v2@example.com", "name": "V2", "role": "investor_viewer", "partner_slug": "investor"})
    assert ok.status_code == 201 and ok.json()["partner_slug"] == "investor"
    for body in ({"role": "manager_viewer", "partner_slug": "manager"}, {"role": "tao_analyst"}, {"role": "investor_viewer", "partner_slug": "manager"}):
        assert code(client.post(V1 + "/users", headers=H(IA), json={"email": "z@example.com", "name": "Z", **body})) == (409, "other_partner")
    a = audit(client, "user_change")[0]
    assert a["detail"]["partner_slug"] == "investor" and a["actor_role"] == "investor_admin"


def test_patch_user_and_self_change_and_last_admin(client):
    r = client.patch(V1 + f"/users/{AN}", headers=H(A1), json={"role": "tao_admin", "name": "J. Moreau-Smith"})
    assert r.status_code == 200 and r.json()["role"] == "tao_admin" and r.json()["name"] == "J. Moreau-Smith"
    a = audit(client, "user_change")[0]["detail"]
    assert a["change"] == "updated" and a["before"]["role"] == "tao_analyst" and a["after"]["role"] == "tao_admin"
    assert code(client.patch(V1 + f"/users/{A1}", headers=H(A1), json={"role": "tao_analyst"})) == (409, "self_change")
    assert client.patch(V1 + f"/users/{A1}", headers=H(A1), json={"name": "A. Patel-Jones"}).status_code == 200   # own name is fine
    assert code(client.patch(V1 + f"/users/{AN}", headers=H(A1), json={"email": "tao.admin2@example.com"})) == (409, "email_taken")
    # partner role without a partner follows the role
    r = client.patch(V1 + f"/users/{AN}", headers=H(A1), json={"role": "manager_viewer"})
    assert r.status_code == 200 and r.json()["partner_slug"] == "manager"
    assert code(client.patch(V1 + f"/users/{AN}", headers=H(A1), json={"role": "tao_analyst", "partner_slug": "manager"})) == (422, "role_partner_mismatch")
    # last tao_admin: deactivate A2, then A1 cannot be demoted by anyone (demo tao_admin here)
    assert client.post(V1 + f"/users/{A2}/deactivate", headers=H(A1), json={"reason": "left"}).status_code == 200
    assert code(client.patch(V1 + f"/users/{A1}", headers=TAO, json={"role": "tao_analyst"})) == (409, "last_admin")


def test_company_admin_patch_rules(client):
    assert code(client.patch(V1 + f"/users/{IA}", headers=H(IA), json={"role": "investor_viewer"})) == (409, "self_change")
    assert code(client.patch(V1 + f"/users/{IV}", headers=H(IA), json={"role": "tao_analyst"})) == (409, "other_partner")
    assert code(client.patch(V1 + f"/users/{MV}", headers=H(IA), json={"name": "x"})) == (404, "not_found")
    assert client.patch(V1 + f"/users/{IV}", headers=H(IA), json={"role": "investor_admin"}).status_code == 200
    # two investor admins now; TAO demotes the first, then the second is the last Company Admin
    assert client.patch(V1 + f"/users/{IA}", headers=TAO, json={"role": "investor_viewer"}).status_code == 200
    assert code(client.patch(V1 + f"/users/{IV}", headers=TAO, json={"role": "investor_viewer"})) == (409, "last_admin")
    assert code(client.post(V1 + f"/users/{IV}/deactivate", headers=TAO, json={"reason": "gone"})) == (409, "last_admin")


def test_deactivate_and_reactivate(client):
    assert code(client.post(V1 + f"/users/{A1}/deactivate", headers=H(A1), json={"reason": "test"})) == (409, "self_change")
    r = client.post(V1 + f"/users/{AN}/deactivate", headers=H(A1), json={"reason": "left the team"})
    assert r.status_code == 200 and r.json()["status"] == "deactivated" and r.json()["deactivation_reason"] == "left the team"
    assert code(client.get(V1 + "/uploads", headers=H(AN))) == (401, "inactive_user")
    assert code(client.post(V1 + f"/users/{AN}/deactivate", headers=H(A1), json={"reason": "again"})) == (409, "already_deactivated")
    assert client.post(V1 + f"/users/{AN}/deactivate", headers=H(A1), json={"reason": "x"}).status_code == 422       # reason too short
    r = client.post(V1 + f"/users/{AN}/reactivate", headers=H(A1), json={"reason": "back"})
    assert r.status_code == 200 and r.json()["status"] == "active" and r.json()["deactivated_at"] is None
    assert code(client.post(V1 + f"/users/{AN}/reactivate", headers=H(A1), json={"reason": "back"})) == (409, "already_active")
    assert client.get(V1 + "/uploads", headers=H(AN)).status_code == 200
    changes = [a["detail"]["change"] for a in audit(client, "user_change")]
    assert changes[:2] == ["reactivated", "deactivated"]
    assert code(client.get(V1 + "/users/00000000-0000-4000-8000-0000000000ff", headers=H(A1))) == (404, "not_found")


# ---- subscriptions ----
SUBS = [{"program_slug": "move-trust", "deal_slug": None, "channels": ["in_app"]},
        {"program_slug": "f-pil-2-0", "deal_slug": "f-pil-2-0-moneda-capital-corp", "channels": ["in_app"]},
        {"program_slug": "f-pil-2-0", "deal_slug": "f-pil-2-0-stride-capital", "channels": ["in_app"]}]


def test_subscriptions_replace_read_and_summary(client):
    r = client.put(V1 + f"/users/{IV}/subscriptions", headers=H(IA), json=SUBS)
    assert r.status_code == 200, r.text
    assert [(x["program_slug"], x["deal_slug"]) for x in r.json()] == [("f-pil-2-0", "f-pil-2-0-moneda-capital-corp"), ("f-pil-2-0", "f-pil-2-0-stride-capital"), ("move-trust", None)]
    assert client.get(V1 + f"/users/{IV}", headers=H(A1)).json()["receives_summary"] == "F-PIL 2.0: 2 deals; MOVE Trust: all deals"
    assert client.get(V1 + f"/users/{IV}/subscriptions", headers=H(IV)).json() == r.json()      # the user themselves, read-only
    assert code(client.put(V1 + f"/users/{IV}/subscriptions", headers=H(IV), json=[])) == (403, "company_admin_only")
    assert code(client.get(V1 + f"/users/{IA}/subscriptions", headers=H(IV))) == (403, "company_admin_only")
    assert code(client.get(V1 + f"/users/{MV}/subscriptions", headers=H(IA))) == (404, "not_found")
    a = audit(client, "user_change")[0]["detail"]
    assert a["change"] == "subscriptions" and a["before"] == [] and len(a["after"]) == 3


def test_subscription_errors(client):
    def put(body, uid=AN):
        return code(client.put(V1 + f"/users/{uid}/subscriptions", headers=H(A1), json=body))
    assert put([{"program_slug": "nope", "channels": ["in_app"]}]) == (422, "unknown_program")
    assert put([{"program_slug": "move-trust", "deal_slug": "nope", "channels": ["in_app"]}]) == (422, "unknown_deal")
    assert put([{"program_slug": "move-trust", "deal_slug": "f-pil-2-0-moneda-capital-corp", "channels": ["in_app"]}]) == (422, "invalid")
    assert put([{"program_slug": "move-trust", "channels": ["in_app", "email"]}]) == (422, "email_later")
    assert put([{"program_slug": "move-trust", "channels": []}]) == (422, "invalid")
    assert put([{"program_slug": "move-trust", "channels": ["in_app"]}] * 2) == (422, "invalid")


def test_partner_user_only_on_shared_programs(client):
    client.put(V1 + "/master/programs", headers=TAO, json={"slug": "move-trust", "name": "MOVE Trust", "partner_slugs": ["investor"],
                                                           "limit": 1916709163.0})
    r = client.put(V1 + f"/users/{MV}/subscriptions", headers=H(A1), json=[{"program_slug": "move-trust", "channels": ["in_app"]}])
    assert code(r) == (422, "not_visible")
    assert client.put(V1 + f"/users/{IV}/subscriptions", headers=H(A1), json=[{"program_slug": "move-trust", "channels": ["in_app"]}]).status_code == 200


# ---- /me ----
def test_me_demo_and_user(client):
    r = client.get(V1 + "/me", headers=INV).json()
    assert r == {"user": None, "role": "investor_viewer", "partner_slug": "investor",
                 "display": {"time_zone": "America/Toronto", "date_format": "D MMM YYYY", "number_format": "1,234.56"}}
    r = client.get(V1 + "/me", headers=H(MA)).json()
    assert r["user"]["id"] == MA and r["role"] == "manager_admin" and r["partner_slug"] == "manager"
    assert client.get(V1 + "/me", headers=TAO).json()["partner_slug"] is None
    assert code(client.patch(V1 + "/me", headers=TAO, json={"name": "x"})) == (401, "user_required")


def test_patch_me(client):
    r = client.patch(V1 + "/me", headers=H(IV), json={"name": "D. Alvarez-Ruiz", "time_zone": "Europe/London", "date_format": "YYYY-MM-DD"})
    assert r.status_code == 200, r.text
    me = r.json()
    assert me["user"]["name"] == "D. Alvarez-Ruiz" and me["display"] == {"time_zone": "Europe/London", "date_format": "YYYY-MM-DD", "number_format": "1,234.56"}
    assert code(client.patch(V1 + "/me", headers=H(IV), json={"time_zone": "Mars/Base"})) == (422, "invalid")
    assert code(client.patch(V1 + "/me", headers=H(IV), json={"number_format": "1.234,56"})) == (422, "invalid")
    assert code(client.patch(V1 + "/me", headers=H(IV), json={})) == (422, "invalid")
    a = audit(client, "prefs_change")[0]
    assert a["detail"]["user_id"] == IV and a["detail"]["before"]["time_zone"] == "America/Toronto" and a["detail"]["after"]["time_zone"] == "Europe/London"
    # role and email are not self-editable: unknown fields are ignored, the user stays as is
    client.patch(V1 + "/me", headers=H(IV), json={"name": "D. A.", "role": "tao_admin", "email": "x@example.com"})
    with db.session() as s:
        u = s.get(AppUser, IV)
        assert u.role == "investor_viewer" and u.email == "investor.viewer@example.com"


def test_my_activity_through_audit_filter(client):
    client.patch(V1 + "/me", headers=H(IV), json={"name": "D. A."})
    mine = client.get(V1 + "/audit", headers=H(IV), params={"actor_user_id": IV})
    assert mine.status_code == 200 and [a["action"] for a in mine.json()] == ["prefs_change"]
    assert client.get(V1 + "/audit", headers=H(IV), params={"actor_user_id": A1}).status_code == 403
    assert client.get(V1 + "/audit", headers=H(AN), params={"actor_user_id": IV, "scope": "platform"}).status_code == 403
    assert [a["actor_user_id"] for a in client.get(V1 + "/audit", headers=H(A1), params={"actor_user_id": IV}).json()] == [IV]


# ---- notification prefs ----
def test_notification_prefs(client):
    tao = client.get(V1 + "/me/notification-prefs", headers=H(AN)).json()
    assert [p["kind"] for p in tao] == ["mention", "reply", "report_needs_review", "report_published", "correction_published",
                                        "covenant_changed", "report_rejected", "user_change", "system"]
    assert all(p["in_app"] for p in tao) and {p["kind"] for p in tao if p["required"]} == {"correction_published", "covenant_changed"}
    partner = client.get(V1 + "/me/notification-prefs", headers=H(IV)).json()
    assert [p["kind"] for p in partner] == ["report_published", "correction_published", "user_change"]
    r = client.put(V1 + "/me/notification-prefs", headers=H(AN), json=[{"kind": "report_published", "in_app": False, "digest": "daily"}])
    assert r.status_code == 200 and next(p for p in r.json() if p["kind"] == "report_published")["in_app"] is False
    assert code(client.put(V1 + "/me/notification-prefs", headers=H(AN), json=[{"kind": "covenant_changed", "in_app": False, "digest": "instant"}])) == (422, "required")
    assert code(client.put(V1 + "/me/notification-prefs", headers=H(IV), json=[{"kind": "mention", "in_app": True, "digest": "instant"}])) == (422, "invalid")
    assert code(client.get(V1 + "/me/notification-prefs", headers=TAO)) == (401, "user_required")
    # a PUT with the kind left out goes back to the default
    assert all(p["in_app"] for p in client.put(V1 + "/me/notification-prefs", headers=H(AN), json=[]).json())
    assert audit(client, "prefs_change")[0]["detail"]["user_id"] == AN


# ---- settings ----
def test_settings_defaults_change_and_audit(client):
    rows = {x["key"]: x for x in client.get(V1 + "/settings", headers=H(A1)).json()}
    assert set(rows) == {"partner_notifications_enabled", "reporting_calendar", "notification_defaults", "publish_note_templates", "company_feeds"}
    assert rows["partner_notifications_enabled"] == {"key": "partner_notifications_enabled", "value": False, "updated_at": None, "updated_by": None}
    r = client.put(V1 + "/settings/partner_notifications_enabled", headers=H(A1), json={"value": True, "reason": "pilot with Investor"})
    assert r.status_code == 200 and r.json()["value"] is True and r.json()["updated_by"] == "A. Patel" and r.json()["updated_at"]
    a = audit(client, "settings_change")[0]
    assert a["detail"] == {"key": "partner_notifications_enabled", "before": False, "after": True} and a["reason"] == "pilot with Investor"
    assert code(client.put(V1 + "/settings/nope", headers=H(A1), json={"value": 1, "reason": "why not"})) == (422, "unknown_setting")
    assert code(client.put(V1 + "/settings/partner_notifications_enabled", headers=H(A1), json={"value": "yes", "reason": "bad"})) == (422, "invalid")
    assert client.put(V1 + "/settings/partner_notifications_enabled", headers=H(A1), json={"value": True, "reason": "x"}).status_code == 422
    assert client.put(V1 + "/settings/reporting_calendar", headers=TAO, json={"value": {"f-pil-2-0-stride-capital": 8}, "reason": "from reports"}).status_code == 200
    assert code(client.put(V1 + "/settings/reporting_calendar", headers=TAO, json={"value": {"nope": 8}, "reason": "bad deal"})) == (422, "invalid")
    assert code(client.put(V1 + "/settings/reporting_calendar", headers=TAO, json={"value": {"f-pil-2-0-stride-capital": 40}, "reason": "bad day"})) == (422, "invalid")
    bad = {"tao_analyst": [{"kind": "covenant_changed", "in_app": False, "digest": "instant"}]}
    assert code(client.put(V1 + "/settings/notification_defaults", headers=TAO, json={"value": bad, "reason": "try"})) == (422, "required")
    r = client.put(V1 + "/settings/publish_note_templates", headers=TAO, json={"value": {"new_report": "Hello {deal_name}"}, "reason": "shorter"})
    assert r.json()["value"]["new_report"] == "Hello {deal_name}" and "{change_list}" in r.json()["value"]["correction"]


def test_notification_defaults_apply_to_prefs_without_a_choice(client):
    client.put(V1 + "/me/notification-prefs", headers=H(A2), json=[{"kind": "system", "in_app": True, "digest": "instant"}])
    off = {"tao_admin": [{"kind": "system", "in_app": False, "digest": "daily"}]}
    assert client.put(V1 + "/settings/notification_defaults", headers=TAO, json={"value": off, "reason": "quieter"}).status_code == 200
    mine = {p["kind"]: p for p in client.get(V1 + "/me/notification-prefs", headers=H(A1)).json()}
    theirs = {p["kind"]: p for p in client.get(V1 + "/me/notification-prefs", headers=H(A2)).json()}
    assert mine["system"]["in_app"] is False and theirs["system"]["in_app"] is True        # an earlier choice is kept


@pytest.mark.parametrize("h", [H(AN), {"X-Role": "tao_analyst"}, H(IA), INV])
def test_settings_are_tao_admin_only(client, h):
    assert client.get(V1 + "/settings", headers=h).status_code == 403
    assert client.put(V1 + "/settings/company_feeds", headers=h, json={"value": {}, "reason": "test"}).status_code == 403


def test_seed_never_overwrites_an_edited_user(client):
    client.patch(V1 + f"/users/{AN}", headers=H(A1), json={"name": "Renamed", "role": "tao_admin"})
    client.post(V1 + f"/users/{IV}/deactivate", headers=H(A1), json={"reason": "gone"})
    from app import seed
    with db.session() as s:
        assert seed.load(s)["users_added"] == 0
        assert s.get(AppUser, AN).name == "Renamed" and s.get(AppUser, AN).role == "tao_admin" and s.get(AppUser, IV).status == "deactivated"
