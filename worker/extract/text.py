"""Page text and positioned tokens from a SetRep PDF via pdfplumber.

The sample SetReps are Excel-generated. Excel's PDF writer places a space glyph *inside* many numbers
("4 03,465.45", "1 ,066,690.29"): the space overlaps the previous digit and the next digit starts where the
previous one ends. Real word gaps are at least 0.2 x font size; these phantom spaces have a gap of ~0. We drop
them before building words, so every number arrives as one token with its own bbox.

Output per page: `Page(number, text, lines)`, where each line is a list of `Token(text, x0, x1, top, bottom)`
sorted left to right. Pages with no characters are flagged `has_text=False` so the caller can route them to OCR.
"""
from __future__ import annotations

import bisect
import re
from dataclasses import dataclass, field
from typing import Iterable

import pdfplumber

PHANTOM_GAP = 0.1   # gap between neighbours, as a fraction of font size, below which a space glyph is phantom
LINE_TOL = 2.0      # points: words whose tops differ by less than this are on the same line


@dataclass
class Token:
    text: str
    x0: float
    x1: float
    top: float
    bottom: float

    @property
    def bbox(self) -> list[float]:
        return [round(self.x0, 2), round(self.top, 2), round(self.x1, 2), round(self.bottom, 2)]


@dataclass
class Line:
    tokens: list[Token]

    @property
    def text(self) -> str:
        return " ".join(t.text for t in self.tokens)

    @property
    def top(self) -> float:
        return min(t.top for t in self.tokens)

    @property
    def bbox(self) -> list[float]:
        return [round(min(t.x0 for t in self.tokens), 2), round(min(t.top for t in self.tokens), 2),
                round(max(t.x1 for t in self.tokens), 2), round(max(t.bottom for t in self.tokens), 2)]


@dataclass
class Page:
    number: int                      # 1-based
    lines: list[Line] = field(default_factory=list)
    width: float = 0.0
    height: float = 0.0

    @property
    def has_text(self) -> bool:
        return any(self.lines)

    @property
    def text(self) -> str:
        return "\n".join(l.text for l in self.lines)


def _phantom_space_ids(chars: list[dict]) -> set[int]:
    rows: dict[int, list[dict]] = {}
    for c in chars:
        rows.setdefault(round(c["top"]), []).append(c)
    out: set[int] = set()
    for cs in rows.values():
        solid = sorted((c for c in cs if c["text"] != " "), key=lambda c: c["x0"])
        xs = [c["x0"] for c in solid]
        for c in cs:
            if c["text"] != " ":
                continue
            # neighbours by the space's centre: the space glyph can start a hair left of the digit it follows
            mid = (c["x0"] + c["x1"]) / 2
            k = bisect.bisect_left(xs, mid)
            if 0 < k < len(solid):
                prev, nxt = solid[k - 1], solid[k]
                if nxt["x0"] - prev["x1"] < PHANTOM_GAP * (c.get("size") or 6):
                    out.add(id(c))
    return out


# Glyphs the fonts in these reports map to no Unicode; pdfminer prints them as (cid:N).
CID_FIXES = {"(cid:415)": "ti"}   # the "ti" ligature in Stride's covenant page ("Cumula(cid:415)ve" -> "Cumulative")


def _fix_cids(s: str) -> str:
    for k, v in CID_FIXES.items():
        s = s.replace(k, v)
    return s


def _lines_from_words(words: Iterable[dict]) -> list[Line]:
    words = sorted(words, key=lambda w: (round(w["top"], 1), w["x0"]))
    lines: list[list[Token]] = []
    for w in words:
        t = Token(_fix_cids(w["text"]), w["x0"], w["x1"], w["top"], w["bottom"])
        if lines and abs(lines[-1][0].top - t.top) < LINE_TOL:
            lines[-1].append(t)
        else:
            lines.append([t])
    return [Line(sorted(ts, key=lambda t: t.x0)) for ts in lines]


def _drop_superscripts(words: list[dict]) -> list[dict]:
    """Footnote markers ("Jan-26 ¹") are set in a smaller font on the same line; they are not cells."""
    out = []
    for w in words:
        if w["text"].isdigit() and len(w["text"]) <= 2:
            peers = [o for o in words if abs(o["top"] - w["top"]) < 6 and o is not w]
            if peers:
                sizes = sorted(o["size"] for o in peers)
                bottoms = sorted(o["bottom"] for o in peers)
                if w["size"] < 0.8 * sizes[len(sizes) // 2] and w["bottom"] < bottoms[len(bottoms) // 2] - 0.5:
                    continue
        out.append(w)
    return out


def read_page(page: "pdfplumber.page.Page", number: int) -> Page:
    phantom = _phantom_space_ids(page.chars)
    clean = page.filter(lambda o: id(o) not in phantom) if phantom else page
    words = clean.extract_words(x_tolerance=1.5, y_tolerance=2, keep_blank_chars=False, use_text_flow=False,
                                extra_attrs=["size"])
    words = _drop_superscripts(words)
    return Page(number=number, lines=_lines_from_words(words), width=float(page.width), height=float(page.height))


def read_pdf(pdf_path: str, pages: list[int] | None = None) -> tuple[list[Page], int]:
    """Return (pages, page_count). `pages` limits which 1-based pages are read (pass 2)."""
    with pdfplumber.open(pdf_path) as pdf:
        count = len(pdf.pages)
        want = set(pages) if pages else set(range(1, count + 1))
        out = [read_page(p, i) for i, p in enumerate(pdf.pages, 1) if i in want]
    return out, count


def pages_without_text(pages: list[Page]) -> list[int]:
    """Pages to route to the OCR fallback (wave 2)."""
    return [p.number for p in pages if not p.has_text]


def engine_version() -> str:
    return f"pdfplumber {pdfplumber.__version__}"


_ws = re.compile(r"\s+")


def norm(s: str) -> str:
    """Collapse whitespace and fold the dash variants the reports use, for heading matching only."""
    return _ws.sub(" ", s.replace("‒", "-").replace("–", "-").replace("—", "-")).strip().upper()
