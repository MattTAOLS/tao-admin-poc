import pytest
from conftest import TAO, ANALYST, INV, MGR

M = "/api/v1/master"
WHY = "checked against the executed SLFA"


def change(row: dict, mode: str, **kw) -> dict:
    """A CovenantChange body from a row the API returned (its read-only fields are echoed back, as the UI does)."""
    return dict(row, mode=mode, reason=WHY, **kw)


def test_programs_get_put(client):
    ps = client.get(f"{M}/programs", headers=ANALYST).json()
    assert {p["slug"] for p in ps} == {"move-trust", "f-pil-2-0"}
    fpil = next(p for p in ps if p["slug"] == "f-pil-2-0")
    assert fpil == {"slug": "f-pil-2-0", "name": "F-PIL 2.0", "partner_slug": "investor", "partner_slugs": ["investor", "manager"],
                    "currency": "CAD", "limit": 150000000.0, "warehouse_limit": 5000000.0}
    body = dict(fpil, limit=175000000.0)
    assert client.put(f"{M}/programs", headers=ANALYST, json=body).status_code == 403
    r = client.put(f"{M}/programs", headers=TAO, json=body)
    assert r.status_code == 200 and r.json()["limit"] == 175000000.0
    assert client.put(f"{M}/programs", headers=TAO, json=dict(body, partner_slug="nobody")).status_code == 422
    a = client.get("/api/v1/audit", headers=TAO).json()[0]
    assert a["action"] == "master_change" and a["upload_id"] is None and a["detail"]["entity"] == "program"
    assert a["detail"]["before"]["limit"] == 150000000.0 and a["detail"]["after"]["limit"] == 175000000.0


def test_program_partner_slugs_put(client):
    fpil = next(p for p in client.get(f"{M}/programs", headers=TAO).json() if p["slug"] == "f-pil-2-0")
    r = client.put(f"{M}/programs", headers=TAO, json=dict(fpil, partner_slugs=["manager"], partner_slug=None))
    assert r.status_code == 200 and r.json()["partner_slugs"] == ["manager"] and r.json()["partner_slug"] == "manager"
    body = {k: v for k, v in fpil.items() if k != "partner_slugs"} | {"partner_slug": "investor"}       # partner_slug alone
    assert client.put(f"{M}/programs", headers=TAO, json=body).json()["partner_slugs"] == ["investor"]
    r = client.put(f"{M}/programs", headers=TAO, json=dict(fpil, partner_slugs=["investor", "manager"]))
    assert r.json()["partner_slugs"] == ["investor", "manager"]
    assert client.put(f"{M}/programs", headers=TAO, json=dict(fpil, partner_slugs=["investor", "nobody"])).status_code == 422
    assert client.put(f"{M}/programs", headers=TAO, json=dict(fpil, partner_slugs=[], partner_slug=None)).status_code == 422
    a = client.get("/api/v1/audit", headers=TAO, params={"action": "master_change"}).json()
    assert len(a) == 3 and a[0]["detail"]["after"]["partner_slugs"] == ["investor", "manager"] and a[0]["detail"]["before"]["partner_slugs"] == ["investor"]


def test_partners_route(client):
    want = [{"slug": "investor", "name": "Investor", "kind": "investor", "status": "active"},
            {"slug": "manager", "name": "Manager", "kind": "manager", "status": "active"}]
    assert client.get(f"{M}/partners", headers=TAO).json() == want
    assert client.get(f"{M}/partners", headers=ANALYST).json() == want


def test_covenant_unit(client):
    rows = client.get(f"{M}/covenants", headers=TAO).json()
    assert {r["unit"] for r in rows} == {"fraction", "ratio", "currency"}
    eq = next(r for r in rows if r["legal_ref"] == "SLFA 9.1 (j)")
    assert eq["unit"] == "currency" and eq["threshold"] == 2500000.0
    r = client.put(f"{M}/covenants", headers=TAO, json=change(eq, "correct", unit=None)).json()["definition"]
    assert r["unit"] is None
    assert client.put(f"{M}/covenants", headers=TAO, json=change(r, "correct", unit="ratio")).json()["definition"]["unit"] == "ratio"
    assert client.put(f"{M}/covenants", headers=TAO, json=change(r, "correct", unit="percent")).status_code == 422


def test_deals_get_put(client):
    assert len(client.get(f"{M}/deals", headers=TAO).json()) == 12
    fpil = client.get(f"{M}/deals", headers=TAO, params={"program_slug": "f-pil-2-0"}).json()
    assert [d["slug"] for d in fpil] == ["f-pil-2-0-moneda-capital-corp", "f-pil-2-0-stride-capital", "f-pil-2-0-xpedite-leasing"]
    new = {"slug": "f-pil-2-0-test-servicer", "name": "Test Servicer", "program_slug": "f-pil-2-0", "servicer": "Test Servicer", "template_id": "fpil-2.0-settrep-v1"}
    assert client.put(f"{M}/deals", headers=ANALYST, json=new).status_code == 403
    assert client.put(f"{M}/deals", headers=TAO, json=dict(new, program_slug="nope")).status_code == 422
    assert client.put(f"{M}/deals", headers=TAO, json=new).json() == new
    assert len(client.get(f"{M}/deals", headers=TAO).json()) == 13
    assert client.get("/api/v1/audit", headers=TAO).json()[0]["detail"]["before"] is None


def test_covenants_as_of_versioning(client):
    deal = "f-pil-2-0-moneda-capital-corp"
    all_ = client.get(f"{M}/covenants", headers=TAO, params={"deal_slug": deal}).json()
    e = next(c for c in all_ if c["legal_ref"] == "SLFA 9.1 (e)")
    assert e["threshold"] == 0.035 and e["effective_from"] == "2022-12-09"
    amended = {k: v for k, v in e.items() if k != "id"} | {"threshold": 0.0325, "effective_from": "2025-03-01", "source": "Amendment 2 2025-03-01",
                                                          "mode": "new_version", "reason": "Amendment 2 lowers the delinquency ceiling"}
    assert client.put(f"{M}/covenants", headers=ANALYST, json=amended).status_code == 403
    r = client.put(f"{M}/covenants", headers=TAO, json=amended)
    assert r.status_code == 200 and r.json()["definition"]["id"] != e["id"] and r.json()["superseded_id"] is None
    def in_force(as_of):
        rows = client.get(f"{M}/covenants", headers=TAO, params={"deal_slug": deal, "as_of": as_of}).json()
        assert len({c["legal_ref"] for c in rows}) == len(rows)
        return next(c for c in rows if c["legal_ref"] == "SLFA 9.1 (e)")["threshold"]
    assert in_force("2024-12-31") == 0.035
    assert in_force("2025-03-01") == 0.0325
    assert in_force("2026-08-31") == 0.0325
    assert client.get(f"{M}/covenants", headers=TAO, params={"deal_slug": deal, "as_of": "2020-01-01"}).json() == []
    assert len(client.get(f"{M}/covenants", headers=TAO, params={"deal_slug": deal}).json()) == len(all_) + 1
    assert client.get(f"{M}/covenants", headers=TAO, params={"as_of": "not-a-date"}).status_code == 422
    a = client.get("/api/v1/audit", headers=TAO).json()[0]
    assert a["action"] == "master_change" and a["detail"]["entity"] == "covenant_definition"


def test_covenant_correct_keeps_threshold_rule(client):
    c = next(x for x in client.get(f"{M}/covenants", headers=TAO).json() if x["legal_ref"] == "SLFA 9.1 (c)")
    assert c["threshold_rule"]["on"] == "/tranche_balance/closing"
    r = client.put(f"{M}/covenants", headers=TAO, json=change(c, "correct", description="Rolling 3-month loss ratio"))
    assert r.status_code == 200 and r.json()["definition"]["id"] != c["id"] and r.json()["superseded_id"] == c["id"]
    assert r.json()["definition"]["threshold_rule"] == c["threshold_rule"]
    both_null = {k: v for k, v in c.items() if k != "id"} | {"threshold_rule": None, "threshold": None, "effective_from": "2099-01-01",
                                                            "mode": "new_version", "reason": "limit set per vintage from 2099"}
    r = client.put(f"{M}/covenants", headers=TAO, json=both_null)                # allowed: e.g. a per-vintage limit
    assert r.status_code == 200 and r.json()["definition"]["threshold"] is None and r.json()["definition"]["threshold_rule"] is None
    assert client.put(f"{M}/covenants", headers=TAO, json=change(c, "correct", kind="sideways")).status_code == 422


@pytest.mark.parametrize("path", ["partners", "programs", "deals", "covenants"])
@pytest.mark.parametrize("h", [INV, MGR])
def test_partners_cannot_read_master(client, path, h):
    assert client.get(f"{M}/{path}", headers=h).status_code == 403
    if path != "partners":
        assert client.put(f"{M}/{path}", headers=h, json={}).status_code == 403


def test_definition_with_no_threshold_round_trips(client):
    """Stride SLFA 9.1 (g) CNL: limit per vintage, so threshold and threshold_rule are both null in the seed."""
    g = [c for c in client.get(f"{M}/covenants", headers=TAO, params={"deal_slug": "f-pil-2-0-stride-capital"}).json()
         if c["legal_ref"] == "SLFA 9.1 (g)"]
    assert len(g) == 1 and g[0]["threshold"] is None and g[0]["threshold_rule"] is None and g[0]["unit"] == "fraction"
    assert any(c["id"] == g[0]["id"] for c in client.get(f"{M}/covenants", headers=TAO,
                                                         params={"deal_slug": "f-pil-2-0-stride-capital", "as_of": "2026-08-31"}).json())
    r = client.put(f"{M}/covenants", headers=TAO, json=change(g[0], "correct", source="checked"))
    d = r.json()["definition"]
    assert r.status_code == 200 and d["supersedes_id"] == g[0]["id"] and d["threshold"] is None and d["threshold_rule"] is None
