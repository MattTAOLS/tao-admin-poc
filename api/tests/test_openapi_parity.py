"""The app must serve exactly the routes in contracts/openapi.yaml (path + method), no more, no fewer."""
import yaml
from conftest import ROOT

METHODS = {"get", "post", "put", "patch", "delete"}


def routes(spec: dict, prefix: str = "") -> set[tuple[str, str]]:
    return {(p[len(prefix):] if prefix and p.startswith(prefix) else p, m) for p, ops in spec["paths"].items() for m in ops if m in METHODS}


def test_served_openapi_matches_contract(client):
    contract = yaml.safe_load((ROOT / "contracts" / "openapi.yaml").read_text(encoding="utf-8"))
    served = client.get("/api/v1/openapi.json").json()
    want, got = routes(contract), routes(served, "/api/v1")
    assert got == want, {"missing": sorted(want - got), "extra": sorted(got - want)}
    assert len({p for p, _ in want}) == 20 and len(want) == 24
