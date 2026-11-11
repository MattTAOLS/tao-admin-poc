"""Bug-audit fixes in the rules package (docs/audit/tao-admin-poc-bug-audit_Report_v1.md): H4 (empty required tables,
unread pages, unplaced fields, a prior month's aging row), M4 (covenant without a value), M5 (R06 against the printed
change), M6 (a finding's page comes from this extraction, not the F-PIL hint), M7 (one covenant-status function)."""
import copy, json
import jsonschema, pytest
from rules import load_rules, run
from rules.engine import Context, page_of, resolve_source_page
from rules import checks
from rules.covenant_status import covenant_status
from rules.tests.fixtures import make_fixtures as mf

FINDING_SCHEMA = json.loads((mf.ROOT / "contracts/finding.schema.json").read_text(encoding="utf-8"))
UID = "00000000-0000-4000-8000-000000000000"

def ex_of(deal, sources=None, **meta): return {"meta": {**mf.META, **meta}, "deal": deal, "sources": sources or {}}

def only(rule_id, ex, ctx=None): return run(ex, ctx or Context(), only={rule_id})

def valid(fs):
    for f in fs: jsonschema.validate({**f, "extraction_id": UID}, FINDING_SCHEMA)
    return fs

# ---------- H4: R01 ----------
@pytest.mark.parametrize("ptr", ["/covenants", "/cnl_by_period", "/aging_history"])
def test_h4_empty_required_table_is_missing(ptr):
    d = mf.single_month(mf.load_deal(mf.MONEDA)); d[ptr[1:]] = []
    fs = valid(only("R01", ex_of(d)))
    assert len(fs) == 1 and fs[0]["severity"] == "block" and fs[0]["fields"] == [ptr] and ptr in fs[0]["message"]

def test_h4_reference_deals_have_no_new_r01_findings():
    for name in (mf.MONEDA, mf.STRIDE, mf.XPEDITE, mf.FINLOC, mf.TLFC_LP, mf.MERIDIAN):
        assert only("R01", ex_of(mf.load_deal(name))) == [], name

def test_h4_pages_without_text_block_and_name_the_pages():
    d = mf.load_deal(mf.MONEDA)
    fs = valid(only("R01", ex_of(d, pages_without_text=[14, 11])))
    assert len(fs) == 1
    f = fs[0]
    assert f["severity"] == "block" and f["fields"] == ["meta:/pages_without_text"] and f["source_page"] == 11
    assert f["context"]["pages"] == [11, 14] and "11, 14" in f["message"] and "no text layer" in f["message"]

def test_h4_unplaced_fields_block_and_name_the_fields():
    d = mf.load_deal(mf.MONEDA)
    fs = valid(only("R01", ex_of(d, unplaced=["aging.closing", "quantitative_tests.*"])))
    assert len(fs) == 1 and fs[0]["severity"] == "block" and fs[0]["fields"] == ["meta:/unplaced"]
    assert "aging.closing, quantitative_tests.*" in fs[0]["message"] and fs[0]["context"]["count"] == 2

def test_h4_blank_page_gives_three_distinct_findings():
    """Moneda with the quantitative-tests page blank: the empty table, the unread page and the unplaced section are
    three findings with different identities, so each can be resolved on its own."""
    d = mf.single_month(mf.load_deal(mf.MONEDA)); d["covenants"] = []
    fs = valid(only("R01", ex_of(d, pages_without_text=[14], unplaced=["quantitative_tests.*"])))
    assert [f["fields"] for f in fs] == [["/covenants"], ["meta:/pages_without_text"], ["meta:/unplaced"]]
    assert all(f["severity"] == "block" for f in fs)

def chained_without_this_months_aging():
    """What history chaining leaves when the aging page of the new report was not read: aging_history holds only
    the earlier months' rows, last month's first."""
    d = mf.load_deal(mf.MONEDA)
    assert d["aging_history"][0]["period"] == "2026-08" and d["aging_history"][1]["period"] == "2026-07"
    d["aging_history"] = d["aging_history"][1:]
    return d

def test_h4_r01_fails_when_aging_has_only_earlier_months():
    fs = valid(only("R01", ex_of(chained_without_this_months_aging())))
    assert len(fs) == 1 and fs[0]["fields"] == ["/aging_history"] and "no row for August 2026" in fs[0]["message"]

def test_h4_r07_never_validates_a_prior_months_row():
    d = chained_without_this_months_aging()
    d["aging_history"][0]["closing_balance"] += 5000.0      # last month's row broken: it is not this report's to check
    assert only("R07", ex_of(d)) == []
    full = mf.load_deal(mf.MONEDA); full["aging_history"][0]["closing_balance"] += 5000.0
    f = only("R07", ex_of(full))[0]
    assert f["targets"] == ["/aging_history/0/closing_balance"] and f["difference"] == 5000.0

def test_h4_r08_page_total_uses_this_months_aging_row():
    d = chained_without_this_months_aging()
    d["aging_history"][0]["cumulative_net_losses"] += 777.0
    assert not [f for f in only("R08", ex_of(d)) if "/aging_history" in " ".join(f["fields"])]

def test_h4_r05_blocks_when_period_history_has_only_earlier_months():
    d = mf.load_deal(mf.MONEDA)
    d["period_history"] = [r for r in d["period_history"] if r["collection_period"] != d["collection_period"]]
    fs = valid(only("R05", ex_of(d)))
    assert len(fs) == 1 and fs[0]["severity"] == "block" and "no row for August 2026" in fs[0]["message"]
    d["period_history"] = []
    assert only("R05", ex_of(d)) == []      # an object with no period_history at all: nothing to check (R01 owns the balances)

# ---------- M7: one status function ----------
@pytest.mark.parametrize("value, threshold, kind, want", [
    (1.11, 1.00, "floor", "WATCH"),      # Essex interest coverage, published as WATCH (1.11 <= 1.00 / 0.9)
    (1.105, 1.00, "floor", "WATCH"),     # between threshold x 1.1 and threshold / 0.9: the old extractor band said OK
    (1.12, 1.00, "floor", "OK"),
    (0.99, 1.00, "floor", "BREACH"),
    (1.00, 1.00, "floor", "WATCH"),
    (0.054, 0.06, "ceiling", "WATCH"),   # exactly threshold x (1 - buffer)
    (0.0539, 0.06, "ceiling", "OK"),
    (0.0601, 0.06, "ceiling", "BREACH"),
])
def test_m7_bands(value, threshold, kind, want):
    assert covenant_status(value, threshold, kind, 0.1) == want
    assert checks.derive_status(value, threshold, kind, 0.1) == want

@pytest.mark.parametrize("value, threshold, kind", [(None, 0.06, "ceiling"), (0.05, None, "ceiling"), (None, None, "floor"),
                                                    (0.05, 0.06, "binary"), (float("nan"), 0.06, "ceiling"), ("0.05", 0.06, "ceiling")])
def test_m7_no_status_without_numbers(value, threshold, kind):
    assert covenant_status(value, threshold, kind, 0.1) is None

def test_m7_rule_and_extractor_share_the_function():
    assert checks.covenant_status is covenant_status
    for name in (mf.MONEDA, mf.STRIDE, mf.XPEDITE, mf.FINLOC, mf.TLFC_LP, mf.MERIDIAN):
        d = mf.load_deal(name); buf = d.get("watch_buffer_pct", 0.1)
        for c in d["covenants"]:
            if c["kind"] in ("ceiling", "floor") and c["status"] != "AVAILABLE" and c["current_value"] is not None and c["threshold"] is not None:
                assert covenant_status(c["current_value"], c["threshold"], c["kind"], buf) == c["status"], (name, c["legal_ref"])

# ---------- M4: covenant without a value ----------
def floor_or_ceiling_index(d):
    return next(i for i, c in enumerate(d["covenants"]) if c["kind"] in ("ceiling", "floor") and c["current_value"] is not None)

@pytest.mark.parametrize("status", ["OK", None])
def test_m4_covenant_without_value_raises_a_review_finding(status):
    d = mf.load_deal(mf.MONEDA); i = floor_or_ceiling_index(d)
    d["covenants"][i]["current_value"] = None; d["covenants"][i]["status"] = status
    fs = valid([f for f in only("R18", ex_of(d)) if f["context"].get("missing_value")])
    assert len(fs) == 1
    f = fs[0]
    assert f["severity"] == "review" and f["fields"][0] == f"/covenants/{i}/current_value" and f["our_value"] is None
    assert d["covenants"][i]["legal_ref"] in f["message"] and "no current value" in f["message"]

def test_m4_binary_and_available_covenants_are_not_flagged():
    for name in (mf.MONEDA, mf.STRIDE, mf.XPEDITE, mf.FINLOC, mf.TLFC_LP, mf.MERIDIAN):
        assert not [f for f in only("R18", ex_of(mf.load_deal(name))) if f["context"].get("missing_value")], name

# ---------- M5: R06 on the printed change ----------
def with_printed_change(sign):
    d = mf.load_deal(mf.MONEDA); c = d["contracts"]
    c["change_reported"] = sign * (c["closing"] - c["opening"])       # F-PIL prints a decrease positive (-1), MOVE negative (+1)
    return d

@pytest.mark.parametrize("sign", [1, -1])
def test_m5_printed_change_that_closes_passes(sign):
    assert [f for f in only("R06", ex_of(with_printed_change(sign))) if "/contracts/change_reported" in f["fields"]] == []

def test_m5_printed_change_that_does_not_close_blocks():
    """The extractor derives change_abs = closing - opening, so the old check opening + change_abs = closing could not
    fail on a misread closing. The printed change can: closing read 3 too high."""
    d = with_printed_change(-1); c = d["contracts"]; i = len(d["period_history"]) - 1
    c["closing"] += 3; c["change_abs"] = c["closing"] - c["opening"]          # as every engine derives it
    d["period_history"][i]["closing_contracts"] = c["closing"]
    fs = valid([f for f in only("R06", ex_of(d)) if "/contracts/change_reported" in f["fields"]])
    assert len(fs) == 1
    f = fs[0]
    assert f["severity"] == "block" and f["difference"] == 3 and f["report_value"] == c["closing"] and f["our_value"] == c["closing"] - 3
    assert f["targets"] == ["/contracts/closing", f"/period_history/{i}/closing_contracts"]
    assert str(c["change_reported"]) in f["message"]

def test_m5_without_printed_change_the_old_check_still_runs():
    d = mf.load_deal(mf.MONEDA); assert "change_reported" not in d["contracts"]
    d["contracts"]["closing"] += 3
    assert any(f["targets"] and f["targets"][0] == "/contracts/closing" for f in only("R06", ex_of(d)))

# ---------- M6: source pages ----------
def dynamic(): return mf.load_deal("move-trust-dynamic-capital.dashboard.json")

def test_m6_move_trust_aging_finding_names_the_aging_page_of_this_report():
    """Dynamic Capital prints aging on page 15; rules.yaml's hint for R07 is the F-PIL page 11."""
    d = dynamic(); assert d["source_pages"]["aging_summary"] == 15
    d["aging_history"][0]["closing_balance"] += 1000.0
    f = only("R07", ex_of(d, template_id="move-trust-settrep-v1"))[0]
    assert f["source_page"] == 15
    assert "page 15 closing balance" in f["message"] and "page 11" not in f["message"]      # the sentence names this report's page too

def test_m6_leaf_provenance_wins_over_the_section_page_and_the_hint():
    d = dynamic(); d["aging_history"][0]["closing_balance"] += 1000.0
    sources = {"/aging_history/0/closing_balance": {"page": 16, "raw_text": "1"}}
    assert only("R07", ex_of(d, sources))[0]["source_page"] == 16

def test_m6_hint_stands_when_no_page_is_known():
    d = dynamic(); d["aging_history"][0]["closing_balance"] += 1000.0; d["source_pages"] = {}
    assert only("R07", ex_of(d))[0]["source_page"] == 11

def test_m6_fpil_pages_unchanged():
    d = mf.load_deal(mf.MONEDA); d["aging_history"][0]["closing_balance"] += 1000.0; d["period_history"][3]["principal"] += 1000.0
    assert only("R07", ex_of(d))[0]["source_page"] == 11 and only("R05", ex_of(d))[0]["source_page"] == 2

def test_m6_page_of_and_resolve():
    ex = {"deal": {"source_pages": {"cumulative_losses": 16, "quantitative_tests": 18}},
          "sources": {"/cnl_by_period/2/cumulative_net_losses": {"page": 17, "raw_text": "x"}, "/cnl_by_period/2/period": {"page": 17, "raw_text": "x"},
                      "/covenants/1/status": {"page": 17, "raw_text": "derived"}, "/covenants/1/threshold": {"page": 18, "raw_text": "x"},
                      "/covenants/1/description": {"page": 18, "raw_text": "x"}}}
    assert page_of("/cnl_by_period/2", ex) == 17 and page_of("/cnl_by_period/0", ex) == 16 and page_of("/covenants/1", ex) == 18
    assert page_of("prior:/covenants", ex) is None and page_of("master:/program/currency", ex) is None and page_of("/deal_name", ex) is None
    rule = {"source_page_hint": 12}
    assert resolve_source_page({"source_page": 12, "fields": ["prior:/x", "/cnl_by_period/2"]}, rule, ex) == 17
    assert resolve_source_page({"source_page": 12, "targets": ["/covenants/1/threshold"], "fields": ["/cnl_by_period/2"]}, rule, ex) == 18
    assert resolve_source_page({"source_page": 3, "fields": ["/cnl_by_period/2"]}, rule, ex) == 3       # the check set its own page
    assert resolve_source_page({"source_page": 12, "fields": ["master:/x"]}, rule, ex) == 12
