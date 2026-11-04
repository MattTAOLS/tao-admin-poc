"""MOVE Trust standard settlement reports (layout move-trust-settrep-standard-v1), reproduced from the April-July
2026 SetReps of the four deals that print this layout, against their docs/dashboard-json reference objects.

For each deal:
- the four reports, chained (history.chain) or added one month at a time (history.extend), reproduce the whole
  reference object within compare.diff tolerance ($0.01 / 0.0001), except the reference quirks listed per deal
  below (each with its reason); a quirk that stops occurring fails the test, so it comes off the list;
- every extraction validates against contracts/extraction.schema.json, has a source on every non-null leaf, and
  fails exactly the phase-1 block rules listed per deal (see EXPECTED_BLOCKS);
- the tranche roll-forward (R05) closes in all four months with the extra terms this layout prints
  (ineligible_buyback, charge_off / adjustment_increase from the signed NBV adjustment);
- interest is the effective-yield income (interest collections + prepayment penalties / excess), i.e. the
  reference's data_corrections new_value, without a correction step.
Slow (16 PDFs): run with EXTRACT_ALL=1.
"""
import functools
import json
import re

import jsonschema
import pytest

from worker.extract import extract, merge_patch
from worker.extract.compare import diff
from worker.extract.history import chain, extend
from worker.extract.provenance import leaves

from .conftest import MOVE_SAMPLES, REFS, ROOT

SCHEMA = json.loads((ROOT / "contracts" / "extraction.schema.json").read_text(encoding="utf-8"))
pytestmark = pytest.mark.slow

# Quirks every reference object of this layout shares.
COMMON_QUIRKS = {
    r"^/ratio_history/Jun-25$":
        "Jun-25 is printed only by the April-June reports; the newest report (July) starts at Jul-25 and "
        "history.chain/extend keep the newest report's months. The reference keeps 14 months.",
    r"^/data_corrections$":
        "audit record of a correction applied to the published object on 2026-10-09 (old value, date applied); not "
        "on the report. The extraction reads interest the corrected way, so it needs no correction.",
}

DEALS = {
    "dynamic": {
        "slug": "move-trust-dynamic-capital",
        "glob": "Dynamic Capital 1.0-SETTREP-2026*.pdf",
        "settlement_date": "August 20, 2026",
        "quirks": {
            r"^/balance_discontinuities/(#len|[23]/)":
                "the reference omits the $0.02 Tranche Amount gap in June (May closing 193,125,980.97, June opening "
                "193,125,980.99, both as printed); history.chain records every gap above $0.01, so the July entries "
                "move down one index.",
            r"^/(covenants|prior_covenants)/7/(current_value|note)$":
                "p.12 prints the Required Tranche Balance rows in a font too small for the text layer (glyphs of "
                "adjacent rows merge); only the totals line reads, so the per-tranche differential (reference "
                "-0.01) is left null.",
        },
        "extend_quirks": {},
        "blocks": {m: set() for m in ("2026-04", "2026-05", "2026-06", "2026-07")},
    },
    "essex": {
        "slug": "move-trust-essex-lease-financial-corp",
        "glob": "Essex - 2026* - SETTREP.pdf",
        "settlement_date": "August 24, 2026",
        "quirks": {
            r"^/source_pages/financial_ratios$":
                "reference names the aggregate-performance page (12); the extraction names the page that prints the "
                "borrower ratios (13), as the Dynamic Capital and VCC IV references do.",
            r"^/prior_covenants/2/trend$":
                "June rolling three-month loss ratio 1.26% vs May 1.24% is a 1.6% relative change, past the 1% flat "
                "band (rising); the reference says flat.",
            r"^/prior_covenants/10/description$":
                "the reference repeats July's '(14 of 53 tranches eligible)'; the June report had 52 tranches "
                "securitized before its collection period.",
        },
        # history.extend reads the reporting-month lag from the extraction (0 here), so it matches chain()
        "extend_quirks": {},
        "blocks": {m: set() for m in ("2026-04", "2026-05", "2026-06", "2026-07")},
    },
    "tpine": {
        "slug": "move-trust-tpine-leasing-capital-corporation",
        "glob": "TPine - 2026* - SETTREP.pdf",
        "settlement_date": "August 24, 2026",
        "quirks": {
            r"^/source_pages/cumulative_losses$":
                "reference names the aging page (12); the CUMULATIVE LOSSES heading is on p.13.",
            r"^/source_pages/financial_ratios$":
                "reference names the aggregate-performance page (13); the extraction names the guarantor ratios "
                "page (14).",
            r"^/cnl_by_period/\d+/current_period_losses$":
                "reference sums the p.2 Interest Collections column per annual period (e.g. 18,383.92 for tranche "
                "21); the extraction sums the p.13 Current Period Losses column (-60,656.26 for tranche 21).",
            r"^/(covenants|prior_covenants)/6/(category|threshold|note)$":
                "MLA 7.5 is printed under CLEAN-UP PROVISION; the reference files it as an Event of Termination with "
                "the generic binary threshold and note. The extraction treats every clean-up provision alike (as the "
                "VCC IV reference does): category Clean-Up Provision, threshold and note null when answered NO.",
        },
        "extend_quirks": {},
        # the printed Rolling 3M Loss Ratio of -113.21% / -130.68% (April / May) is inside R03's wider range now
        "blocks": {m: set() for m in ("2026-04", "2026-05", "2026-06", "2026-07")},
    },
    "vcc": {
        "slug": "move-trust-vcc-iv-lp",
        "glob": "Vault Rated - SETTREP 2026*.pdf",
        "settlement_date": "August 20, 2026",
        "quirks": {
        },
        "extend_quirks": {},
        "blocks": {m: set() for m in ("2026-04", "2026-05", "2026-06", "2026-07")},
    },
}
# With R03's wider loss-ratio range, R04's per-program offset (MOVE reporting month = collection month) and
# R05's adjustment_increase / charge_off terms on main, no MOVE report raises a phase-1 block.


def _pdfs(deal: str) -> list:
    return sorted(MOVE_SAMPLES.glob(DEALS[deal]["glob"]))


def _need(deal: str):
    if len(_pdfs(deal)) != 4:
        pytest.skip(f"{deal} SetReps not present under data/samples/move-trust/")


@functools.lru_cache(maxsize=None)
def _extractions(deal: str) -> tuple:
    return tuple(extract(str(p), "move-trust-settrep-v1", upload_id="00000000-0000-4000-8000-000000000003")
                 for p in _pdfs(deal))


@functools.lru_cache(maxsize=None)
def _ref_text(deal: str) -> str:
    return (REFS / f"{DEALS[deal]['slug']}.dashboard.json").read_text(encoding="utf-8")


def _ref(deal: str) -> dict:
    return json.loads(_ref_text(deal))


def _by_month(deal: dict) -> dict:
    out = dict(deal)
    out["ratio_history"] = {r["month"]: r for r in deal.get("ratio_history") or []}
    return out


def _quirks(deal: str, extra: dict | None = None) -> dict:
    return {**COMMON_QUIRKS, **DEALS[deal]["quirks"], **(extra or {})}


def _split(diffs, quirks: dict):
    real, known = [], {}
    for d in diffs:
        pat = next((p for p in quirks if re.search(p, d[0])), None)
        if pat is None:
            real.append(d)
        else:
            known.setdefault(pat, []).append(d)
    return real, known


def _check_against_reference(deal: str, obj: dict, extra: dict | None = None):
    quirks = _quirks(deal, extra)
    real, known = _split(diff(_by_month(obj), _by_month(_ref(deal))), quirks)
    assert real == [], real
    # every listed quirk still occurs: a fixed quirk must come off the list
    assert set(known) == set(quirks), set(quirks) - set(known)


DEAL_IDS = list(DEALS)


@pytest.mark.parametrize("deal", DEAL_IDS)
def test_layout_dispatch_and_period_convention(deal):
    _need(deal)
    exs = _extractions(deal)
    assert [e["meta"]["layout"] for e in exs] == ["move-trust-settrep-standard-v1"] * 4
    assert [e["deal"]["period_history"][0]["period"] for e in exs] == ["2026-04", "2026-05", "2026-06", "2026-07"]
    d, meta = exs[-1]["deal"], exs[-1]["meta"]
    assert d["collection_period"] == "July 2026" and d["prior_period"] == "2026-06"
    assert d["settlement_date"] == DEALS[deal]["settlement_date"]
    # the page header names the collection period; the aggregate table ends at it: reporting = collection month
    for e in exs:
        assert e["meta"]["reporting_period"] == e["deal"]["period_history"][0]["period"]
    assert meta["reporting_period"] == "2026-07"
    assert d["ratio_history"][-1]["month"] == "Jul-26"


@pytest.mark.parametrize("deal", DEAL_IDS)
def test_chained_reports_reproduce_reference(deal):
    _need(deal)
    full = chain(list(_extractions(deal)))
    jsonschema.validate(full, SCHEMA)
    _check_against_reference(deal, full["deal"])


@pytest.mark.parametrize("deal", DEAL_IDS)
def test_month_by_month_reproduces_reference(deal):
    _need(deal)
    exs = _extractions(deal)
    doc = extend(None, exs[0])
    for ex in exs[1:]:
        doc = extend(doc["deal"], ex)
    assert [r["period"] for r in doc["deal"]["period_history"]] == ["2026-04", "2026-05", "2026-06", "2026-07"]
    full = chain(list(exs))["deal"]
    eq = DEALS[deal]["extend_quirks"]
    for a, b in ((doc["deal"], full), (full, doc["deal"])):
        real, known = _split(diff(a, b), eq)
        assert real == [] and set(known) == set(eq), (real, set(eq) - set(known))
    _check_against_reference(deal, doc["deal"], eq)


@pytest.mark.parametrize("deal", DEAL_IDS)
def test_each_report_matches_its_history_row(deal):
    _need(deal)
    ref, quirks = _ref(deal), _quirks(deal)
    for ex in _extractions(deal):
        for key in ("period_history", "aging_history"):
            row = ex["deal"][key][0]
            match = [r for r in ref[key] if r["period"] == row["period"]]
            assert match, (key, row["period"])
            i = ref[key].index(match[0])
            real, _ = _split([(f"/{key}/{i}{p}", a, b) for p, a, b in diff(row, match[0])], quirks)
            assert real == [], (key, row["period"], real)


@pytest.mark.parametrize("deal", DEAL_IDS)
def test_schema_and_provenance(deal):
    _need(deal)
    for ex in _extractions(deal):
        jsonschema.validate(ex, SCHEMA)
        assert ex["meta"]["unplaced"] == [] and ex["meta"]["notes"] == []
        missing = [ptr for ptr, v in leaves(ex["deal"]) if v is not None and ptr not in ex["sources"]]
        assert missing == [], missing[:10]
        for ptr, s in ex["sources"].items():
            assert s["page"] >= 1 and isinstance(s["raw_text"], str)
        src = ex["sources"]
        tb_page = ex["deal"]["source_pages"]["tranche_balance"]
        assert src["/tranche_balance/opening"]["page"] == tb_page and src["/tranche_balance/opening"]["bbox"]
        assert src["/period_history/0/interest"]["raw_text"].startswith("derived:")
        assert src["/period_history/0/charge_off"]["page"] == tb_page


@pytest.mark.parametrize("deal", DEAL_IDS)
def test_phase1_rules_block_only_as_expected(deal):
    _need(deal)
    from rules import run
    from rules.engine import Context
    for ex in _extractions(deal):
        period = ex["deal"]["period_history"][0]["period"]
        blocks = [f for f in run(ex, Context(), phases=(1,)) if f["severity"] == "block"]
        assert {f["rule_id"] for f in blocks} == DEALS[deal]["blocks"][period], \
            (period, [(f["rule_id"], f.get("message")) for f in blocks])


@pytest.mark.parametrize("deal", DEAL_IDS)
def test_r05_closes_with_layout_terms(deal):
    """opening - principal - prepayments - losses - charge_off - ineligible_buyback + adjustment_increase = closing,
    all four months, to the printed rounding (R05 tolerance is $1)."""
    _need(deal)
    for ex in _extractions(deal):
        row = ex["deal"]["period_history"][0]
        co, up, ib = row["charge_off"], row["adjustment_increase"], row.get("ineligible_buyback") or 0.0
        assert co >= 0 and up >= 0 and ib >= 0
        computed = (row["opening_balance"] - row["principal"] - row["principal_prepayments"] - row["losses"]
                    - co - ib + up)
        assert abs(computed - row["closing_balance"]) <= 0.10, (row["period"], computed, row["closing_balance"])


def test_layout_terms_where_printed():
    """Dynamic Capital prints a Buyback column (June: 4,026,754.90) -> ineligible_buyback; TPine's July NBV
    Adjustment is -0.04 (sign hugging the previous cell) -> charge_off 0.04."""
    for deal, period, key, value in (("dynamic", "2026-06", "ineligible_buyback", 4026754.90),
                                     ("tpine", "2026-07", "charge_off", 0.04)):
        _need(deal)
        row = next(e["deal"]["period_history"][0] for e in _extractions(deal)
                   if e["deal"]["period_history"][0]["period"] == period)
        assert abs(row[key] - value) <= 0.005, (deal, key, row[key])


@pytest.mark.parametrize("deal", DEAL_IDS)
def test_interest_is_effective_yield_income(deal):
    """interest = interest collections + prepayment penalties / excess (the effective-yield numerator), so the
    2026-07 value is the reference data_corrections new_value without a correction step."""
    _need(deal)
    corr = _ref(deal)["data_corrections"][0]
    assert corr["period"] == "2026-07" and corr["field"] == "interest"
    d = _extractions(deal)[-1]["deal"]
    assert abs(d["period_history"][0]["interest"] - corr["new_value"]) <= 0.01
    assert abs(d["period_history"][0]["interest"] - corr["old_value"]) > 1
    assert abs(d["tranche_balance"]["interest"] - corr["new_value"]) <= 0.01


def test_pass2_rereads_page_2():
    """Pass 2 on the tranche balance page returns a patch with only page-2 leaves; merged onto pass 1 it changes
    nothing."""
    deal = "essex"
    _need(deal)
    pdf = _pdfs(deal)[-1]
    base = _extractions(deal)[-1]
    patch = extract(str(pdf), "move-trust-settrep-v1", pages=[2], upload_id="00000000-0000-4000-8000-000000000003")
    assert patch["meta"]["pass"] == 2 and patch["meta"]["pages_reread"] == [2]
    assert patch["deal"]["tranche_balance"]["closing"] == base["deal"]["tranche_balance"]["closing"]
    assert all(s["page"] == 2 for s in patch["sources"].values())
    merged = merge_patch(base, patch)
    assert merged["meta"]["pass"] == 2
    assert diff(merged["deal"], base["deal"]) == [] and diff(base["deal"], merged["deal"]) == []
