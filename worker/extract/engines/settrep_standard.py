"""Engine for the standard MOVE Trust settlement report (template move-trust-settrep-standard-v1).

One table per section: tranche balance (per tranche, Pool Balances totals), outstanding contracts, tranche amounts,
funding costs and program limits, warehouse advances (where the facility has one), enhancement totals, the
required-tranche-balance table, top 10 obligors, aging, aggregate performance by month, cumulative losses by
annual period, originator / guarantor ratios, quantitative tests. Servicers differ in which columns they print;
the template lists the column sets as variants picked by header keywords.

Blank cells and accounting dashes are common, so table cells are placed under their column by right edge, using a
row that prints every column (the totals row) as anchors. A minus sign either hugs the previous cell ("- 4,147.57")
or sits left-aligned in its own cell ("4 - 1 3"); a zero-dash sits at its column's right edge.

parse(pages, page_count, tpl) -> mapper.Parsed; build(parsed, recorder, *, prior=None, partial=False).
"""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Iterable, Optional

from .. import mapper
from ..derive import MONTHS, Series, _month_key, _prev_mon_yy, _prev_month, _status, _threshold, _trend, _ym, parse_long_date, slugify
from ..mapper import F, Doc, Parsed, _all_numeric, _first_number_after, _pick_variant
from ..parse import DASHES, Cell, _edge, cells, is_advance_date, is_month, is_number, row_cells
from ..provenance import Recorder
from ..text import Line, Page, norm

log = logging.getLogger("extract.settrep_standard")

PLACE_TOL = 4.0     # x text height: a cell further than this from every column anchor is not in the table


# ---------------------------------------------------------------- helpers
def _lines_after(page: Page, pattern: str, end: str | None = None) -> Optional[list[Line]]:
    rx, erx = re.compile(pattern), (re.compile(end) if end else None)
    for i, l in enumerate(page.lines):
        if rx.search(norm(l.text)):
            out = []
            for m in page.lines[i + 1:]:
                if erx and erx.search(norm(m.text)):
                    break
                out.append(m)
            return out
    return None


def _header(lines: list[Line]) -> str:
    """Header text: the lines before the first row that starts with a number or a date."""
    out = []
    for l in lines:
        t = l.tokens[0].text if l.tokens else ""
        if is_advance_date(t) or is_month(t) or (t.isdigit() and len(l.tokens) > 2 and _all_numeric(l.tokens[1:])):
            break
        out.append(l.text)
    return norm(" ".join(out))


def _height(c: Cell) -> float:
    return c.bbox[3] - c.bbox[1]


def _nearest(anchors: list[float], x: float) -> int:
    return min(range(len(anchors)), key=lambda k: abs(anchors[k] - x))


def _drop_overlaps(toks: list) -> list:
    """A page number printed into a table row overlaps a cell ("7,207,637.85 16 -" with "16" on top of "-"): two
    tokens cannot share the same x range in one table row, so a bare integer overlapping a neighbour is dropped."""
    out = list(toks)
    for i in range(len(out) - 2, -1, -1):
        a, b = out[i], out[i + 1]
        if b.x0 < a.x1 - 0.1:
            for k, t in ((i, a), (i + 1, b)):
                if re.fullmatch(r"\d{1,3}", t.text):
                    del out[k]
                    break
    return out


def _fold_left_signs(cs: list[Cell], anchors: list[float]) -> list[Cell]:
    """A dash followed by a number under the same column is that number's sign (left-aligned accounting format).
    A zero-dash sits just left of its own column's edge, so the first column edge right of a dash is the dash's
    column; when that is also the next number's column, the dash is the number's sign."""
    out: list[Cell] = []
    i = 0
    while i < len(cs):
        c = cs[i]
        nxt = cs[i + 1] if i + 1 < len(cs) else None
        own = next((k for k, a in enumerate(anchors) if a >= c.bbox[2] - 0.5), None) if c.raw in DASHES else None
        if own is not None and nxt is not None and nxt.raw not in DASHES and nxt.value is not None \
                and own == _nearest(anchors, _edge(nxt)):
            out.append(Cell("-" + nxt.raw, -nxt.value, [c.bbox[0], c.bbox[1], nxt.bbox[2], nxt.bbox[3]], nxt.is_pct))
            i += 2
            continue
        out.append(c)
        i += 1
    return out


def _fold_to_count(cs: list[Cell], n: int) -> list[Cell]:
    """Totals rows without anchors: fold dash + number pairs into negatives until the row has n cells."""
    cs = list(cs)
    while len(cs) > n:
        k = next((i for i in range(len(cs) - 1) if cs[i].raw in DASHES and cs[i + 1].raw not in DASHES
                  and cs[i + 1].value is not None), None)
        if k is None:
            break
        a, b = cs[k], cs[k + 1]
        cs[k:k + 2] = [Cell("-" + b.raw, -b.value, [a.bbox[0], a.bbox[1], b.bbox[2], b.bbox[3]], b.is_pct)]
    return cs


def _place(cs: list[Cell], anchors: list[float]) -> Optional[list[Optional[Cell]]]:
    """Each cell under the column anchor nearest its right edge. None when two cells claim one column or a cell
    is far from every anchor."""
    cs = _fold_left_signs(cs, anchors)
    out: list[Optional[Cell]] = [None] * len(anchors)
    for c in cs:
        e = _edge(c)
        i = _nearest(anchors, e)
        if out[i] is not None or abs(anchors[i] - e) > PLACE_TOL * _height(c):
            return None
        out[i] = c
    return out


def _v(f: Optional[F]) -> float:
    return 0.0 if f is None or f.value is None else f.value


def _sum(fs: Iterable[Optional[F]]) -> float:
    return sum(_v(f) for f in fs)


def _ins(fs: Iterable[Optional[F]]) -> list[F]:
    return [f for f in fs if f is not None]


def _find(doc: Doc, pattern: str) -> Optional[Page]:
    hit = doc.find(pattern)
    return hit[0] if hit else None


def _pages_from(doc: Doc, page: Page, n_after: int) -> list[Page]:
    return [doc.pages[k] for k in range(page.number, page.number + n_after + 1) if k in doc.pages]


def _labelled_values(lines: list[Line], spec: dict, page: int) -> dict:
    got = {}
    for key, pat in spec.items():
        rx = re.compile(pat)
        for l in lines:
            r = _first_number_after(l, rx)
            if r:
                got[key] = F.of(r[1], page)
                break
    return got


# ---------------------------------------------------------------- parsing
def parse_cover(doc: Doc, tpl: dict, out: Parsed):
    mapper.parse_cover(doc, tpl, out)
    # the funding-gap flag is optional on the cover; it is not a missing field when absent
    out.unplaced = [u for u in out.unplaced if not (u[0] == "cover" and u[1] == "funding_gap")]


def parse_balances(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["tranche_balance"]
    out.extra["balance"] = None
    page = _find(doc, sec["heading"])
    if page is None:
        out.unplaced.append(("tranche_balance", "*", None))
        return
    out.source_pages[sec["source_page_key"]] = page.number
    lines = _lines_after(page, sec["heading"], sec["end"])
    v = _pick_variant(sec["variants"], _header(lines))
    if v is None:
        out.unplaced.append(("tranche_balance", "variant", page.number))
        return
    pre, tot_pre, ycols, post = v["columns_before_yields"], v["total_columns_before_pct"], v["yield_columns"], sec["columns_after_yields"]
    trx = re.compile(sec["total_row"])
    res: dict[str, Any] = {"page": page.number, "variant": v["name"], "columns": pre, "total": {}, "rows": []}
    anchors: dict[str, float] = {}
    for l in lines:
        label, cs = row_cells(l)
        if not trx.search(norm(label)):
            continue
        k = next((i for i, c in enumerate(cs) if c.is_pct), None)
        if k is None or len(cs[:k]) != len(tot_pre) or len(cs[k + 1:]) != len(post):
            out.notes.append(f"tranche_balance p.{page.number}: totals row has {len(cs)} cells")
            continue
        res["total"] = {c: F.of(cell, page.number) for c, cell in zip(tot_pre, cs[:k])}
        res["total"][ycols[-1]] = F.of(cs[k], page.number)
        res["total"].update({c: F.of(cell, page.number) for c, cell in zip(post, cs[k + 1:])})
        anchors = {c: _edge(cell) for c, cell in zip(tot_pre, cs[:k])}
        anchors.update({c: _edge(cell) for c, cell in zip(post, cs[k + 1:])})
        break
    if not res["total"]:
        out.unplaced.append(("tranche_balance", "total", page.number))
        out.extra["balance"] = res
        return
    a_pre, a_post = [anchors[c] for c in pre], [anchors[c] for c in post]
    for l in lines:
        toks = l.tokens
        if len(toks) < 3 or not is_advance_date(toks[0].text) or not toks[1].text.isdigit() or not _all_numeric(toks[2:]):
            continue
        cs = cells(toks[2:], left_edge=toks[1].x1)
        pk = [j for j, c in enumerate(cs) if c.is_pct]
        before, after = (cs[:pk[0]], cs[pk[-1] + 1:]) if pk else (cs, [])
        a, b = _place(before, a_pre), _place(after, a_post)
        if a is None or b is None:
            out.notes.append(f"tranche_balance p.{page.number}: tranche {toks[1].text} cells do not fit the columns")
            out.unplaced.append(("tranche_balance", f"tranche {toks[1].text}", page.number))
            continue
        row: dict[str, Any] = {"tranche": F(int(toks[1].text), page.number, toks[1].text, toks[1].bbox),
                               "date": F(toks[0].text, page.number, toks[0].text, toks[0].bbox)}
        row.update({c: F.of(cell, page.number) for c, cell in zip(pre, a) if cell is not None})
        row.update({c: F.of(cell, page.number) for c, cell in zip(post, b) if cell is not None})
        ys = [cs[j] for j in pk]
        for c, cell in zip(ycols[-len(ys):] if ys else [], ys[-len(ycols):]):
            row[c] = F.of(cell, page.number)
        res["rows"].append(row)
    out.extra["balance"] = res


def parse_contracts(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["outstanding_contracts"]
    out.extra["contracts"] = None
    page = _find(doc, sec["heading"])
    if page is None:
        out.unplaced.append(("outstanding_contracts", "*", None))
        return
    out.source_pages[sec["source_page_key"]] = page.number
    cols, trx = sec["columns"], re.compile(sec["total_row"])
    lines = _lines_after(page, sec["heading"])
    res: dict[str, Any] = {"page": page.number, "total": {}, "rows": []}
    anchors = None
    for l in lines:
        label, cs = row_cells(l)
        if trx.search(norm(label)):
            cs = _fold_to_count(cs, len(cols))
            if len(cs) == len(cols):
                res["total"] = {c: F.of(cell, page.number) for c, cell in zip(cols, cs)}
                anchors = [_edge(c) for c in cs]
            break
    if anchors is None:
        out.unplaced.append(("outstanding_contracts", "total", page.number))
        return
    for l in lines:
        toks = l.tokens
        if len(toks) < 2 or not toks[0].text.isdigit() or not _all_numeric(toks[1:]):
            continue
        placed = _place(cells(toks[1:], left_edge=toks[0].x1), anchors)
        if placed is None:
            out.unplaced.append(("outstanding_contracts", f"tranche {toks[0].text}", page.number))
            continue
        row = {"tranche": F(int(toks[0].text), page.number, toks[0].text, toks[0].bbox)}
        row.update({c: F.of(cell, page.number) for c, cell in zip(cols, placed) if cell is not None})
        res["rows"].append(row)
    out.extra["contracts"] = res


def parse_amounts(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["tranche_amounts"]
    out.extra["amounts"] = {}
    page = _find(doc, sec["heading"])
    if page is None:
        out.unplaced.append(("tranche_amounts", "*", None))
        return
    out.source_pages[sec["source_page_key"]] = page.number
    trx = re.compile(sec["total_row"])
    for l in _lines_after(page, sec["heading"]):
        label, cs = row_cells(l)
        if trx.search(norm(label)) and len(cs) == len(sec["columns"]):
            out.extra["amounts"] = {c: F.of(cell, page.number) for c, cell in zip(sec["columns"], cs)}
            return
    out.unplaced.append(("tranche_amounts", "total", page.number))


def parse_program(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["program"]
    out.extra["program"] = {}
    page = _find(doc, sec["heading"])
    if page is None:
        out.unplaced.append(("program", "*", None))
        return
    out.source_pages[sec["source_page_key"]] = page.number
    got: dict = {}
    for pg in _pages_from(doc, page, sec["search_pages_after_heading"]):
        lines = _lines_after(pg, sec["heading"]) if pg is page else pg.lines
        for k, f in _labelled_values(lines, sec["lines"], pg.number).items():
            got.setdefault(k, f)
    out.extra["program"] = got
    if "program_limit" not in got:
        out.unplaced.append(("program", "program_limit", page.number))


def parse_warehouse(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["warehouse"]
    out.extra["warehouse"] = None        # the facility has no warehouse line
    hit = doc.find(sec["anchor"])
    if not hit:
        return
    page, i = hit
    trx = re.compile(sec["total_row"])
    for l in reversed(page.lines[:i]):
        label, cs = row_cells(l)
        if trx.search(norm(label)) and len(cs) >= 2:
            out.extra["warehouse"] = {"opening": F.of(cs[sec["opening_index"]], page.number),
                                      "closing": F.of(cs[sec["closing_index"]], page.number)}
            return
    out.extra["warehouse"] = {}
    out.unplaced.append(("warehouse", "total", page.number))


def parse_enhancement(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["enhancement"]
    page = _find(doc, sec["heading"])
    if page is None:
        out.unplaced.append(("enhancement", "*", None))
        return
    out.source_pages[sec["source_page_key"]] = page.number
    for pg in _pages_from(doc, page, sec["search_pages_after_heading"]):
        for l in pg.lines:
            t = norm(l.text)
            if sec["line"] not in t:
                continue
            k = t.index(sec["line"])
            toks = [x for x in l.tokens if is_number(x.text) or x.text in DASHES]
            cs = _fold_to_count(cells(toks), 0)      # "- 63,977,259.97": a dash before an amount is its sign
            amounts = [c for c in cs if not c.is_pct and c.raw not in DASHES and "." in c.raw]
            pcts = [c for c in cs if c.is_pct]
            if "($)" in t[k:] and amounts and "total_amount" not in out.enhancement:
                out.enhancement["total_amount"] = F.of(amounts[0], pg.number)
            if "(%)" in t[k:] and pcts and "total_pct" not in out.enhancement:
                out.enhancement["total_pct"] = F.of(pcts[0], pg.number)
        if "total_amount" in out.enhancement and "total_pct" in out.enhancement:
            break
    for k in ("total_amount", "total_pct"):
        if k not in out.enhancement:
            out.unplaced.append(("enhancement", k, page.number))


def parse_required(doc: Doc, tpl: dict, out: Parsed):
    """Required Tranche Balance table: per tranche closing - required (the covenant's context value)."""
    sec = tpl["sections"]["required_tranche_balance"]
    out.extra["required_rows"] = []
    page = _find(doc, sec["heading"])
    if page is None:
        return
    rrx, cols = re.compile(sec["row"]), sec["columns"]
    for l in _lines_after(page, sec["heading"]):
        toks = l.tokens
        if len(toks) < 2 or not rrx.match(toks[0].text) or not _all_numeric(toks[1:]):
            continue
        cs = _fold_to_count(cells(toks[1:], left_edge=toks[0].x1), len(cols))
        if len(cs) != len(cols):
            continue
        row = {"tranche": F(int(toks[0].text), page.number, toks[0].text, toks[0].bbox), "bbox": l.bbox, "raw": l.text}
        row.update({c: F.of(cell, page.number) for c, cell in zip(cols, cs)})
        out.extra["required_rows"].append(row)


def parse_top10(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["top10_obligor"]
    out.extra["top10"] = []
    page = _find(doc, sec["heading"])
    if page is None:
        out.unplaced.append(("top10_obligor", "*", None))
        return
    out.source_pages[sec["source_page_key"]] = page.number
    rrx, arx = re.compile(sec["row"]), re.compile(sec["amount"])
    for l in _lines_after(page, sec["heading"]):
        toks = l.tokens
        if len(toks) < 6 or not rrx.match(toks[0].text):
            continue
        k = next((i for i in range(2, len(toks)) if arx.match(toks[i].text)), None)
        if k is None:
            continue
        name = toks[1:k]
        amt, conc = toks[k], toks[k + 1] if k + 1 < len(toks) else None
        rest = toks[k + 2:]
        if conc is None or not conc.text.endswith("%") or len(rest) < 3:
            out.unplaced.append(("top10_obligor", f"rank {toks[0].text}", page.number))
            continue
        excess, per = rest[-1], rest[-2]
        lim = rest[:-2]
        row: dict[str, Any] = {
            "rank": F(int(toks[0].text), page.number, toks[0].text, toks[0].bbox),
            "name": F(" ".join(t.text for t in name), page.number, " ".join(t.text for t in name),
                      [name[0].x0, name[0].top, name[-1].x1, name[-1].bottom]),
            "amount": F.of(cells([amt])[0], page.number),
            "concentration_pct": F.of(cells([conc])[0], page.number),
            "limit_per_obligor": F.of(cells([per])[0], page.number),
            "excess": F.of(cells([excess])[0], page.number),
        }
        lim_text = " ".join(t.text for t in lim)
        lim_bbox = [lim[0].x0, lim[0].top, lim[-1].x1, lim[-1].bottom]
        if len(lim) == 1 and is_number(lim[0].text) and lim[0].text.endswith("%"):
            row["limit_pct"] = F.of(cells(lim)[0], page.number)
        else:
            row["limit_desc"] = F(lim_text, page.number, lim_text, lim_bbox)
        out.extra["top10"].append(row)
    if not out.extra["top10"]:
        out.unplaced.append(("top10_obligor", "rows", page.number))


def parse_aging(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["aging"]
    page = _find(doc, sec["heading"])
    if page is None:
        out.unplaced.append(("aging", "*", None))
        return
    out.source_pages[sec["source_page_key"]] = page.number
    lines = _lines_after(page, sec["heading"])
    v = _pick_variant(sec["variants"], _header(lines))
    out.extra["aging_variant"] = v
    trx = re.compile(sec["total_row"])
    for l in lines:
        label, cs = row_cells(l)
        if trx.search(norm(label)) and len(cs) == len(v["columns"]):
            out.aging = {c: F.of(cell, page.number) for c, cell in zip(v["columns"], cs)}
            return
    out.unplaced.append(("aging", "total", page.number))


def parse_aggregate(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["aggregate_performance"]
    page = _find(doc, sec["heading"])
    if page is None:
        out.unplaced.append(("aggregate_performance", "*", None))
        return
    out.source_pages[sec["source_page_key"]] = page.number
    lines = _lines_after(page, sec["heading"], sec["end"])
    v = _pick_variant(sec["variants"], _header(lines))
    for l in lines:
        toks = l.tokens
        if not toks or not is_month(toks[0].text) or not _all_numeric(toks[1:]):
            continue
        _, cs = row_cells(l, 1)
        npct = sum(1 for i in v["pick"].values() if i < 0)
        if len(cs) < len(v["pick"]) or not all(c.is_pct for c in cs[-npct:]):
            out.notes.append(f"aggregate_performance: {toks[0].text} has {len(cs)} cells")
            continue
        row = {"month": F(toks[0].text, page.number, toks[0].text, toks[0].bbox)}
        row.update({k: F.of(cs[i], page.number) for k, i in v["pick"].items()})
        out.aggregate.append(row)
    if not out.aggregate:
        out.unplaced.append(("aggregate_performance", "rows", page.number))


def parse_cnl(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["cumulative_losses"]
    out.extra["cnl_rows"], out.extra["cnl_summary"] = [], []
    page = _find(doc, sec["heading"])
    if page is None:
        out.unplaced.append(("cumulative_losses", "*", None))
        return
    out.source_pages[sec["source_page_key"]] = page.number
    lines = _lines_after(page, sec["heading"])
    out.extra["cnl_variant"] = _pick_variant(sec["variants"], _header(lines))
    cols, trx = sec["columns"], re.compile(sec["total_row"])
    period = sec["period"]
    srx = re.compile(sec["summary_row"].replace("{period}", period))
    rrx = re.compile(sec["tranche_row"].replace("{period}", period))
    anchors = None
    for l in lines:
        label, cs = row_cells(l)
        if trx.search(norm(label)):
            cs = _fold_to_count(cs, len(cols))
            if len(cs) == len(cols):
                anchors = [_edge(c) for c in cs]
            break
    if anchors is None:
        out.unplaced.append(("cumulative_losses", "total", page.number))
        return
    for l in lines:
        toks = list(l.tokens)
        # the annual-period summary down the right-hand side
        for k in range(len(toks)):
            m = srx.fullmatch(" ".join(t.text for t in toks[k:]))
            if m and (k == 0 or toks[k].x0 > anchors[-1]):
                st = toks[k:]
                out.extra["cnl_summary"].append({
                    "period": F(m["period"], page.number, m["period"], [st[0].x0, st[0].top, st[-1].x1, st[-1].bottom]),
                    "range": F(re.sub(r"\s+", "", m["range"]), page.number, m["range"], None),
                    "ratio": F.of(cells([st[-1]])[0], page.number)})
                toks = toks[:k]
                break
        m = rrx.match(" ".join(t.text for t in toks) + " ")
        if not m:
            continue
        nlab = 2 + len(m["period"].split())
        # cells right of the last column belong to the summary down the right-hand side
        vals = [t for t in _drop_overlaps(toks[nlab:]) if t.x0 <= anchors[-1]]
        if not _all_numeric(vals):
            continue
        placed = _place(cells(vals, left_edge=toks[nlab - 1].x1), anchors) if vals else [None] * len(cols)
        if placed is None:
            out.unplaced.append(("cumulative_losses", f"tranche {m['tranche']}", page.number))
            continue
        row = {"tranche": int(m["tranche"]), "period": m["period"],
               "label": F(m["tranche"], page.number, l.text, l.bbox)}
        row.update({c: F.of(cell, page.number) for c, cell in zip(cols, placed) if cell is not None})
        out.extra["cnl_rows"].append(row)
    if not out.extra["cnl_rows"] or not out.extra["cnl_summary"]:
        out.unplaced.append(("cumulative_losses", "rows", page.number))


def parse_borrower(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["borrower_ratios"]
    page = _find(doc, sec["heading"])
    if page is not None:
        out.source_pages[sec["source_page_key"]] = page.number
        mapper.parse_borrower(doc, tpl, out)


def parse_tests(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["quantitative_tests"]
    out.extra["clean_up_footnote"] = None
    page = _find(doc, sec["heading"])
    if page is None:
        out.unplaced.append(("quantitative_tests", "*", None))
        return
    out.source_pages[sec["source_page_key"]] = page.number
    trx, prx = re.compile(sec["test_row"]), re.compile(sec["ref_prefix_line"])
    frx = re.compile(sec["clean_up"]["footnote"])
    cats = {norm(k): v for k, v in sec["categories"].items()}
    category, cur = None, None
    for l in _lines_after(page, sec["heading"]):
        text = re.sub(r"\s+", " ", l.text).strip()
        t = norm(text)
        head = next((v for k, v in cats.items() if t.startswith(k)), None)
        if head:
            category, cur = head, None
            continue
        fm = frx.search(t)
        if fm:
            out.extra["clean_up_footnote"] = F(fm["list"], page.number, l.text, l.bbox)
            cur = None
            continue
        m = trx.match(text)
        if m:
            ref = re.sub(r"(\d)\(", r"\1 (", re.sub(r"\s+", " ", m["ref"])).strip()
            cur = {"ref": ref, "desc": m["desc"].strip(), "answer": m["answer"].upper(), "category": category,
                   "conditional": [], "page": page.number, "bbox": l.bbox, "raw": l.text}
            out.tests.append(cur)
            continue
        if cur is not None and prx.match(t) and not re.match(r"^[A-Z]", cur["ref"]):
            cur["ref"] = f"{t} {cur['ref']}"
            cur["raw"] += "\n" + l.text
            continue
        if cur is not None and not t.startswith("*") and not re.fullmatch(r"\d+", t):
            cur["desc"] = f"{cur['desc']} {text}"     # wrapped description line
            cur["raw"] += "\n" + l.text
        else:
            cur = None
    if not out.tests:
        out.unplaced.append(("quantitative_tests", "rows", page.number))


PARSERS = [parse_cover, parse_balances, parse_contracts, parse_amounts, parse_program, parse_warehouse,
           parse_enhancement, parse_required, parse_top10, parse_aging, parse_aggregate, parse_cnl, parse_borrower,
           parse_tests]


def parse(pages: list[Page], page_count: int, tpl: dict) -> Parsed:
    doc = Doc(pages)
    out = Parsed(template=tpl, page_count=page_count)
    for fn in PARSERS:
        try:
            fn(doc, tpl, out)
        except Exception as e:     # a broken section must not sink the rest; it is reported as unplaced
            log.exception("section parser %s failed", fn.__name__)
            out.unplaced.append((fn.__name__.replace("parse_", ""), "*", None))
            out.notes.append(f"{fn.__name__}: {type(e).__name__}: {e}")
    return out


# ---------------------------------------------------------------- building
class _W:
    """Write the same value to several deal paths (tranche_balance and the current period_history row carry the
    same totals)."""

    def __init__(self, rec: Recorder):
        self.rec = rec

    def read(self, ptrs, f: Optional[F]):
        for p in ([ptrs] if isinstance(ptrs, str) else ptrs):
            self.rec.read(p, f)

    def derived(self, ptrs, value, formula: str, inputs: Iterable[Optional[F]] = ()):
        ins = _ins(inputs)
        for p in ([ptrs] if isinstance(ptrs, str) else ptrs):
            self.rec.derived(p, value, formula, ins)


def _source_file(name: str, tpl: dict) -> str:
    p = Path(name)
    spec = tpl["source_file"]
    return re.sub(spec["replace"], spec["with"], p.stem) + p.suffix


def build(p: Parsed, rec: Recorder, *, prior: dict | None = None, partial: bool = False) -> dict:
    tpl, der = p.template, p.template["derived"]
    tid = tpl["template_id"]
    prior_deal = (prior or {}).get("deal") if prior and "deal" in prior else prior
    w = _W(rec)

    # ---------------- identity and periods
    cov = p.cover
    period = coll_label = None
    if "title" in cov:
        title = re.sub(r"\s+", " ", cov["title"].value).strip()
        name = tpl["program"]["deal_name_format"].format(title=title)
        rec.derived("/deal_name", name, f"cover title ({tid})", [cov["title"]])
        rec.derived("/deal_slug", slugify(name), "slug(deal_name)", [cov["title"]])
    elif not partial:
        rec.read("/deal_name", None)
        rec.read("/deal_slug", None)
    if not partial or p.source_file:
        rec.const("/source_file", _source_file(p.source_file, tpl), "uploaded file name, characters outside [A-Za-z0-9_-] -> _")
    if "settlement_date" in cov:
        rec.read("/settlement_date", cov["settlement_date"])
    elif not partial:
        rec.read("/settlement_date", None)
    if "collection_start" in cov:
        d = parse_long_date(cov["collection_start"].value)
        period, coll_label = _ym(d), d.strftime("%B %Y")
        rec.derived("/collection_period", coll_label, "month of Collection Period Start Date (cover)", [cov["collection_start"]])
        rec.derived("/prior_period", _prev_month(period), "collection period - 1 month", [cov["collection_start"]])
    elif not partial:
        rec.read("/collection_period", None)
        rec.read("/prior_period", None)
    if not partial:
        rec.const("/terminology", tpl.get("terminology"), "terminology (none for this layout)")
        for k in ["tranche_balance", "tranche_amounts", "outstanding_contracts", "funding_costs", "enhancement",
                  "top10_obligor", "aging_summary", "aggregate_performance", "cumulative_losses",
                  "quantitative_tests", "financial_ratios"]:
            rec.const(f"/source_pages/{k}", p.source_pages.get(k), "page where the section heading was found")
        rec.const("/watch_buffer_pct", der["watch_buffer_pct"], "derived.watch_buffer_pct")
        rec.empty("/ratio_test_detail", "dict")
        for k in ("restatements", "balance_discontinuities"):
            rec.empty(f"/{k}")

    ph, tb = "/period_history/0", "/tranche_balance"
    bal = p.extra.get("balance") or {}
    bt = bal.get("total") or {}
    sec_b = tpl["sections"]["tranche_balance"]

    # ---------------- tranche balance (page totals) and the current period_history row
    if bt:
        cols = bal["columns"]
        o, c = bt.get("opening"), bt.get("closing")
        w.read([f"{tb}/opening", f"{ph}/opening_balance"], o)
        w.read([f"{tb}/closing", f"{ph}/closing_balance"], c)
        rec.derived(f"{tb}/change_abs", _v(c) - _v(o), "closing - opening", [c, o])
        rec.derived(f"{tb}/change_pct", (_v(c) - _v(o)) / _v(o) if _v(o) else None, "(closing - opening) / opening", [c, o])
        for key, cs in sec_b["period_fields"].items():
            fs = [bt.get(x) for x in cs if x in cols]
            if len(fs) == 1:
                w.read([f"{tb}/{key}", f"{ph}/{key}"], fs[0])
            else:
                w.derived([f"{tb}/{key}", f"{ph}/{key}"], _sum(fs), " + ".join(cs) + " (Pool Balances row)", fs)
        for k in ("by_currency", "activity_by_currency"):
            w.rec.const(f"{tb}/{k}", None, "single-currency facility")
            w.rec.const(f"{ph}/{k}", None, "single-currency facility")
        rec.const(f"{ph}/amount_by_currency", None, "single-currency facility")
        # R05 terms: printed extra roll-forward columns, and the signed NBV adjustment split into its parts
        for key, col in sec_b["extra_terms"].items():
            if col in cols:
                rec.read(f"{ph}/{key}", bt.get(col))
        adj = bt.get("adjustment")
        down, up = (-_v(adj), 0.0) if _v(adj) < 0 else (0.0, _v(adj))
        w.derived([f"{tb}/charge_off", f"{ph}/charge_off"], down,
                  "NBV Adjustment (+/-): decrease as a positive amount", [adj])
        w.derived([f"{tb}/adjustment_increase", f"{ph}/adjustment_increase"], up,
                  "NBV Adjustment (+/-): increase as a positive amount", [adj])
        _tranches(p, rec, bal, der)
    elif not partial:
        for key in ("opening", "closing", "principal", "principal_prepayments", "losses", "interest", "recoveries",
                    "change_abs", "change_pct", "charge_off"):
            rec.read(f"{tb}/{key}", None)
        rec.const(f"{tb}/by_currency", None, "tranche balance page not found")
        rec.const(f"{tb}/activity_by_currency", None, "tranche balance page not found")
        rec.empty(f"{tb}/top_movers")
        rec.empty(f"{tb}/all_tranches")

    if period and (bt or not partial):
        rec.derived(f"{ph}/period", period, "collection period (cover)", [cov["collection_start"]])
        rec.derived(f"{ph}/collection_period", coll_label, "collection period (cover)", [cov["collection_start"]])

    # ---------------- tranche amounts
    am = p.extra.get("amounts") or {}
    if am:
        w.read(["/tranche_amount/opening", f"{ph}/opening_amount"], am.get("opening"))
        w.read(["/tranche_amount/closing", f"{ph}/closing_amount"], am.get("closing"))
        rec.const("/tranche_amount/by_currency", None, "single-currency facility")
    elif not partial:
        rec.read("/tranche_amount/opening", None)
        rec.read("/tranche_amount/closing", None)
        rec.const("/tranche_amount/by_currency", None, "tranche amounts page not found")

    # ---------------- contracts
    ct = (p.extra.get("contracts") or {})
    ctt = ct.get("total") or {}
    if ctt:
        o, c = ctt.get("opening"), ctt.get("closing")
        w.read(["/contracts/opening", f"{ph}/opening_contracts"], o)
        w.read(["/contracts/closing", f"{ph}/closing_contracts"], c)
        rec.read("/contracts/change_reported", ctt.get("change"))     # as printed; rule R06 closes the count with it
        rec.derived("/contracts/change_abs", _v(c) - _v(o), "closing - opening", [c, o])
        rec.derived("/contracts/change_pct", (_v(c) - _v(o)) / _v(o) if _v(o) else None, "(closing - opening) / opening", [c, o])
        rec.empty("/contracts/top_movers")
        moved = [r for r in ct["rows"] if _v(r.get("change"))]
        moved.sort(key=lambda r: (-abs(_v(r["change"])), r["tranche"].value))
        for i, r in enumerate(moved[:der["top_movers"]["contracts"]]):
            b = f"/contracts/top_movers/{i}"
            rec.read(f"{b}/tranche", r["tranche"])
            for k, cname in (("opening_contracts", "opening"), ("change_contracts", "change"), ("closing_contracts", "closing")):
                if r.get(cname) is not None:
                    rec.read(f"{b}/{k}", r[cname])
                else:
                    rec.derived(f"{b}/{k}", 0.0, "blank cell", [r["tranche"]])
        prior_cc = ((prior_deal or {}).get("contracts") or {}).get("closing") if prior_deal else None
        if prior_cc is not None:
            rec.derived("/prior_closing_contracts", prior_cc, "prior published extraction: contracts.closing")
        else:
            rec.read("/prior_closing_contracts", o)
    elif not partial:
        for k in ("opening", "closing", "change_abs", "change_pct"):
            rec.read(f"/contracts/{k}", None)
        rec.empty("/contracts/top_movers")
        rec.read("/prior_closing_contracts", None)

    # ---------------- program, warehouse, enhancement
    pr = p.extra.get("program") or {}
    if pr or not partial:
        lim, amt = pr.get("program_limit"), pr.get("program_amount")
        rec.read("/program/program_limit", lim)
        if amt is not None:
            rec.read("/program/program_amount", amt)
        elif am.get("opening") is not None:
            amt = am["opening"]
            rec.derived("/program/program_amount", amt.value, "no Program Amount line: opening tranche amount", [amt])
        else:
            rec.read("/program/program_amount", None)
        if pr.get("unused_facility") is not None:
            rec.read("/program/unused_facility", pr["unused_facility"])
        elif lim is not None and amt is not None:
            rec.derived("/program/unused_facility", lim.value - amt.value, "program limit - program amount", [lim, amt])
        else:
            rec.read("/program/unused_facility", None)
        if lim is not None and amt is not None and lim.value:
            rec.derived("/program/program_utilization_pct", round(amt.value / lim.value, der["program_utilization_round"]),
                        "program amount / program limit", [amt, lim])
        else:
            rec.read("/program/program_utilization_pct", None)
        rec.read("/program/maximum_program_limit", pr.get("maximum_program_limit"))
    wh = p.extra.get("warehouse")
    if wh is None and not partial:
        rec.const("/warehouse", None, "this facility has no warehouse advances table")
    elif wh is not None and (wh or not partial):
        rec.read("/warehouse/opening_advances_outstanding", wh.get("opening"))
        rec.read("/warehouse/closing_advances_outstanding", wh.get("closing"))
        rec.read("/warehouse/maximum_warehouse_facility_limit", pr.get("maximum_warehouse_limit"))
    en = p.enhancement
    if en or not partial:
        rec.read("/total_enhancement/total_enhancement_amount", en.get("total_amount"))
        rec.read("/total_enhancement/total_enhancement_pct", en.get("total_pct"))

    # ---------------- top 10 obligors
    if p.extra.get("top10") or not partial:
        rec.empty("/top10_obligors")
    for i, r in enumerate(p.extra.get("top10") or []):
        b = f"/top10_obligors/{i}"
        rec.read(f"{b}/rank", r["rank"])
        rec.read(f"{b}/obligor_name", r["name"])
        rec.read(f"{b}/aggregate_contract_amount", r["amount"])
        rec.read(f"{b}/obligor_concentration_pct", r["concentration_pct"])
        if "limit_pct" in r:
            rec.read(f"{b}/concentration_limit_pct", r["limit_pct"])
        else:
            rec.read(f"{b}/concentration_limit_desc", r["limit_desc"])
        rec.read(f"{b}/concentration_limit_per_obligor", r["limit_per_obligor"])
        rec.read(f"{b}/excess_concentration_amount", r["excess"])

    # ---------------- aging_history: the current period's row
    ag = p.aging
    if ag and (period or partial):
        v = p.extra.get("aging_variant") or {}
        b = "/aging_history/0"
        if period:
            rec.derived(f"{b}/period", period, "collection period (cover)", [cov["collection_start"]])
            rec.derived(f"{b}/collection_period", coll_label, "collection period (cover)", [cov["collection_start"]])
        rec.const(f"{b}/tranche_rows", None, "per-tranche aging rows are not carried for this layout")
        for k in ("current_0_30", "days_31_60", "days_61_90"):
            if k in ag:
                rec.read(f"{b}/{k}", ag[k])
            else:
                rec.derived(f"{b}/{k}", 0.0, f"no {k} column in this aging layout ({v.get('name')})", [ag.get("closing")])
        label = v.get("written_off_bucket_label") or tpl["sections"]["aging"]["written_off_bucket_label"]
        rec.const(f"{b}/written_off_bucket_label", label, "aging variant bucket label")
        rec.read(f"{b}/written_off", ag.get("days_91_plus"))
        rec.read(f"{b}/cumulative_net_losses", ag.get("cumulative_losses"))
        rec.read(f"{b}/closing_balance", ag.get("closing"))
        if "payment_deferral" in ag:
            rec.read(f"{b}/payment_deferral", ag["payment_deferral"])
        bk = [ag.get(k) for k in ("current_0_30", "days_31_60", "days_61_90")]
        s3, wo, cl = _sum(bk), _v(ag.get("days_91_plus")), ag.get("closing")
        rec.derived(f"{b}/bucket_sum", s3, "current + 31-60 + 61-90", bk)
        rec.derived(f"{b}/bucket_sum_with_writeoff", s3 + wo, "bucket_sum + written-off bucket", bk + [ag.get("days_91_plus")])
        tol = der["reconcile_tolerance"]
        ok = cl is not None and (abs(s3 - cl.value) <= tol or abs(s3 + wo - cl.value) <= tol)
        rec.derived(f"{b}/reconciles", bool(ok), f"bucket sum (with or without written-off) within {tol} of closing", bk + [cl])
    elif not partial:
        rec.empty("/aging_history")

    if not partial and not bt and not period:
        rec.empty("/period_history")

    # ---------------- ratio history
    s = Series(p)
    cur_month = p.aggregate[0]["month"].value if p.aggregate else None
    if p.aggregate or p.borrower or not partial:
        rec.empty("/ratio_history")
        months = [m for m in s.months if any(isinstance(v, F) for v in s.rows[m].values())]
        for i, m in enumerate(months):
            row = s.rows[m]
            mf = row.get("_month") or next(iter(v for k, v in row.items() if isinstance(v, F)))
            rec.read(f"/ratio_history/{i}/month", F(m, mf.page, m, mf.bbox if mf.value == m else None))
            for key, series in tpl["ratio_history_fields"].items():
                if series in row:
                    rec.read(f"/ratio_history/{i}/{key}", row[series])

    prior_tb = ((prior_deal or {}).get("tranche_balance") or {}).get("closing") if prior_deal else None
    if prior_tb is not None:
        rec.derived("/prior_closing_tranche_balance", prior_tb, "prior published extraction: tranche_balance.closing")
    elif cur_month:
        # the aggregate table's newest row is the collection month; the row before it is the prior closing
        rec.read("/prior_closing_tranche_balance", s.at("portfolio_balance", _prev_mon_yy(cur_month)))
    elif not partial:
        rec.read("/prior_closing_tranche_balance", None)

    # ---------------- cumulative losses by annual period
    limit_fn = _cnl_limits(p)
    if p.extra.get("cnl_summary") or not partial:
        _cnl(p, rec, der, limit_fn)

    # ---------------- covenants, summary, financial ratios
    worst = _worst(p, limit_fn)
    if p.tests and cur_month:
        covs = _covenants(p, s, cur_month, worst, der, tpl)
        prior_covs = _covenants(p, s, _prev_mon_yy(cur_month), None, der, tpl, prior_deal=prior_deal, prior_month=True)
        for name, lst in (("covenants", covs), ("prior_covenants", prior_covs)):
            rec.empty(f"/{name}")
            for i, (c, srcs) in enumerate(lst):
                for k, v in c.items():
                    f = srcs.get(k)
                    if isinstance(f, F):
                        rec.read(f"/{name}/{i}/{k}", f)
                    else:
                        rec.derived(f"/{name}/{i}/{k}", v, f"{k} per covenant rules ({tid})", srcs.get("_inputs", []))
        counts = {"BREACH": 0, "WATCH": 0, "OK": 0, "AVAILABLE": 0}
        for c, _ in covs:
            if c["status"] in counts:
                counts[c["status"]] += 1
        ins = [x for _, sr in covs for x in sr.get("_inputs", [])][:1]
        for k, v in counts.items():
            rec.derived(f"/covenant_summary/{k}", v, f"count of covenants with status {k}", ins)
        rec.derived("/worst_status", "BREACH" if counts["BREACH"] else "WATCH" if counts["WATCH"] else "OK",
                    "most severe covenant status", ins)
        rec.empty("/financial_ratios")
        j = 0
        for spec in tpl["financial_ratios"]:
            if spec["series"] == "cnl_worst_vintage":
                if not worst:
                    continue
                f, vintage = worst["ratio"], worst["period"]
            else:
                f, vintage = s.at(spec["series"], cur_month), None
                if f is None:
                    continue
            b = f"/financial_ratios/{j}"
            for k in ("key", "label", "format", "group"):
                rec.const(f"{b}/{k}", spec[k], f"financial_ratios.{spec['key']}")
            rec.read(f"{b}/value", f)
            if vintage is not None:
                rec.read(f"{b}/vintage", vintage)
            j += 1
    elif not partial:
        rec.empty("/covenants")
        rec.empty("/prior_covenants")
        for k in ("BREACH", "WATCH", "OK", "AVAILABLE"):
            rec.const(f"/covenant_summary/{k}", 0, "no quantitative tests extracted")
        rec.read("/worst_status", None)
        rec.empty("/financial_ratios")
    return rec.deal


def _tranches(p: Parsed, rec: Recorder, bal: dict, der: dict):
    """all_tranches (opening/closing per tranche row, printed order) and the top movers by change."""
    tb = "/tranche_balance"

    def amount(r: dict, col: str):
        return ("read", r[col]) if r.get(col) is not None else ("derived", 0.0, "blank cell", [r["tranche"]])

    def val(a) -> float:
        return _v(a[1]) if a[0] == "read" else a[1]

    def write(ptr, a):
        rec.read(ptr, a[1]) if a[0] == "read" else rec.derived(ptr, a[1], a[2], a[3])

    rows = bal["rows"]
    rec.empty(f"{tb}/all_tranches")
    for i, r in enumerate(rows):
        b = f"{tb}/all_tranches/{i}"
        rec.read(f"{b}/tranche", r["tranche"])
        write(f"{b}/opening", amount(r, "opening"))
        write(f"{b}/closing", amount(r, "closing"))
    movers = sorted(rows, key=lambda r: -abs(val(amount(r, "closing")) - val(amount(r, "opening"))))[:der["top_movers"]["tranche"]]
    rec.empty(f"{tb}/top_movers")
    for i, r in enumerate(movers):
        b = f"{tb}/top_movers/{i}"
        rec.read(f"{b}/leasing_date", r.get("date"))
        rec.read(f"{b}/tranche", r["tranche"])
        for k, cname in (("original_tranche_balance", "original"), ("opening_tranche_balance", "opening"),
                         ("original_tranche_yield", "original_yield"),
                         ("current_period_effective_tranche_yield", "effective_yield"),
                         ("closing_tranche_balance", "closing")):
            write(f"{b}/{k}", amount(r, cname))


# ---------------------------------------------------------------- cumulative losses and covenants
def _cnl_test(p: Parsed) -> Optional[dict]:
    for t in p.tests:
        if re.search(r"CNL RATIO|CUMULATIVE NET LOSS RATIO", norm(t["desc"])):
            return t
    return None


def _cnl_limits(p: Parsed):
    """-> fn(period label) -> (limit, is_exception, source F), or None without a CNL test. The base limit is the
    first percentage in the test; a named origination window (template cnl_exception) gets its own limit."""
    t = _cnl_test(p)
    if t is None:
        return None
    pcts = re.findall(r"(\d+(?:\.\d+)?)\s?%", t["desc"])
    if not pcts:
        return None
    src = F(None, t["page"], t["raw"], t["bbox"])
    base = float(pcts[0]) / 100
    m = re.search(p.template["sections"]["quantitative_tests"]["cnl_exception"], norm(t["desc"]))
    exc = None
    if m:
        exc = ((int(m["y1"]), MONTHS[m["m1"][:3]]), (int(m["y2"]), MONTHS[m["m2"][:3]]), float(m["pct"]) / 100)

    def limit(label: str):
        key = _label_start(label)
        if exc and key is not None and exc[0] <= key <= exc[1]:
            return exc[2], True, src
        return base, False, src
    return limit


def _label_start(label: str) -> Optional[tuple[int, int]]:
    """(year, month) of the first month of an annual-period label ("Oct 2017 - Sep 2018", "Dec-14 - Nov-15")."""
    start = re.split(r"\s[-‒–—]\s", label.strip())[0]
    m = re.match(r"([A-Za-z]{3})[A-Za-z]*[- ](\d{4}|\d{2})$", start)
    if not m or m[1].upper() not in MONTHS:
        return None
    y = int(m[2])
    return (y if y > 100 else 2000 + y), MONTHS[m[1].upper()]


def _cnl(p: Parsed, rec: Recorder, der: dict, limit_fn):
    rows, summary = p.extra.get("cnl_rows") or [], p.extra.get("cnl_summary") or []
    v = p.extra.get("cnl_variant") or {}
    keys = v.get("keys") or {}
    rec.empty("/cnl_by_period")
    for i, srow in enumerate(summary):
        lab = _norm_period(srow["period"].value)
        members = [r for r in rows if _norm_period(r["period"]) == lab]
        b = f"/cnl_by_period/{i}"
        rec.read(f"{b}/{keys['period']}", srow["period"])
        rec.read(f"{b}/{keys['range']}", srow["range"])
        labels = [r["label"] for r in members] or [srow["period"]]
        if "trigger" not in keys:
            rec.read(f"{b}/cnl_ratio_pct", srow["ratio"])
        for k, col, what in (("original", "original", "original tranche balance"),
                             ("current_period_losses", "current_period_losses", "current period losses"),
                             ("cumulative_net_losses", "cumulative_net_losses", "cumulative net losses")):
            fs = [r.get(col) for r in members]
            rec.derived(f"{b}/{keys[k]}", round(_sum(fs), 2), f"sum of {what} of the tranches of this annual period",
                        _ins(fs) or labels)
        if "trigger" in keys:
            rec.read(f"{b}/cnl_ratio_pct", srow["ratio"])
        ratio = srow["ratio"].value
        if limit_fn:
            lim, exc, src = limit_fn(srow["period"].value)
            if "trigger" in keys:
                rec.derived(f"{b}/{keys['trigger']}", lim, "CNL ratio limit (quantitative tests page)", [src])
                rec.derived(f"{b}/{keys['spread']}", round(lim - ratio, der["spread_round"]), "trigger - CNL ratio",
                            [srow["ratio"], src])
            rec.derived(f"{b}/cnl_limit", lim, "CNL ratio limit for this period (quantitative tests page)", [src])
            rec.derived(f"{b}/cnl_limit_is_exception", exc, "period named as an exception in the CNL test", [src])
            rec.derived(f"{b}/cnl_within_limit", None if ratio is None else ratio <= lim, "cnl_ratio_pct <= cnl_limit",
                        [srow["ratio"], src])


def _norm_period(s: str) -> str:
    return re.sub(r"\s*[-‒–—]\s*", " - ", re.sub(r"\s+", " ", s)).strip().upper()


def _worst(p: Parsed, limit_fn) -> Optional[dict]:
    best = None
    for r in p.extra.get("cnl_summary") or []:
        v = r["ratio"].value
        if v is None:
            continue
        lim = limit_fn(r["period"].value)[0] if limit_fn else None
        u = v / lim if lim else v
        if best is None or u > best["util"]:
            best = {"util": u, "ratio": r["ratio"], "period": r["period"], "limit": lim}
    return best


def _expand(lst: str) -> list[int]:
    out: list[int] = []
    for a, b in re.findall(r"(\d+)(?:\s*-\s*(\d+))?", lst):
        out += list(range(int(a), int(b) + 1)) if b else [int(a)]
    return out


def _covenants(p: Parsed, s: Series, month: str, worst: Optional[dict], der: dict, tpl: dict,
               prior_deal: dict | None = None, prior_month: bool = False) -> list[tuple[dict, dict]]:
    sec = tpl["sections"]["quantitative_tests"]
    out = []
    for t in p.tests:
        nd = norm(t["desc"])
        test_src = F(None, t["page"], t["raw"], t["bbox"])
        c: dict[str, Any] = {"category": t["category"], "legal_ref": t["ref"], "description": t["desc"]}
        srcs: dict = {"_inputs": [test_src]}
        binary = {"current_value": None, "threshold": None, "kind": "binary", "utilization_pct": None, "trend": "n/a"}
        cu, fg, td = sec["clean_up"], sec["funding_gap"], sec["tranche_differential"]
        if t["category"] == cu["category"]:
            c.update(binary)
            fn = p.extra.get("clean_up_footnote")
            if t["answer"] == "YES" and fn is not None:
                elig = _expand(fn.value)
                start = parse_long_date(p.cover["collection_start"].value) if "collection_start" in p.cover else None
                rows = (p.extra.get("balance") or {}).get("rows") or []
                total = sum(1 for r in rows if start is None or _tranche_date(r["date"].value) < start)
                c["description"] = cu["description"].format(desc=t["desc"], n=len(elig), total=total)
                c.update({"current_value": len(elig), "status": "AVAILABLE",
                          "note": cu["note"].format(list=", ".join(str(x) for x in elig))})
                srcs["_inputs"] = [fn, test_src]
            else:
                c.update({"status": "BREACH" if t["answer"] == "YES" else "OK", "note": None})
        elif t["category"] == fg["category"]:
            c.update(binary)
            gap = ((p.cover.get("funding_gap") or F(None, 1, "")).value or "").upper()
            c.update({"status": "AVAILABLE" if gap == "YES" else "OK", "note": fg["note"] if gap == "YES" else None})
            if p.cover.get("funding_gap") is not None:
                srcs["_inputs"] = [p.cover["funding_gap"], test_src]
        elif re.search(td["match"], nd):
            c.update(binary)
            req = p.extra.get("required_rows") or []
            diffs = [(round(_v(r.get("closing")) - _v(r.get("required")), 2), r) for r in req]
            val = min(diffs, key=lambda x: x[0]) if diffs else None
            c.update({"current_value": val[0] if val else None, "threshold": 0,
                      "status": "BREACH" if t["answer"] == "YES" else "OK",
                      "note": td["note"].format(value=f"{val[0]:,.2f}") if val else None})
            if val:
                srcs["_inputs"] = [val[1]["closing"], val[1]["required"], test_src]
        else:
            metric = next((m for m in sec["metrics"] if re.search(m["match"], nd)), None)
            if metric is None or metric.get("series") is None:
                pc = re.findall(r"(\d+(?:\.\d+)?)\s?%", t["desc"])
                dollars = re.search(r"\$\s?([\d,]+(?:\.\d+)?)", t["desc"])
                thr = float(pc[0]) / 100 if pc else (float(dollars.group(1).replace(",", "")) if dollars else None)
                c.update(binary)
                c.update({"threshold": thr, "status": "BREACH" if t["answer"] == "YES" else "OK", "note": sec["binary_note"]})
            else:
                series, kind = metric["series"], metric["kind"]
                if series == "cnl_worst_vintage":
                    if worst is not None:
                        vf, v, wv, thr = worst["ratio"], worst["ratio"].value, worst["period"].value, worst["limit"]
                    else:   # the prior period's CNL is not on this report; from the prior extraction when supplied
                        pc = next((x for x in (prior_deal or {}).get("covenants", []) if x.get("legal_ref") == t["ref"]), None)
                        vf, v, wv, thr = None, (pc or {}).get("current_value"), (pc or {}).get("worst_vintage"), (pc or {}).get("threshold")
                    trend = "n/a"
                else:
                    vf, pf = s.asof(series, month), s.asof(series, _prev_mon_yy(month))
                    v = None if vf is None else vf.value
                    thr, _ = _threshold(t, series, s, month, worst)
                    trend = _trend(v, None if pf is None else pf.value, der["trend_flat_band"])
                util = None
                if v is not None and thr:
                    util = round(v / thr, der["utilization_round"]) if kind == "ceiling" else \
                        (round(thr / v, der["utilization_round"]) if v else None)
                c.update({"current_value": v, "threshold": thr, "kind": kind, "utilization_pct": util, "trend": trend,
                          "status": _status(v, thr, kind, der["watch_buffer_pct"], prior_month), "note": None})
                if series == "cnl_worst_vintage":
                    c["worst_vintage"] = wv
                if vf is not None:
                    srcs["current_value"] = vf
                    srcs["_inputs"] = [vf, test_src]
        c["reported_triggered"] = t["answer"]
        out.append((c, srcs))
    return out


def _tranche_date(s: str):
    from datetime import datetime
    return datetime.strptime(s, "%d-%b-%y").date()
