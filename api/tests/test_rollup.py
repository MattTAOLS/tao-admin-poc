"""The roll-up must rebuild both real program aggregates from their own deals."""
import json, math
import pytest
from app.rollup import build_program
from conftest import REF


@pytest.mark.parametrize("slug", ["f-pil-2-0", "move-trust"])
def test_rollup_reproduces_real_program(slug):
    real = json.loads((REF / f"program-{slug}.dashboard.json").read_text(encoding="utf-8"))
    built = build_program(real["period"], real["deals"])
    assert set(built) == set(real)
    for k in ("period", "deal_count", "covenant_totals", "terminology", "history_policy"):
        assert built[k] == real[k], k
    assert sorted(built["deals_with_escalations"]) == sorted(real["deals_with_escalations"])
    rt, bt = real["portfolio_totals"], built["portfolio_totals"]
    assert set(bt) == set(rt)
    for k, v in rt.items():
        if isinstance(v, list):
            assert sorted(bt[k]) == sorted(v), k
        elif v is None:
            assert bt[k] is None, k
        else:
            assert math.isclose(bt[k], v, rel_tol=1e-9, abs_tol=0.005), (k, bt[k], v)
