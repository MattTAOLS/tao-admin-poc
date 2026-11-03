"""Template-driven section parsing: report pages -> raw fields with provenance.

Deterministic first. Every value comes from a located table row or labelled line and carries the page, bbox and
the text as printed. Fields the parser cannot place are listed in `Parsed.unplaced`; `ModelFallback` asks Claude
(model from ANTHROPIC_MODEL) for exactly those cells, with the page text and the field list in the prompt, and
validates the JSON it returns. No whole-page model calls when a table parses.

Nothing in here names a deal or a servicer: layouts are told apart by header keywords listed in the template.
"""
from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import yaml

from .parse import Cell, DASHES, align_columns, cells, is_advance_date, is_month, is_number, parse_number, row_cells
from .text import Line, Page, norm

log = logging.getLogger("extract.mapper")
TEMPLATES = Path(__file__).resolve().parent / "templates"


# ---------------------------------------------------------------- data holders
@dataclass
class F:
    """One extracted value with provenance."""
    value: Any
    page: int
    raw: str
    bbox: Optional[list[float]] = None
    confidence: float = 1.0

    @classmethod
    def of(cls, c: Cell, page: int) -> "F":
        return cls(c.value, page, c.raw, [round(x, 2) for x in c.bbox])


@dataclass
class Parsed:
    template: dict
    page_count: int
    source_file: str = ""
    cover: dict = field(default_factory=dict)              # borrower, settlement_date, collection_start, reporting_period
    source_pages: dict = field(default_factory=dict)       # section key -> page
    funded_total: dict = field(default_factory=dict)       # column -> F
    funded_advances: list = field(default_factory=list)    # [{advance_date: F, advance_no: F, <column>: F}]
    contracts_total: dict = field(default_factory=dict)
    contracts_advances: list = field(default_factory=list)
    principal: dict = field(default_factory=dict)          # line field -> F
    cost_of_funds: dict = field(default_factory=dict)
    warehouse: Optional[dict] = None
    enhancement: dict = field(default_factory=dict)
    aging: dict = field(default_factory=dict)
    aggregate: list = field(default_factory=list)          # [{month: F, <column>: F}] in printed order (newest first)
    cnl: list = field(default_factory=list)                # [{period: F, advances: F|None, <column>: F}]
    cnl_base_field: str = "original_finance_contract_npv"
    borrower: dict = field(default_factory=dict)           # month -> {series: F}
    tests: list = field(default_factory=list)              # [{ref, desc, answer, conditional: [...], page, bbox}]
    unplaced: list = field(default_factory=list)           # [(section, field, page_hint)]
    notes: list = field(default_factory=list)


def load_template(template_id: str) -> dict:
    path = TEMPLATES / f"{template_id}.yaml"
    if not path.exists():
        raise FileNotFoundError(f"no extraction template {template_id!r} in {TEMPLATES}")
    return yaml.safe_load(path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------- document navigation
class Doc:
    def __init__(self, pages: list[Page]):
        self.pages = {p.number: p for p in pages}

    def find(self, pattern: str, hint: int | None = None, skip_toc: bool = True) -> Optional[tuple[Page, int]]:
        rx = re.compile(pattern)
        order = sorted(self.pages, key=lambda n: (n != hint, n))
        for n in order:
            p = self.pages[n]
            for i, l in enumerate(p.lines):
                t = norm(l.text)
                if skip_toc and " PG. " in t + " ":
                    continue
                if rx.search(t):
                    return p, i
        return None

    def section(self, pattern: str, hint: int | None = None, end: str | None = None) -> Optional[tuple[Page, list[Line]]]:
        hit = self.find(pattern, hint)
        if not hit:
            return None
        p, i = hit
        out = []
        erx = re.compile(end) if end else None
        for l in p.lines[i + 1:]:
            if erx and erx.search(norm(l.text)):
                break
            out.append(l)
        return p, out


def _header_text(lines: list[Line], until: int) -> str:
    return norm(" ".join(l.text for l in lines[:until]))


def _pick_variant(variants: list[dict], header: str) -> Optional[dict]:
    for v in variants:
        if all(k in header for k in v.get("when_header_has", [])):
            return v
    return None


def _all_numeric(tokens) -> bool:
    return bool(tokens) and all(is_number(t.text) or t.text in DASHES or
                                (t.text.endswith("-") and is_number(t.text[:-1])) for t in tokens)


def _drop_footnote_marker(cs: list[Cell], expected: int) -> list[Cell]:
    """'Jan-26 ¹ 55,096,943 ...': a bare 1-2 digit integer right after the label, when there is one cell too many."""
    if len(cs) == expected + 1 and re.fullmatch(r"\d{1,2}", cs[0].raw):
        return cs[1:]
    return cs


def _first_number_after(line: Line, label_rx: re.Pattern, skip_dates: bool = False) -> Optional[tuple[str, Cell]]:
    """For 'LABEL ... 1,234.56 trailing-text' lines: the label is the text before the first numeric token."""
    toks = line.tokens
    for k, t in enumerate(toks):
        txt = t.text
        if skip_dates and is_advance_date(txt):
            continue
        m = re.match(r"^\(?-?[\d,]*\d(\.\d+)?%?\)?", txt)
        if (m and (is_number(m.group(0)))) or txt in DASHES:
            label = norm(" ".join(x.text for x in toks[:k] if not (skip_dates and is_advance_date(x.text))))
            if not label_rx.search(label):
                return None
            raw = txt if txt in DASHES else m.group(0)
            return label, Cell(raw, parse_number(raw), [t.x0, t.top, t.x1, t.bottom], raw.endswith("%"))
    return None


# ---------------------------------------------------------------- section parsers
def parse_cover(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["cover"]
    p = doc.pages.get(sec.get("page_hint", 1)) or next(iter(doc.pages.values()))
    for key, pat in sec["patterns"].items():
        rx = re.compile(pat)
        for l in p.lines:
            m = rx.search(norm(l.text))
            if m:
                # keep the printed casing: map the match span back onto the original text
                orig = re.sub(r"\s+", " ", l.text).strip()
                val = orig[m.start("v"):m.end("v")] if len(orig) == len(norm(l.text)) else m.group("v").title()
                out.cover[key] = F(val, p.number, l.text, l.bbox)
                break
        else:
            out.unplaced.append(("cover", key, p.number))
    rp = re.compile(tpl["sections"]["reporting_period"]["pattern"])
    for n in sorted(doc.pages):
        for l in doc.pages[n].lines:
            m = rp.search(norm(l.text))
            if m:
                out.cover["reporting_period"] = F(m.group("v"), n, l.text, l.bbox)
                return


def _parse_rows_table(doc: Doc, sec: dict, key: str, out: Parsed) -> tuple[dict, list, Optional[int]]:
    s = doc.section(sec["heading"], sec.get("page_hint"), sec.get("end"))
    if not s:
        out.unplaced.append((key, "*", sec.get("page_hint")))
        return {}, [], None
    page, lines = s
    first_data = next((i for i, l in enumerate(lines) if _all_numeric(l.tokens[1:]) and len(l.tokens) > 3), len(lines))
    header = _header_text(lines, first_data)
    v = _pick_variant(sec["variants"], header)
    if v is None:
        out.unplaced.append((key, "variant", page.number))
        out.notes.append(f"{key}: no layout variant matched header {header[:120]!r}")
        return {}, [], page.number
    total: dict = {}
    advances: list = []
    nlabel = len(v.get("advance_rows", {}).get("label", []))
    trow = v.get("total_row")
    trx = re.compile(trow["label"]) if trow else None
    pending: list[tuple[list, list[Cell]]] = []
    for l in lines:
        toks = l.tokens
        if v.get("advance_rows") and len(toks) > nlabel:
            lab = toks[:nlabel]
            ok = (nlabel == 2 and is_advance_date(lab[0].text) and lab[1].text.isdigit()) or \
                 (nlabel == 1 and lab[0].text.isdigit())
            if ok and _all_numeric(toks[nlabel:]):
                _, cs = row_cells(l, nlabel)
                pending.append((lab, cs))
                continue
        if trx is not None and not total:
            label, cs = row_cells(l)
            if trx.search(norm(label)) and len(cs) == len(trow["columns"]):
                total = {c: F.of(cell, page.number) for c, cell in zip(trow["columns"], cs)}
    if pending:
        ncol = len(v["columns"])
        if all(len(cs) == ncol for _, cs in pending):
            grid = [cs for _, cs in pending]
        else:
            grid = align_columns([cs for _, cs in pending], ncol)
            if grid is None:
                out.notes.append(f"{key}: advance rows do not resolve into {ncol} columns")
                out.unplaced.append((key, "advance_rows", page.number))
                grid = []
            else:
                out.notes.append(f"{key}: blank cells present; columns placed by right-edge alignment")
        for (lab, _), cs in zip(pending, grid):
            row = {c: (F.of(cell, page.number) if cell is not None else F(None, page.number, "", None))
                   for c, cell in zip(v["columns"], cs)}
            if nlabel == 2:
                row["advance_date"] = F(lab[0].text, page.number, lab[0].text, lab[0].bbox)
            row["advance_no"] = F(int(lab[-1].text), page.number, lab[-1].text, lab[-1].bbox)
            advances.append(row)
    if trow and not total:
        out.unplaced.append((key, "total", page.number))
    return total, advances, page.number


def parse_funded(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["funded_contracts"]
    out.funded_total, out.funded_advances, pg = _parse_rows_table(doc, sec, "funded_contracts", out)
    out.source_pages[sec["source_page_key"]] = pg


def parse_contracts(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["outstanding_contracts"]
    out.contracts_total, out.contracts_advances, pg = _parse_rows_table(doc, sec, "outstanding_contracts", out)
    out.source_pages[sec["source_page_key"]] = pg


def _parse_lines(doc: Doc, sec: dict, key: str, out: Parsed, skip_dates: bool = False) -> tuple[dict, Optional[int]]:
    s = doc.section(sec["heading"], sec.get("page_hint"))
    if not s:
        return {}, None
    page, lines = s
    got: dict = {}
    for fkey, pat in sec["lines"].items():
        rx = re.compile(pat)
        for l in lines:
            r = _first_number_after(l, rx, skip_dates)
            if r:
                got[fkey] = F.of(r[1], page.number)
                break
    return got, page.number


def parse_principal(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["principal_balances"]
    out.principal, pg = _parse_lines(doc, sec, "principal_balances", out)
    out.source_pages[sec["source_page_key"]] = pg
    s = doc.section(sec["heading"], sec.get("page_hint"))
    if s:
        page, lines = s
        tr = sec["total_row"]
        for l in lines:
            label, cs = row_cells(l)
            cols = tr["by_cell_count"].get(len(cs))
            if cols and re.search(tr["label"], norm(label)):
                out.principal.update({c: F.of(cell, page.number) for c, cell in zip(cols, cs)})
                break
    for k in ("term_limit", "closing_principal", "availability"):
        if k not in out.principal:
            out.unplaced.append(("principal_balances", k, pg or sec.get("page_hint")))


def parse_cost_of_funds(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["cost_of_funds"]
    out.cost_of_funds, pg = _parse_lines(doc, sec, "cost_of_funds", out, skip_dates=True)
    out.source_pages[sec["source_page_key"]] = pg
    if "opening_advances" not in out.cost_of_funds:
        out.unplaced.append(("cost_of_funds", "opening_advances", pg or sec.get("page_hint")))


def parse_warehouse(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["warehouse"]
    s = doc.section(sec["heading"], sec.get("page_hint"))
    if not s:
        out.warehouse = None      # this facility has no warehouse line
        return
    page, lines = s
    for l in lines:
        label, cs = row_cells(l)
        tr = sec["total_row"]
        if re.search(tr["label"], norm(label)) and len(cs) >= 2:
            out.warehouse = {"opening": F.of(cs[tr["opening_index"]], page.number),
                             "closing": F.of(cs[tr["closing_index"]], page.number)}
            return
    out.warehouse = {}
    out.unplaced.append(("warehouse", "total", page.number))


def parse_enhancement(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["enhancement"]
    got, pg = _parse_lines(doc, sec, "enhancement", out)
    out.source_pages[sec["source_page_key"]] = pg
    out.enhancement = dict(got)
    if "total_amount" in got:
        return
    s = doc.section(sec["unfunded_heading"], pg)
    if not s:
        out.unplaced.append(("enhancement", "total_amount", pg))
        return
    page, lines = s
    cols = sec["unfunded_columns"]
    for l in reversed(lines):
        label, cs = row_cells(l)
        if norm(label) in ("", "TOTAL") and len(cs) in (len(cols["with_actual"]), len(cols["plain"])):
            if len(cs) == len(cols["with_actual"]):
                out.enhancement["unfunded_actual"] = F.of(cs[cols["with_actual"].index("actual_unfunded_amount")], page.number)
            else:
                out.enhancement["unfunded_actual"] = F(0.0, page.number, l.text, l.bbox)
            out.enhancement["unfunded_page"] = page.number
            return
    out.unplaced.append(("enhancement", "unfunded_total", page.number))


def parse_aging(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["aging"]
    s = doc.section(sec["heading"], sec.get("page_hint"))
    if not s:
        out.unplaced.append(("aging", "*", sec.get("page_hint")))
        return
    page, lines = s
    out.source_pages[sec["source_page_key"]] = page.number
    for k in sec.get("also_source_page_keys", []):
        out.source_pages[k] = page.number
    for i, l in enumerate(lines):
        label, cs = row_cells(l)
        header = _header_text(lines, i)
        v = _pick_variant(sec["variants"], header)
        if v and len(cs) == len(v["columns"]):
            out.aging = {c: F.of(cell, page.number) for c, cell in zip(v["columns"], cs)}
            return
    out.unplaced.append(("aging", "row", page.number))


def _month_rows(lines: list[Line], columns: list[str], page: int, out: Parsed, key: str) -> list[dict]:
    rows = []
    for l in lines:
        if l.tokens and is_month(l.tokens[0].text) and _all_numeric(l.tokens[1:]):
            _, cs = row_cells(l, 1)
            cs = _drop_footnote_marker(cs, len(columns))
            if len(cs) != len(columns):
                out.notes.append(f"{key}: {l.tokens[0].text} has {len(cs)} cells, expected {len(columns)}")
                continue
            row = {"month": F(l.tokens[0].text, page, l.tokens[0].text, l.tokens[0].bbox)}
            row.update({c: F.of(cell, page) for c, cell in zip(columns, cs)})
            rows.append(row)
    return rows


def parse_aggregate(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["aggregate_performance"]
    s = doc.section(sec["heading"], sec.get("page_hint"), end=tpl["sections"]["cumulative_losses"]["heading"])
    if not s:
        out.unplaced.append(("aggregate_performance", "*", sec.get("page_hint")))
        return
    page, lines = s
    out.source_pages[sec["source_page_key"]] = page.number
    for k in sec.get("also_source_page_keys", []):
        out.source_pages[k] = page.number
    first = next((i for i, l in enumerate(lines) if l.tokens and is_month(l.tokens[0].text)), len(lines))
    v = _pick_variant(sec["variants"], _header_text(lines, first))
    out.aggregate = _month_rows(lines, v["columns"], page.number, out, "aggregate_performance")
    if not out.aggregate:
        out.unplaced.append(("aggregate_performance", "rows", page.number))


def parse_cnl(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["cumulative_losses"]
    s = doc.section(sec["heading"], sec.get("page_hint"))
    if not s:
        out.unplaced.append(("cumulative_losses", "*", sec.get("page_hint")))
        return
    page, lines = s
    first = next((i for i, l in enumerate(lines) if re.match(r"^[A-Z][a-z]{2}-\d{2} ", l.text)), len(lines))
    v = _pick_variant(sec["variants"], _header_text(lines, first))
    out.cnl_base_field = v["base_field"]
    prx = re.compile(sec["period_row"])
    for l in lines:
        m = prx.match(l.text + " ")
        if not m:
            continue
        ntok = 3
        adv = None
        if v["with_advance_range"] and m.group("advances"):
            adv_txt = m.group("advances")
            k = len(adv_txt.split())
            adv = F(adv_txt, page.number, adv_txt, None)
            ntok += k
        label_toks, vals = l.tokens[:ntok], l.tokens[ntok:]
        cs = cells(vals, left_edge=label_toks[-1].x1)
        if len(cs) != len(sec["columns"]):
            out.notes.append(f"cumulative_losses: {m.group('period')} has {len(cs)} cells")
            continue
        row = {"period": F(m.group("period"), page.number, m.group("period"), label_toks[0].bbox), "advances": adv}
        row.update({c: F.of(cell, page.number) for c, cell in zip(sec["columns"], cs)})
        out.cnl.append(row)
    if not out.cnl:
        out.unplaced.append(("cumulative_losses", "rows", page.number))


def parse_borrower(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["borrower_ratios"]
    s = doc.section(sec["heading"], sec.get("page_hint"))
    if not s:
        return      # not every borrower reports these (no ratio data series)
    page, lines = s
    header: list[str] = []
    spec = None
    for l in lines:
        if l.tokens and is_month(l.tokens[0].text) and _all_numeric(l.tokens[1:]):
            if header:
                h = norm(" ".join(header))
                spec = next((t for t in sec["tables"] if all(k in h for k in t["when_header_has"])), None)
                header = []
            if spec is None:
                continue
            _, cs = row_cells(l, 1)
            # the ratio column is the one printed as a plain decimal ("7.57"); see template `pick`
            ratio_idx = next((i for i, c in enumerate(cs) if re.fullmatch(r"-?\d{1,3}\.\d{2}", c.raw)), None)
            if ratio_idx is None:
                continue
            month = l.tokens[0].text
            got = out.borrower.setdefault(month, {})
            for fld, rel in spec["pick"].items():
                i = ratio_idx + rel
                if 0 <= i < len(cs):
                    got[fld] = F.of(cs[i], page.number)
        else:
            header.append(l.text)


def parse_tests(doc: Doc, tpl: dict, out: Parsed):
    sec = tpl["sections"]["quantitative_tests"]
    s = doc.section(sec["heading"], sec.get("page_hint"))
    if not s:
        out.unplaced.append(("quantitative_tests", "*", sec.get("page_hint")))
        return
    page, lines = s
    out.source_pages[sec["source_page_key"]] = page.number
    trx = re.compile(sec["test_row"], re.I)
    crx = re.compile(sec["conditional_threshold"])
    cur = None
    for l in lines:
        text = _repair_overlap(re.sub(r"\s+", " ", l.text).strip())
        m = trx.match(text)
        if m:
            cur = {"ref": _norm_ref(m.group("ref")), "desc": m.group("desc").strip(),
                   "answer": (m.group("answer") or "").upper() or None, "conditional": [],
                   "page": page.number, "bbox": l.bbox, "raw": l.text}
            out.tests.append(cur)
            continue
        c = crx.match(norm(text).replace("%IF", "% IF"))
        if c and cur is not None:
            cur["conditional"].append({"pct": parse_number(c.group("pct")), "op": c.group("op"),
                                       "amount": parse_number(c.group("amount")), "raw": l.text})
            continue
        t = norm(text)
        if cur is not None and not cur["conditional"] and not t.startswith("*") and not re.fullmatch(r"\d+", t) \
                and t not in ("CLEAN-UP PROVISION", "EVENTS OF DEFAULT EVENT TRIGGERED?"):
            # wrapped description line; the YES/NO answer sat at the end of the first line
            cur["desc"] = (cur["desc"] + " " + text).strip()
            cur["raw"] += "\n" + l.text
        else:
            cur = None if t.startswith("*") or t == "CLEAN-UP PROVISION" else cur
    if not out.tests:
        out.unplaced.append(("quantitative_tests", "rows", page.number))


def _norm_ref(ref: str) -> str:
    """'SLFA 9.1(c)' and 'SLFA 9.1 (c)' are the same reference; store the spaced form."""
    return re.sub(r"\s*\(", " (", re.sub(r"\s+", " ", ref)).strip()


def _repair_overlap(s: str) -> str:
    """A legal-ref cell that overflows into the description interleaves glyphs: '7.2 (Hi)as the' is '7.2 (i) Has the'."""
    return re.sub(r"\((?P<a>[A-Z])(?P<b>[a-z])\)(?P<rest>[a-z]+)", lambda m: f"({m['b']}) {m['a']}{m['rest']}", s)


PARSERS = [parse_cover, parse_funded, parse_contracts, parse_principal, parse_cost_of_funds, parse_warehouse,
           parse_enhancement, parse_aging, parse_aggregate, parse_cnl, parse_borrower, parse_tests]


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


# ---------------------------------------------------------------- model fallback
FALLBACK_SCHEMA = {
    "type": "object",
    "required": ["cells"],
    "properties": {"cells": {"type": "array", "items": {
        "type": "object", "required": ["field", "value", "page", "raw_text"],
        "properties": {"field": {"type": "string"}, "value": {"type": ["number", "string", "null"]},
                       "page": {"type": "integer", "minimum": 1}, "raw_text": {"type": "string"}}}}},
}


class ModelFallback:
    """Asks Claude for the cells the parser could not place. Off unless ANTHROPIC_API_KEY and ANTHROPIC_MODEL are
    set. Every call is logged with prompt size and the fields asked; `calls` keeps the same record in memory."""

    def __init__(self, model: str | None = None, client: Any = None):
        self.model = model or os.environ.get("ANTHROPIC_MODEL") or ""
        self.client = client
        self.calls: list[dict] = []

    @property
    def enabled(self) -> bool:
        return bool(self.model) and (self.client is not None or bool(os.environ.get("ANTHROPIC_API_KEY")))

    def build_prompt(self, fields: list[tuple[str, str]], pages: dict[int, str]) -> str:
        page_text = "\n\n".join(f"--- page {n} ---\n{t}" for n, t in sorted(pages.items()))
        wanted = "\n".join(f"- {sec}.{fld}" for sec, fld in fields)
        return (
            "You read a settlement report (SetRep). The deterministic parser could not place the fields below.\n"
            "For each field, find the cell on the pages given and return it exactly as printed.\n"
            "Rules: '-' alone is zero; '#N/A' rows are placeholders, skip them; percentages are returned as printed "
            "(e.g. \"1.79%\"); do not compute anything.\n"
            f"Fields:\n{wanted}\n\n{page_text}\n\n"
            'Answer with JSON only: {"cells": [{"field": "<section.field>", "value": <number|string|null>, '
            '"page": <int>, "raw_text": "<cell text as printed>"}]}'
        )

    def ask(self, fields: list[tuple[str, str]], pages: dict[int, str]) -> list[dict]:
        if not fields:
            return []
        prompt = self.build_prompt(fields, pages)
        rec = {"model": self.model or None, "prompt_chars": len(prompt), "fields": [f"{s}.{f}" for s, f in fields],
               "pages": sorted(pages), "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "status": "skipped"}
        self.calls.append(rec)
        if not self.enabled:
            log.info("model fallback skipped (no model configured): %s", rec)
            return []
        import jsonschema
        try:
            client = self.client
            if client is None:
                import anthropic
                client = anthropic.Anthropic()
            msg = client.messages.create(model=self.model, max_tokens=2000,
                                         messages=[{"role": "user", "content": prompt}])
            text = "".join(getattr(b, "text", "") for b in msg.content).strip()
            text = re.sub(r"^```(json)?|```$", "", text).strip()
            data = json.loads(text)
            jsonschema.validate(data, FALLBACK_SCHEMA)
            rec["status"] = "ok"
            rec["returned"] = len(data["cells"])
            log.info("model fallback call: %s", rec)
            return data["cells"]
        except Exception as e:
            rec["status"] = f"error: {type(e).__name__}: {e}"
            log.warning("model fallback call failed: %s", rec)
            return []
