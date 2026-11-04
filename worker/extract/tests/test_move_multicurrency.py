"""MOVE Trust settlement reports split by currency (layout move-trust-settrep-multicurrency-v1), reproduced from
the Finloc 2000 Inc. SetReps for April-July 2026 against docs/dashboard-json/move-trust-finloc-2000-inc.

- the four reports, chained (history.chain) or added one month at a time (history.extend), reproduce the whole
  reference object within compare.diff tolerance ($0.01 / 0.0001), except the reference quirks listed below;
- every extraction validates against contracts/extraction.schema.json, has a source on every non-null leaf, and
  fails exactly the phase-1 rules named in EXPECTED_BLOCKS (see the reasons there);
- the roll-forward closes in all four months with charge_off and adjustment_increase (page 2 column i).
Slow (29-page PDFs): run with EXTRACT_ALL=1.
"""
import functools
import json
import re

import jsonschema
import pytest

from worker.extract import extract
from worker.extract.compare import diff
from worker.extract.history import chain, extend
from worker.extract.provenance import leaves

from .conftest import MOVE_SAMPLES, REFS, ROOT

SLUG = "move-trust-finloc-2000-inc"
PDFS = sorted(MOVE_SAMPLES.glob("Finloc-*-SETTREP.pdf"))
SCHEMA = json.loads((ROOT / "contracts" / "extraction.schema.json").read_text(encoding="utf-8"))
pytestmark = [pytest.mark.slow,
              pytest.mark.skipif(len(PDFS) != 4, reason="Finloc SetReps not present under data/samples/move-trust/")]

# Reference paths no extraction rule can reproduce from the PDFs, each with the reason. ratio_history is compared
# by month (see _by_month), so its paths read /ratio_history/<Mon-YY>/<field>.
REFERENCE_QUIRKS = {
    r"^/ratio_history/Jun-25$":
        "Jun-25 is printed only by the April-June reports (originator table); the newest report (July) starts at "
        "Jul-25 and history.chain/extend keep the newest report's months. The reference keeps 14 months.",
    r"^/(period_history/\d+|tranche_balance)/charge_off$":
        "reference carries null; the extraction carries the downward part of page 2 column i 'Adjustment to "
        "Portfolio (+/-)' as charge_off (the R05 term behind KNOWN_ROLLFORWARD_GAPS -4,163.85 in July).",
    r"^/top10_obligors/\d+/(obligor_concentration_pct|concentration_limit_pct|concentration_limit_per_obligor"
    r"|excess_concentration_amount)$":
        "reference columns are shifted by one (obligor_concentration_pct holds the total amount, "
        "concentration_limit_pct the obligor's concentration, concentration_limit_per_obligor the 5% limit, "
        "excess_concentration_amount the per-obligor dollar limit); the extraction reads each printed column into "
        "its own field, as the other MOVE Trust references do.",
    r"^/(covenants|prior_covenants)/8/description$":
        "reference keeps only the first printed line of the MSA 8.1 (h) question; the extraction keeps the wrapped "
        "second line ('... Required Tranche Balance at such time?').",
    r"^/balance_discontinuities/[01]/explained_by_new_tranches$":
        "reference writes 0 for May and June but null for July although no new tranche appears in any month; "
        "history.chain/extend write null whenever there are no new tranches.",
    r"^/period_history/1/(opening_balance|by_currency/usd_opening_cad_equivalent)$":
        "the report prints no USD opening CAD equivalent; the extraction computes printed USD opening x printed "
        "spot (3,685,289.42 x 1.37980). The reference implies a spot of 1.3797999972 (unrounded source rate), "
        "$0.0103 lower in May; April and June differ by < $0.005 for the same reason.",
    r"^/balance_discontinuities/0/(current_opening|gap|residual)$":
        "follows from the May opening balance above ($0.0103).",
    r"^/data_corrections$":
        "audit record of a correction applied to the published object on 2026-10-09 (old value, date applied); "
        "not on the report. The extraction reads interest the corrected way, so it needs no correction.",
}

# Phase-1 block findings each extraction produces, by period, and why.
# R04: periods_line_up expects collection_period = meta.reporting_period + 1 month (F-PIL convention). In this
#      layout the page header names the collection period itself and the aggregate table ends at that month, so
#      reporting_period = collection_period; R04 needs a per-layout offset (request to Rules/Lead).
# R05: April-June have an upward 'Adjustment to Portfolio' (CAD +29,149.68 / +50,888.50 / +8,318.79, USD
#      +4,506.50 / +75.00); the extraction carries it as adjustment_increase, which R05 does not read yet.
EXPECTED_BLOCKS = {"2026-04": {"R04", "R05"}, "2026-05": {"R04", "R05"}, "2026-06": {"R04", "R05"}, "2026-07": {"R04"}}


@functools.lru_cache(maxsize=None)
def _extractions() -> tuple:
    return tuple(extract(str(p), "move-trust-settrep-v1", upload_id="00000000-0000-4000-8000-000000000002")
                 for p in PDFS)


def _ref() -> dict:
    return json.loads((REFS / f"{SLUG}.dashboard.json").read_text(encoding="utf-8"))


def _by_month(deal: dict) -> dict:
    out = dict(deal)
    out["ratio_history"] = {r["month"]: r for r in deal.get("ratio_history") or []}
    return out


def _split(diffs):
    real, known = [], {}
    for d in diffs:
        pat = next((p for p in REFERENCE_QUIRKS if re.search(p, d[0])), None)
        if pat is None:
            real.append(d)
        else:
            known.setdefault(pat, []).append(d)
    return real, known


def _check_against_reference(deal: dict):
    real, known = _split(diff(_by_month(deal), _by_month(_ref())))
    assert real == [], real
    # every listed quirk still occurs: a fixed quirk must come off the list
    assert set(known) == set(REFERENCE_QUIRKS), set(REFERENCE_QUIRKS) - set(known)


def test_layout_dispatch_and_period_convention():
    exs = _extractions()
    assert [e["meta"]["layout"] for e in exs] == ["move-trust-settrep-multicurrency-v1"] * 4
    d, meta = exs[-1]["deal"], exs[-1]["meta"]
    assert d["collection_period"] == "July 2026" and d["period_history"][0]["period"] == "2026-07"
    assert d["settlement_date"] == "August 13, 2026" and d["prior_period"] == "2026-06"
    # the page header names the collection period; the aggregate table ends at it: reporting = collection month
    assert meta["reporting_period"] == "2026-07"
    assert d["ratio_history"][-1]["month"] == "Jul-26"


def test_chained_reports_reproduce_reference():
    full = chain(list(_extractions()))
    jsonschema.validate(full, SCHEMA)
    _check_against_reference(full["deal"])


def test_month_by_month_reproduces_reference():
    exs = _extractions()
    doc = extend(None, exs[0])
    for ex in exs[1:]:
        doc = extend(doc["deal"], ex)
    assert [r["period"] for r in doc["deal"]["period_history"]] == ["2026-04", "2026-05", "2026-06", "2026-07"]
    full = chain(list(exs))["deal"]
    assert diff(doc["deal"], full) == [] and diff(full, doc["deal"]) == []
    _check_against_reference(doc["deal"])


def test_each_report_matches_its_history_row():
    ref = _ref()
    for ex in _extractions():
        for key in ("period_history", "aging_history"):
            row = ex["deal"][key][0]
            match = [r for r in ref[key] if r["period"] == row["period"]]
            assert match, (key, row["period"])
            real, _ = _split([(f"/{key}/{ref[key].index(match[0])}{p}", a, b) for p, a, b in diff(row, match[0])])
            assert real == [], (key, row["period"], real)


def test_schema_and_provenance():
    for ex in _extractions():
        jsonschema.validate(ex, SCHEMA)
        assert ex["meta"]["unplaced"] == [] and ex["meta"]["notes"] == []
        missing = [ptr for ptr, v in leaves(ex["deal"]) if v is not None and ptr not in ex["sources"]]
        assert missing == [], missing[:10]
        for ptr, s in ex["sources"].items():
            assert s["page"] >= 1 and isinstance(s["raw_text"], str)
        # printed cells carry their bbox; CAD-equivalent totals say how they were derived
        assert ex["sources"]["/period_history/0/activity_by_currency/spot_rate"]["bbox"] is not None
        assert ex["sources"]["/tranche_balance/by_currency/usd_closing_raw"]["raw_text"].startswith("derived:")
        assert ex["sources"]["/total_enhancement/total_enhancement_amount"]["page"] == 17


def test_phase1_rules_block_only_as_expected():
    from rules import run
    from rules.engine import Context
    for ex in _extractions():
        row = ex["deal"]["period_history"][0]
        blocks = [f for f in run(ex, Context(), phases=(1,)) if f["severity"] == "block"]
        assert {f["rule_id"] for f in blocks} == EXPECTED_BLOCKS[row["period"]], [(f["rule_id"], f["message"]) for f in blocks]
        r05 = [f for f in blocks if f["rule_id"] == "R05"]
        if r05:   # misses by exactly the upward adjustment R05 does not read yet
            assert abs(r05[0]["difference"] - row["adjustment_increase"]) <= 0.02   # rounded difference, USD cents


def test_r05_closes_with_adjustment_terms():
    """opening - principal - prepayments - losses - charge_off + adjustment_increase = closing on the CAD-equivalent
    totals, all four months; both terms are positive amounts sourced from page 2 / page 3 column i."""
    expected = {"2026-04": (0.0, 35289.34), "2026-05": (6011.10, 50888.50), "2026-06": (0.0, 8425.37),
                "2026-07": (4163.85, 0.0)}
    for ex in _extractions():
        row = ex["deal"]["period_history"][0]
        co, up = row["charge_off"], row["adjustment_increase"]
        assert co >= 0 and up >= 0
        assert abs(co - expected[row["period"]][0]) <= 0.01 and abs(up - expected[row["period"]][1]) <= 0.01
        assert ex["sources"]["/period_history/0/charge_off"]["page"] == 2
        computed = (row["opening_balance"] - row["principal"] - row["principal_prepayments"] - row["losses"]
                    - co + up)
        assert abs(computed - row["closing_balance"]) <= 0.02, (row["period"], computed, row["closing_balance"])


def test_interest_is_effective_yield_income():
    """interest = interest collections + prepayment penalties (j = (e+f)/a), so the 2026-07 value is the reference
    data_corrections new_value without a correction step."""
    ref = _ref()
    corr = ref["data_corrections"][0]
    d = _extractions()[-1]["deal"]
    assert abs(d["period_history"][0]["interest"] - corr["new_value"]) <= 0.01
    assert abs(d["period_history"][0]["interest"] - corr["old_value"]) > 1
    assert abs(d["tranche_balance"]["activity_by_currency"]["CAD"]["interest"] - (335936.52 + 10230.10)) <= 0.01
