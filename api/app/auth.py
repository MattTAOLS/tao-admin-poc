"""Role header stands in for authentication in the POC. Real sign-in is out of scope (see docs/portal-map.md)."""
from fastapi import Header, HTTPException
TAO = {"tao_admin", "tao_analyst"}
PARTNER = {"investor_admin": "investor", "investor_viewer": "investor", "manager_admin": "manager", "manager_viewer": "manager"}
ALL = TAO | set(PARTNER)

class Caller:
    def __init__(self, role: str, partner: str | None):
        self.role, self.partner = role, partner
        self.is_tao = role in TAO
        self.is_admin = role == "tao_admin"

def caller(x_role: str = Header(...), x_partner: str | None = Header(default=None)) -> Caller:
    if x_role not in ALL:
        raise HTTPException(403, {"code": "bad_role", "message": f"unknown role {x_role}"})
    if x_role in PARTNER:
        expected = PARTNER[x_role]
        if x_partner != expected:
            raise HTTPException(403, {"code": "bad_partner", "message": f"{x_role} must send X-Partner: {expected}"})
    return Caller(x_role, x_partner)

def tao_only(c: Caller):
    if not c.is_tao: raise HTTPException(403, {"code": "tao_only", "message": "intake routes are TAO-only"})
    return c

def admin_only(c: Caller):
    if not c.is_admin: raise HTTPException(403, {"code": "admin_only", "message": "tao_admin only"})
    return c
