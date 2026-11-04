"""Engine for MOVE settlement reports with a sub-servicer and a performance guarantor (template
move-trust-settrep-guarantor-v1).

One tranche-balance page (blank cells common; signed adjustment column), contracts, tranche amounts, funding costs,
cash / OC enhancement with a required-tranche-balance table, top 10 obligors, aging, aggregate performance with a
residual-value-loss (RVL) table on the lease reports, cumulative losses with a calendar-period summary, servicer /
seller and guarantor ratio tables, and quantitative tests under a Master Lease Agreement or a Purchase Agreement.

Everything document-specific (headings, columns, labels, formulas, constants) is in the template. Table cells are
placed under their column by right edge, using a row that prints every column (the totals row) as anchors.

parse(pages, page_count, tpl) -> mapper.Parsed; build(parsed, recorder, *, prior=None, partial=False).
"""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Iterable, Optional

from ..derive import Series, _month_key, _prev_mon_yy, _prev_month, _status, _trend, _ym, parse_long_date, slugify
from ..mapper import F, Doc, Parsed, parse_cover
from ..parse import DASHES, Cell, _edge, align_columns, cells, is_month, is_number, parse_number, row_cells
from ..provenance import Recorder
from ..text import Line, Page, Token, norm

log = logging.getLogger("extract.guarantor")

PLACE_TOL = 4.0     # x text height: a cell further than this from every column anchor is not in the table
NULLS = {"n.a.", "N.A.", "n/a"}


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


def _value_token(t: Token) -> bool:
    return is_number(t.text) or t.text in DASHES or t.text in NULLS


def _all_values(toks: list[Token]) -> bool:
    return bool(toks) and all(_value_token(t) for t in toks)


def _cells(toks: list[Token], left_edge: float | None = None) -> list[Cell]:
    """cells() plus the null marker 'n.a.' (value None)."""
    out: list[Cell] = []
    run: list[Token] = []
    edge = left_edge
    for t in toks + [None]:
        if t is None or t.text in NULLS:
            if run:
                out += cells(run, left_edge=edge)
                edge = run[-1].x1
                run = []
            if t is not None:
                out.append(Cell(t.text, None, Token.bbox.fget(t)))
                edge = t.x1
        else:
            run.append(t)
    return out


def _place(cs: list[Cell], anchors: list[float]) -> Optional[list[Optional[Cell]]]:
    """Each cell under the column anchor nearest its right edge. None when two cells claim one column or a cell
    is far from every anchor."""
    out: list[Optional[Cell]] = [None] * len(anchors)
    for c in cs:
        e, h = _edge(c), c.bbox[3] - c.bbox[1]
        i = min(range(len(anchors)), key=lambda k: abs(anchors[k] - e))
        if out[i] is not None or abs(anchors[i] - e) > PLACE_TOL * h:
            return None
        out[i] = c
    return out


def _v(f: Optional[F]) -> float:
    return 0.0 if f is None or f.value is None else f.value


def _sum(fs: Iterable[Optional[F]]) -> float:
    return sum(_v(f) for f in fs)


def _ins(fs: Iterable[Optional[F]]) -> list[F]:
    return [f for f in fs if f is not None]


def _months_between(a: str, b: str) -> int:
    (ya, ma), (yb, mb) = _month_key(a), _month_key(b)
    return (yb - ya) * 12 + (mb - ma)


def _labelled(line: Line, rx: re.Pattern, page: int) -> Optional[F]:
    """'LABEL ... 1,234.56 trailing-letter': the label is the text before the first value token; a dash followed
    by a number in a one-value line is that number's sign ("- 0.00" -> -0.0)."""
    toks = line.tokens
    k = next((i for i, t in enumerate(toks) if _value_token(t)), None)
    if k is None or not rx.search(norm(" ".join(t.text for t in toks[:k]))):
        return None
    t = toks[k]
    nxt = toks[k + 1] if k + 1 < len(toks) else None
    if t.text in DASHES and nxt is not None and is_number(nxt.text) and nxt.text not in DASHES:
        v = parse_number(nxt.text)
        return F(-v if v is not None else None, page, f"{t.text} {nxt.text}", [round(t.x0, 2), round(t.top, 2),
                                                                                   round(nxt.x1, 2), round(nxt.bottom, 2)])
    c = cells([t])[0]
    return F.of(c, page)


def _labelled_values(lines: list[Line], spec: dict, page: int) -> dict:
    got = {}
    for key, pat in spec.items():
        rx = re.compile(pat)
        for l in lines:
            f = _labelled(l, rx, page)
            if f is not None:
                got[key] = f
                break
    return got


def _find(doc: Doc, sec: dict, key: str, out: Parsed) -> Optional[Page]:
    hit = doc.find(sec["heading"], sec.get("page_hint"))
    if not hit:
        out.unplaced.append((key, "*", None))
        return None
    page = hit[0]
    if sec.get("source_page_key"):
        out.source_pages[sec["source_page_key"]] = page.number
    for k in sec.get("also_source_page_keys", []):
        out.source_pages[k] = page.number
    return page


# ---------------------------------------------------------------- parsing
def parse_balances(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["tranche_balance"]
    date_rx = re.compile(tpl["dates"]["tranche_date"])
    page = _find(doc, sec, "tranche_balance", out)
    out.extra["balance"] = None
    if page is None:
        return
    lines = _lines_after(page, sec["heading"])
    pre_cols, ycols, post_cols = sec["columns_before_yields"], sec["yield_columns"], sec["columns_after_yields"]
    res: dict[str, Any] = {"page": page.number, "total": {}, "rows": [], "interest_columns": None}

    first_row = next((i for i, l in enumerate(lines) if l.tokens and date_rx.match(l.tokens[0].text)), len(lines))
    header = re.sub(r"\s", "", norm(" ".join(l.text for l in lines[:first_row])))
    for v in sec["effective_yield_income"]:
        if re.sub(r"\s", "", v["formula"]) in header:
            res["interest_columns"] = v["columns"]
            res["interest_formula"] = F(v["formula"], page.number, v["formula"], None)
            break
    if res["interest_columns"] is None:
        out.unplaced.append(("tranche_balance", "effective_yield_formula", page.number))
        out.notes.append("tranche_balance: no effective-yield formula of the template found in the page-2 header")

    trx = re.compile(sec["total_row"])
    anchors_pre = anchors_post = None
    for l in lines:
        label, cs = row_cells(l)
        if not trx.search(norm(label)):
            continue
        k = next((i for i, c in enumerate(cs) if c.is_pct), None)
        if k is None or len(cs[:k]) != len(pre_cols) or len(cs[k + 1:]) != len(post_cols):
            out.notes.append(f"tranche_balance p.{page.number}: totals row has {len(cs)} cells")
            continue
        res["total"] = {c: F.of(cell, page.number) for c, cell in zip(pre_cols, cs[:k])}
        res["total"][ycols[-1]] = F.of(cs[k], page.number)
        res["total"].update({c: F.of(cell, page.number) for c, cell in zip(post_cols, cs[k + 1:])})
        anchors_pre, anchors_post = [_edge(c) for c in cs[:k]], [_edge(c) for c in cs[k + 1:]]
        break
    if not res["total"]:
        out.unplaced.append(("tranche_balance", "total", page.number))
        out.extra["balance"] = res
        return
    for l in lines:
        toks = l.tokens
        if len(toks) < 3 or not date_rx.match(toks[0].text) or not toks[1].text.isdigit() or not _all_values(toks[2:]):
            continue
        cs = _cells(toks[2:], left_edge=toks[1].x1)
        pk = [j for j, c in enumerate(cs) if c.is_pct]
        pre, post = (cs[:pk[0]], cs[pk[-1] + 1:]) if pk else (cs, [])
        a, b = _place(pre, anchors_pre), _place(post, anchors_post)
        if a is None or b is None:
            out.notes.append(f"tranche_balance p.{page.number}: tranche {toks[1].text} cells do not fit the columns")
            out.unplaced.append(("tranche_balance", f"tranche {toks[1].text}", page.number))
            continue
        row: dict[str, Any] = {"tranche": F(int(toks[1].text), page.number, toks[1].text, toks[1].bbox),
                               "date": F(toks[0].text, page.number, toks[0].text, toks[0].bbox)}
        row.update({c: F.of(cell, page.number) for c, cell in zip(pre_cols, a) if cell is not None})
        row.update({c: F.of(cell, page.number) for c, cell in zip(post_cols, b) if cell is not None})
        ys = [cs[j] for j in pk]
        for c, cell in zip(ycols[-len(ys):] if ys else [], ys[-len(ycols):]):
            row[c] = F.of(cell, page.number)
        res["rows"].append(row)
    out.extra["balance"] = res


def _count_cells(toks: list[Token]) -> Optional[list[Cell]]:
    """opening, change, closing of a contracts row. The change column is printed signed ("-11", "(4)"), as a
    decrease ("156"), as a zero-dash, or as a sign and a number ("- 3"); its cells are not aligned with the totals
    row on every report, so the first and last tokens are the opening and closing and the rest is the change."""
    if len(toks) < 3:
        return None
    mid = toks[1:-1]
    if len(mid) == 1:
        ch = cells(mid)[0]
    elif len(mid) == 2 and mid[0].text in DASHES and is_number(mid[1].text) and mid[1].text not in DASHES:
        v = parse_number(mid[1].text)
        ch = Cell("-" + mid[1].text, None if v is None else -v, [mid[0].x0, mid[0].top, mid[1].x1, mid[1].bottom])
    else:
        return None
    return [cells([toks[0]])[0], ch, cells([toks[-1]])[0]]


def parse_contracts(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["outstanding_contracts"]
    page = _find(doc, sec, "outstanding_contracts", out)
    out.extra["contracts"] = None
    if page is None:
        return
    res: dict[str, Any] = {"page": page.number, "total": {}, "rows": []}
    trx = re.compile(sec["total_row"])
    for l in _lines_after(page, sec["heading"]):
        toks = l.tokens
        if toks and toks[0].text.isdigit() and _all_values(toks[1:]):
            k = 1                       # tranche row: "116 5 - 3 2"
        else:                           # totals row: "Contract Totals: 168 -11 157"
            k = next((i for i, t in enumerate(toks) if _value_token(t)), None)
            if not k or not _all_values(toks[k:]) or not trx.search(norm(" ".join(t.text for t in toks[:k]))):
                continue
            cs = _count_cells(toks[k:])
            if cs is None:
                out.unplaced.append(("outstanding_contracts", "total", page.number))
            else:
                res["total"] = {c: F.of(cell, page.number) for c, cell in zip(sec["columns"], cs)}
            continue
        cs = _count_cells(toks[k:])
        if cs is None:
            out.unplaced.append(("outstanding_contracts", f"tranche {toks[0].text}", page.number))
            continue
        row = {"tranche": F(int(toks[0].text), page.number, toks[0].text, toks[0].bbox)}
        row.update({c: F.of(cell, page.number) for c, cell in zip(sec["columns"], cs)})
        res["rows"].append(row)
    if not res["total"]:
        out.unplaced.append(("outstanding_contracts", "total", page.number))
    out.extra["contracts"] = res


def parse_amounts(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["tranche_amounts"]
    page = _find(doc, sec, "tranche_amounts", out)
    out.extra["amounts"] = None
    if page is None:
        return
    trx = re.compile(sec["total_row"])
    for l in _lines_after(page, sec["heading"]):
        label, cs = row_cells(l)
        if trx.search(norm(label)) and len(cs) == len(sec["columns"]):
            out.extra["amounts"] = {c: F.of(cell, page.number) for c, cell in zip(sec["columns"], cs)}
            return
    out.unplaced.append(("tranche_amounts", "total", page.number))


def parse_program(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["program"]
    page = _find(doc, sec, "program", out)
    out.extra["program"] = {}
    if page is None:
        return
    out.extra["program"] = _labelled_values(_lines_after(page, sec["heading"]), sec["lines"], page.number)
    for k in sec["lines"]:
        if k not in out.extra["program"]:
            out.unplaced.append(("program", k, page.number))


def parse_enhancement(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["enhancement"]
    page = _find(doc, sec, "enhancement", out)
    out.extra["deferred"] = {}
    if page is None:
        return
    for n in range(page.number, page.number + sec["search_pages_after_heading"] + 1):
        if n in doc.pages:
            for k, f in _labelled_values(doc.pages[n].lines, sec["lines"], n).items():
                out.enhancement.setdefault(k, f)
    for k in sec["lines"]:
        if k not in out.enhancement:
            out.unplaced.append(("enhancement", k, page.number))
    out.extra["deferred"] = _labelled_values(_lines_after(page, sec["heading"]), sec["deferred_lines"], page.number)


def parse_required(doc: Doc, tpl: dict, out: Parsed):
    """Required tranche balance per tranche (OC pages); every row prints all its columns (zero-dashes)."""
    sec = tpl["sections"]["required_tranche_balance"]
    out.extra["required"] = []
    hit = doc.find(sec["heading"])
    if not hit:
        return
    page = hit[0]
    cols = sec["columns"]
    for l in _lines_after(page, sec["heading"]):
        toks = l.tokens
        if len(toks) < 2 or not toks[0].text.isdigit() or not _all_values(toks[1:]):
            continue
        cs = cells(toks[1:], left_edge=toks[0].x1)
        if len(cs) != len(cols):
            out.unplaced.append(("required_tranche_balance", f"tranche {toks[0].text}", page.number))
            continue
        row = {"tranche": F(int(toks[0].text), page.number, toks[0].text, toks[0].bbox)}
        row.update({c: F.of(cell, page.number) for c, cell in zip(cols, cs)})
        out.extra["required"].append(row)


def parse_top10(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["top10_obligor"]
    out.extra["top10"] = []
    page = _find(doc, sec, "top10_obligor", out)
    if page is None:
        return
    lines = _lines_after(page, sec["heading"], sec["end"])
    first = next((i for i, l in enumerate(lines) if l.tokens and l.tokens[0].text.isdigit()), len(lines))
    header = norm(" ".join(l.text for l in lines[:first]))
    var = next(v for v in sec["variants"] if all(k in header for k in v["when_header_has"]))
    cols = var["columns"]
    n = len(cols)
    for l in lines[first:]:
        toks = l.tokens
        if len(toks) < n + 2 or not toks[0].text.isdigit() or not _all_values(toks[-n:]):
            continue
        vals, name = toks[-n:], toks[1:-n]
        cs = [Cell(t.text, None, Token.bbox.fget(t)) if t.text in NULLS else cells([t])[0] for t in vals]
        row = {"rank": F(int(toks[0].text), page.number, toks[0].text, toks[0].bbox),
               "name": F(" ".join(t.text for t in name), page.number, l.text, l.bbox)}
        row.update({c: F.of(cell, page.number) for c, cell in zip(cols, cs) if c})
        out.extra["top10"].append(row)
    if not out.extra["top10"]:
        out.unplaced.append(("top10_obligor", "rows", page.number))


def parse_aging(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["aging"]
    page = _find(doc, sec, "aging", out)
    if page is None:
        return
    trx = re.compile(sec["total_row"])
    for l in _lines_after(page, sec["heading"]):
        label, cs = row_cells(l)
        if trx.search(norm(label)) and len(cs) == len(sec["columns"]):
            out.aging = {c: F.of(cell, page.number) for c, cell in zip(sec["columns"], cs)}
            return
    out.unplaced.append(("aging", "total", page.number))


def _month_table(lines: list[Line], pick: dict, page: int, key: str, out: Parsed) -> list[dict]:
    rows = []
    for l in lines:
        toks = l.tokens
        if not toks or not is_month(toks[0].text) or not _all_values(toks[1:]):
            continue
        _, cs = row_cells(l, 1)
        need = max(max(i + 1 if i >= 0 else -i for i in pick.values()), 1)
        if len(cs) < need:
            out.notes.append(f"{key}: {toks[0].text} has {len(cs)} cells")
            continue
        row = {"month": F(toks[0].text, page, toks[0].text, toks[0].bbox)}
        row.update({k: F.of(cs[i], page) for k, i in pick.items()})
        rows.append(row)
    return rows


def parse_aggregate(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["aggregate_performance"]
    page = _find(doc, sec, "aggregate_performance", out)
    if page is None:
        return
    out.aggregate = _month_table(_lines_after(page, sec["heading"], sec["end"]), sec["pick"], page.number,
                                 "aggregate_performance", out)
    for r in out.aggregate:      # the aggregate table's ratios must be the two percentages at the end of the row
        if not (r["delinquency_ratio"].raw.endswith("%") and r["loss_ratio"].raw.endswith("%")):
            out.notes.append(f"aggregate_performance: {r['month'].value} ratios are not percentages")
    if not out.aggregate:
        out.unplaced.append(("aggregate_performance", "rows", page.number))
    rsec = tpl["sections"]["rvl"]
    hit = doc.find(rsec["heading"], page.number)
    if hit:
        for r in _month_table(_lines_after(hit[0], rsec["heading"]), rsec["pick"], hit[0].number, "rvl", out):
            out.borrower.setdefault(r.pop("month").value, {}).update(r)


def parse_cnl(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["cumulative_losses"]
    page = _find(doc, sec, "cumulative_losses", out)
    out.extra["cnl"] = []
    if page is None:
        return
    prx = re.compile(sec["period_row"])
    pend = []
    for l in _lines_after(page, sec["heading"]):
        toks = l.tokens
        if len(toks) >= 2 and prx.match(toks[0].text) and _all_values(toks[1:]):
            pend.append((toks[0], _cells(toks[1:], left_edge=toks[0].x1)))
    ncol = len(sec["columns"])
    grid = [cs for _, cs in pend] if all(len(cs) == ncol for _, cs in pend) else align_columns([cs for _, cs in pend], ncol)
    if not pend or grid is None:
        out.unplaced.append(("cumulative_losses", "period summary", page.number))
        return
    for (pt, _), cs in zip(pend, grid):
        row = {"period": F(pt.text, page.number, pt.text, pt.bbox)}
        for c, cell in zip(sec["columns"], cs):
            row[c] = F.of(cell, page.number) if cell is not None else None
        out.extra["cnl"].append(row)


def parse_borrower(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["borrower_ratios"]
    for t in sec["tables"]:
        hit = doc.find(t["heading"])
        if not hit:
            continue
        page = hit[0]
        lines = _lines_after(page, t["heading"])
        # the table ends at the next heading of the same section
        others = [re.compile(o["heading"]) for o in sec["tables"] if o is not t]
        stop = next((i for i, l in enumerate(lines) if any(o.search(norm(l.text)) for o in others)), len(lines))
        for r in _month_table(lines[:stop], t["pick"], page.number, "borrower_ratios", out):
            out.borrower.setdefault(r.pop("month").value, {}).update(r)


def parse_tests(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["quantitative_tests"]
    page = _find(doc, sec, "quantitative_tests", out)
    out.extra["clean_up"] = None
    if page is None:
        return
    trx, arx = re.compile(sec["test_row"], re.I), re.compile(sec["answer_only"], re.I)
    aliases = [(re.compile(k), v) for k, v in sec.get("ref_aliases", {}).items()]
    cats = {norm(k): v for k, v in sec["categories"].items()}
    skip = [re.compile(s) for s in sec.get("skip_lines", [])]
    frx = re.compile(sec["clean_up"]["footnote"])
    category, cur, prefix = None, None, None
    for l in _lines_after(page, sec["heading"]):
        text = re.sub(r"\s+", " ", l.text).strip()
        t = norm(text)
        if any(s.search(t) for s in skip):
            continue
        head = next((v for k, v in cats.items() if t.startswith(k)), None)
        if head:
            category, cur, prefix = head, None, None
            continue
        if t.startswith("*"):
            m = frx.search(t)
            if m:
                out.extra["clean_up"] = {"list": m["list"], "page": page.number, "bbox": l.bbox, "raw": l.text}
            cur = prefix = None
            continue
        m = trx.match(text)
        if m:
            ref = re.sub(r"\s+", " ", m["ref"]).strip()
            for rx, fmt in aliases:
                a = rx.match(norm(ref))
                if a:
                    ref = fmt.format(**a.groupdict())
                    break
            desc = m["desc"].strip()
            raw = l.text
            if prefix:   # a description printed above its reference line
                desc, raw = f"{prefix[0]} {desc}", prefix[1] + "\n" + raw
            cur = {"ref": ref, "desc": desc, "answer": m["answer"].upper(), "category": category,
                   "conditional": [], "page": page.number, "bbox": l.bbox, "raw": raw}
            out.tests.append(cur)
            prefix = None
            continue
        if cur is not None and not cur["desc"].endswith("?"):
            a = arx.match(text)
            cur["desc"] = f"{cur['desc']} {text}"     # wrapped description line
            cur["raw"] += "\n" + l.text
            if a and cur["answer"] is None:
                cur["answer"] = a["answer"].upper()
        else:
            prefix = (text, l.text) if prefix is None else (f"{prefix[0]} {text}", prefix[1] + "\n" + l.text)
    if not out.tests:
        out.unplaced.append(("quantitative_tests", "rows", page.number))


PARSERS = [parse_cover, parse_balances, parse_contracts, parse_amounts, parse_program, parse_enhancement,
           parse_required, parse_top10, parse_aging, parse_aggregate, parse_cnl, parse_borrower, parse_tests]


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
    if "cover" in tpl["sections"] and 1 not in doc.pages:
        # pass 2 without page 1: the cover fields come from page 1 only; nothing from other pages is a cover value
        for k in ("title", "collection_start"):
            out.unplaced = [u for u in out.unplaced if u[:2] != ("cover", k)]
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
        rec.const("/source_file", Path(p.source_file).name.replace(" ", "_"), "uploaded file name, spaces -> _")
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
        rec.const("/warehouse", None, "this layout has no warehouse facility")
        rec.empty("/ratio_test_detail", "dict")
        for k in ("restatements", "balance_discontinuities"):
            rec.empty(f"/{k}")

    ph, tb = "/period_history/0", "/tranche_balance"
    sec = tpl["sections"]["tranche_balance"]

    # ---------------- page 2: tranche balance
    bal = p.extra.get("balance")
    t = (bal or {}).get("total") or {}
    if t:
        for key, cs in (("principal", ["principal"]), ("principal_prepayments", ["prepayments"]),
                        ("losses", ["defaults"]), ("recoveries", ["recoveries"])):
            w.read([f"{tb}/{key}", f"{ph}/{key}"], t.get(cs[0]))
        ic = bal.get("interest_columns")
        if ic:
            fs = [t.get(c) for c in ic]
            w.derived([f"{tb}/interest", f"{ph}/interest"], _sum(fs),
                      f"income counted by the printed effective-yield formula {bal['interest_formula'].value}: "
                      + " + ".join(ic), fs)
        else:
            w.read([f"{tb}/interest", f"{ph}/interest"], None)
        w.read([f"{tb}/opening", f"{ph}/opening_balance"], t.get("opening"))
        w.read([f"{tb}/closing", f"{ph}/closing_balance"], t.get("closing"))
        o, c = t.get("opening"), t.get("closing")
        if o is not None and c is not None:
            rec.derived(f"{tb}/change_abs", c.value - o.value, "closing - opening", [c, o])
            rec.derived(f"{tb}/change_pct", (c.value - o.value) / o.value if o.value else None,
                        "(closing - opening) / opening", [c, o])
        # R05 terms: the signed adjustment column split into its downward part (charge_off) and upward part
        adj = [t.get(x) for x in sec["rollforward"]["plus"]]
        down = sum((-_v(f) for f in adj if _v(f) < 0), 0.0)
        up = sum((_v(f) for f in adj if _v(f) > 0), 0.0)
        w.derived([f"{tb}/charge_off", f"{ph}/charge_off"], down,
                  "Adjustment to Portfolio (+/-): decrease as a positive amount", adj)
        w.derived([f"{tb}/adjustment_increase", f"{ph}/adjustment_increase"], up,
                  "Adjustment to Portfolio (+/-): increase as a positive amount", adj)
        for k in ("by_currency", "activity_by_currency"):
            rec.const(f"{tb}/{k}", None, "single-currency facility")
            rec.const(f"{ph}/{k}", None, "single-currency facility")
        rec.const(f"{ph}/amount_by_currency", None, "single-currency facility")
        _tranches(p, rec, bal, der)
    elif not partial:
        for key in ("opening", "closing", "principal", "principal_prepayments", "losses", "interest", "recoveries",
                    "change_abs", "change_pct", "charge_off"):
            rec.read(f"{tb}/{key}", None)
        rec.const(f"{tb}/by_currency", None, "tranche balance page not found")
        rec.const(f"{tb}/activity_by_currency", None, "tranche balance page not found")
        rec.empty(f"{tb}/top_movers")
        rec.empty(f"{tb}/all_tranches")

    # ---------------- tranche amounts
    am = p.extra.get("amounts")
    if am:
        w.read(["/tranche_amount/opening", f"{ph}/opening_amount"], am.get("opening"))
        w.read(["/tranche_amount/closing", f"{ph}/closing_amount"], am.get("closing"))
        rec.const("/tranche_amount/by_currency", None, "single-currency facility")
    elif not partial:
        rec.read("/tranche_amount/opening", None)
        rec.read("/tranche_amount/closing", None)
        rec.const("/tranche_amount/by_currency", None, "tranche amount page not found")

    # ---------------- contracts
    ct = p.extra.get("contracts")
    if ct and ct["total"]:
        o, c = ct["total"].get("opening"), ct["total"].get("closing")
        w.read(["/contracts/opening", f"{ph}/opening_contracts"], o)
        w.read(["/contracts/closing", f"{ph}/closing_contracts"], c)
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
            rec.derived("/prior_closing_contracts", _v(o), "opening contracts (= prior closing)", [o])
    elif not partial:
        for k in ("opening", "closing", "change_abs", "change_pct"):
            rec.read(f"/contracts/{k}", None)
        rec.empty("/contracts/top_movers")
        rec.read("/prior_closing_contracts", None)

    # ---------------- program and enhancement
    pr = p.extra.get("program") or {}
    if pr or not partial:
        rec.read("/program/program_limit", pr.get("program_limit"))
        rec.read("/program/program_amount", pr.get("program_amount"))
        rec.read("/program/unused_facility", pr.get("unused_facility"))
        lim, a = pr.get("program_limit"), pr.get("program_amount")
        if lim is not None and a is not None and lim.value:
            rec.derived("/program/program_utilization_pct", round(a.value / lim.value, der["program_utilization_decimals"]),
                        "program amount / program limit", [a, lim])
        else:
            rec.read("/program/program_utilization_pct", None)
        rec.const("/program/maximum_program_limit", None, "not printed on this layout")
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
        for k in ("aggregate_contract_amount", "obligor_concentration_pct", "concentration_limit_pct",
                  "concentration_limit_per_obligor", "excess_concentration_amount"):
            rec.read(f"{b}/{k}", r.get(k))

    # ---------------- aging_history: the current period's row
    ag = p.aging
    if ag and (period or partial):
        b = "/aging_history/0"
        if period:
            rec.derived(f"{b}/period", period, "collection period (cover)", [cov["collection_start"]])
            rec.derived(f"{b}/collection_period", coll_label, "collection period (cover)", [cov["collection_start"]])
        rec.const(f"{b}/tranche_rows", None, "per-tranche aging rows are not carried for this layout")
        for k in ("current_0_30", "days_31_60", "days_61_90"):
            rec.read(f"{b}/{k}", ag.get(k))
        rec.const(f"{b}/written_off_bucket_label", der["written_off_bucket_label"], "derived.written_off_bucket_label")
        rec.read(f"{b}/written_off", ag.get("days_91_plus"))
        rec.read(f"{b}/cumulative_net_losses", ag.get("cumulative_losses"))
        rec.read(f"{b}/closing_balance", ag.get("closing"))
        bk = [ag.get(k) for k in ("current_0_30", "days_31_60", "days_61_90")]
        s3, wo, cl = _sum(bk), _v(ag.get("days_91_plus")), ag.get("closing")
        rec.derived(f"{b}/bucket_sum", s3, "0-30 + 31-60 + 61-90", bk)
        rec.derived(f"{b}/bucket_sum_with_writeoff", s3 + wo, "bucket_sum + 91+/other defaults", bk + [ag.get("days_91_plus")])
        tol = der["reconcile_tolerance"]
        ok = cl is not None and (abs(s3 - cl.value) <= tol or abs(s3 + wo - cl.value) <= tol)
        rec.derived(f"{b}/reconciles", bool(ok), f"bucket sum (with or without 91+) within {tol} of closing", bk + [cl])
    elif not partial:
        rec.empty("/aging_history")

    if period and (t or not partial):
        rec.derived(f"{ph}/period", period, "collection period (cover)", [cov["collection_start"]])
        rec.derived(f"{ph}/collection_period", coll_label, "collection period (cover)", [cov["collection_start"]])
    elif not partial and not t:
        rec.empty("/period_history")

    # ---------------- ratio history
    s = Series(p)
    cur_month = p.aggregate[0]["month"].value if p.aggregate else None
    if p.aggregate or p.borrower or not partial:
        rec.empty("/ratio_history")
        for i, m in enumerate(s.months):
            row = s.rows[m]
            mf = row.get("_month") or next(iter(v for v in row.values() if isinstance(v, F)))
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

    # ---------------- cumulative losses by calendar period
    cnl_limit, cnl_src = _cnl_limit(p)
    if p.extra.get("cnl") or not partial:
        _cnl(p, rec, cnl_limit, cnl_src)

    # ---------------- covenants, summary, financial ratios
    worst = _worst(p, cnl_limit)
    if p.tests and cur_month:
        ctx = _context(p)
        covs = _covenants(p, s, cur_month, worst, cnl_limit, ctx, der, tpl)
        prior_covs = _covenants(p, s, _prev_mon_yy(cur_month), None, cnl_limit, {}, der, tpl, prior_deal=prior_deal)
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
                f, vintage = worst["ratio"], worst
            else:
                f, vintage = s.asof(spec["series"], cur_month), None
                if f is None:
                    continue
            b = f"/financial_ratios/{j}"
            for k in ("key", "label", "format", "group"):
                rec.const(f"{b}/{k}", spec[k], f"financial_ratios.{spec['key']}")
            rec.read(f"{b}/value", f)
            if vintage:
                rec.read(f"{b}/vintage", vintage["period"])
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
    """all_tranches (every dated tranche row) and the top movers by |closing - opening|, in page order on ties."""
    tb = "/tranche_balance"

    def amount(r: dict, col: str):
        f = r.get(col)
        return ("read", f) if f is not None else ("derived", 0.0, "blank cell", [r["tranche"]])

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
    movers = sorted(rows, key=lambda r: -abs(val(amount(r, "closing")) - val(amount(r, "opening"))))
    rec.empty(f"{tb}/top_movers")
    for i, r in enumerate(movers[:der["top_movers"]["tranche"]]):
        b = f"{tb}/top_movers/{i}"
        rec.read(f"{b}/leasing_date", r["date"])
        rec.read(f"{b}/tranche", r["tranche"])
        for k, cname in (("original_tranche_balance", "original"), ("opening_tranche_balance", "opening"),
                         ("original_tranche_yield", "original_yield"),
                         ("current_period_effective_tranche_yield", "effective_yield"),
                         ("closing_tranche_balance", "closing")):
            write(f"{b}/{k}", amount(r, cname))


def _cnl_limit(p: Parsed) -> tuple[Optional[float], Optional[F]]:
    sec = p.template["sections"]["cumulative_losses"]
    qs = p.template["sections"]["quantitative_tests"]
    spec = next((m for m in qs["metrics"] if m["series"] == "cnl_worst_vintage"), None)
    for t in p.tests:
        if re.search(sec["limit_from_test"], norm(t["desc"])) and spec:
            m = re.search(spec["threshold"]["pattern"], norm(t["desc"]))
            if m:
                return float(m.group(1).replace(",", "")) * spec["threshold"]["scale"], F(None, t["page"], t["raw"], t["bbox"])
    return None, None


def _cnl(p: Parsed, rec: Recorder, limit: Optional[float], limit_src: Optional[F]):
    rec.empty("/cnl_by_period")
    for i, r in enumerate(p.extra.get("cnl") or []):
        b = f"/cnl_by_period/{i}"
        rec.read(f"{b}/period", r["period"])
        rec.const(f"{b}/advance_range", None, "calendar-period vintages; no advance range on this layout")
        for k in ("original_finance_contract_npv", "cumulative_net_losses", "cnl_ratio_pct",
                  "period_original_balance", "period_cumulative_net_losses"):
            if r.get(k) is not None:
                rec.read(f"{b}/{k}", r[k])
            else:
                rec.derived(f"{b}/{k}", 0.0, "blank cell", [r["period"]])
        if limit is not None:
            rec.derived(f"{b}/cnl_limit", limit, "CNL ratio limit (quantitative tests page)", [limit_src])
            rec.derived(f"{b}/cnl_limit_is_exception", False, "one limit for every vintage on this layout", [limit_src])
            ratio = r.get("cnl_ratio_pct")
            rec.derived(f"{b}/cnl_within_limit", None if ratio is None or ratio.value is None else ratio.value <= limit,
                        "cnl_ratio_pct <= cnl_limit", [ratio, limit_src])


def _worst(p: Parsed, limit: Optional[float]) -> Optional[dict]:
    best = None
    for r in p.extra.get("cnl") or []:
        f = r.get("cnl_ratio_pct")
        if f is None or f.value is None:
            continue
        u = f.value / limit if limit else f.value
        if best is None or u > best["util"]:
            best = {"util": u, "ratio": f, "period": r["period"], "label": r["period"].value}
    return best


def _context(p: Parsed) -> dict:
    """Values the report prints next to binary tests: deferred-account excess/(shortfall) and the smallest
    (closing - required) tranche balance difference."""
    ctx: dict[str, Optional[F]] = {}
    ctx["deferred_excess"] = (p.extra.get("deferred") or {}).get("excess")
    diffs = []
    for r in p.extra.get("required") or []:
        cl, rq = r.get("closing"), r.get("required")
        if cl is not None and rq is not None and cl.value is not None and rq.value is not None:
            diffs.append((cl.value - rq.value, cl, rq))
    if diffs:
        d, cl, rq = min(diffs, key=lambda x: x[0])
        ctx["tranche_differential"] = F(d, cl.page, f"derived: closing {cl.raw} - required {rq.raw}", None)
    return ctx


def _metric(s: Series, series: str, month: str, window: Optional[int]) -> tuple[Optional[F], Optional[F]]:
    """(value, previous value) of a series as of `month`. With a window: the highest value of the `window` months
    ending at `month`, and the same for the month before. Without: the latest printed value at or before `month`
    and the printed value before it (quarterly series carry forward)."""
    h = [(m, f) for m, f in s.history(series) if f.value is not None]
    if window:
        def mx(end):
            fs = [f for m, f in h if 0 <= _months_between(m, end) < window]
            return max(fs, key=lambda f: f.value) if fs else None
        return mx(month), mx(_prev_mon_yy(month))
    upto = [f for m, f in h if _month_key(m) <= _month_key(month)]
    return (upto[-1] if upto else None), (upto[-2] if len(upto) > 1 else None)


def _tranche_list(text: str) -> list[int]:
    """'114-117, 119 - 121, 128, 141 -143, 147 and 148' -> [114, 115, 116, 117, 119, 120, 121, 128, ...]."""
    out: list[int] = []
    for part in re.split(r",|\bAND\b", text, flags=re.I):
        m = re.fullmatch(r"\s*(\d+)\s*(?:-\s*(\d+))?\s*", part)
        if m:
            a, b = int(m.group(1)), int(m.group(2) or m.group(1))
            out += list(range(a, b + 1))
    return out


def _covenants(p: Parsed, s: Series, month: str, worst: Optional[dict], cnl_limit: Optional[float], ctx: dict,
               der: dict, tpl: dict, prior_deal: dict | None = None) -> list[tuple[dict, dict]]:
    sec = tpl["sections"]["quantitative_tests"]
    notes = sec["binary_notes"]
    out = []
    for t in p.tests:
        nd = norm(t["desc"])
        metric = next((m for m in sec["metrics"] if re.search(m["match"], nd)), None)
        test_src = F(None, t["page"], t["raw"], t["bbox"])
        c = {"category": t["category"], "legal_ref": t["ref"], "description": t["desc"]}
        srcs: dict = {"_inputs": [test_src]}
        answer_status = "BREACH" if t["answer"] == "YES" else "OK"
        binary = {"current_value": None, "threshold": None, "kind": "binary", "utilization_pct": None, "trend": "n/a",
                  "status": answer_status, "note": notes.get(t["category"], notes["default"])}
        kind = metric["kind"] if metric else None
        if metric is None:
            c.update(binary)
        elif kind == "context":
            f = ctx.get(metric["series"])
            c.update(binary)
            if f is not None and f.value is not None:
                c.update({"current_value": f.value, "threshold": 0, "note": metric["note"].format(value=f.value)})
                srcs["current_value"] = f
                srcs["_inputs"] = [f, test_src]
        elif kind == "clean_up":
            cu = p.extra.get("clean_up")
            c.update(binary)
            if cu is not None:
                spec = sec["clean_up"]
                ids = _tranche_list(cu["list"])
                total = len(((p.extra.get("balance") or {}).get("rows")) or [])
                c["description"] = t["desc"] + spec["description_suffix"].format(n=len(ids), total=total)
                c["current_value"] = len(ids)
                c["note"] = spec["note"].format(tranches=", ".join(str(x) for x in ids))
                srcs["_inputs"] = [F(None, cu["page"], cu["raw"], cu["bbox"]), test_src]
            if t["answer"] == "YES":
                c["status"] = sec["clean_up"]["status_if_yes"]
        else:
            series = metric["series"]
            th = metric.get("threshold")
            m = re.search(th["pattern"], nd) if th else None
            thr = float(m.group(1).replace(",", "")) * th["scale"] if m else None
            if series == "cnl_worst_vintage":
                if worst is not None:
                    vf, v, wv = worst["ratio"], worst["ratio"].value, worst["label"]
                else:   # the prior period's CNL is not on this report; from the prior extraction when supplied
                    pc = next((x for x in (prior_deal or {}).get("covenants", []) if x.get("legal_ref") == t["ref"]), None)
                    vf, v, wv = None, (pc or {}).get("current_value"), (pc or {}).get("worst_vintage")
                thr, trend = cnl_limit if cnl_limit is not None else thr, "n/a"
            else:
                vf, pf = _metric(s, series, month, metric.get("window"))
                v = None if vf is None else vf.value
                trend = _trend(v, None if pf is None else pf.value, der["trend_flat_band"])
            util = None
            if v is not None and thr:
                util = round(v / thr, der["utilization_decimals"]) if kind == "ceiling" else \
                    (round(thr / v, der["utilization_decimals"]) if v else None)
            c.update({"current_value": v, "threshold": thr, "kind": kind, "utilization_pct": util, "trend": trend,
                      "status": _status(v, thr, kind, der["watch_buffer_pct"]), "note": None})
            if series == "cnl_worst_vintage":
                c["worst_vintage"] = wv
            if vf is not None:
                srcs["current_value"] = vf
                srcs["_inputs"] = [vf, test_src]
        c["reported_triggered"] = t["answer"]
        out.append((c, srcs))
    return out
