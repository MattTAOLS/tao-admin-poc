"""MOVE Trust settlement reports with a sub-servicer and a performance guarantor (layout
move-trust-settrep-guarantor-v1), reproduced from the April-July 2026 reports of three deals:

  TLFC_LP-2026MM-SETTREP.pdf     -> docs/dashboard-json/move-trust-tlfc-lp-leases.dashboard.json
  TLFC_Leases-2026MM-SETTREP.pdf -> docs/dashboard-json/move-trust-tlfc-leases.dashboard.json
  TLFC_Loans-2026MM-SETTREP.pdf  -> docs/dashboard-json/move-trust-tlfc-loans.dashboard.json

- the four reports, chained (history.chain) or added one month at a time (history.extend), reproduce the whole
  reference object within compare.diff tolerance ($0.01 / 0.0001), except the reference quirks listed per deal;
  every listed quirk must still occur;
- every extraction validates against contracts/extraction.schema.json, has a source on every non-null leaf, and
  fails exactly the phase-1 rules named per deal (see the reasons there);
- the roll-forward closes in all twelve reports with charge_off and adjustment_increase (page 2 adjustment column);
- page-1 dispatch picks this layout for all twelve reports and for none of the other 24 MOVE Trust samples.
Slow (19-23-page PDFs): run with EXTRACT_ALL=1.
"""
import functools
import json
import re

import jsonschema
import pytest

from worker.extract import _pick_layout, extract, merge_patch
from worker.extract.compare import diff
from worker.extract.engines import guarantor_settrep as eng
from worker.extract.history import chain, extend
from worker.extract.mapper import load_template
from worker.extract.provenance import leaves
from worker.extract.text import Line, Page, Token, read_pdf

from .conftest import MOVE_SAMPLES, REFS, ROOT

LAYOUT = "move-trust-settrep-guarantor-v1"
SCHEMA = json.loads((ROOT / "contracts" / "extraction.schema.json").read_text(encoding="utf-8"))

# Reasons shared by the three deals
_RATIO_MONTHS = ("printed only by the June report and earlier (the July report's aggregate / RVL tables start at "
                 "Aug-25 and its ratio tables one quarter later than June's); history.chain/extend keep the newest "
                 "report's months. The reference keeps the months of the last two reports.")
_CHARGE_OFF = ("reference carries null; the extraction carries the downward part of page 2 'Adjustment to Portfolio "
               "(+/-)' as charge_off (0.00 when the column is zero or positive), the R05 term")
_PRIOR_TREND = ("reference prior_covenants trend for the six-month window tests does not follow from the June report "
                "(window max of Jan-Jun vs Dec-May); history.chain/extend carry the June report's own covenants")
_INTEREST = ("reference April-June interest adds Other Interest, which this report's effective-yield formula "
             "h/i = (e+f)/a*12 does not count; the July reference value is the formula's e+f, as extracted (the "
             "same definition data_corrections applied on TLFC Leases)")
_DIFFERENTIAL_NOTE = ("reference note quotes the June report's smallest closing-minus-required differential (-0.06, "
                      "the June current_value in prior_covenants); current_value is July's, as extracted")

# Reference paths no extraction rule can reproduce from the PDFs, per deal, each with the reason. ratio_history is
# compared by month and covenants by legal reference (see _keyed), so paths read /ratio_history/<Mon-YY>/... and
# /covenants/<legal_ref>[ | <first words>]/...
DEALS = {
    "move-trust-tlfc-leases": {
        "prefix": "TLFC_Leases",
        "quirks": {
            r"^/ratio_history/(Mar-24|Jul-25)$": _RATIO_MONTHS,
            r"^/(period_history/\d+|tranche_balance)/charge_off$": _CHARGE_OFF,
            r"^/contracts/top_movers/#len$":
                "reference keeps 5 of the 9 tranches whose contract count changed in July; the layout's top-movers "
                "limit is 10 (the LP and Loans references carry 10)",
            r"^/cnl_by_period/14/period_original_balance$":
                "the 2026 period prints '-' (zero) for this pool's original balance; reference null",
            r"^/aging_history/3/cumulative_net_losses$":
                "April prints '- 790.22' (negative, as on the April cumulative-losses page 'Pool Balance Totals ... "
                "- 790.22' and like July's '- 7,062.24', which the reference keeps negative); reference +790.22",
            r"^/covenant_summary/OK$":
                "the deferred-account lock-up test the reference leaves out (see EXTRA_COVENANTS) is OK",
            r"^/covenants/MLA 7\.1\(u\)/description$":
                "the July report adds 'following the OC Rebalancing Date (where applicable)'; the reference keeps "
                "the April-June wording",
            r"^/covenants/MLA 7\.1\(u\)/note$": _DIFFERENTIAL_NOTE,
            r"^/covenants/MLA 7\.5/(description|note)$":
                "reference description and note list the June footnote's 19 tranches (114-117, 119-123, 125, ...), "
                "while its current_value is July's 17; the extraction reads July's footnote for all three",
            r"^/prior_covenants/MLA \(Definitions\) \| Does the (Delinquency|Loss) Ratio/trend$": _PRIOR_TREND,
            r"^/data_corrections$":
                "audit record of a correction applied to the published object on 2026-10-09 (old value, date "
                "applied); not on the report. The extraction reads interest the corrected way: e+f+h, the income "
                "the printed formula j=(e+f+h)/a*12 counts.",
        },
        # covenants the extraction carries that the reference leaves out, with the reason
        "extra_covenants": {
            "MLA (Definitions) | Is the amount on":
                "printed lock-up test 'Is the amount on deposit in the Deferred Account less that 75% of the "
                "Required Deferred Amount ...? No' (description wrapped over two lines); missing from the reference",
        },
        "blocks": {"R04"},
        "adjustments": {"2026-04": (0.0, 0.01), "2026-05": (0.0, 0.0), "2026-06": (0.0, 0.01), "2026-07": (0.01, 0.0)},
        "extend_divergence": {},
    },
    "move-trust-tlfc-lp-leases": {
        "prefix": "TLFC_LP",
        "quirks": {
            r"^/ratio_history/(Dec-22|Jul-25)$": _RATIO_MONTHS,
            r"^/period_history/[0-2]/interest$": _INTEREST,
            r"^/(period_history/\d+|tranche_balance)/charge_off$": _CHARGE_OFF,
            r"^/covenants/MLA 7\.1 \(t\)/description$":
                "the July report adds 'following the OC Rebalancing Date (where applicable)'; the reference keeps "
                "the April-June wording",
            r"^/(covenants|prior_covenants)/MLA 7\.1 \(aa\)/description$":
                "reference keeps only the first printed line; the extraction keeps the wrapped second line "
                "('following March 9th, 2026 ... remedied within three Business Days?')",
            r"^/covenants/MLA 7\.5/description$":
                "reference counts 97 tranches (the June report's page 2); July adds tranche 157: 24 of 98",
            r"^/prior_covenants/MLA \(Definitions\) \| Does the (Delinquency|Loss|RVL) Ratio/trend$": _PRIOR_TREND,
        },
        "extra_covenants": {},
        # R05 reads charge_off but not adjustment_increase yet: every month has an upward adjustment
        "blocks": {"R04", "R05"},
        "adjustments": {"2026-04": (0.0, 3035.22), "2026-05": (0.0, 2551.21), "2026-06": (0.0, 2972.92),
                        "2026-07": (0.0, 2782.68)},
        # history.extend infers which earlier reports printed a restated month as reporting month = period - 1
        # (_reporting_month, F-PIL). On this layout each report's newest ratio month is its own collection month,
        # so the April report's Apr-26 and the May report's May-26 RVL ratios (0.0, later restated to 0.112487%)
        # are left out of as_reported. history.chain reads every report and matches the reference.
        "extend_divergence": {
            r"^/restatements/[01]/as_reported/":
                "extend() drops source_period 2026-04 from Apr-26 and 2026-05 from May-26 (reporting month taken "
                "as period - 1; this layout's reporting month = period)",
        },
    },
    "move-trust-tlfc-loans": {
        "prefix": "TLFC_Loans",
        "quirks": {
            r"^/source_pages/cumulative_losses$":
                "reference has page 13 (aging); 'CUMULATIVE LOSSES' is printed on page 15",
            r"^/ratio_history/(Dec-23|Jul-25)$": _RATIO_MONTHS,
            r"^/period_history/[0-2]/interest$": _INTEREST,
            r"^/(period_history/\d+|tranche_balance)/charge_off$": _CHARGE_OFF,
            r"^/covenants/PA 7\.1 \(s\)/note$": _DIFFERENTIAL_NOTE,
            r"^/(covenants|prior_covenants)/PA 7\.1 \(x\)/(description|current_value|threshold|note)$":
                "the reference keeps only the line printed beside the reference ('remedied within three Business "
                "Days?') and so treats it as a plain binary test; the description starts on the line above ('Is the "
                "Amount in the Deferred Account less than the Required Deferred Amount ...'), and the extraction "
                "carries the page-8 deferred-account excess/(shortfall) as its context value, as the LP reference "
                "does for the same test (MLA 7.1 (aa))",
            r"^/prior_covenants/PA \(Definitions\) \| Does the (Delinquency|Loss) Ratio/trend$": _PRIOR_TREND,
        },
        "extra_covenants": {},
        "blocks": {"R04"},
        "adjustments": {"2026-04": (0.01, 0.0), "2026-05": (0.03, 0.0), "2026-06": (0.0, 0.0), "2026-07": (0.0, 0.0)},
        "extend_divergence": {},
    },
}

# The other MOVE Trust samples (must not dispatch to this layout)
OTHER_PREFIXES = ["Dynamic Capital", "Essex", "TPine", "Vault Rated", "Finloc", "MOCLP"]


def _pdfs(prefix: str) -> list:
    return sorted(MOVE_SAMPLES.glob(f"{prefix}-*-SETTREP.pdf"))


_have = all(len(_pdfs(d["prefix"])) == 4 for d in DEALS.values())
needs_samples = pytest.mark.skipif(not _have, reason="TLFC SetReps not present under data/samples/move-trust/")
deal_params = pytest.mark.parametrize("slug", list(DEALS))


@functools.lru_cache(maxsize=None)
def _exs(slug: str) -> tuple:
    return tuple(extract(str(p), "move-trust-settrep-v1", upload_id="00000000-0000-4000-8000-000000000003")
                 for p in _pdfs(DEALS[slug]["prefix"]))


@functools.lru_cache(maxsize=None)
def _ref(slug: str) -> dict:
    return json.loads((REFS / f"{slug}.dashboard.json").read_text(encoding="utf-8"))


def _cov_keys(lst: list) -> dict:
    refs = [c["legal_ref"] for c in lst]
    return {(c["legal_ref"] if refs.count(c["legal_ref"]) == 1
             else c["legal_ref"] + " | " + " ".join(c["description"].split()[:4])): c for c in lst}


def _keyed(deal: dict) -> dict:
    out = dict(deal)
    out["ratio_history"] = {r["month"]: r for r in deal.get("ratio_history") or []}
    for k in ("covenants", "prior_covenants"):
        out[k] = _cov_keys(deal.get(k) or [])
    return out


def _split(diffs, patterns: dict):
    real, known = [], {}
    for d in diffs:
        pat = next((p for p in patterns if re.search(p, d[0])), None)
        if pat is None:
            real.append(d)
        else:
            known.setdefault(pat, []).append(d)
    return real, known


def _check_against_reference(slug: str, deal: dict, extra_patterns: dict | None = None):
    spec = DEALS[slug]
    patterns = {**spec["quirks"], **(extra_patterns or {})}
    ours, ref = _keyed(deal), _keyed(_ref(slug))
    real, known = _split(diff(ours, ref), patterns)
    assert real == [], real
    # every listed quirk still occurs: a fixed quirk must come off the list
    assert set(known) == set(patterns), set(patterns) - set(known)
    for k in ("covenants", "prior_covenants"):
        assert set(ours[k]) - set(ref[k]) == set(spec["extra_covenants"]), (k, set(ours[k]) - set(ref[k]))


def _stepwise(slug: str) -> dict:
    exs = _exs(slug)
    doc = extend(None, exs[0])
    for ex in exs[1:]:
        doc = extend(doc["deal"], ex)
    return doc


# ---------------------------------------------------------------- whole reference
@deal_params
@pytest.mark.slow
@needs_samples
def test_chained_reports_reproduce_reference(slug):
    full = chain(list(_exs(slug)))
    jsonschema.validate(full, SCHEMA)
    assert full["meta"]["chained_periods"] == ["2026-04", "2026-05", "2026-06", "2026-07"]
    _check_against_reference(slug, full["deal"])


@deal_params
@pytest.mark.slow
@needs_samples
def test_month_by_month_reproduces_reference(slug):
    step = _stepwise(slug)
    assert step["meta"]["history"]["periods"] == ["2026-04", "2026-05", "2026-06", "2026-07"]
    jsonschema.validate(step, SCHEMA)
    div = DEALS[slug]["extend_divergence"]
    full = chain(list(_exs(slug)))["deal"]
    real, known = _split(diff(step["deal"], full) + diff(full, step["deal"]), div)
    assert real == [], real
    assert set(known) == set(div), set(div) - set(known)
    _check_against_reference(slug, step["deal"], div)


@deal_params
@pytest.mark.slow
@needs_samples
def test_each_report_matches_its_history_rows(slug):
    ref = _ref(slug)
    for ex in _exs(slug):
        for key in ("period_history", "aging_history"):
            row = ex["deal"][key][0]
            match = [i for i, r in enumerate(ref[key]) if r["period"] == row["period"]]
            assert match, (key, row["period"])
            ds = [(f"/{key}/{match[0]}{p}", a, b) for p, a, b in diff(row, ref[key][match[0]])]
            real, _ = _split(ds, DEALS[slug]["quirks"])
            assert real == [], (key, row["period"], real)


# ---------------------------------------------------------------- each extraction
@deal_params
@pytest.mark.slow
@needs_samples
def test_schema_provenance_and_layout(slug):
    for ex in _exs(slug):
        jsonschema.validate(ex, SCHEMA)
        assert ex["meta"]["layout"] == LAYOUT and ex["meta"]["template_id"] == "move-trust-settrep-v1"
        assert ex["meta"]["unplaced"] == [] and ex["meta"]["notes"] == []
        missing = [ptr for ptr, v in leaves(ex["deal"]) if v is not None and ptr not in ex["sources"]]
        assert missing == [], missing[:10]
        for s in ex["sources"].values():
            assert s["page"] >= 1 and isinstance(s["raw_text"], str)
        # printed cells carry their bbox and text; sums say how they were derived
        src = ex["sources"]["/tranche_balance/principal"]
        assert src["page"] == 2 and src["bbox"] is not None
        assert ex["sources"]["/period_history/0/interest"]["raw_text"].startswith("derived: income counted by")
        assert ex["sources"]["/period_history/0/charge_off"]["page"] == 2
        assert ex["sources"]["/total_enhancement/total_enhancement_amount"]["page"] == 11


@deal_params
@pytest.mark.slow
@needs_samples
def test_phase1_rules_block_only_as_expected(slug):
    """R04 assumes F-PIL's convention (collection period = page-header reporting period + 1 month). On this layout
    the page header names the collection period itself, so R04 blocks every report. R05 does not read
    adjustment_increase yet, so it blocks the LP reports by exactly their upward adjustment."""
    from rules import run
    from rules.engine import Context
    for ex in _exs(slug):
        row = ex["deal"]["period_history"][0]
        blocks = [f for f in run(ex, Context(), phases=(1,)) if f["severity"] == "block"]
        assert {f["rule_id"] for f in blocks} == DEALS[slug]["blocks"], [(f["rule_id"], f["message"]) for f in blocks]
        r04 = next(f for f in blocks if f["rule_id"] == "R04")
        assert f"page-header reporting period {row['period']}" in r04["message"]
        for f in blocks:
            if f["rule_id"] == "R05":
                assert abs(f["difference"] - row["adjustment_increase"]) <= 0.01


@deal_params
@pytest.mark.slow
@needs_samples
def test_r05_closes_with_adjustment_terms(slug):
    """opening - principal - prepayments - losses - charge_off + adjustment_increase = closing, to the cent, in
    every month; both terms are positive amounts from page 2 'Adjustment to Portfolio (+/-)'."""
    expected = DEALS[slug]["adjustments"]
    for ex in _exs(slug):
        row = ex["deal"]["period_history"][0]
        co, up = row["charge_off"], row["adjustment_increase"]
        assert (round(co, 2), round(up, 2)) == expected[row["period"]], (row["period"], co, up)
        computed = row["opening_balance"] - row["principal"] - row["principal_prepayments"] - row["losses"] - co + up
        assert abs(computed - row["closing_balance"]) <= 0.005, (row["period"], computed - row["closing_balance"])


@deal_params
@pytest.mark.slow
@needs_samples
def test_period_convention(slug):
    ex = _exs(slug)[-1]
    d, meta = ex["deal"], ex["meta"]
    assert d["settlement_date"] == "August 17, 2026"          # "Settlement Date August 17, 2026 for ..."
    assert d["collection_period"] == "July 2026"              # "... for Collection Period July 2026"
    assert d["period_history"][0]["period"] == "2026-07" and d["prior_period"] == "2026-06"
    assert meta["reporting_period"] == "2026-07"              # the page header's collection period, same month
    assert [r["month"] for r in d["ratio_history"] if "delinquency_ratio_pct" in r][-1] == "Jul-26"
    assert ex["sources"]["/collection_period"]["page"] == 1


@pytest.mark.slow
@needs_samples
def test_interest_is_effective_yield_income():
    """interest = the income the printed effective-yield formula counts: TLFC Leases j=(e+f+h)/a*12 (the reference
    data_corrections new_value, without a correction step), the other two (e+f)/a*12."""
    corr = _ref("move-trust-tlfc-leases")["data_corrections"][0]
    d = _exs("move-trust-tlfc-leases")[-1]["deal"]
    assert abs(d["period_history"][0]["interest"] - corr["new_value"]) <= 0.01
    assert abs(d["period_history"][0]["interest"] - corr["old_value"]) > 1
    assert abs(d["tranche_balance"]["interest"] - (54780.62 + 208.91)) <= 0.01
    assert abs(_exs("move-trust-tlfc-lp-leases")[-1]["deal"]["tranche_balance"]["interest"] - 894011.31) <= 0.01
    assert abs(_exs("move-trust-tlfc-loans")[-1]["deal"]["tranche_balance"]["interest"] - 130939.79) <= 0.01


@pytest.mark.slow
@needs_samples
def test_pass2_reread_of_page_2_patches_the_same_values():
    pdf = str(_pdfs("TLFC_LP")[-1])
    base = _exs("move-trust-tlfc-lp-leases")[-1]
    patch = extract(pdf, "move-trust-settrep-v1", pages=[2])
    assert patch["meta"]["pass"] == 2 and patch["meta"]["pages_reread"] == [2]
    assert patch["meta"]["layout"] == LAYOUT
    assert patch["deal"]["tranche_balance"]["closing"] == base["deal"]["tranche_balance"]["closing"]
    assert {s["page"] for s in patch["sources"].values()} == {2}
    merged = merge_patch(base, patch)
    assert merged["meta"]["pass"] == 2
    assert diff(merged["deal"], base["deal"]) == [] and diff(base["deal"], merged["deal"]) == []


# ---------------------------------------------------------------- dispatch over all MOVE Trust samples
@pytest.mark.slow
@pytest.mark.skipif(not _have or not all(list(MOVE_SAMPLES.glob(f"{p}*.pdf")) for p in OTHER_PREFIXES),
                    reason="MOVE Trust samples not present under data/samples/move-trust/")
def test_dispatch_matches_exactly_the_twelve_reports():
    tpl = load_template("move-trust-settrep-v1")
    mine = {p for d in DEALS.values() for p in _pdfs(d["prefix"])}
    others = sorted(p for p in MOVE_SAMPLES.glob("*.pdf") if p not in mine)
    assert len(mine) == 12 and len(others) == 24
    assert all(any(p.name.startswith(x) for x in OTHER_PREFIXES) for p in others)
    for p in sorted(mine):
        assert _pick_layout(tpl, read_pdf(str(p), [1])[0][0]) == LAYOUT, p.name
    for p in others:
        page1 = read_pdf(str(p), [1])[0][0]
        lay = next((l for l in tpl["layouts"] if l["template"] == LAYOUT), None)
        assert not all(k.upper() in " ".join(page1.text.upper().split()) for k in lay["when_page1_has"]), p.name
        assert _pick_layout(tpl, page1) != LAYOUT, p.name


# ---------------------------------------------------------------- no samples needed
def _line(*words, top=10.0):
    toks, x = [], 10.0
    for w in words:
        toks.append(Token(w, x, x + 6 * len(w), top, top + 8))
        x += 6 * len(w) + 4
    return Line(toks)


def test_template_and_dispatch():
    tpl = load_template(LAYOUT)
    assert tpl["engine"] == "guarantor_settrep"
    page1 = Page(1, [_line("Summary", "of", "Tranche", "Balance", "Pg.", "2"),
                     _line("Administrative", "Agent:", "Servicer:", "Lessors:", "Sub", "-", "Servicer:",
                           "Performance", "Guarantor:", top=30),
                     _line("SAA", "=", "Sub-Administration", "Agreement", top=50)])
    assert _pick_layout(load_template("move-trust-settrep-v1"), page1) == LAYOUT
    # without the sub-servicer / guarantor block it stays a standard report
    plain = Page(1, [_line("SUMMARY", "OF", "TRANCHE", "BALANCE", "Pg.", "2")])
    assert _pick_layout(load_template("move-trust-settrep-v1"), plain) == "move-trust-settrep-standard-v1"


def test_clean_up_footnote_tranche_list():
    assert eng._tranche_list("114-117, 119 - 121, 128, 133, 137-139, 141 -143, 147 and 148") == \
        [114, 115, 116, 117, 119, 120, 121, 128, 133, 137, 138, 139, 141, 142, 143, 147, 148]
    assert eng._tranche_list("76 - 77, 79 - 81, 84 - 86, 88 - 109, 111, 114, and 120")[:5] == [76, 77, 79, 80, 81]


def test_contract_counts_fold_a_separate_sign():
    toks = [Token("5", 284.0, 286.0, 0, 3.5), Token("-", 303.7, 304.9, 0, 3.5), Token("3", 326.6, 328.6, 0, 3.5),
            Token("2", 341.5, 343.5, 0, 3.5)]
    assert [c.value for c in eng._count_cells(toks)] == [5.0, -3.0, 2.0]
    toks = [Token("0", 284.0, 286.0, 0, 3.5), Token("-", 323.5, 324.7, 0, 3.5), Token("0", 341.5, 343.5, 0, 3.5)]
    assert [c.value for c in eng._count_cells(toks)] == [0.0, 0.0, 0.0]
    toks = [Token("11", 279.0, 283.1, 0, 4), Token("(4)", 309.8, 314.3, 0, 4), Token("7", 351.6, 353.6, 0, 4)]
    assert [c.value for c in eng._count_cells(toks)] == [11.0, -4.0, 7.0]


def test_labelled_value_keeps_a_negative_zero():
    import re as _re
    l = _line("EXCESS", "/", "(SHORTFALL)", "IN", "THE", "DEFERRED", "ACCOUNT", "-", "0.00", "f")
    f = eng._labelled(l, _re.compile(r"^EXCESS ?/ ?\(SHORTFALL\) IN THE DEFERRED ACCOUNT$"), 8)
    assert f.value == 0.0 and str(f.value) == "-0.0" and f"{f.value:.2f}" == "-0.00"
