"""Audit H5: a re-extract of some pages (pass 2) must leave the merged extraction equal to the full one.

The audit's cases, each a full extraction, a pass-2 patch for the pages named and merge_patch: zero differing
leaves in `deal`. Before the fix: Essex Apr-2026 page 13 put the borrower ratios under the wrong months of
ratio_history (39 changed leaves); Moneda Aug-2026 pages 12 and 14 nulled the interest coverage, leverage and
equity covenant values and flipped covenant_summary. Plus merge_patch on hand-built documents (no PDF needed)."""
import copy
import json

import jsonschema
import pytest

from worker.extract import extract, merge_patch, row_key, row_keys
from worker.extract.provenance import leaves

from .conftest import MOVE_SAMPLES, ROOT, SAMPLES, needs_samples

SCHEMA = json.loads((ROOT / "contracts" / "extraction.schema.json").read_text(encoding="utf-8"))
UID = "33333333-3333-4333-8333-333333333333"

FPIL = "fpil-2.0-settrep-v1"
MOVE = "move-trust-settrep-v1"
CASES = [
    pytest.param(SAMPLES / "Moneda-202608 -SETTREP.pdf", FPIL, [12, 14], id="moneda-202608-p12-14"),
    pytest.param(SAMPLES / "Moneda-202608 -SETTREP.pdf", FPIL, [13], id="moneda-202608-p13"),
    pytest.param(SAMPLES / "Moneda-202608 -SETTREP.pdf", FPIL, [2], id="moneda-202608-p2"),
    pytest.param(MOVE_SAMPLES / "Essex - 202604 - SETTREP.pdf", MOVE, [13], id="essex-202604-p13", marks=pytest.mark.slow),
    pytest.param(MOVE_SAMPLES / "Dynamic Capital 1.0-SETTREP-202607.pdf", MOVE, [17], id="dynamic-202607-p17", marks=pytest.mark.slow),
    pytest.param(MOVE_SAMPLES / "TPine - 202607 - SETTREP.pdf", MOVE, [13], id="tpine-202607-p13", marks=pytest.mark.slow),
    pytest.param(MOVE_SAMPLES / "TLFC_LP-202607-SETTREP.pdf", MOVE, [14], id="tlfc-lp-202607-p14", marks=pytest.mark.slow),
    pytest.param(MOVE_SAMPLES / "Vault Rated - SETTREP 202607.pdf", MOVE, [12, 14], id="vault-202607-p12-14", marks=pytest.mark.slow),
    pytest.param(MOVE_SAMPLES / "Finloc-202607-SETTREP.pdf", MOVE, [2, 21], id="finloc-202607-p2-21", marks=pytest.mark.slow),
    pytest.param(MOVE_SAMPLES / "MOCLP - 202607 - Servicer Report.pdf", MOVE, [11], id="moclp-202607-p11", marks=pytest.mark.slow),
]
_full: dict = {}


def full_extraction(pdf, template_id):
    if pdf not in _full:
        _full[pdf] = extract(str(pdf), template_id, upload_id=UID)
    return copy.deepcopy(_full[pdf])


def deal_diffs(a, b):
    la, lb = dict(leaves(a["deal"])), dict(leaves(b["deal"]))
    return [(k, la.get(k, "<absent>"), lb.get(k, "<absent>")) for k in sorted(set(la) | set(lb)) if la.get(k, "<absent>") != lb.get(k, "<absent>")]


@needs_samples
@pytest.mark.parametrize("pdf, template_id, pages", CASES)
def test_h5_partial_reextract_merges_to_the_full_extraction(pdf, template_id, pages):
    base = full_extraction(pdf, template_id)
    patch = extract(str(pdf), template_id, pages=pages, upload_id=UID)
    assert patch["meta"]["pass"] == 2 and patch["meta"]["pages_reread"] == pages
    assert patch["sources"], "the pages named carry values, so the patch is not empty"
    # every leaf in the patch was read on the pages asked for, and is stamped pass 2
    assert {s["page"] for s in patch["sources"].values()} <= set(pages)
    assert {s["pass"] for s in patch["sources"].values()} == {2}
    merged = merge_patch(base, patch)
    assert deal_diffs(base, merged) == []
    assert merged["meta"]["pass"] == 2 and merged["meta"]["pages_reread"] == pages
    assert set(merged["sources"]) == set(base["sources"])
    jsonschema.validate(merged, SCHEMA)
    # the audit's symptoms, named
    assert merged["deal"]["ratio_history"] == base["deal"]["ratio_history"]
    assert merged["deal"]["covenants"] == base["deal"]["covenants"]
    assert merged["deal"]["covenant_summary"] == base["deal"]["covenant_summary"]
    # and the same patch onto a base whose rows were moved: rows are found by key, not by position
    shuffled = copy.deepcopy(base)
    shuffled["deal"]["ratio_history"].reverse()
    shuffled["deal"]["covenants"].reverse()
    again = merge_patch(shuffled, patch)
    assert again["deal"]["ratio_history"] == shuffled["deal"]["ratio_history"]
    assert again["deal"]["covenants"] == shuffled["deal"]["covenants"]


@needs_samples
def test_h5_derived_leaf_with_an_input_on_another_page_is_left_to_pass_1():
    """Moneda: covenant values on page 13, the tests on page 14. Re-reading 14 alone must not emit the covenant
    statuses (inputs on 13 and 14); re-reading both emits them."""
    pdf = SAMPLES / "Moneda-202608 -SETTREP.pdf"
    base = full_extraction(pdf, FPIL)
    icr = next(i for i, c in enumerate(base["deal"]["covenants"]) if base["sources"].get(f"/covenants/{i}/current_value", {}).get("page") == 13)
    only_14 = extract(str(pdf), FPIL, pages=[14], upload_id=UID)
    assert f"/covenants/{icr}/status" not in only_14["sources"] and f"/covenants/{icr}/current_value" not in only_14["sources"]
    assert any(k.startswith("/covenants/") for k in only_14["sources"])      # covenants read from page 14 alone are in the patch
    assert "/worst_status" not in only_14["sources"] and "/covenant_summary/OK" not in only_14["sources"]
    both = extract(str(pdf), FPIL, pages=[13, 14], upload_id=UID)
    assert f"/covenants/{icr}/status" in both["sources"] and f"/covenants/{icr}/current_value" in both["sources"]


@needs_samples
def test_h5_page_outside_the_document_is_refused():
    with pytest.raises(ValueError, match="not in this"):
        extract(str(SAMPLES / "Moneda-202608 -SETTREP.pdf"), FPIL, pages=[99], upload_id=UID)


# ---------- merge_patch on hand-built documents ----------
def src(page, pass_no=2):
    return {"page": page, "bbox": None, "raw_text": "x", "confidence": 1.0, "pass": pass_no}


def base_doc():
    deal = {"ratio_history": [{"month": "Feb-26", "loss_ratio_pct": 0.01, "debt_equity_ratio": 2.0},
                              {"month": "Mar-26", "loss_ratio_pct": 0.02, "debt_equity_ratio": 2.1},
                              {"month": "Apr-26", "loss_ratio_pct": 0.03, "debt_equity_ratio": 2.2}],
            "covenants": [{"legal_ref": "MSA 8.1 (a)", "description": "Loss ratio", "current_value": 0.03, "status": "OK"},
                          {"legal_ref": "MSA 8.1 (b)", "description": "Leverage", "current_value": 2.2, "status": "OK"}],
            "contracts": {"opening": 10, "closing": 9}}
    sources = {p: src(1, 1) for p, _ in leaves(deal)}
    return {"meta": {"pass": 1, "extracted_at": "2026-11-10T00:00:00Z", "unplaced": ["aging.closing", "enhancement.total_amount"], "pages_without_text": []},
            "deal": deal, "sources": sources}


def patch_doc(deal, sources, keys, **meta):
    return {"meta": {"pass": 2, "pages_reread": [13], "extracted_at": "2026-11-10T01:00:00Z", "row_keys": keys, **meta}, "deal": deal, "sources": sources}


def test_h5_rows_are_matched_by_month_not_position():
    """The patch carries the leverage of Mar-26 and Apr-26 as its rows 0 and 1 (the old partial build): they must
    land on the Mar-26 and Apr-26 rows of the base, not on rows 0 and 1."""
    patch = patch_doc({"ratio_history": [{"month": "Mar-26", "debt_equity_ratio": 9.1}, {"month": "Apr-26", "debt_equity_ratio": 9.2}]},
                      {"/ratio_history/0/debt_equity_ratio": src(13), "/ratio_history/1/debt_equity_ratio": src(13)},
                      {"/ratio_history": ["month:Mar-26", "month:Apr-26"]})
    out = merge_patch(base_doc(), patch)
    assert [r["debt_equity_ratio"] for r in out["deal"]["ratio_history"]] == [2.0, 9.1, 9.2]
    assert [r["loss_ratio_pct"] for r in out["deal"]["ratio_history"]] == [0.01, 0.02, 0.03]
    assert out["sources"]["/ratio_history/1/debt_equity_ratio"]["pass"] == 2 and out["sources"]["/ratio_history/0/debt_equity_ratio"]["pass"] == 1


def test_h5_sparse_patch_rows_are_not_written_as_nulls():
    patch = patch_doc({"covenants": [None, {"current_value": 2.5}]}, {"/covenants/1/current_value": src(13)},
                      {"/covenants": ["legal_ref:MSA 8.1 (a)|Loss ratio", "legal_ref:MSA 8.1 (b)|Leverage"]})
    out = merge_patch(base_doc(), patch)
    assert out["deal"]["covenants"][0] == base_doc()["deal"]["covenants"][0] and out["deal"]["covenants"][1]["current_value"] == 2.5


def test_h5_null_never_replaces_a_pass_1_value():
    patch = patch_doc({"covenants": [{"current_value": None, "status": None}], "contracts": {"closing": None}},
                      {"/covenants/0/current_value": src(13), "/covenants/0/status": src(13), "/contracts/closing": src(13)},
                      {"/covenants": ["legal_ref:MSA 8.1 (a)|Loss ratio"]})
    out = merge_patch(base_doc(), patch)
    assert out["deal"] == base_doc()["deal"] and out["sources"] == base_doc()["sources"]


def test_h5_a_row_the_base_does_not_have_is_appended_whole():
    patch = patch_doc({"ratio_history": [{"month": "May-26", "loss_ratio_pct": 0.04, "debt_equity_ratio": 2.3}]},
                      {"/ratio_history/0/month": src(13), "/ratio_history/0/loss_ratio_pct": src(13), "/ratio_history/0/debt_equity_ratio": src(13)},
                      {"/ratio_history": ["month:May-26"]})
    out = merge_patch(base_doc(), patch)
    assert out["deal"]["ratio_history"][:3] == base_doc()["deal"]["ratio_history"]
    assert out["deal"]["ratio_history"][3] == {"month": "May-26", "loss_ratio_pct": 0.04, "debt_equity_ratio": 2.3}
    assert "/ratio_history/3/month" in out["sources"]


def test_h5_merged_meta_keeps_what_is_still_unread():
    patch = patch_doc({}, {}, {}, unplaced=["aging.closing"], pages_without_text=[11])
    out = merge_patch(base_doc(), patch)
    assert out["meta"]["unplaced"] == ["aging.closing"] and out["meta"]["pages_without_text"] == [11]
    assert out["meta"]["pass"] == 2 and out["meta"]["pages_reread"] == [13]


def test_h5_patch_without_row_keys_is_applied_by_position():
    patch = {"meta": {"pass": 2, "pages_reread": [2], "extracted_at": "x"}, "deal": {"contracts": {"closing": 8}}, "sources": {"/contracts/closing": src(2)}}
    assert merge_patch(base_doc(), patch)["deal"]["contracts"]["closing"] == 8


def test_h5_row_keys():
    assert row_key({"month": "Apr-26"}) == "month:Apr-26" and row_key({"period": "2026-08", "collection_period": "August 2026"}) == "period:2026-08"
    assert row_key({"legal_ref": "SLFA 9.1 (c)", "description": "Loss"}) == "legal_ref:SLFA 9.1 (c)|Loss"
    assert row_key({"key": "loss_ratio", "value": 1}) == "key:loss_ratio" and row_key({"tranche": 12}) == "tranche:12" and row_key({"x": 1}) is None
    keys = row_keys({"covenants": [{"legal_ref": "A", "description": "d"}, {"legal_ref": "A", "description": "d"}], "aging_history": [{"period": "2026-08", "tranche_rows": None}],
                     "a": {"b": [{"month": "Jan-26"}]}, "n": [1, 2]})
    assert keys == {"/covenants": ["legal_ref:A|d", "legal_ref:A|d#2"], "/aging_history": ["period:2026-08"], "/a/b": ["month:Jan-26"]}
