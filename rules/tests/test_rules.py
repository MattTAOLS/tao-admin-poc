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
KNOWN_ROLLFORWARD_GAPS = {"move-trust-finloc-2000-inc", "move-trust-tlfc-lp-leases"}   # reference-data gaps, see test_engine.py

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
    """Review findings on real deals: none. The earlier R14 pair on Stride came from seed definitions copied from
    Moneda; since lead/covenants (71c8ca4) Stride and Xpedite have their own, and all three F-PIL deals agree with
    the master record. R19 notes are real status changes and are not counted here."""
    seen = {(d["deal_slug"], f["rule_id"]) for d, fs, _ in reference_runs() for f in fs if f["severity"] == "review"}
    assert seen == set(), seen

def test_r14_compares_every_f_pil_deal_against_its_own_definitions():
    """Each F-PIL deal's master definitions match some of its page-14 refs (Xpedite's ARFA refs are compared now),
    and a one-number change on a matched covenant fires R14."""
    for src in (mf.MONEDA, mf.STRIDE, mf.XPEDITE):
        d = mf.load_deal(src); m = mf.master_for(d["deal_slug"])
        defs = checks._effective(m["covenants"], checks.period_key(d["collection_period"]))
        idx = [i for i, c in enumerate(d["covenants"]) if c["kind"] in ("ceiling", "floor") and checks._ref(c["legal_ref"]) in defs
               and checks.resolve_threshold(defs[checks._ref(c["legal_ref"])], d) is not None]
        assert idx, src
        d["covenants"][idx[0]]["threshold"] *= 2
        fs = run({"meta": mf.META, "deal": d, "sources": {}}, Context(master=m), only={"R14"})
        assert [f["context"]["legal_ref"] for f in fs] == [d["covenants"][idx[0]]["legal_ref"]], src

def test_r14_skips_a_definition_with_no_threshold_and_no_rule():
    """Stride SLFA 9.1 (g) CNL: threshold null, no threshold_rule (set per vintage). The report states 3.50%;
    R14 must not compare it, nor flag its kind."""
    d = mf.load_deal(mf.STRIDE); m = mf.master_for(d["deal_slug"])
    g = next(x for x in m["covenants"] if x["legal_ref"] == "SLFA 9.1 (g)")
    assert g["threshold"] is None and not g["threshold_rule"]
    assert run({"meta": mf.META, "deal": d, "sources": {}}, Context(master=m), only={"R14"}) == []
    g["kind"] = "floor"
    assert run({"meta": mf.META, "deal": d, "sources": {}}, Context(master=m), only={"R14"}) == []

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

MOVE_META = {**mf.META, "template_id": "move-trust-settrep-v1"}
TPINE = "move-trust-tpine-leasing-capital-corporation.dashboard.json"

def test_r05_move_terms_close_the_documented_reference_gaps():
    """The two reference gaps are the MOVE Trust adjustment column the references do not carry. With July's values as
    extracted (TLFC LP adjustment_increase +2,782.68, Finloc charge_off 4,163.85) R05 closes to the cent; Meridian
    closes with balance_adjustment 0.00 as every sample prints it."""
    for name, field, value, gap in ((mf.TLFC_LP, "adjustment_increase", 2782.68, 2782.68), (mf.FINLOC, "charge_off", 4163.85, -4163.85)):
        d = mf.load_deal(name)
        fs = run({"meta": MOVE_META, "deal": d, "sources": {}}, Context(), only={"R05"})
        assert len(fs) == 1 and abs(fs[0]["difference"] - gap) < 0.01, name
        cur = next(p for p in d["period_history"] if p["collection_period"] == d["collection_period"]); cur[field] = value
        assert run({"meta": MOVE_META, "deal": d, "sources": {}}, Context(), only={"R05"}) == [], name
    d = mf.load_deal(mf.MERIDIAN); d["period_history"][3]["balance_adjustment"] = 0.0
    assert run({"meta": MOVE_META, "deal": d, "sources": {}}, Context(), only={"R05"}) == []

def test_r05_null_move_terms_count_as_zero():
    d = mf.load_deal(mf.MONEDA); d["period_history"][3].update(adjustment_increase=None, balance_adjustment=None)
    assert run({"meta": mf.META, "deal": d, "sources": {}}, Context(), only={"R05"}) == []

def test_r05_message_names_the_move_terms():
    fx = json.loads((FIX / "r05-charge-off-move-fail.json").read_text(encoding="utf-8"))
    f = mf.evaluate(fx)[0]
    assert "+ upward adjustment 4163.85" in f["message"] and f["context"]["adjustment_increase"] == 4163.85

def _tpine_with_rolling_3m(value):
    d = mf.load_deal(TPINE)
    r = d["financial_ratios"][1]; assert r["key"] == "rolling_3month_loss_ratio"
    r["value"] = value
    return run({"meta": MOVE_META, "deal": d, "sources": {}}, Context(), only={"R03"})

@pytest.mark.parametrize("printed", [-1.1321, -1.3068, -5.0, 1.0])
def test_r03_loss_ratios_may_go_below_minus_100_percent(printed):
    """TPine April / May print Rolling 3M Loss Ratio -113.21% / -130.68% (recoveries on a small base)."""
    assert _tpine_with_rolling_3m(printed) == []

@pytest.mark.parametrize("misread", [113.21, -113.21, 1.1321, -5.01])
def test_r03_loss_ratio_misreads_still_block(misread):
    fs = _tpine_with_rolling_3m(misread)
    assert len(fs) == 1 and fs[0]["severity"] == "block" and fs[0]["context"]["range"] == "-5.0 to 1.0" and fs[0]["report_value"] == misread

def test_r03_loss_range_covers_loss_and_cnl_keys_only():
    for key in ("loss_ratio", "rolling_3month_loss_ratio", "rolling_12month_loss_ratio", "cnl_ratio", "annualized_loss_ratio", "cumulative_net_loss_ratio"):
        assert checks.ratio_range({"key": key, "format": "pct"}) == checks.LOSS_RANGE, key
    for key in ("delinquency_ratio", "rvl_ratio", "charge_off_ratio", "deemed_default_ratio"):
        assert checks.ratio_range({"key": key, "format": "pct"}) == (-1.0, 1.0), key
    d = mf.load_deal(TPINE); d["financial_ratios"][0]["value"] = -1.1321   # delinquency keeps -1..1
    fs = run({"meta": MOVE_META, "deal": d, "sources": {}}, Context(), only={"R03"})
    assert len(fs) == 1 and fs[0]["context"]["range"] == "-1.0 to 1.0"

def test_r04_reporting_lag_comes_from_the_contract_per_template():
    lags = load_rules()["reporting_lag_months"]
    assert lags["fpil-2.0-settrep-v1"] == 1 and lags["move-trust-settrep-v1"] == 0
    d = mf.load_deal(TPINE)   # "Settlement Date August 20, 2026 for Collection Period July 2026"
    ok = run({"meta": {**MOVE_META, "reporting_period": "2026-07"}, "deal": d, "sources": {}}, Context(), only={"R04"})
    assert ok == []
    fs = run({"meta": {**MOVE_META, "reporting_period": "2026-06"}, "deal": d, "sources": {}}, Context(), only={"R04"})
    assert len(fs) == 1 and "should be 0 months after the reporting period 2026-06 for template move-trust-settrep-v1 (expected 2026-06)" in fs[0]["message"]
    fs = run({"meta": {**mf.META, "reporting_period": "2026-07"}, "deal": d, "sources": {}}, Context(), only={"R04"})   # F-PIL lag on a MOVE month
    assert len(fs) == 1 and "should be 1 month after" in fs[0]["message"] and fs[0]["our_value"] == "2026-08"

def test_r04_unknown_template_assumes_one_month_and_master_template_is_the_fallback():
    d = mf.load_deal(mf.MONEDA)   # collection 2026-08
    meta = {**mf.META, "template_id": "unknown-v9", "reporting_period": "2026-07"}
    assert run({"meta": meta, "deal": d, "sources": {}}, Context(), only={"R04"}) == []
    d = mf.load_deal(TPINE); meta = {k: v for k, v in MOVE_META.items() if k != "template_id"}; meta["reporting_period"] = "2026-07"
    master = {"deal": {"slug": d["deal_slug"], "template_id": "move-trust-settrep-v1"}}
    assert run({"meta": meta, "deal": d, "sources": {}}, Context(master=master), only={"R04"}) == []
    assert len(run({"meta": meta, "deal": d, "sources": {}}, Context(), only={"R04"})) == 1

def test_r04_direct_call_without_settings_reads_the_contract():
    rule = next(r for r in RULES if r["id"] == "R04")
    d = mf.load_deal(TPINE)
    assert checks.periods_line_up(rule, {"meta": {**MOVE_META, "reporting_period": "2026-07"}, "deal": d}, Context(), load_rules()["tolerances"]) == []

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

# ---------- override targets ----------
TARGET_RULES = {"R05", "R06", "R07", "R08", "R09", "R10", "R17"}

def assert_targets_resolve(deal, findings, where):
    for f in findings:
        if "targets" not in f: continue
        assert f["rule_id"] in TARGET_RULES, (where, f["rule_id"])
        assert f["targets"] and len(set(f["targets"])) == len(f["targets"]), (where, f["targets"])
        for ptr in f["targets"]:
            v = checks._get(deal, ptr)
            assert v is not None, (where, f["rule_id"], ptr, "does not resolve")
            t = 0.005 if f["unit"] == "currency" else 1e-9
            assert abs(v - f["report_value"]) <= t, (where, f["rule_id"], ptr, v, f["report_value"])
            assert type(f["our_value"]) in (int, float), (where, f["rule_id"])

def test_every_fixture_target_resolves_to_report_value():
    n = 0
    for name in mf.NAMES:
        for case in ("pass", "fail"):
            fx = load(FIX / f"{name}-{case}.json"); fs = mf.evaluate(fx)
            assert_targets_resolve(fx["deal"], fs, f"{name}-{case}"); n += sum("targets" in f for f in fs)
    assert n == 12   # R05 x6 (base, new-funded, buyback, MOVE adjustment increase, charge-off, balance adjustment), R06, R07, R08, R09, R10, R17

def test_targets_resolve_in_single_and_chained_objects():
    """Seed the same errors in each reference deal as uploaded (one month) and as chained (four months): the current
    row's index differs (0 vs 3) and every target must still point at the value the report states."""
    for f in sorted(glob.glob(str(ROOT / "docs/dashboard-json/[fm]*.dashboard.json"))):
        full = load(f)
        for label, deal in (("chained", copy.deepcopy(full)), ("single", mf.single_month(full))):
            i = checks._current_index(deal)
            assert i == (len(full["period_history"]) - 1 if label == "chained" else 0)
            deal["period_history"][i]["principal"] += 1000.0
            deal["contracts"]["closing"] += 1
            deal["program"]["unused_facility"] = (deal["program"]["unused_facility"] or 0) + 500.0
            fs = run({"meta": mf.META, "deal": deal, "sources": {}}, Context(), phases=(1, 2))
            assert_targets_resolve(deal, fs, (full["deal_slug"], label))
            r05 = next(x for x in fs if x["rule_id"] == "R05" and x["targets"][0].endswith("closing_balance"))
            assert r05["targets"][0] == f"/period_history/{i}/closing_balance" and "/tranche_balance/closing" in r05["targets"]
            assert any(x["rule_id"] == "R06" and x.get("targets") == ["/contracts/closing"] for x in fs)

def test_applying_our_value_clears_the_finding():
    """What approve does with use_ours: write our_value to every target. Re-running the rule must no longer raise a
    finding on those targets (it may raise a different one, e.g. R08's ratio once the CNL changes)."""
    for name in mf.NAMES:
        fx = load(FIX / f"{name}-fail.json")
        for f in mf.evaluate(fx):
            if "targets" not in f: continue
            fixed = copy.deepcopy(fx)
            for ptr in f["targets"]: mf.set_ptr(fixed["deal"], ptr, f["our_value"])
            again = [g for g in mf.evaluate(fixed) if g.get("targets") == f["targets"]]
            assert not again, (name, f["message"], [g["message"] for g in again])

def test_no_targets_on_master_period_status_or_text_findings():
    for p in sorted(glob.glob(str(FIX / "findings/*.json"))):
        f = load(p)
        if f["rule_id"] not in TARGET_RULES: assert "targets" not in f, p

# ---------- R12 corrected re-issues ----------
def test_r12_reissue_has_no_targets_and_carries_context():
    f = mf.evaluate(load(FIX / "r12-reissue-later-fail.json"))[0]
    assert f["severity"] == "block" and "targets" not in f
    assert f["context"]["replaces_upload_id"] == "11111111-1111-4111-8111-111111111111" and f["context"]["later_periods"] == ["2026-09", "2026-10"]
    assert f["context"]["published_at"] == "2026-08-12T16:40:00Z"

def test_r12_plain_duplicate_keeps_its_message_and_set_form_works():
    d = mf.load_deal(mf.MONEDA)
    f = run({"meta": mf.META, "deal": d, "sources": {}}, Context(published_periods={"2026-08"}), only={"R12"})[0]
    assert f["message"] == "f-pil-2-0-moneda-capital-corp already has a published report for 2026-08 (published earlier)"
    g = run({"meta": mf.META, "deal": d, "sources": {}}, Context(published_periods={"2026-08", "2026-09"}, upload={"replaces_upload_id": "x"}), only={"R12"})[0]
    assert g["message"] == ("Corrected re-issue: replaces the 2026-08 report published earlier. "
                            "Later published months (2026-09) still carry the earlier figures for 2026-08.")
