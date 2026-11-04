"""MOVE Trust payment-date servicer report (template move-trust-servicer-report-v1, engine servicer_report),
reproducing docs/dashboard-json/move-trust-meridian-onecap-lp.dashboard.json from the four 2026-04..07 reports.

Sample tests are slow (EXTRACT_ALL=1) and need the git-ignored PDFs under <samples>/move-trust/.
Tolerance: $0.01 on amounts, 0.0001 on fractions (worker/extract/compare.py).
"""
import functools
import glob
import json
import re

import jsonschema
import pytest

from worker.extract import _pick_layout, extract
from worker.extract.compare import diff
from worker.extract.engines import servicer_report
from worker.extract.history import chain, extend
from worker.extract.mapper import load_template
from worker.extract.provenance import leaves
from worker.extract.text import Line, Page, Token

from .conftest import MOVE_SAMPLES, REFS, ROOT

SLUG = "move-trust-meridian-onecap-lp"
PREFIX = "MOCLP"
SCHEMA = json.loads((ROOT / "contracts" / "extraction.schema.json").read_text(encoding="utf-8"))

# Reference values this layout's extraction cannot reproduce, with the reason for each. Every entry must match at
# least one difference (so a stale entry fails the test instead of hiding nothing).
MERIDIAN_REFERENCE_QUIRKS = {
    r"^/source_pages/quantitative_tests$":
        "reference has null; the lock-up / event-of-default tests are printed on page 11 and we cite that page",
    r"^/source_pages/financial_ratios$":
        "reference has page 1; the ratios (test results, CNL) are on page 11 and we cite that page",
    r"^/prior_covenants/\d+/trend$":
        "reference prior_covenants carry trend 'n/a'; chain()/extend() copy the prior report's covenants, whose trend "
        "is computed from its own prior-month test result (same quirk as compare.KNOWN_REFERENCE_QUIRKS for F-PIL)",
}


def _pdfs():
    return sorted(glob.glob(str(MOVE_SAMPLES / f"{PREFIX}*.pdf")))


needs_move_samples = pytest.mark.skipif(len(_pdfs()) != 4, reason=f"{PREFIX} servicer reports not under {MOVE_SAMPLES}")


@functools.lru_cache(maxsize=None)
def _exs() -> tuple:
    return tuple(extract(p, "move-trust-settrep-v1", upload_id="00000000-0000-4000-8000-000000000002")
                 for p in _pdfs())


def _ref():
    return json.loads((REFS / f"{SLUG}.dashboard.json").read_text(encoding="utf-8"))


def _split(diffs):
    real, hits = [], {k: 0 for k in MERIDIAN_REFERENCE_QUIRKS}
    for d in diffs:
        k = next((k for k in MERIDIAN_REFERENCE_QUIRKS if re.search(k, d[0])), None)
        if k is None:
            real.append(d)
        else:
            hits[k] += 1
    return real, hits


def _stepwise():
    exs = _exs()
    doc = extend(None, exs[0])
    for ex in exs[1:]:
        doc = extend(doc["deal"], ex)
    return doc


# ---------------------------------------------------------------- whole reference
@pytest.mark.slow
@needs_move_samples
def test_chained_reports_reproduce_whole_reference():
    full = chain(list(_exs()))
    real, hits = _split(diff(full["deal"], _ref()))
    assert real == [], real
    assert all(hits.values()), f"stale quirk entries: {[k for k, n in hits.items() if not n]}"
    jsonschema.validate(full, SCHEMA)


@pytest.mark.slow
@needs_move_samples
def test_month_by_month_reproduces_reference_and_equals_chain():
    step = _stepwise()
    full = chain(list(_exs()))
    assert diff(step["deal"], full["deal"]) == [] and diff(full["deal"], step["deal"]) == []
    real, _ = _split(diff(step["deal"], _ref()))
    assert real == [], real
    assert step["meta"]["history"]["periods"] == ["2026-04", "2026-05", "2026-06", "2026-07"]


@pytest.mark.slow
@needs_move_samples
def test_each_report_matches_its_history_rows():
    ref = _ref()
    for ex in _exs():
        for key in ("period_history", "aging_history"):
            row = ex["deal"][key][0]
            match = [r for r in ref[key] if r["period"] == row["period"]]
            assert match, (key, row["period"])
            assert diff(row, match[0]) == [], (key, row["period"], diff(row, match[0]))


# ---------------------------------------------------------------- each extraction
@pytest.mark.slow
@needs_move_samples
def test_schema_provenance_and_layout():
    for ex in _exs():
        jsonschema.validate(ex, SCHEMA)
        assert ex["meta"]["layout"] == "move-trust-servicer-report-v1"
        assert ex["meta"]["unplaced"] == [] and ex["meta"]["notes"] == []
        missing = [ptr for ptr, v in leaves(ex["deal"]) if v is not None and ptr not in ex["sources"]]
        assert missing == [], missing[:10]
        for s in ex["sources"].values():
            assert s["page"] >= 1 and isinstance(s["raw_text"], str)
        # values read from a table carry a bbox and the printed text
        src = ex["sources"]["/period_history/0/charge_off"]
        assert src["page"] == 2 and src["bbox"] is not None
        assert ex["sources"]["/total_enhancement/ending_cash_reserve_amount"]["raw_text"].startswith("$")


@pytest.mark.slow
@needs_move_samples
def test_phase1_rules_only_r04_blocks():
    """R04 assumes F-PIL's convention (collection period = page-header reporting period + 1 month). On this layout
    the Report Month IS the collection period, so R04 blocks every report and nothing else does."""
    from rules import run
    from rules.engine import Context
    for ex in _exs():
        blocks = [f for f in run(ex, Context(), phases=(1,)) if f["severity"] == "block"]
        assert [f["rule_id"] for f in blocks] == ["R04"], [(f["rule_id"], f["message"]) for f in blocks]
        cp = ex["deal"]["period_history"][0]["period"]
        assert ex["meta"]["reporting_period"] == cp
        assert f"page-header reporting period {cp}" in blocks[0]["message"]


@pytest.mark.slow
@needs_move_samples
def test_period_convention():
    ex = _exs()[-1]
    d = ex["deal"]
    assert d["settlement_date"] == "August 24, 2026"           # "Payment Date August 24, 2026"
    assert d["collection_period"] == "July 2026"               # "... for Collection Period July 2026"
    assert d["period_history"][0]["period"] == "2026-07"
    assert d["prior_period"] == "2026-06"
    assert ex["meta"]["reporting_period"] == "2026-07"         # "Report Month: Jul-26" = the collection month
    assert ex["sources"]["/collection_period"]["page"] == 1


@pytest.mark.slow
@needs_move_samples
def test_r05_closes_with_charge_off():
    """opening - principal - prepayments - deemed defaults - charge-off (+ balance adjustment, 0 in every sample)
    = closing, to the cent, in all four months; without charge_off July is off by -598,714.81 (the old gap)."""
    from rules import run
    from rules.engine import Context
    for ex in _exs():
        row = ex["deal"]["period_history"][0]
        assert row["charge_off"] > 0 and row["balance_adjustment"] == 0
        computed = (row["opening_balance"] - row["principal"] - row["principal_prepayments"] - row["losses"]
                    - row["charge_off"] + row["balance_adjustment"])
        assert abs(computed - row["closing_balance"]) <= 0.02, (row["period"], computed - row["closing_balance"])
        assert not [f for f in run(ex, Context(), phases=(1,)) if f["rule_id"] == "R05"]
    jul = _exs()[-1]["deal"]["period_history"][0]
    assert round(jul["opening_balance"] - jul["principal"] - jul["principal_prepayments"] - jul["losses"]
                 - jul["closing_balance"], 2) == 598714.81


@pytest.mark.slow
@needs_move_samples
def test_direct_template_id_equals_dispatch():
    p = _pdfs()[-1]
    a = extract(p, "move-trust-servicer-report-v1")["deal"]
    assert diff(a, _exs()[-1]["deal"]) == []


# ---------------------------------------------------------------- no samples needed
def _line(*words, top=10.0):
    toks, x = [], 10.0
    for w in words:
        toks.append(Token(w, x, x + 6 * len(w), top, top + 8))
        x += 6 * len(w) + 4
    return Line(toks)


def test_template_and_dispatch():
    tpl = load_template("move-trust-servicer-report-v1")
    assert tpl["engine"] == "servicer_report"
    page1 = Page(1, [_line("Payment", "Date", "August", "24,", "2026"), _line("COLLECTION", "PERIOD", "INFORMATION", top=30)])
    assert _pick_layout(load_template("move-trust-settrep-v1"), page1) == "move-trust-servicer-report-v1"


def test_line_decorations():
    tpl = load_template("move-trust-servicer-report-v1")
    lab, cs, ans = servicer_report._decorated(_line("70", "1", "Month", "Prior", "to", "Current", "Month",
                                                    "$176,638,488.87", "$904,309.48", "0.51%", "PREVIOUS"), tpl)
    assert " ".join(t.text for t in lab) == "1 Month Prior to Current Month"
    assert [c.value for c in cs] == [176638488.87, 904309.48, 0.0051]
    lab, cs, ans = servicer_report._decorated(_line("1", "Month", "Prior", "to", "Current", "Month", "0.50%",
                                                    "PREVIOUS"), tpl)
    assert " ".join(t.text for t in lab) == "1 Month Prior to Current Month" and cs[0].value == 0.005
    lab, cs, ans = servicer_report._decorated(_line("88", "Lock-Up", "Event", "Triggered?", "No"), tpl)
    assert " ".join(t.text for t in lab) == "Lock-Up Event Triggered?" and ans.text == "No" and cs == []
