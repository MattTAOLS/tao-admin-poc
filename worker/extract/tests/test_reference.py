"""The three F-PIL 2.0 reference objects, reproduced from their SetRep PDFs.

- each 2026-08 report alone reproduces every field of its reference object that one report can carry
  (the current period's rows of the history arrays; restatements/discontinuities need the other reports);
- the four reports per deal, chained, reproduce the whole reference object;
- the 2026-05..07 reports reproduce the reference history rows for their own period;
- every extraction validates against contracts/extraction.schema.json, and every leaf has a source;
- every extraction passes the implemented phase-1 rules with no block findings.
Tolerance: $0.01 on amounts, 0.0001 on fractions (worker/extract/compare.py).
"""
import functools
import json

import jsonschema
import pytest

from worker.extract import extract
from worker.extract.compare import compare_current, diff, split_known
from worker.extract.history import chain
from worker.extract.provenance import leaves

from .conftest import DEALS, REFS, ROOT, needs_samples, sample_pdfs

pytestmark = needs_samples
SCHEMA = json.loads((ROOT / "contracts" / "extraction.schema.json").read_text(encoding="utf-8"))


@functools.lru_cache(maxsize=None)
def _extractions(prefix: str) -> tuple:
    return tuple(extract(p, upload_id="00000000-0000-4000-8000-000000000001") for p in sample_pdfs(prefix))


def _ref(slug):
    return json.loads((REFS / f"{slug}.dashboard.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("slug,prefix", DEALS.items())
def test_latest_report_reproduces_reference(slug, prefix):
    exs = _extractions(prefix)
    assert len(exs) == 4
    ref = _ref(slug)
    keys = [k for k in ref if k not in ("restatements", "balance_discontinuities")]
    real, _known = split_known(compare_current(exs[-1]["deal"], ref, keys))
    # one report cannot carry ratio_history values it no longer prints (Xpedite Jul-25 ICR): checked chained below
    real = [d for d in real if not d[0].startswith("/ratio_history/")] if slug.endswith("xpedite-leasing") else real
    assert real == [], real


@pytest.mark.parametrize("slug,prefix", DEALS.items())
def test_chained_reports_reproduce_whole_reference(slug, prefix):
    full = chain(list(_extractions(prefix)))
    real, _known = split_known(diff(full["deal"], _ref(slug)))
    assert real == [], real
    jsonschema.validate(full, SCHEMA)


@pytest.mark.parametrize("slug,prefix", DEALS.items())
def test_each_report_matches_its_history_row(slug, prefix):
    ref = _ref(slug)
    for ex in _extractions(prefix):
        for key in ("period_history", "aging_history"):
            row = ex["deal"][key][0]
            match = [r for r in ref[key] if r["period"] == row["period"]]
            assert match, (key, row["period"])
            assert diff(row, match[0]) == [], (key, row["period"], diff(row, match[0]))


@pytest.mark.parametrize("slug,prefix", DEALS.items())
def test_schema_and_provenance(slug, prefix):
    for ex in _extractions(prefix):
        jsonschema.validate(ex, SCHEMA)
        assert ex["meta"]["unplaced"] == []
        missing = [ptr for ptr, v in leaves(ex["deal"]) if v is not None and ptr not in ex["sources"]]
        assert missing == [], missing[:10]
        for ptr, s in ex["sources"].items():
            assert s["page"] >= 1 and isinstance(s["raw_text"], str)
        # values read from a table carry a bbox
        assert ex["sources"]["/tranche_balance/closing"]["bbox"] is not None
        assert ex["meta"]["reporting_period"] is not None


@pytest.mark.parametrize("slug,prefix", DEALS.items())
def test_extractions_pass_phase1_rules(slug, prefix):
    from rules import run
    from rules.engine import Context
    for ex in _extractions(prefix):
        blocks = [f for f in run(ex, Context(), phases=(1,)) if f["severity"] == "block"]
        assert blocks == [], [(f["rule_id"], f["message"]) for f in blocks]


def test_period_naming():
    ex = _extractions("Moneda")[-1]
    assert ex["deal"]["collection_period"] == "August 2026"
    assert ex["deal"]["period_history"][0]["period"] == "2026-08"
    assert ex["meta"]["reporting_period"] == "2026-07"
    assert ex["deal"]["prior_period"] == "2026-07"


def test_reported_answers_kept_for_r18():
    # Moneda May 2026 page 14 answers YES for 9.1(h) and 9.1(i) (footnoted historical defaults)
    ex = _extractions("Moneda")[0]
    got = {c["legal_ref"]: c["reported_triggered"] for c in ex["deal"]["covenants"]}
    assert got["SLFA 9.1 (h)"] == "YES" and got["SLFA 9.1 (i)"] == "YES" and got["SLFA 9.1 (c)"] == "NO"


@pytest.mark.parametrize("slug,prefix", DEALS.items())
def test_r05_identity_with_all_rollforward_terms(slug, prefix):
    """contracts/rules.yaml R05 (lead/wave1-seams): opening + new_funded - principal - prepayments - losses
    - charge_off - ineligible_buyback = closing, within $1; absent terms count as 0. Checked here directly so it
    holds before the Rules agent's checks.py update is merged."""
    expected_terms = {"Moneda": {"charge_off"}, "Stride": {"new_funded", "ineligible_buyback"}, "Xpedite": set()}
    for ex in _extractions(prefix):
        row = ex["deal"]["period_history"][0]
        assert {k for k in ("charge_off", "new_funded", "ineligible_buyback") if k in row} == expected_terms[prefix]
        for k in ("charge_off", "new_funded", "ineligible_buyback"):
            if k in row:
                assert row[k] is not None and row[k] >= 0 and ex["sources"][f"/period_history/0/{k}"]["page"] == 2
        computed = (row["opening_balance"] + (row.get("new_funded") or 0) - row["principal"]
                    - row["principal_prepayments"] - row["losses"] - (row.get("charge_off") or 0)
                    - (row.get("ineligible_buyback") or 0))
        assert abs(computed - row["closing_balance"]) <= 1.0, (row["period"], computed, row["closing_balance"])
