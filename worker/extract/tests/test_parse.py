"""Unit tests for cell parsing, sign detection and column alignment (no PDFs needed)."""
import pytest

from worker.extract.parse import Cell, align_columns, cells, parse_number
from worker.extract.text import Token, _phantom_space_ids


@pytest.mark.parametrize("raw,val", [
    ("1,234.56", 1234.56), ("-", 0.0), ("1.79%", 0.0179), ("-0.20%", -0.002), ("(1,000.00)", -1000.0),
    ("n.a.", None), ("7.57", 7.57), ("$2,500,000", 2500000.0), ("0.00%", 0.0),
])
def test_parse_number(raw, val):
    got = parse_number(raw)
    assert (got is None and val is None) or abs(got - val) < 1e-12


def test_parse_number_rejects_text():
    with pytest.raises(ValueError):
        parse_number("Prepayment")


def T(text, x0, x1, h=10.0):
    return Token(text, x0, x1, 100.0, 100.0 + h)


def test_sign_hugging_previous_cell_is_negative():
    # Moneda p12 Jul-26: "64,170.00 | - 39,470.55 | - 11,870.78" (geometry from the real page)
    toks = [T("64,170.00", 859.5, 900.5), T("-", 907.6, 910.6), T("39,470.55", 989.0, 1030.0),
            T("-", 1037.0, 1040.1), T("11,870.78", 1096.2, 1137.1)]
    assert [c.value for c in cells(toks, left_edge=801)] == [64170.0, -39470.55, -11870.78]


def test_zero_dash_then_number_is_two_cells():
    # Moneda p12 Jun-26: gross losses "-" (zero) then recoveries "277,950.00"
    toks = [T("269,447.89", 655.2, 701.5), T("-", 787.0, 790.0), T("277,950.00", 854.0, 901.0)]
    assert [c.value for c in cells(toks, left_edge=594)] == [269447.89, 0.0, 277950.0]


def test_trailing_glued_sign_belongs_to_next_cell():
    # Xpedite p13 Jul-26 prints "38,932.49-" "3,930.45-" "35,002.04" at 2.8 pt
    toks = [T("38,932.49-", 373.3, 386.0, 2.8), T("3,930.45-", 405.0, 416.4, 2.8), T("35,002.04", 436.9, 448.4, 2.8)]
    assert [c.value for c in cells(toks, left_edge=352)] == [38932.49, -3930.45, -35002.04]


def test_align_columns_places_blank_cell():
    def C(raw, x1, h=2.8):
        return Cell(raw, parse_number(raw), [x1 - 10, 0, x1, h])
    full = [C("1.00", 336), C("2.00", 360), C("-", 380 - 2.94), C("4.00", 406)]
    short = [C("1.00", 336), C("2.00", 360), C("4.00", 406)]      # third column left blank
    grid = align_columns([full, short], 4)
    assert grid is not None
    assert grid[1][2] is None and grid[1][3].value == 4.0


def test_phantom_space_detection():
    # "4 03,465.45": a space glyph overlapping the 4, next digit starts where the 4 ends
    chars = [{"text": "4", "x0": 278.88, "x1": 281.86, "top": 159.0, "size": 5.9},
             {"text": " ", "x0": 278.86, "x1": 280.2, "top": 159.0, "size": 5.9},
             {"text": "0", "x0": 281.87, "x1": 284.8, "top": 159.0, "size": 5.9},
             {"text": "x", "x0": 300.0, "x1": 302.0, "top": 159.0, "size": 5.9},
             {"text": " ", "x0": 302.0, "x1": 303.5, "top": 159.0, "size": 5.9},
             {"text": "y", "x0": 303.6, "x1": 306.0, "top": 159.0, "size": 5.9}]
    ids = _phantom_space_ids(chars)
    assert id(chars[1]) in ids and id(chars[4]) not in ids
