"""Bug-audit fixes in worker/extract, on real SetReps where a PDF is needed:
H4 a page with no text layer -> block findings (and never last month's aging row), M4 an unreadable covenant value
has no status, M5 the printed contract change is extracted and R06 uses it, M7 one status function, L6 model
answers are checked before they are merged, L27 vintage labels are the report's own text."""
import json
import math

import pytest

from rules import run
from rules.covenant_status import covenant_status
from rules.engine import Context
from worker.extract import _apply_model_cells, derive, extract
from worker.extract import status as status_mod
from worker.extract.engines import guarantor_settrep, multicurrency_settrep, servicer_report, settrep_standard
from worker.extract.history import extend
from worker.extract.mapper import F, Parsed

from .conftest import MOVE_SAMPLES, SAMPLES, needs_samples

UID = "44444444-4444-4444-8444-444444444444"
FPIL = "fpil-2.0-settrep-v1"
MONEDA_AUG = SAMPLES / "Moneda-202608 -SETTREP.pdf"
MONEDA_JUL = SAMPLES / "Moneda-202607 -SETTREP.pdf"


def blank_pages(src, dst, pages):
    """A copy of `src` whose `pages` (1-based) have an empty content stream: no text layer, as a scanned page."""
    pypdf = pytest.importorskip("pypdf")
    writer = pypdf.PdfWriter(clone_from=pypdf.PdfReader(str(src)))
    for n in pages:
        page = writer.pages[n - 1]
        contents = page.get_contents()
        contents.set_data(b"")
        page.replace_contents(contents)
    with open(dst, "wb") as fh:
        writer.write(fh)
    return dst


def findings(ex, prior=None, rule=None):
    fs = run(ex, Context(prior=prior), phases=(1, 2))
    return [f for f in fs if rule is None or f["rule_id"] == rule]


# ---------- H4 ----------
@needs_samples
def test_h4_blank_tests_page_blocks_instead_of_passing_clean(tmp_path):
    """The audit's case: Moneda Aug-2026 with page 14 blank gave covenants [], confidence 0.975 and zero findings."""
    ex = extract(str(blank_pages(MONEDA_AUG, tmp_path / "blank14.pdf", [14])), FPIL, upload_id=UID)
    assert ex["deal"]["covenants"] == [] and ex["meta"]["pages_without_text"] == [14] and ex["meta"]["unplaced"]
    r01 = findings(ex, rule="R01")
    assert r01 and all(f["severity"] == "block" for f in r01)
    by_fields = {tuple(f["fields"]): f for f in r01}
    assert ("/covenants",) in by_fields
    assert by_fields[("meta:/pages_without_text",)]["context"]["pages"] == [14] and by_fields[("meta:/pages_without_text",)]["source_page"] == 14
    assert any(u.startswith("quantitative_tests") for u in by_fields[("meta:/unplaced",)]["context"]["unplaced"])


@needs_samples
def test_h4_blank_aging_page_never_validates_last_months_row(tmp_path):
    """Page 11 blank and the history chained onto July: aging_history[0] is July's row. R01 must block on the
    missing August row; R07 must not report (or pass) July's."""
    prior = extract(str(MONEDA_JUL), FPIL, upload_id=UID)["deal"]
    ex = extract(str(blank_pages(MONEDA_AUG, tmp_path / "blank11.pdf", [11])), FPIL, upload_id=UID)
    assert ex["deal"]["aging_history"] == [] and 11 in ex["meta"]["pages_without_text"]
    chained = extend(prior, ex)
    assert chained["deal"]["aging_history"][0]["period"] == "2026-07"
    fs = findings(chained, prior=prior)
    r01 = [f for f in fs if f["rule_id"] == "R01" and "/aging_history" in f["fields"]]
    assert len(r01) == 1 and r01[0]["severity"] == "block" and "no row for August 2026" in r01[0]["message"]
    assert not [f for f in fs if f["rule_id"] == "R07"]
    # break July's carried row: still nothing from R07 (it is not this report's row)
    chained["deal"]["aging_history"][0]["closing_balance"] += 1000.0
    assert not findings(chained, prior=prior, rule="R07")


@needs_samples
def test_h4_clean_report_has_no_new_findings():
    ex = extract(str(MONEDA_AUG), FPIL, upload_id=UID)
    assert ex["meta"]["pages_without_text"] == [] and ex["meta"]["unplaced"] == []
    assert not findings(ex, rule="R01")


# ---------- M4 ----------
@needs_samples
def test_m4_unreadable_covenant_value_has_no_status_and_a_finding(tmp_path):
    """Page 13 (borrower financials) blank: interest coverage, leverage and equity have no value. They used to be
    status OK with confidence 1.0 and no finding."""
    clean = extract(str(MONEDA_AUG), FPIL, upload_id=UID)
    on13 = [i for i, c in enumerate(clean["deal"]["covenants"]) if clean["sources"].get(f"/covenants/{i}/current_value", {}).get("page") == 13]
    assert on13, "Moneda prints covenant values on page 13"
    ex = extract(str(blank_pages(MONEDA_AUG, tmp_path / "blank13.pdf", [13])), FPIL, upload_id=UID)
    covs = ex["deal"]["covenants"]
    unread = [i for i, c in enumerate(covs) if c["kind"] in ("ceiling", "floor") and c["current_value"] is None]
    assert unread
    for i in unread:
        assert covs[i]["status"] is None and covs[i]["utilization_pct"] is None
        assert ex["sources"][f"/covenants/{i}/status"]["confidence"] == status_mod.UNREAD_CONFIDENCE
    assert ex["meta"]["confidence"] <= 0.9
    assert sum(ex["deal"]["covenant_summary"].values()) == len(covs) - len(unread)       # counted in no bucket
    r18 = [f for f in findings(ex, rule="R18") if f["context"].get("missing_value")]
    assert sorted(f["fields"][0] for f in r18) == sorted(f"/covenants/{i}/current_value" for i in unread)
    assert all(f["severity"] == "review" for f in r18)
    # covenants whose value was read keep their status
    for i, c in enumerate(covs):
        if i not in unread:
            assert c["status"] == clean["deal"]["covenants"][i]["status"]


# ---------- M7 ----------
def test_m7_every_engine_and_r18_use_one_status_function():
    assert status_mod.covenant_status is covenant_status
    for mod in (derive, settrep_standard, guarantor_settrep, multicurrency_settrep, servicer_report):
        assert mod._status is status_mod.status, mod.__name__


@pytest.mark.parametrize("v, thr, kind, want", [(1.105, 1.0, "floor", "WATCH"), (1.11, 1.0, "floor", "WATCH"), (1.12, 1.0, "floor", "OK"),
                                               (0.99, 1.0, "floor", "BREACH"), (0.054, 0.06, "ceiling", "WATCH"), (0.07, 0.06, "ceiling", "BREACH")])
def test_m7_extractor_status_is_the_rule_status(v, thr, kind, want):
    from rules.checks import derive_status
    assert status_mod.status(v, thr, kind, 0.1) == want == derive_status(v, thr, kind, 0.1)


def test_m4_status_without_a_value():
    assert status_mod.status(None, 0.06, "ceiling", 0.1) is None and status_mod.status(1.2, None, "floor", 0.1) is None
    assert status_mod.status(None, 0.06, "ceiling", 0.1, prior_month=True) == "OK"      # the prior month's CNL is not on this report


# ---------- M5 ----------
@needs_samples
@pytest.mark.parametrize("name", ["Moneda-202608 -SETTREP.pdf", "Stride Capital - 202608 - SETTREP.pdf", "Xpedite Leasing - 202608 - SETTREP.pdf"])
def test_m5_printed_contract_change_is_extracted_and_closes(name):
    ex = extract(str(SAMPLES / name), FPIL, upload_id=UID)
    c = ex["deal"]["contracts"]
    assert isinstance(c["change_reported"], (int, float)) and abs(c["change_reported"]) == abs(c["closing"] - c["opening"])
    assert ex["sources"]["/contracts/change_reported"]["page"] == ex["deal"]["source_pages"]["outstanding_contracts"]
    assert c["change_abs"] == c["closing"] - c["opening"]            # unchanged: the dashboards read it
    assert not findings(ex, rule="R06")


@needs_samples
def test_m5_a_misread_closing_count_now_fails_r06():
    ex = extract(str(MONEDA_AUG), FPIL, upload_id=UID)
    c = ex["deal"]["contracts"]
    c["closing"] += 2
    c["change_abs"] = c["closing"] - c["opening"]                    # what the engine derives from the misread number
    ex["deal"]["period_history"][0]["closing_contracts"] = c["closing"]
    r06 = [f for f in findings(ex, rule="R06") if "/contracts/change_reported" in f["fields"]]
    assert len(r06) == 1 and r06[0]["difference"] == 2 and r06[0]["severity"] == "block" and r06[0]["source_page"] == 2


@needs_samples
@pytest.mark.slow
@pytest.mark.parametrize("name", ["Essex - 202607 - SETTREP.pdf", "TLFC_LP-202607-SETTREP.pdf", "Finloc-202607-SETTREP.pdf"])
def test_m5_move_trust_printed_change(name):
    ex = extract(str(MOVE_SAMPLES / name), "move-trust-settrep-v1", upload_id=UID)
    c = ex["deal"]["contracts"]
    assert c["change_reported"] == c["closing"] - c["opening"]       # MOVE Trust prints a decrease as a negative number
    assert not findings(ex, rule="R06")


# ---------- L27 ----------
@needs_samples
@pytest.mark.parametrize("name", ["Moneda-202608 -SETTREP.pdf", "Stride Capital - 202608 - SETTREP.pdf", "Xpedite Leasing - 202608 - SETTREP.pdf"])
def test_l27_vintage_labels_are_the_reports_text(name, tmp_path):
    """The report prints vintages with a figure dash (U+2012): 'Dec-22 ‒ Nov-23'. The label must be those characters,
    in the object and after the worker's JSON file round trip; never the bytes of the dash read as cp1252."""
    ex = extract(str(SAMPLES / name), FPIL, upload_id=UID)
    out = tmp_path / "extraction-pass1.json"
    out.write_text(json.dumps(ex, indent=1), encoding="utf-8")       # as worker/main.py writes it
    back = json.loads(out.read_text(encoding="utf-8"))
    assert out.read_bytes().isascii()                                # \\u escapes: safe under any reader's default encoding
    labels = [r["period"] for r in back["deal"]["cnl_by_period"]]
    labels += [c["worst_vintage"] for c in back["deal"]["covenants"] if c.get("worst_vintage")]
    labels += [r["vintage"] for r in back["deal"]["financial_ratios"] if r.get("vintage")]
    assert labels
    for label in labels:
        assert "â" not in label and "€" not in label and "�" not in label, label
        assert label == ex["sources"]["/cnl_by_period/%d/period" % [r["period"] for r in ex["deal"]["cnl_by_period"]].index(label)]["raw_text"]
        a, dash, b = label.split(" ")
        assert dash == "‒" and len(a) == 6 and len(b) == 6


# ---------- L6 ----------
def parsed(unplaced, **kw):
    return Parsed(template={}, page_count=16, unplaced=list(unplaced), **kw)


def cell(field, value, page=4, raw="x"):
    return {"field": field, "value": value, "page": page, "raw_text": raw}


def test_l6_field_that_was_not_asked_for_cannot_overwrite_a_parsed_value():
    p = parsed([("principal_balances", "term_limit", 4)], principal={"closing_principal": F(15_000_000.0, 4, "15,000,000.00")})
    _apply_model_cells(p, [cell("principal_balances.closing_principal", "1.00"), cell("principal_balances.term_limit", "50,000,000.00")])
    assert p.principal["closing_principal"].value == 15_000_000.0 and p.principal["closing_principal"].confidence == 1.0
    assert p.principal["term_limit"].value == 50_000_000.0 and p.unplaced == []
    assert any("not asked for" in n for n in p.notes)


@pytest.mark.parametrize("bad", [
    cell("principal_balances.term_limit", None),                       # null
    cell("principal_balances.term_limit", "fifty million"),            # not a number
    cell("principal_balances.term_limit", float("nan")),
    cell("principal_balances.term_limit", True),
    cell("principal_balances.term_limit", "50,000,000.00", page=17),   # past the last page
    cell("principal_balances.term_limit", "50,000,000.00", page=0),
    cell("principal_balances.term_limit", "50,000,000.00", page="4"),
    cell("principal_balances.term_limit", "50,000,000.00", page=9),    # a real page, but not one the model was shown
    {"field": "principal_balances.term_limit"},                        # no value at all
    "not a cell",
])
def test_l6_bad_answer_leaves_the_field_unplaced(bad):
    p = parsed([("principal_balances", "term_limit", 4)])
    _apply_model_cells(p, [bad], [("principal_balances", "term_limit")], {4})
    assert "term_limit" not in p.principal and p.unplaced == [("principal_balances", "term_limit", 4)]


@pytest.mark.parametrize("fld, value, ok", [
    ("collection_start", "July 1, 2026", True), ("collection_start", "sometime in July", False), ("collection_start", 20260701, False),
    ("reporting_period", "July 2026", True), ("reporting_period", "2026-07", False),
    ("settlement_date", "August 7, 2026", True), ("settlement_date", "the seventh", False),
    ("borrower", "Moneda Capital Corp.", True), ("borrower", "  ", False),
])
def test_l6_cover_values_are_checked(fld, value, ok):
    p = parsed([("cover", fld, 1)])
    _apply_model_cells(p, [cell(f"cover.{fld}", value, page=1)])
    assert (fld in p.cover) is ok and (p.unplaced == []) is ok


def test_l6_good_answer_still_applies_with_low_confidence():
    p = parsed([("aging", "closing", 11)])
    _apply_model_cells(p, [cell("aging.closing", 15019971.52, page=11, raw="15,019,971.52")], [("aging", "closing")], {11})
    f = p.aging["closing"]
    assert f.value == 15019971.52 and f.page == 11 and f.confidence < 1 and math.isfinite(f.value) and p.unplaced == []


@needs_samples
def test_l6_a_bad_model_answer_does_not_fail_the_upload(tmp_path):
    """Cover date answered with nonsense for a report whose parser placed everything: nothing is asked, nothing
    merged; and with a section unplaced, a nonsense answer leaves it unplaced and the extraction still returns."""
    from types import SimpleNamespace
    from worker.extract.mapper import ModelFallback

    reply = json.dumps({"cells": [{"field": "cover.collection_start", "value": "not a date", "page": 1, "raw_text": "?"},
                                  {"field": "aging.closing", "value": None, "page": 11, "raw_text": ""},
                                  {"field": "principal_balances.closing_principal", "value": "1", "page": 99, "raw_text": "1"}]})
    client = SimpleNamespace(messages=SimpleNamespace(create=lambda **kw: SimpleNamespace(content=[SimpleNamespace(text=reply)])))
    ex = extract(str(blank_pages(MONEDA_AUG, tmp_path / "blank11.pdf", [11])), FPIL, upload_id=UID, model=ModelFallback(model="test-model", client=client))
    clean = extract(str(MONEDA_AUG), FPIL, upload_id=UID)
    assert ex["meta"]["model_calls"] and ex["meta"]["model_calls"][0]["status"] == "ok"
    assert ex["deal"]["collection_period"] == clean["deal"]["collection_period"]
    assert ex["deal"]["program"]["program_amount"] == clean["deal"]["program"]["program_amount"]
    assert any(u.startswith("aging") for u in ex["meta"]["unplaced"]) and ex["deal"]["aging_history"] == []
