"""Per-rule fixtures, reference-deal calibration with master data, schema and timing checks."""
import copy, glob, json, pathlib, time
import jsonschema, pytest
from rules import load_rules, run
from rules.engine import Context, finding
from rules import checks
from rules.tests.fixtures import make_fixtures as mf

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIX = ROOT / "rules/tests/fixtures"
FINDING_SCHEMA = json.loads((ROOT / "contracts/finding.schema.json").read_text(encoding="utf-8"))
RULES = load_rules()["rules"]
IMPLEMENTED = [r["id"] for r in RULES if r["phase"] in (1, 2)]
VOLATILE = {"id", "created_at", "extraction_id"}

def load(p): return json.loads(pathlib.Path(p).read_text(encoding="utf-8"))

def leaf_diffs(a, b, path=""):
    if isinstance(a, dict) and isinstance(b, dict):
        out = []
        for k in set(a) | set(b): out += leaf_diffs(a.get(k, "<absent>"), b.get(k, "<absent>"), f"{path}/{k}")
        return out
    if isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        return [d for i, (x, y) in enumerate(zip(a, b)) for d in leaf_diffs(x, y, f"{path}/{i}")]
    return [] if a == b else [path]

def expected_findings(rule_id):
    out, i = [], 0
    while (p := FIX / "findings" / mf.expected_name(rule_id, i)).exists(): out.append(load(p)); i += 1
    return out

def strip(f): return {k: v for k, v in f.items() if k not in VOLATILE}

@pytest.mark.parametrize("rule_id", IMPLEMENTED)
def test_every_phase_1_and_2_rule_has_both_fixtures(rule_id):
    assert (FIX / f"{rule_id.lower()}-pass.json").exists() and (FIX / f"{rule_id.lower()}-fail.json").exists()
    assert expected_findings(rule_id), f"{rule_id}: no frozen expected finding"
    fn = next(r for r in RULES if r["id"] == rule_id).get("fn")
    assert fn is None or hasattr(checks, fn), f"{rule_id}: checks.{fn} missing"

@pytest.mark.parametrize("rule_id", IMPLEMENTED)
def test_pass_fixture_is_the_real_deal_and_passes(rule_id):
    fx = load(FIX / f"{rule_id.lower()}-pass.json")
    assert fx["deal"] == load(ROOT / fx["source"]), "pass fixture must be the unchanged real deal"
    assert mf.evaluate(fx) == []

@pytest.mark.parametrize("rule_id", IMPLEMENTED)
def test_fail_fixture_has_one_change_and_fires(rule_id):
    fx = load(FIX / f"{rule_id.lower()}-fail.json")
    assert len(fx["changes"]) == 1
    diffs = leaf_diffs(load(ROOT / fx["source"]), fx["deal"])
    if fx["changes"][0]["target"] == "deal": assert diffs == [fx["changes"][0]["path"]], diffs
    else: assert diffs == [], "context-only change must leave the deal untouched"
    got = mf.evaluate(fx); want = expected_findings(rule_id)
    assert [strip(f) for f in got] == [strip(f) for f in want]
    assert all(f["rule_id"] == rule_id for f in got)

@pytest.mark.parametrize("name", list(mf.EXTRA))
def test_extra_fixtures(name):
    """Term-specific fixtures: the deal differs from the real one exactly at the recorded paths; pass is clean,
    fail produces the frozen findings (one change)."""
    for case in ("pass", "fail"):
        fx = load(FIX / f"{name}-{case}.json")
        assert sorted(leaf_diffs(load(ROOT / fx["source"]), fx["deal"])) == sorted(c["path"] for c in fx["changes"] if c["target"] == "deal")
        got = mf.evaluate(fx)
        if case == "pass": assert got == [], [f["message"] for f in got]
        else:
            assert len(fx["changes"]) == 1
            assert [strip(f) for f in got] == [strip(f) for f in expected_findings(name)] and got

def test_fixtures_are_reproducible():
    """The committed fixtures are exactly what make_fixtures.py builds now (no hand edits)."""
    for name in mf.NAMES:
        for case in ("pass", "fail"):
            assert load(FIX / f"{name}-{case}.json") == json.loads(json.dumps(mf.build(name, case))), f"{name}-{case}: rerun make_fixtures.py"

def test_expected_findings_validate_against_schema():
    for p in sorted(glob.glob(str(FIX / "findings/*.json"))): jsonschema.validate(load(p), FINDING_SCHEMA)

# ---------- reference deals with master data ----------
KNOWN_ROLLFORWARD_GAPS = {"move-trust-finloc-2000-inc", "move-trust-tlfc-lp-leases"}   # see test_engine.py

def reference_runs(phases=(1, 2)):
    for f in sorted(glob.glob(str(ROOT / "docs/dashboard-json/[fm]*.dashboard.json"))):
        d = load(f); fx = {"meta": mf.META, "deal": d}
        ctx = Context(master=mf.master_for(d["deal_slug"]), upload=mf.upload_for(d), published_periods={checks.add_months(checks.period_key(d["collection_period"]), -1): "2026-07-01T00:00:00Z"})
        t = time.perf_counter(); fs = run({"meta": fx["meta"], "deal": d, "sources": {}}, ctx, phases=phases); el = time.perf_counter() - t
        yield d, fs, el

def test_reference_deals_with_master_have_no_blocks_beyond_known_gaps():
    for d, fs, _ in reference_runs():
        blocks = [(f["rule_id"], f["message"]) for f in fs if f["severity"] == "block"]
        if d["deal_slug"] in KNOWN_ROLLFORWARD_GAPS: assert [b[0] for b in blocks] == ["R05"], blocks
        else: assert not blocks, (d["deal_slug"], blocks)

def test_reference_review_findings_are_the_documented_ones():
    """Review findings on real deals: only R14 on Stride, whose seeded covenant definitions are Moneda's copied
    (docs/requests.md). R19 notes are real status changes."""
    seen = {(d["deal_slug"], f["rule_id"]) for d, fs, _ in reference_runs() for f in fs if f["severity"] == "review"}
    assert seen == {("f-pil-2-0-stride-capital", "R14")}, seen

def test_r18_reproduces_every_reference_status():
    for d, fs, _ in reference_runs():
        assert not [f for f in fs if f["rule_id"] == "R18"], d["deal_slug"]
        for c in d["covenants"]:
            if c["kind"] in ("ceiling", "floor") and c["current_value"] is not None and c["threshold"] is not None and c["status"] != "AVAILABLE":
                assert checks.derive_status(c["current_value"], c["threshold"], c["kind"], d["watch_buffer_pct"]) == c["status"], (d["deal_slug"], c["legal_ref"])

def test_reference_findings_validate_and_run_fast():
    for d, fs, el in reference_runs():
        assert el < 2.0, (d["deal_slug"], el)
        for f in fs: jsonschema.validate(f, FINDING_SCHEMA)

# ---------- focused unit tests ----------
def test_period_key_and_months():
    assert checks.period_key("August 2026") == "2026-08" and checks.period_key("2026-08") == "2026-08"
    assert checks.period_key("Jul-26") == "2026-07" and checks.period_key("Sept 2026") == "2026-09" and checks.period_key("garbage") is None
    assert checks.add_months("2026-01", -1) == "2025-12" and checks.add_months("2026-12", 1) == "2027-01"

def test_threshold_rule_resolves_against_pointer():
    defn = next(c for c in mf.seed("covenant_definitions.json") if c["deal_slug"] == "f-pil-2-0-moneda-capital-corp" and c["legal_ref"] == "SLFA 9.1 (c)")
    assert checks.resolve_threshold(defn, {"tranche_balance": {"closing": 15019971.52}}) == 0.04
    assert checks.resolve_threshold(defn, {"tranche_balance": {"closing": 10000000.0}}) == 0.06
    assert checks.resolve_threshold(defn, {"tranche_balance": {}}) is None

def test_r14_ignores_definitions_not_yet_effective():
    d = mf.load_deal(mf.MONEDA); m = mf.master_for(d["deal_slug"])
    m["covenants"].append({**m["covenants"][2], "threshold": 0.03, "effective_from": "2026-09-01"})
    assert run({"meta": mf.META, "deal": d, "sources": {}}, Context(master=m), only={"R14"}) == []

def test_r11_new_tranche_explains_opening_gap():
    """Dynamic Capital opens July with tranche 87 (7,662,419.16) funded since June: explained, no finding.
    Finloc's -47,609.31 opening gap has no new tranche behind it: R11 blocks."""
    dyn = mf.load_deal("move-trust-dynamic-capital.dashboard.json")
    assert run({"meta": mf.META, "deal": dyn, "sources": {}}, Context(prior=mf.prior_from_history(dyn)), only={"R11"}) == []
    fin = mf.load_deal(mf.FINLOC)
    fs = run({"meta": mf.META, "deal": fin, "sources": {}}, Context(prior=mf.prior_from_history(fin)), only={"R11"})
    assert len(fs) == 1 and abs(fs[0]["difference"] - (-47609.31)) < 0.01

def test_r11_flags_a_restated_prior_month():
    """Xpedite's Jan-26 leverage was 9.23 in the 2026-05 report and 9.30 from 2026-06 on (its own restatements list)."""
    d = mf.load_deal(mf.XPEDITE); prior = mf.prior_from_history(d)
    row = next(r for r in prior["ratio_history"] if r["month"] == "Jan-26"); row["debt_equity_ratio"] = 9.23
    fs = run({"meta": mf.META, "deal": d, "sources": {}}, Context(prior=prior), only={"R11"})
    assert len(fs) == 1 and fs[0]["context"]["restatement"] and fs[0]["report_value"] == 9.3 and fs[0]["our_value"] == 9.23

def test_r05_subtracts_the_npv_adjustment():
    d = mf.load_deal("move-trust-meridian-onecap-lp.dashboard.json")
    assert run({"meta": mf.META, "deal": d, "sources": {}}, Context(), only={"R05"}) == []
    cur = next(p for p in d["period_history"] if p["collection_period"] == d["collection_period"]); cur["charge_off"] = None
    fs = run({"meta": mf.META, "deal": d, "sources": {}}, Context(), only={"R05"})
    assert len(fs) == 1 and abs(fs[0]["difference"] - (-598714.81)) < 0.01

def test_r09_resolves_from_the_contract():
    d = mf.load_deal(mf.MONEDA); d["program"]["program_utilization_pct"] = 0.33
    fs = run({"meta": mf.META, "deal": d, "sources": {}}, Context(), only={"R09"})
    assert [f["unit"] for f in fs] == ["percent_points"]

def test_r17_recomputes_meridian_rolling_ratios_from_components():
    d = mf.load_deal("move-trust-meridian-onecap-lp.dashboard.json")
    v, basis = checks.recompute_metric(d, "charge_off_ratio", None, "charge_off_ratio")
    assert abs(v - 0.0094) < 0.0001 and "ratio_test_detail" in basis
    d["ratio_test_detail"]["portfolio_delinquency_ratio"]["history"][0]["numerator_amount"] *= 2
    fs = run({"meta": mf.META, "deal": d, "sources": {}}, Context(), only={"R17"})
    assert {f["context"]["metric"] for f in fs} == {"delinquency_ratio"}

def test_finding_message_override_and_no_context_clash():
    rule = next(r for r in RULES if r["id"] == "R05")
    f = finding(rule, "x", our_value=1, report_value=2, difference=1, context={"a": 5}, message="a={a} ours={our_value}")
    assert f["message"] == "a=5 ours=1"

# ---------- history chaining ----------
def test_chained_history_adds_no_findings():
    """The upload as handle_extraction sees it after chaining (the 4-month reference object) against the 3-month
    state as ctx.prior, versus the single-month extraction against the same prior: chaining must add no block or
    review finding. ctx.prior and the chained period_history carry the same earlier months; R11's restatement check
    compares them and must find them equal, and every other rule reads the current month by collection_period."""
    for f in sorted(glob.glob(str(ROOT / "docs/dashboard-json/[fm]*.dashboard.json"))):
        full = load(f); prior = mf.prior_state(full)
        def kept(deal):
            ctx = Context(prior=prior, master=mf.master_for(deal["deal_slug"]), upload=mf.upload_for(deal), published_periods={prior["collection_period"]})
            return {(x["rule_id"], x["message"]) for x in run({"meta": mf.META, "deal": deal, "sources": {}}, ctx, phases=(1, 2)) if x["severity"] != "note"}
        chained, single = kept(full), kept(mf.single_month(full))
        assert chained <= single, (full["deal_slug"], chained - single)
        assert not [m for r, m in chained if r == "R11" and "Restatement" in m], full["deal_slug"]
