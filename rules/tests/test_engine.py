import json, pathlib, glob
from rules import run, load_rules
from rules.engine import Context
ROOT = pathlib.Path(__file__).resolve().parents[2]
META = {"upload_id": "00000000-0000-4000-8000-000000000000", "pass": 1, "template_id": "fpil-2.0-settrep-v1", "page_count": 16, "extracted_at": "2026-10-28T00:00:00Z", "engine": {"text_layer": "pdfplumber", "model": "claude"}}

def deals():
    for f in sorted(glob.glob(str(ROOT / "docs/dashboard-json/*.dashboard.json"))):
        if not pathlib.Path(f).name.startswith("program-"): yield pathlib.Path(f).name, json.load(open(f))

def test_rules_load(): assert len(load_rules()["rules"]) == 22

# Reference deals whose tranche roll-forward does not close, with the gap R05 must report. Empty: Meridian OneCap
# (-598,714.81, its charge_off), Finloc (-4,163.85, July charge_off) and TLFC LP (+2,782.68, July adjustment_increase)
# were listed until the references carried the page-2 adjustment column (lead/move-fixes). A new entry needs its reason.
KNOWN_ROLLFORWARD_GAPS: dict[str, float] = {}

def test_reference_deals_pass_implemented_rules():
    """Every real deal object must pass the implemented phase-1 rules (reports we believe are right), except the
    documented MOVE Trust roll-forward gaps, which must fail R05 by exactly the known amount."""
    for name, d in deals():
        fs = run({"meta": META, "deal": d, "sources": {}}, Context(), phases=(1,))
        blocks = [f for f in fs if f["severity"] == "block"]
        if name in KNOWN_ROLLFORWARD_GAPS:
            assert [f["rule_id"] for f in blocks] == ["R05"], f"{name}: {[ (f['rule_id'], f['message']) for f in blocks ]}"
            assert abs(blocks[0]["difference"] - KNOWN_ROLLFORWARD_GAPS[name]) < 0.01
        else:
            assert not blocks, f"{name}: {[ (f['rule_id'], f['message']) for f in blocks ]}"

def test_seeded_error_fires_r05():
    name, d = next(deals()); d = json.loads(json.dumps(d))
    cur = next(p for p in d["period_history"] if p["collection_period"] == d["collection_period"])
    cur["principal"] += 1000.0   # a changed digit on page 2
    fs = run({"meta": META, "deal": d, "sources": {}}, Context(), phases=(1,))
    assert any(f["rule_id"] == "R05" for f in fs)
