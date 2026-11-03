"""Cell parsing and row splitting for Excel-generated SetRep tables.

Number conventions seen in the sample reports (the template names them under `number_format`):
  "1,234.56" -> 1234.56        "-" (accounting zero) -> 0.0      "1.79%" -> 0.0179 (stored as a fraction)
  "(1,234.56)" -> -1234.56     "-" hugging the left edge of a cell, then digits -> negative number
  "#N/A" -> the row is a placeholder and is skipped          "n.a." -> null

Negative numbers. Excel's accounting format left-aligns the minus sign in the cell and right-aligns the digits,
so a negative value arrives as two tokens: "-" just right of the previous column's right edge, then the digits.
A zero arrives as a lone "-" about one text-height left of its own column's right edge. We tell them apart by
geometry: a dash whose left edge is within NEG_SIGN_GAP text-heights of the previous cell's right edge, and that
is followed by a number, is a sign. Xpedite's reports sometimes glue the sign onto the previous number
("38,932.49-"); the tokenizer splits that trailing dash off first.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

from .text import Line, Token

# Both thresholds scale with the text height (the reports print tables at 2.8 pt to 10 pt line height).
NEG_SIGN_GAP = 2.0      # x height: a sign sits < 1 height right of the previous cell; a zero-dash >= 5 heights
ZERO_DASH_PAD = 1.05    # x height: a zero-dash's right edge sits this far left of its column's right edge

_num = re.compile(r"^\(?-?\$?\d[\d,]*(\.\d+)?\)?%?$|^\(?-?\$?\.\d+\)?%?$")
_month = re.compile(r"^[A-Z][a-z]{2}-\d{2}$")
_advance_date = re.compile(r"^\d{1,2}-[A-Z][a-z]{2}-\d{2}$")
DASHES = {"-", "‒", "–", "—"}


@dataclass
class Cell:
    raw: str                 # text as printed (sign included when it was a separate glyph)
    value: Optional[float]   # parsed value; None for n.a.
    bbox: list[float]
    is_pct: bool = False


def is_number(s: str) -> bool:
    return bool(_num.match(s.replace(" ", "")))


def is_month(s: str) -> bool:
    return bool(_month.match(s))


def is_advance_date(s: str) -> bool:
    return bool(_advance_date.match(s))


def parse_number(s: str, *, percent_as_fraction: bool = True) -> Optional[float]:
    """Parse one printed cell. Raises ValueError for text that is not a number, zero-dash or null marker."""
    t = s.strip().replace(" ", "").replace("$", "")
    if t in DASHES or t == "":
        return 0.0
    if t.lower() in ("n.a.", "n/a", "na"):
        return None
    neg = False
    if t.startswith("(") and t.endswith(")"):
        neg, t = True, t[1:-1]
    if t.startswith("-"):
        neg, t = (not neg), t[1:]
    pct = t.endswith("%")
    if pct:
        t = t[:-1]
    if not re.match(r"^\d[\d,]*(\.\d+)?$|^\.\d+$", t):
        raise ValueError(f"not a number: {s!r}")
    v = float(t.replace(",", ""))
    if pct and percent_as_fraction:
        v = v / 100
    return -v if neg else v


def split_glued_signs(tokens: list[Token]) -> list[Token]:
    """'38,932.49-' -> '38,932.49', '-' (the dash is the next cell's sign)."""
    out: list[Token] = []
    for t in tokens:
        if len(t.text) > 1 and t.text.endswith("-") and is_number(t.text[:-1]):
            w = (t.x1 - t.x0) / len(t.text)
            out.append(Token(t.text[:-1], t.x0, t.x1 - w, t.top, t.bottom))
            out.append(Token("-", t.x1 - w, t.x1, t.top, t.bottom))
        else:
            out.append(t)
    return out


def cells(tokens: list[Token], *, left_edge: float | None = None) -> list[Cell]:
    """Turn the value tokens of one table row into cells, folding negative signs into the following number.
    `left_edge` is the right edge of the row label (so a sign in the first value column can be detected)."""
    toks = split_glued_signs(tokens)
    out: list[Cell] = []
    prev_edge = left_edge
    i = 0
    while i < len(toks):
        t = toks[i]
        nxt = toks[i + 1] if i + 1 < len(toks) else None
        if t.text in DASHES and nxt is not None and is_number(nxt.text) and nxt.text not in DASHES \
                and prev_edge is not None and (t.x0 - prev_edge) < NEG_SIGN_GAP * (t.bottom - t.top):
            v = parse_number(nxt.text)
            out.append(Cell("-" + nxt.text, None if v is None else -v, [t.x0, t.top, nxt.x1, nxt.bottom], nxt.text.endswith("%")))
            prev_edge = nxt.x1
            i += 2
            continue
        v = parse_number(t.text)
        out.append(Cell(t.text, v, Token.bbox.fget(t), t.text.endswith("%")))
        prev_edge = t.x1 + (ZERO_DASH_PAD * (t.bottom - t.top) if t.text in DASHES else 0.0)
        i += 1
    return out


def numeric_tail(line: Line) -> tuple[list[Token], list[Token]]:
    """Split a line into (label tokens, value tokens): the value tokens are the longest numeric suffix."""
    toks = line.tokens
    k = len(toks)
    while k > 0 and (is_number(toks[k - 1].text) or toks[k - 1].text in DASHES
                     or (toks[k - 1].text.endswith("-") and is_number(toks[k - 1].text[:-1]))):
        k -= 1
    return toks[:k], toks[k:]


def row_cells(line: Line, label_tokens: int | None = None) -> tuple[str, list[Cell]]:
    """Label text and parsed value cells for a table row. If `label_tokens` is given, that many leading tokens
    are the label; otherwise the label is everything before the numeric tail."""
    if label_tokens is None:
        label, vals = numeric_tail(line)
    else:
        label, vals = line.tokens[:label_tokens], line.tokens[label_tokens:]
    edge = label[-1].x1 if label else None
    return " ".join(t.text for t in label), cells(vals, left_edge=edge)


def _edge(c: Cell) -> float:
    h = c.bbox[3] - c.bbox[1]
    return c.bbox[2] + (ZERO_DASH_PAD * h if c.raw in DASHES else 0.0)


def align_columns(rows: list[list[Cell]], ncols: int) -> Optional[list[list[Optional[Cell]]]]:
    """Some rows leave a cell blank (no dash printed), so position in the token stream is not column identity.
    Cluster the right edges of every cell in the block (numbers are right-aligned; a zero-dash sits ZERO_DASH_PAD
    left of its edge) into column anchors, then place each cell under its anchor. Returns None when the block
    does not resolve into exactly `ncols` anchors; the caller then reports the rows as unplaced."""
    pts = sorted((_edge(c), c.bbox[3] - c.bbox[1]) for r in rows for c in r)
    if not pts:
        return None
    anchors: list[list[float]] = []
    for x, h in pts:
        if anchors and x - anchors[-1][-1] <= 0.8 * h:
            anchors[-1].append(x)
        else:
            anchors.append([x])
    if len(anchors) != ncols:
        return None
    centers = [sum(a) / len(a) for a in anchors]
    out = []
    for r in rows:
        placed: list[Optional[Cell]] = [None] * ncols
        for c in r:
            i = min(range(ncols), key=lambda k: abs(centers[k] - _edge(c)))
            if placed[i] is not None:
                return None
            placed[i] = c
        out.append(placed)
    return out
