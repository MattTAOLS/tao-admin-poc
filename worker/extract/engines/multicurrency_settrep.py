"""Engine for settlement reports split by currency and rate type (template move-trust-settrep-multicurrency-v1).

The report prints the tranche balance and the tranche amounts on one page per rate type and currency
(FIXED / FLOATING x CAD / USD). The deal object carries:
- CAD-equivalent totals (CAD pages + USD pages x the spot rate printed on the USD pages; the USD closing balance
  uses the CAD-equivalent column the page prints), which are what the rules check (R05 on period_history);
- the split by currency (by_currency, activity_by_currency, amount_by_currency, tranche_amount.by_currency);
- per-tranche rows with currency and rate type (all_tranches, top_movers), top-10 obligors with CAD/USD amounts,
  the cumulative-loss table grouped by semi-annual period, covenants from the quantitative-tests page.

Everything document-specific (headings, columns, labels, constants) is in the template. Blank cells are common,
so table cells are placed under their column by right edge, using a row that prints every column (the totals
row) or the header tokens as anchors.

parse(pages, page_count, tpl) -> mapper.Parsed; build(parsed, recorder, *, prior=None, partial=False).
"""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Iterable, Optional

from .. import mapper
from ..derive import Series, _month_key, _prev_mon_yy, _prev_month, _status, _threshold, _trend, _ym, parse_long_date, slugify
from ..mapper import F, Doc, Parsed, _all_numeric, _first_number_after, _norm_ref
from ..parse import DASHES, Cell, _edge, cells, is_advance_date, is_month, is_number, row_cells
from ..provenance import Recorder
from ..text import Line, Page, norm

log = logging.getLogger("extract.multicurrency")

PLACE_TOL = 4.0     # x text height: a cell further than this from every column anchor is not in the table


# ---------------------------------------------------------------- helpers
def _literal(heading: str) -> str:
    return "^" + re.escape(norm(heading)) + "$"


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


def _place(cs: list[Cell], anchors: list[float]) -> Optional[list[Optional[Cell]]]:
    """Each cell under the column anchor nearest its right edge (numbers are right-aligned; a zero-dash sits
    ZERO_DASH_PAD left of its edge). None when two cells claim one column or a cell is far from every anchor."""
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


# ---------------------------------------------------------------- parsing
def _parse_spot(doc: Doc, tpl: dict, out: Parsed):
    rx = re.compile(tpl["currencies"]["spot_rate"])
    spots = {}
    for n in sorted(doc.pages):
        for l in doc.pages[n].lines:
            m = rx.search(norm(l.text))
            if m:
                spots[n] = F(float(m.group("v")), n, l.text, l.bbox)
                break
    out.extra["spots"] = spots


def _balance_table(page: Page, lines: list[Line], spec: dict, sec: dict, out: Parsed) -> dict:
    trx = re.compile(sec["total_row"])
    pre_cols, ycols = sec["columns_before_yields"], sec["yield_columns"]
    post_cols = sec["columns_after_yields"][spec["currency"]]
    res = {"page": page.number, "currency": spec["currency"], "rate_type": spec["rate_type"], "total": {}, "rows": []}
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
        out.unplaced.append(("tranche_balance", f"total p.{page.number}", page.number))
        return res
    for l in lines:
        toks = l.tokens
        i = 1 if toks and is_advance_date(toks[0].text) else 0
        if len(toks) <= i + 1 or not toks[i].text.isdigit() or not _all_numeric(toks[i + 1:]):
            continue
        cs = cells(toks[i + 1:], left_edge=toks[i].x1)
        pk = [j for j, c in enumerate(cs) if c.is_pct]
        pre, post = (cs[:pk[0]], cs[pk[-1] + 1:]) if pk else (cs, [])
        a, b = _place(pre, anchors_pre), _place(post, anchors_post)
        row: dict[str, Any] = {"tranche": F(int(toks[i].text), page.number, toks[i].text, toks[i].bbox),
                               "date": F(toks[0].text, page.number, toks[0].text, toks[0].bbox) if i else None}
        if a is None or b is None:
            if i:   # a dated tranche row must resolve; undated filler rows ("6 - - - -") may not
                out.notes.append(f"tranche_balance p.{page.number}: tranche {toks[i].text} cells do not fit the columns")
                out.unplaced.append(("tranche_balance", f"tranche {toks[i].text} p.{page.number}", page.number))
            continue
        row.update({c: F.of(cell, page.number) for c, cell in zip(pre_cols, a) if cell is not None})
        row.update({c: F.of(cell, page.number) for c, cell in zip(post_cols, b) if cell is not None})
        ys = [cs[j] for j in pk]
        for c, cell in zip(ycols[-len(ys):] if ys else [], ys[-len(ycols):]):
            row[c] = F.of(cell, page.number)
        res["rows"].append(row)
    return res


def _contracts_table(page: Page, lines: list[Line], sec: dict, out: Parsed) -> dict:
    cols = sec["columns"]
    res = {"page": page.number, "total": {}, "rows": []}
    trx = re.compile(sec["total_row"])
    anchors = None
    for l in lines:
        label, cs = row_cells(l)
        if trx.search(norm(label)) and len(cs) == len(cols):
            res["total"] = {c: F.of(cell, page.number) for c, cell in zip(cols, cs)}
            anchors = [_edge(c) for c in cs]
            break
    if anchors is None:
        out.unplaced.append(("outstanding_contracts", f"total p.{page.number}", page.number))
        return res
    for l in lines:
        toks = l.tokens
        if len(toks) < 2 or not toks[0].text.isdigit() or not _all_numeric(toks[1:]):
            continue
        placed = _place(cells(toks[1:], left_edge=toks[0].x1), anchors)
        if placed is None:
            out.unplaced.append(("outstanding_contracts", f"tranche {toks[0].text} p.{page.number}", page.number))
            continue
        row = {"tranche": F(int(toks[0].text), page.number, toks[0].text, toks[0].bbox)}
        row.update({c: F.of(cell, page.number) for c, cell in zip(cols, placed) if cell is not None})
        res["rows"].append(row)
    return res


def parse_balances(doc: Doc, tpl: dict, out: Parsed):
    sec, csec = tpl["sections"]["tranche_balance"], tpl["sections"]["outstanding_contracts"]
    out.extra["balance_pages"], out.extra["contract_pages"] = [], []
    for spec in sec["pages"]:
        hit = doc.find(_literal(spec["heading"]))
        if not hit:
            out.unplaced.append(("tranche_balance", spec["heading"], None))
            continue
        page = hit[0]
        if spec is sec["pages"][0]:
            out.source_pages[sec["source_page_key"]] = page.number
            for k in sec.get("also_source_page_keys", []):
                out.source_pages[k] = page.number
        lines = _lines_after(page, _literal(spec["heading"]), sec["end"])
        out.extra["balance_pages"].append(_balance_table(page, lines, spec, sec, out))
        clines = _lines_after(page, csec["heading"])
        if clines is None:
            out.unplaced.append(("outstanding_contracts", spec["heading"], page.number))
            continue
        out.extra["contract_pages"].append(_contracts_table(page, clines, csec, out))


def parse_amounts(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["tranche_amounts"]
    out.extra["amount_pages"] = []
    trx = re.compile(sec["total_row"])
    for spec in sec["pages"]:
        hit = doc.find(_literal(spec["heading"]))
        if not hit:
            out.unplaced.append(("tranche_amounts", spec["heading"], None))
            continue
        page = hit[0]
        if spec is sec["pages"][0]:
            out.source_pages[sec["source_page_key"]] = page.number
        total = {}
        for l in _lines_after(page, _literal(spec["heading"])):
            label, cs = row_cells(l)
            if trx.search(norm(label)) and len(cs) == len(sec["columns"]):
                total = {c: F.of(cell, page.number) for c, cell in zip(sec["columns"], cs)}
                break
        if not total:
            out.unplaced.append(("tranche_amounts", f"total p.{page.number}", page.number))
        out.extra["amount_pages"].append({"page": page.number, "currency": spec["currency"],
                                          "rate_type": spec["rate_type"], "total": total})


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


def parse_program(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["program"]
    hit = doc.find(sec["heading"])
    if not hit:
        out.unplaced.append(("program", "*", None))
        return
    page = hit[0]
    out.source_pages[sec["source_page_key"]] = page.number
    out.extra["program"] = _labelled_values(_lines_after(page, sec["heading"]), sec["lines"], page.number)
    for k in sec["lines"]:
        if k not in out.extra["program"]:
            out.unplaced.append(("program", k, page.number))


def parse_enhancement(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["enhancement"]
    hit = doc.find(sec["heading"])
    if not hit:
        out.unplaced.append(("enhancement", "*", None))
        return
    out.source_pages[sec["source_page_key"]] = hit[0].number
    for n in range(hit[0].number, hit[0].number + sec["search_pages_after_heading"] + 1):
        if n in doc.pages:
            for k, f in _labelled_values(doc.pages[n].lines, sec["lines"], n).items():
                out.enhancement.setdefault(k, f)
    for k in sec["lines"]:
        if k not in out.enhancement:
            out.unplaced.append(("enhancement", k, hit[0].number))


def parse_top10(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["top10_obligor"]
    out.extra["top10"] = []
    hit = doc.find(sec["heading"])
    if not hit:
        out.unplaced.append(("top10_obligor", "*", None))
        return
    page = hit[0]
    out.source_pages[sec["source_page_key"]] = page.number
    lines = _lines_after(page, sec["heading"])
    ah = sec["anchor_header"]
    hdr = next((l for l in lines if ah["line_has"] in norm(l.text)), None)
    anchors = [t.x1 for t in hdr.tokens if re.match(ah["tokens"], norm(t.text))] if hdr else []
    if len(anchors) != len(sec["columns"]):
        out.unplaced.append(("top10_obligor", "columns", page.number))
        return
    rrx = re.compile(sec["row"])
    for l in lines:
        label, cs = row_cells(l)
        # a numeric-looking name token ("Obligor # 1") is not under any column: give it back to the label
        while cs and min(abs(a - _edge(cs[0])) for a in anchors) > PLACE_TOL * (cs[0].bbox[3] - cs[0].bbox[1]):
            label, cs = f"{label} {cs[0].raw}", cs[1:]
        m = rrx.match(label)
        if not m or not cs:
            continue
        placed = _place(cs, anchors)
        if placed is None:
            out.unplaced.append(("top10_obligor", f"rank {m['rank']}", page.number))
            continue
        row = {"rank": F(int(m["rank"]), page.number, m["rank"], l.tokens[0].bbox),
               "name": F(m["name"].strip(), page.number, label, l.bbox)}
        row.update({c: F.of(cell, page.number) for c, cell in zip(sec["columns"], placed) if cell is not None})
        out.extra["top10"].append(row)
    if not out.extra["top10"]:
        out.unplaced.append(("top10_obligor", "rows", page.number))


def parse_aging(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["aging"]
    hit = doc.find(sec["heading"])
    if not hit:
        out.unplaced.append(("aging", "*", None))
        return
    page = hit[0]
    out.source_pages[sec["source_page_key"]] = page.number
    trx = re.compile(sec["total_row"])
    for l in _lines_after(page, sec["heading"]):
        label, cs = row_cells(l)
        if trx.search(norm(label)) and len(cs) == len(sec["columns"]):
            out.aging = {c: F.of(cell, page.number) for c, cell in zip(sec["columns"], cs)}
            return
    out.unplaced.append(("aging", "total", page.number))


def parse_aggregate(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["aggregate_performance"]
    hit = doc.find(sec["heading"])
    if not hit:
        out.unplaced.append(("aggregate_performance", "*", None))
        return
    page = hit[0]
    out.source_pages[sec["source_page_key"]] = page.number
    for l in _lines_after(page, sec["heading"], sec["end"]):
        toks = l.tokens
        if not toks or not is_month(toks[0].text) or not _all_numeric(toks[1:]):
            continue
        _, cs = row_cells(l, 1)
        if len(cs) < len(sec["pick"]) or not (cs[-1].is_pct and cs[-2].is_pct):
            out.notes.append(f"aggregate_performance: {toks[0].text} has {len(cs)} cells")
            continue
        row = {"month": F(toks[0].text, page.number, toks[0].text, toks[0].bbox)}
        row.update({k: F.of(cs[i], page.number) for k, i in sec["pick"].items()})
        out.aggregate.append(row)
    if not out.aggregate:
        out.unplaced.append(("aggregate_performance", "rows", page.number))


def parse_cnl(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["cumulative_losses"]
    out.extra["cnl_rows"], out.extra["cnl_summary"], out.extra["cnl_totals"] = [], [], {}
    hit = doc.find(sec["heading"])
    if not hit:
        out.unplaced.append(("cumulative_losses", "*", None))
        return
    page = hit[0]
    out.source_pages[sec["source_page_key"]] = page.number
    lines = _lines_after(page, sec["heading"])
    trx, rrx, cols = re.compile(sec["total_row"]), re.compile(sec["row"]), sec["columns"]
    anchors = None
    for l in lines:
        label, cs = row_cells(l)
        if trx.search(norm(label)) and len(cs) == len(cols):
            out.extra["cnl_totals"] = {c: F.of(cell, page.number) for c, cell in zip(cols, cs)}
            out.extra["cnl_totals"]["page"] = page.number
            anchors = [_edge(c) for c in cs]
            break
    if anchors is None:
        out.unplaced.append(("cumulative_losses", "total", page.number))
        return
    for l in lines:
        toks = list(l.tokens)
        # semi-annual period summary down the right-hand side: "<period no.> <CNL ratio %>"
        if len(toks) >= 2 and toks[-1].text.endswith("%") and is_number(toks[-1].text) and toks[-2].text.isdigit() \
                and toks[-2].x0 > anchors[-1]:
            pt, rt = toks[-2], toks[-1]
            out.extra["cnl_summary"].append({"period": F(int(pt.text), page.number, pt.text, pt.bbox),
                                             "ratio": F.of(cells([rt])[0], page.number)})
            toks = toks[:-2]
        m = rrx.match(" ".join(t.text for t in toks))
        if not m:
            continue
        first_amt = next((j for j in range(3, len(toks)) if toks[j].text in DASHES or
                          (is_number(toks[j].text) and not toks[j].text.isdigit())), None)
        if first_amt is None or not toks[first_amt - 1].text.isdigit():
            out.unplaced.append(("cumulative_losses", f"{m['tranche']} {m['currency']}", page.number))
            continue
        semi = toks[first_amt - 1]
        placed = _place(cells(toks[first_amt:], left_edge=semi.x1), anchors)
        if placed is None:
            out.unplaced.append(("cumulative_losses", f"{m['tranche']} {m['currency']}", page.number))
            continue
        row = {"date": m["date"], "tranche": m["tranche"], "currency": m["currency"],
               "semi": F(int(semi.text), page.number, semi.text, semi.bbox), "bbox": l.bbox, "raw": l.text}
        row.update({c: F.of(cell, page.number) for c, cell in zip(cols, placed) if cell is not None})
        out.extra["cnl_rows"].append(row)
    if not out.extra["cnl_rows"] or not out.extra["cnl_summary"]:
        out.unplaced.append(("cumulative_losses", "rows", page.number))


def parse_borrower(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["borrower_ratios"]
    hit = doc.find(sec["heading"], sec.get("page_hint"))
    if hit:
        out.source_pages[sec["source_page_key"]] = hit[0].number
    mapper.parse_borrower(doc, tpl, out)


def parse_tests(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["quantitative_tests"]
    hit = doc.find(sec["heading"])
    if not hit:
        out.unplaced.append(("quantitative_tests", "*", None))
        return
    page = hit[0]
    out.source_pages[sec["source_page_key"]] = page.number
    trx = re.compile(sec["test_row"], re.I)
    aliases = {norm(k): v for k, v in sec.get("ref_aliases", {}).items()}
    cats = {norm(k): v for k, v in sec["categories"].items()}
    keep = {norm(k) for k in sec.get("continue_category", [])}
    category, cur = None, None
    for l in _lines_after(page, sec["heading"]):
        text = re.sub(r"\s+", " ", l.text).strip()
        t = norm(text)
        head = next((v for k, v in cats.items() if t.startswith(k)), None)
        if head:
            category, cur = head, None
            continue
        if t in keep:
            cur = None
            continue
        m = trx.match(text)
        if m:
            ref = aliases.get(norm(m["ref"]), _norm_ref(m["ref"]))
            cur = {"ref": ref, "desc": m["desc"].strip(), "answer": m["answer"].upper(), "category": category,
                   "conditional": [], "page": page.number, "bbox": l.bbox, "raw": l.text}
            out.tests.append(cur)
            continue
        if cur is not None and not t.startswith("*"):
            cur["desc"] = f"{cur['desc']} {text}"     # wrapped description line
            cur["raw"] += "\n" + l.text
        else:
            cur = None
    if not out.tests:
        out.unplaced.append(("quantitative_tests", "rows", page.number))


PARSERS = [mapper.parse_cover, _parse_spot, parse_balances, parse_amounts, parse_program, parse_enhancement,
           parse_top10, parse_aging, parse_aggregate, parse_cnl, parse_borrower, parse_tests]


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


def _spot(p: Parsed) -> Optional[F]:
    spots = p.extra.get("spots") or {}
    base = p.template["currencies"]["base"]
    for pg in p.extra.get("balance_pages", []):
        if pg["currency"] != base and pg["page"] in spots:
            return spots[pg["page"]]
    return next(iter(spots.values()), None)


def build(p: Parsed, rec: Recorder, *, prior: dict | None = None, partial: bool = False) -> dict:
    tpl, der = p.template, p.template["derived"]
    tid = tpl["template_id"]
    base, foreign = tpl["currencies"]["base"], tpl["currencies"]["foreign"]
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

    spot = _spot(p)
    sp = spot.value if spot is not None else None
    ph, tb = "/period_history/0", "/tranche_balance"

    # ---------------- tranche balance pages
    # cross-page totals only when every currency / rate-type page of the table was read (pass 2 may re-read a few)
    def complete(key: str, sec_key: str) -> list[dict]:
        got = [pg for pg in p.extra.get(key, []) if pg["total"]]
        need = len(tpl["sections"][sec_key]["pages"])
        return got if len(got) == need and (sp is not None or all(pg.get("currency", base) == base for pg in got)) else []

    bal = complete("balance_pages", "tranche_balance")
    if bal:
        sec = tpl["sections"]["tranche_balance"]
        cad = [pg["total"] for pg in bal if pg["currency"] == base]
        usd = [pg["total"] for pg in bal if pg["currency"] == foreign]

        def col(ts, c):
            return [t.get(c) for t in ts]

        acts = {"principal": ["principal"], "principal_prepayments": ["prepayments"], "losses": ["defaults"],
                "interest": sec["interest_columns"], "recoveries": ["recoveries"]}
        ac = "activity_by_currency"
        for key, cs in acts.items():
            fc = [f for c in cs for f in col(cad, c)]
            fu = [f for c in cs for f in col(usd, c)]
            what = " + ".join(cs)
            vc, vu = _sum(fc), _sum(fu)
            w.derived([f"{tb}/{ac}/{base}/{key}", f"{ph}/{ac}/{base}/{key}"], vc, f"{what}, {base} pages", fc)
            w.derived([f"{tb}/{ac}/{foreign}/{key}", f"{ph}/{ac}/{foreign}/{key}"], vu, f"{what}, {foreign} pages", fu)
            w.derived([f"{tb}/{ac}/{foreign}_cad_equivalent/{key}", f"{ph}/{ac}/{foreign}_cad_equivalent/{key}"],
                      vu * sp, f"{what}, {foreign} pages x spot rate", fu + [spot])
            w.derived([f"{tb}/{key}", f"{ph}/{key}"], vc + vu * sp, f"{what}: {base} + {foreign} x spot rate", fc + fu + [spot])
        w.read([f"{tb}/{ac}/spot_rate", f"{ph}/{ac}/spot_rate"], spot)

        bc = "by_currency"
        o_c, c_c = col(cad, "opening"), col(cad, "closing")
        o_u, c_u, c_ue = col(usd, "opening"), col(usd, "closing"), col(usd, "closing_cad_equivalent")
        w.derived([f"{tb}/{bc}/cad_opening", f"{ph}/{bc}/cad_opening"], _sum(o_c), f"opening, {base} pages", o_c)
        w.derived([f"{tb}/{bc}/cad_closing", f"{ph}/{bc}/cad_closing"], _sum(c_c), f"closing, {base} pages", c_c)
        w.derived([f"{tb}/{bc}/usd_opening_cad_equivalent", f"{ph}/{bc}/usd_opening_cad_equivalent"], _sum(o_u) * sp,
                  f"opening, {foreign} pages x spot rate", o_u + [spot])
        w.derived([f"{tb}/{bc}/usd_closing_cad_equivalent", f"{ph}/{bc}/usd_closing_cad_equivalent"], _sum(c_ue),
                  f"closing CAD equivalent as printed, {foreign} pages", c_ue)
        w.derived([f"{tb}/{bc}/usd_closing_raw", f"{ph}/{bc}/usd_closing_raw"], _sum(c_u), f"closing, {foreign} pages", c_u)
        opening, closing = _sum(o_c) + _sum(o_u) * sp, _sum(c_c) + _sum(c_ue)
        w.derived([f"{tb}/opening", f"{ph}/opening_balance"], opening,
                  f"opening: {base} + {foreign} x spot rate", o_c + o_u + [spot])
        w.derived([f"{tb}/closing", f"{ph}/closing_balance"], closing,
                  f"closing: {base} + {foreign} closing CAD equivalent", c_c + c_ue)
        rec.derived(f"{tb}/change_abs", closing - opening, "closing - opening", o_c + c_c)
        rec.derived(f"{tb}/change_pct", (closing - opening) / opening if opening else None,
                    "(closing - opening) / opening", o_c + c_c)

        # R05 terms: the signed page-2 adjustment split into its downward part (charge_off) and upward part
        adj = [(t.get("adjustment"), 1.0 if pg["currency"] == base else sp) for pg, t in ((pg, pg["total"]) for pg in bal)]
        down = sum((-_v(f) * r for f, r in adj if _v(f) < 0), 0.0)
        up = sum((_v(f) * r for f, r in adj if _v(f) > 0), 0.0)
        fa = [f for f, _ in adj] + ([spot] if usd else [])
        w.derived([f"{tb}/charge_off", f"{ph}/charge_off"], down,
                  "Adjustment to Portfolio (+/-), column i: decreases as a positive CAD-equivalent amount", fa)
        w.derived([f"{tb}/adjustment_increase", f"{ph}/adjustment_increase"], up,
                  "Adjustment to Portfolio (+/-), column i: increases as a positive CAD-equivalent amount", fa)

        _tranches(p, rec, bal, spot, sec, der)
    elif not partial:
        for key in ("opening", "closing", "principal", "principal_prepayments", "losses", "interest", "recoveries",
                    "change_abs", "change_pct", "charge_off"):
            rec.read(f"{tb}/{key}", None)
        rec.const(f"{tb}/by_currency", None, "tranche balance pages not found")
        rec.const(f"{tb}/activity_by_currency", None, "tranche balance pages not found")
        rec.empty(f"{tb}/top_movers")
        rec.empty(f"{tb}/all_tranches")

    # ---------------- tranche amounts
    amt = complete("amount_pages", "tranche_amounts")
    if amt:
        ca = [pg["total"] for pg in amt if pg["currency"] == base]
        ua = [pg["total"] for pg in amt if pg["currency"] == foreign]
        oc, cc = [t.get("opening") for t in ca], [t.get("closing") for t in ca]
        ou, cu = [t.get("opening") for t in ua], [t.get("closing") for t in ua]
        note = f"{base} + {foreign} as printed (no conversion)"
        w.derived(["/tranche_amount/opening", f"{ph}/opening_amount"], _sum(oc) + _sum(ou), f"opening amount: {note}", oc + ou)
        w.derived(["/tranche_amount/closing", f"{ph}/closing_amount"], _sum(cc) + _sum(cu), f"closing amount: {note}", cc + cu)
        for pre in ("/tranche_amount/by_currency", f"{ph}/amount_by_currency"):
            rec.derived(f"{pre}/cad_closing", _sum(cc), f"closing amount, {base} pages", cc)
            rec.derived(f"{pre}/usd_closing_raw", _sum(cu), f"closing amount, {foreign} pages", cu)
            rec.derived(f"{pre}/usd_closing_cad_equivalent", _sum(cu) * sp, f"closing amount, {foreign} pages x spot rate", cu + [spot])
            rec.derived(f"{pre}/total_cad_equivalent", _sum(cc) + _sum(cu) * sp,
                        f"closing amount: {base} + {foreign} x spot rate", cc + cu + [spot])
    elif not partial:
        rec.read("/tranche_amount/opening", None)
        rec.read("/tranche_amount/closing", None)
        rec.const("/tranche_amount/by_currency", None, "tranche amount pages not found")

    # ---------------- contracts
    cps = complete("contract_pages", "tranche_balance")
    if cps:
        o = [pg["total"].get("opening") for pg in cps]
        c = [pg["total"].get("closing") for pg in cps]
        so, sc = _sum(o), _sum(c)
        w.derived(["/contracts/opening", f"{ph}/opening_contracts"], so, "opening contracts, all pages", o)
        w.derived(["/contracts/closing", f"{ph}/closing_contracts"], sc, "closing contracts, all pages", c)
        rec.derived("/contracts/change_abs", sc - so, "closing - opening", o + c)
        rec.derived("/contracts/change_pct", (sc - so) / so if so else None, "(closing - opening) / opening", o + c)
        rec.empty("/contracts/top_movers")
        moved = [r for pg in cps for r in pg["rows"] if _v(r.get("change"))]
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
            rec.derived("/prior_closing_contracts", so, "opening contracts (= prior closing)", o)
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
            rec.derived("/program/program_utilization_pct", round(a.value / lim.value, 10),
                        "program amount at CAD equivalent / program limit", [a, lim])
        else:
            rec.read("/program/program_utilization_pct", None)
        rec.read("/program/maximum_program_limit", None)
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
        rec.read(f"{b}/aggregate_cad_contract_amount", r.get("cad_amount"))
        if r.get("usd_amount") is not None:
            rec.read(f"{b}/aggregate_usd_contract_amount", r["usd_amount"])
        elif r.get("usd_cad_equivalent") is not None and not r["usd_cad_equivalent"].value:
            rec.derived(f"{b}/aggregate_usd_contract_amount", 0.0,
                        "USD amount blank and its CAD equivalent is nil", [r["usd_cad_equivalent"]])
        else:
            rec.read(f"{b}/aggregate_usd_contract_amount", None)
        rec.read(f"{b}/aggregate_contract_amount", r.get("total_amount"))
        rec.read(f"{b}/obligor_concentration_pct", r.get("concentration_pct"))
        rec.read(f"{b}/concentration_limit_pct", r.get("limit_pct"))
        rec.read(f"{b}/concentration_limit_per_obligor", r.get("limit_per_obligor"))
        rec.read(f"{b}/excess_concentration_amount", r.get("excess_amount"))

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

    if period and (bal or not partial):
        rec.derived(f"{ph}/period", period, "collection period (cover)", [cov["collection_start"]])
        rec.derived(f"{ph}/collection_period", coll_label, "collection period (cover)", [cov["collection_start"]])
    elif not partial and not bal:
        rec.empty("/period_history")

    # ---------------- ratio history
    s = Series(p)
    cur_month = p.aggregate[0]["month"].value if p.aggregate else None
    if p.aggregate or p.borrower or not partial:
        rec.empty("/ratio_history")
        for i, m in enumerate(s.months):
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

    # ---------------- cumulative losses by semi-annual period
    cnl_limit, cnl_test = _cnl_limit(p)
    if p.extra.get("cnl_summary") or not partial:
        _cnl(p, rec, der, cnl_limit, cnl_test)

    # ---------------- covenants, summary, financial ratios
    worst = _worst(p, cnl_limit)
    if p.tests and cur_month:
        covs = _covenants(p, s, cur_month, worst, cnl_limit, der, tpl)
        prior_covs = _covenants(p, s, _prev_mon_yy(cur_month), None, cnl_limit, der, tpl, prior_deal=prior_deal)
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
                rec.derived(f"{b}/vintage", vintage["label"], "worst semi-annual period by CNL ratio / limit", [vintage["period"]])
            j += 1
    elif not partial:
        rec.empty("/covenants")
        rec.empty("/prior_covenants")
        for k in ("BREACH", "WATCH", "OK", "AVAILABLE"):
            rec.const(f"/covenant_summary/{k}", 0, "no quantitative tests extracted")
        rec.read("/worst_status", None)
        rec.empty("/financial_ratios")
    return rec.deal


def _tranches(p: Parsed, rec: Recorder, bal: list[dict], spot: F, sec: dict, der: dict):
    """all_tranches (CAD-equivalent opening/closing per dated tranche row) and the top movers by CAD-equivalent
    change, with currency and rate type."""
    tb = "/tranche_balance"
    base = p.template["currencies"]["base"]
    rule, dec = sec["all_tranches"], der["cad_equivalent_decimals"]

    def amount(f: Optional[F], r: dict):
        # ("read", F) for a printed cell, ("derived", value, formula, inputs) otherwise
        return ("read", f) if f is not None else ("derived", 0.0, "blank cell", [r["tranche"]])

    cands = []
    for pg in bal:
        t = pg["total"]
        if rule.get("skip_pages_with_zero_totals") and not _v(t.get("opening")) and not _v(t.get("closing")):
            continue
        for r in pg["rows"]:
            if rule.get("require_date") and r.get("date") is None:
                continue
            if pg["currency"] == base:
                oe, ce = amount(r.get("opening"), r), amount(r.get("closing"), r)
            else:
                oe = ("derived", round(_v(r.get("opening")) * spot.value, dec),
                      f"opening x spot rate, rounded to {dec} decimals", _ins([r.get("opening"), r["tranche"], spot]))
                ce = amount(r.get("closing_cad_equivalent"), r)
            cands.append({"row": r, "page": pg, "open": oe, "close": ce})

    def val(a) -> float:
        return _v(a[1]) if a[0] == "read" else a[1]

    def write(ptr, a):
        rec.read(ptr, a[1]) if a[0] == "read" else rec.derived(ptr, a[1], a[2], a[3])

    rec.empty(f"{tb}/all_tranches")
    for i, cd in enumerate(cands):
        b = f"{tb}/all_tranches/{i}"
        rec.read(f"{b}/tranche", cd["row"]["tranche"])
        write(f"{b}/opening", cd["open"])
        write(f"{b}/closing", cd["close"])
    movers = sorted(cands, key=lambda cd: -abs(val(cd["close"]) - val(cd["open"])))[:der["top_movers"]["tranche"]]
    rec.empty(f"{tb}/top_movers")
    for i, cd in enumerate(movers):
        r, pg = cd["row"], cd["page"]
        b = f"{tb}/top_movers/{i}"
        rec.read(f"{b}/leasing_date", r.get("date"))
        rec.read(f"{b}/tranche", r["tranche"])
        rec.const(f"{b}/currency", pg["currency"], f"page heading currency (p.{pg['page']})")
        rec.const(f"{b}/rate_type", pg["rate_type"], f"page heading rate type (p.{pg['page']})")
        for k, cname in (("original_tranche_balance", "original"), ("opening_tranche_balance", "opening"),
                         ("current_period_effective_tranche_yield", "effective_yield"),
                         ("closing_tranche_balance", "closing")):
            write(f"{b}/{k}", amount(r.get(cname), r))
        write(f"{b}/opening_tranche_balance_cad_equivalent", cd["open"])


def _cnl_limit(p: Parsed) -> tuple[Optional[float], Optional[F]]:
    for t in p.tests:
        if re.search(r"CNL RATIO|CUMULATIVE NET LOSS RATIO", norm(t["desc"])):
            pcts = re.findall(r"(\d+(?:\.\d+)?)\s?%", t["desc"])
            if pcts:
                return float(pcts[0]) / 100, F(None, t["page"], t["raw"], t["bbox"])
    return None, None


def _cnl(p: Parsed, rec: Recorder, der: dict, limit: Optional[float], limit_src: Optional[F]):
    sec = p.template["sections"]["cumulative_losses"]
    rows, summary, totals = p.extra.get("cnl_rows") or [], p.extra.get("cnl_summary") or [], p.extra.get("cnl_totals") or {}
    rec.empty("/cnl_by_period")
    for i, srow in enumerate(sorted(summary, key=lambda r: r["period"].value)):
        n = srow["period"].value
        members = [r for r in rows if r["semi"].value == n]
        b = f"/cnl_by_period/{i}"
        rec.read(f"{b}/semi_annual_period", srow["period"])
        labels = [sec["tranche_label"][r["currency"]].format(tranche=r["tranche"]) for r in members]
        semis = [r["semi"] for r in members]
        rec.derived(f"{b}/tranches", ", ".join(labels), "tranches of this semi-annual period, in printed order",
                    semis or [srow["period"]])
        orig = [r.get("original") for r in members]
        cnl = [r.get("cumulative_net_losses") for r in members]
        so, sc = _sum(orig), round(_sum(cnl), 2)
        rec.derived(f"{b}/period_original_balance", so, "sum of original tranche balance (CAD equivalent)", orig or semis)
        rec.derived(f"{b}/period_cumulative_net_losses", sc, "sum of cumulative net losses per tranche", cnl or semis)
        ratio = round(sc / so, der["cnl_ratio_decimals"]) if so else None
        rec.derived(f"{b}/cnl_ratio_pct", ratio, "period cumulative net losses / period original balance", (cnl + orig) or semis)
        rec.read(f"{b}/cnl_ratio_reported_pct", srow["ratio"])
        if limit is not None:
            rec.derived(f"{b}/cnl_limit", limit, "CNL ratio limit (quantitative tests page)", [limit_src])
            rec.derived(f"{b}/cnl_within_limit", None if ratio is None else ratio <= limit, "cnl_ratio_pct <= cnl_limit",
                        [srow["ratio"], limit_src])
    if totals:
        rec.read("/cnl_pool_totals/original_tranche_balance", totals.get("original"))
        rec.read("/cnl_pool_totals/cumulative_net_losses", totals.get("cumulative_net_losses"))
        src = sec["pool_totals_source"].format(file=Path(p.source_file).name, page=totals["page"])
        rec.derived("/cnl_pool_totals/source", src, "file and page of the Pool Balance Totals row", [totals.get("original")])


def _worst(p: Parsed, limit: Optional[float]) -> Optional[dict]:
    best = None
    for r in p.extra.get("cnl_summary") or []:
        v = r["ratio"].value
        if v is None:
            continue
        u = v / limit if limit else v
        if best is None or u > best["util"]:
            best = {"util": u, "ratio": r["ratio"], "period": r["period"], "limit": limit,
                    "label": f"Period {r['period'].value}"}
    return best


def _metric(s: Series, series: str, month: str, window: Optional[int]) -> tuple[Optional[F], Optional[F]]:
    """(value, previous value) of a series as of `month`. With a window: the highest value of the `window` months
    ending at `month`, and the same for the month before. Without: the latest printed value at or before `month`
    and the printed value before it (quarterly or lagged series carry forward)."""
    h = [(m, f) for m, f in s.history(series) if f.value is not None]
    if window:
        def mx(end):
            fs = [f for m, f in h if 0 <= _months_between(m, end) < window]
            return max(fs, key=lambda f: f.value) if fs else None
        return mx(month), mx(_prev_mon_yy(month))
    upto = [f for m, f in h if _month_key(m) <= _month_key(month)]
    return (upto[-1] if upto else None), (upto[-2] if len(upto) > 1 else None)


def _covenants(p: Parsed, s: Series, month: str, worst: Optional[dict], cnl_limit: Optional[float], der: dict,
               tpl: dict, prior_deal: dict | None = None) -> list[tuple[dict, dict]]:
    sec = tpl["sections"]["quantitative_tests"]
    out = []
    for t in p.tests:
        nd = norm(t["desc"])
        metric = next((m for m in sec["metrics"] if re.search(m["match"], nd)), None)
        test_src = F(None, t["page"], t["raw"], t["bbox"])
        c = {"category": t["category"], "legal_ref": t["ref"], "description": t["desc"]}
        srcs: dict = {"_inputs": [test_src]}
        if metric is None:
            pc = re.findall(r"(\d+(?:\.\d+)?)\s?%", t["desc"])
            c.update({"current_value": None, "threshold": float(pc[0]) / 100 if pc else None, "kind": "binary",
                      "utilization_pct": None, "trend": "n/a",
                      "status": "BREACH" if t["answer"] == "YES" else "OK", "note": sec["binary_note"]})
        else:
            series, kind = metric["series"], metric["kind"]
            if series == "cnl_worst_vintage":
                if worst is not None:
                    vf, v, wv = worst["ratio"], worst["ratio"].value, worst["label"]
                else:   # the prior period's CNL is not on this report; from the prior extraction when supplied
                    pc = next((x for x in (prior_deal or {}).get("covenants", []) if x.get("legal_ref") == t["ref"]), None)
                    vf, v, wv = None, (pc or {}).get("current_value"), (pc or {}).get("worst_vintage")
                thr, trend = cnl_limit, "n/a"
            else:
                vf, pf = _metric(s, series, month, metric.get("window"))
                v = None if vf is None else vf.value
                thr, _ = _threshold(t, series, s, month, worst)
                trend = _trend(v, None if pf is None else pf.value, der["trend_flat_band"])
            util = None
            if v is not None and thr:
                util = round(v / thr, 4) if kind == "ceiling" else (round(thr / v, 4) if v else None)
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
