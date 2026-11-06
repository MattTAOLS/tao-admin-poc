"""Who is calling. Real sign-in is a production item (decision C1); the POC has two ways in, both ending in the same Caller.

Demo mode (no X-User): X-Role and X-Partner, exactly as in phase 1; the role switcher and every existing test use it.
User mode (X-User, wave C, risk R1): an app_user id. An active user's role and partner come from the user record and
X-Role / X-Partner are ignored; a deactivated user is 401 inactive_user, an unknown id 401 unknown_user.
Either way the Caller carries (role, partner), so every gate below and partner_filter in main.py are unchanged. User mode
adds user_id and label (the user's name, used as actor_label in the audit log)."""
import datetime as dt, re
from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session
from .db import get_db

TAO = {"tao_admin", "tao_analyst"}
PARTNER = {"investor_admin": "investor", "investor_viewer": "investor", "manager_admin": "manager", "manager_viewer": "manager"}
ALL = TAO | set(PARTNER)
COMPANY_ADMINS = {"investor_admin", "manager_admin"}
ACTIVE_EVERY = dt.timedelta(minutes=5)          # last_active_at is written at most this often per user
UUID = re.compile(r"^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$")


class Caller:
    def __init__(self, role: str, partner: str | None, user_id: str | None = None, label: str | None = None):
        self.role, self.partner = role, partner
        self.is_tao = role in TAO
        self.is_admin = role == "tao_admin"
        self.is_company_admin = role in COMPANY_ADMINS
        self.user_id, self.label = user_id, label          # None in demo mode


def _err(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, {"code": code, "message": message})


def _aware(t: dt.datetime | None) -> dt.datetime | None:
    return t.replace(tzinfo=dt.timezone.utc) if t is not None and t.tzinfo is None else t


def caller(x_role: str | None = Header(default=None), x_partner: str | None = Header(default=None),
           x_user: str | None = Header(default=None), s: Session = Depends(get_db)) -> Caller:
    if x_user is not None:
        from .models import AppUser
        u = s.get(AppUser, x_user.lower()) if UUID.match(x_user) else None
        if u is None:
            raise _err(401, "unknown_user", "X-User names no user")
        if u.status != "active":
            raise _err(401, "inactive_user", "this user is deactivated")
        now = dt.datetime.now(dt.timezone.utc)
        last = _aware(u.last_active_at)
        if last is None or now - last > ACTIVE_EVERY:
            u.last_active_at = now
            s.commit()
        return Caller(u.role, u.partner_slug, u.id, u.name)
    if x_role is None:                         # before wave C the header was required: same 422 as a missing header then
        raise _err(422, "invalid", "X-Role header is required (or X-User)")
    if x_role not in ALL:
        raise _err(403, "bad_role", f"unknown role {x_role}")
    if x_role in PARTNER:
        expected = PARTNER[x_role]
        if x_partner != expected:
            raise _err(403, "bad_partner", f"{x_role} must send X-Partner: {expected}")
    return Caller(x_role, x_partner)


def tao_only(c: Caller):
    if not c.is_tao: raise HTTPException(403, {"code": "tao_only", "message": "intake routes are TAO-only"})
    return c


def admin_only(c: Caller):
    if not c.is_admin: raise HTTPException(403, {"code": "admin_only", "message": "tao_admin only"})
    return c


def company_admin_only(c: Caller):
    """Users routes: tao_admin, or a partner's Company Admin (scoped to that partner by the route)."""
    if not (c.is_admin or c.is_company_admin):
        raise HTTPException(403, {"code": "company_admin_only", "message": "tao_admin or the partner's Company Admin only"})
    return c


def user_required(c: Caller):
    """Routes about one person (/me writes, /notifications, comments) need X-User."""
    if c.user_id is None:
        raise HTTPException(401, {"code": "user_required", "message": "this route needs a signed-in user (X-User)"})
    return c
