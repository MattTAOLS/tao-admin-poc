"""Seeded error: change one digit on page 2 of a copy of a real SetRep and check the extraction fails R05 by
exactly that amount; then a pass-2 re-read of page 2 returns a patch for page-2 fields only.

The copy is made with pypdf (test-only dependency; requested for worker/requirements.txt in docs/requests.md).
The digit is changed in the page content stream, so the text layer, glyph positions and everything else on the
page are untouched.
"""
import pathlib

import pytest

from worker.extract import extract, merge_patch

from .conftest import SAMPLES, needs_samples

pypdf = pytest.importorskip("pypdf")
pytestmark = needs_samples

SOURCE = SAMPLES / "Moneda-202608 -SETTREP.pdf"
# Portfolio Balances row, scheduled principal 646,926.71 -> 646,826.71 (the hundreds digit 9 -> 8): -100.00
ORIGINAL_RUN = b"[(6)-3(4)-3(6)-3(,)6(9)-3(2)-3(6)-3(.)8(7)-3(1)] TJ"
SEEDED_RUN = b"[(6)-3(4)-3(6)-3(,)6(8)-3(2)-3(6)-3(.)8(7)-3(1)] TJ"
DELTA = -100.00


def seed_copy(dst: pathlib.Path) -> pathlib.Path:
    reader = pypdf.PdfReader(str(SOURCE))
    writer = pypdf.PdfWriter(clone_from=reader)
    page = writer.pages[1]
    contents = page.get_contents()
    data = contents.get_data()
    assert data.count(ORIGINAL_RUN) == 1, "the sample's page-2 total row changed; update ORIGINAL_RUN"
    contents.set_data(data.replace(ORIGINAL_RUN, SEEDED_RUN))
    page.replace_contents(contents)
    with open(dst, "wb") as fh:
        writer.write(fh)
    return dst


@pytest.fixture(scope="module")
def seeded(tmp_path_factory):
    if not SOURCE.exists():
        pytest.skip("Moneda 202608 sample not present")
    return seed_copy(tmp_path_factory.mktemp("seeded") / "Moneda-202608-seeded.pdf")


def test_seeded_digit_is_read(seeded):
    ex = extract(str(seeded))
    assert ex["deal"]["tranche_balance"]["principal"] == pytest.approx(646926.71 + DELTA, abs=0.001)
    src = ex["sources"]["/tranche_balance/principal"]
    assert src["page"] == 2 and src["raw_text"] == "646,826.71" and src["bbox"] is not None


def test_seeded_digit_fails_r05_by_exactly_that_amount(seeded):
    from rules import run
    from rules.engine import Context
    clean = extract(str(SOURCE))
    bad = extract(str(seeded))
    clean_r05 = [f for f in run(clean, Context(), phases=(1,)) if f["rule_id"] == "R05"]
    bad_r05 = [f for f in run(bad, Context(), phases=(1,)) if f["rule_id"] == "R05"]
    assert clean_r05 == []
    assert len(bad_r05) == 1
    # report closing - (opening - principal - prepayments - losses): principal is $100 low, so computed is $100 high
    f = bad_r05[0]
    clean_gap = (clean["deal"]["tranche_balance"]["closing"] - (
        clean["deal"]["tranche_balance"]["opening"] - clean["deal"]["tranche_balance"]["principal"]
        - clean["deal"]["tranche_balance"]["principal_prepayments"] - clean["deal"]["tranche_balance"]["losses"]))
    assert f["difference"] == pytest.approx(DELTA + clean_gap, abs=0.005)
    assert abs(f["difference"] - DELTA) < 0.02


def test_pass2_patch_rereads_page_2_only(seeded):
    base = extract(str(seeded))
    patch = extract(str(SOURCE), pages=[2])           # the re-read finds the correct digit
    assert patch["meta"]["pass"] == 2 and patch["meta"]["pages_reread"] == [2]
    assert {s["page"] for s in patch["sources"].values()} == {2}
    assert patch["deal"]["tranche_balance"]["principal"] == pytest.approx(646926.71)
    assert "covenants" not in patch["deal"]          # page 14 was not re-read
    merged = merge_patch(base, patch)
    assert merged["meta"]["pass"] == 2
    assert merged["deal"]["tranche_balance"]["principal"] == pytest.approx(646926.71)
    assert merged["deal"]["period_history"][0]["principal"] == pytest.approx(646926.71)
    assert merged["sources"]["/tranche_balance/principal"]["pass"] == 2
    assert merged["deal"]["covenants"] == base["deal"]["covenants"]
