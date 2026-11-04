"""Engine for payment-date servicer reports (template `engine: servicer_report`).

The layout: a cover block "Payment Date <date> for Collection Period <month>", a per-tranche contract-balance
roll-forward (page 2), outstanding balances (page 3), funding costs (page 6), overcollateralization enhancement and
cash reserve (page 7), a concentration page (page 8), lock-up / event-of-default ratio tests with their own
histories, CNL by annual origination period and servicer termination events (page 11), and an aging table per
tranche (page 12). Headings, column orders, row labels, legal references and wording come from the template; this
module has no deal or servicer names in it.

parse(pages, page_count, tpl) -> mapper.Parsed (everything in `parsed.extra`, plus the cover fields extract()
reads: collection_start, settlement_date, reporting_period). build(parsed, recorder, *, prior, partial) writes the
deal object; every non-null leaf goes through the Recorder so it has a `sources` entry.
"""
from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Optional

from ..derive import _status, _trend, slugify
from ..mapper import Doc, F, Parsed
from ..parse import cells, is_advance_date, is_number, numeric_tail, row_cells
from ..provenance import Recorder
from ..text import Line, Page, norm


# ---------------------------------------------------------------- line helpers
def _collapse(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def _decorated(line: Line, tpl: dict, nlabel: int | None = None):
    """-> (label tokens, value cells, answer token or None) with the form's row number and status word removed."""
    deco = tpl.get("line_decorations", {})
    toks = list(line.tokens)
    keep = {k.upper() for k in deco.get("row_number_keeps_before", [])}
    if deco.get("row_number_prefix") and len(toks) > 1 and toks[0].text.isdigit() and toks[1].text.upper() not in keep:
        toks = toks[1:]
    suffixes = {s.upper() for s in deco.get("status_suffixes", [])}
    while toks and toks[-1].text.upper() in suffixes:
        toks = toks[:-1]
    answer = None
    answers = tpl["covenants"].get("answers", {})
    if len(toks) > 1 and toks[-1].text.upper() in answers and not is_number(toks[-1].text):
        answer, toks = toks[-1], toks[:-1]
    if not toks:
        return [], [], answer
    if nlabel is None:
        label, vals = numeric_tail(Line(toks))
    else:
        label, vals = toks[:nlabel], toks[nlabel:]
    try:
        cs = cells(vals, left_edge=label[-1].x1 if label else None)
    except ValueError:
        cs = []
    return label, cs, answer


def _text(tokens) -> str:
    return " ".join(t.text for t in tokens)


def _bbox(tokens) -> Optional[list[float]]:
    if not tokens:
        return None
    return [round(min(t.x0 for t in tokens), 2), round(min(t.top for t in tokens), 2),
            round(max(t.x1 for t in tokens), 2), round(max(t.bottom for t in tokens), 2)]


def _labelled_value(line: Line, rx: re.Pattern, page: int) -> Optional[F]:
    """'LABEL ... $1,234.56 trailing-text': the label is the text before the first numeric token."""
    toks = line.tokens
    for k, t in enumerate(toks):
        if is_number(t.text):
            if not rx.search(norm(_text(toks[:k]))):
                return None
            c = cells([t])[0]
            return F.of(c, page)
    return None


# ---------------------------------------------------------------- parse
def _parse_cover(doc: Doc, tpl: dict, out: Parsed):
    spec = tpl["cover"]
    page = doc.pages.get(spec.get("page", 1))
    if page is None:
        return
    for key, pat in spec["patterns"].items():
        rx = re.compile(pat, re.I)
        for l in page.lines:
            m = rx.search(_collapse(l.text))
            if m:
                for g, v in m.groupdict().items():
                    if v is not None:
                        out.cover[g] = F(v, page.number, l.text, l.bbox)
                break
        else:
            out.unplaced.append(("cover", key, page.number))
    rm = out.cover.get("report_month")
    if rm is not None:
        d = datetime.strptime(rm.value.title(), tpl["dates"]["report_month"])
        out.cover["reporting_period"] = F(d.strftime("%B %Y"), rm.page, rm.raw, rm.bbox)


def _rows_table(doc: Doc, tpl: dict, key: str, out: Parsed):
    sec = tpl["sections"][key]
    s = doc.section(sec["heading"], sec.get("page_hint"))
    if not s:
        out.unplaced.append((key, "*", sec.get("page_hint")))
        return
    page, lines = s
    nlabel = len(sec["row_label"])
    rows, total = [], None
    trx = re.compile(sec["total_row"])
    tcols = sec.get("total_columns", sec["columns"])
    for l in lines:
        toks = l.tokens
        if len(toks) > nlabel and is_advance_date(toks[0].text) and toks[1].text.isdigit():
            _, cs = row_cells(l, nlabel)
            if len(cs) != len(sec["columns"]):
                out.notes.append(f"{key}: tranche {toks[1].text} has {len(cs)} cells, expected {len(sec['columns'])}")
                out.unplaced.append((key, f"row {toks[1].text}", page.number))
                continue
            row = {c: F.of(cell, page.number) for c, cell in zip(sec["columns"], cs)}
            row[sec["row_label"][0]] = F(toks[0].text, page.number, toks[0].text, toks[0].bbox)
            row[sec["row_label"][1]] = F(int(toks[1].text), page.number, toks[1].text, toks[1].bbox)
            rows.append(row)
            continue
        if total is None:
            label, cs = row_cells(l)
            if trx.search(norm(label)) and len(cs) == len(tcols):
                total = {c: F.of(cell, page.number) for c, cell in zip(tcols, cs)}
    if total is None:
        out.unplaced.append((key, "total", page.number))
    out.extra[key] = {"page": page.number, "rows": rows, "total": total or {}}


def _total_only(doc: Doc, tpl: dict, key: str, out: Parsed):
    sec = tpl["sections"][key]
    s = doc.section(sec["heading"], sec.get("page_hint"))
    if not s:
        out.unplaced.append((key, "*", sec.get("page_hint")))
        return
    page, lines = s
    trx = re.compile(sec["total_row"])
    for l in lines:
        label, cs = row_cells(l)
        if trx.search(norm(label)) and len(cs) == len(sec["total_columns"]):
            out.extra[key] = {"page": page.number,
                              "total": {c: F.of(cell, page.number) for c, cell in zip(sec["total_columns"], cs)}}
            return
    out.extra[key] = {"page": page.number, "total": {}}
    out.unplaced.append((key, "total", page.number))


def _lines(doc: Doc, tpl: dict, key: str, out: Parsed):
    sec = tpl["sections"][key]
    s = doc.section(sec["heading"], sec.get("page_hint"))
    if not s:
        out.unplaced.append((key, "*", sec.get("page_hint")))
        return
    page, lines = s
    got = {}
    for fld, pat in sec.get("lines", {}).items():
        rx = re.compile(pat)
        for l in lines:
            f = _labelled_value(l, rx, page.number)
            if f is not None:
                got[fld] = f
                break
        else:
            out.unplaced.append((key, fld, page.number))
    out.extra[key] = {"page": page.number, **got}


def _ratio_tests(doc: Doc, tpl: dict, out: Parsed):
    key = "ratio_tests"
    sec = tpl["sections"][key]
    s = doc.section(sec["heading"], sec.get("page_hint"))
    if not s:
        out.unplaced.append((key, "*", sec.get("page_hint")))
        return
    page, lines = s
    pn = page.number
    hist_rx, res_rx = re.compile(sec["history_row"]), re.compile(sec["test_result_row"])
    lt_rx, et_rx = re.compile(sec["lockup_trigger"]), re.compile(sec["eod_trigger"])
    la_rx, ea_rx = re.compile(sec["lockup_triggered"]), re.compile(sec["eod_triggered"])
    cnl, ste = sec["cnl"], sec["servicer_termination"]
    cnl_title, cnl_row = re.compile(cnl["title"]), re.compile(cnl["row"])
    ste_titles = [re.compile(t) for t in ste["titles"]]
    ste_rx = re.compile(ste["triggered"])
    ratios: dict = {}
    cnl_out: dict = {"rows": [], "eod_triggered": None}
    stes: list = []
    state, cur = None, None
    for l in lines:
        t = norm(l.text)
        spec = next((r for r in sec["ratios"] if re.search(r["title"], t)), None)
        if spec:
            state = "ratio"
            cur = {"spec": spec, "title": F(_collapse(l.text), pn, l.text, l.bbox), "history": [], "results": [],
                   "phase": "history"}
            ratios[spec["key"]] = cur
            continue
        if cnl_title.search(t):
            state = "cnl"
            continue
        ti = next((i for i, rx in enumerate(ste_titles) if rx.search(t)), None)
        if ti is not None:
            state = "ste"
            cur = {"title": F(_collapse(l.text), pn, l.text, l.bbox), "triggered": None}
            stes.append(cur)
            continue
        if state == "cnl":
            # "90 Apr 2021 - Mar 2022 $283,328,911.81 ..." : the period label is five tokens
            deco_label, cs5, _ = _decorated(l, tpl, nlabel=5)
            if deco_label and cnl_row.search(norm(_text(deco_label))) and len(cs5) == len(cnl["columns"]):
                row = {c: F.of(cell, pn) for c, cell in zip(cnl["columns"], cs5)}
                row["annual_period"] = F(_text(deco_label), pn, _text(deco_label), _bbox(deco_label))
                cnl_out["rows"].append(row)
                continue
        label, cs, ans = _decorated(l, tpl)
        lab = norm(_text(label))
        if state == "ratio":
            if res_rx.search(lab) and len(cs) == 1:
                cur["phase"] = "results"
                cur["results"].append((F(_text(label), pn, _text(label), _bbox(label)), F.of(cs[0], pn)))
            elif hist_rx.search(lab):
                per = F(_text(label), pn, _text(label), _bbox(label))
                if cur["phase"] == "history" and len(cs) == len(sec["history_columns"]):
                    cur["history"].append({"period": per, **{c: F.of(x, pn) for c, x in zip(sec["history_columns"], cs)}})
                elif cur["phase"] == "results" and len(cs) == 1:
                    cur["results"].append((per, F.of(cs[0], pn)))
            elif lt_rx.search(lab) and len(cs) == 1:
                cur["lockup_trigger"] = F.of(cs[0], pn)
            elif et_rx.search(lab) and len(cs) == 1:
                cur["eod_trigger"] = F.of(cs[0], pn)
            elif la_rx.search(lab) and ans is not None:
                cur["lockup_triggered"] = F(ans.text, pn, l.text, l.bbox)
            elif ea_rx.search(lab) and ans is not None:
                cur["eod_triggered"] = F(ans.text, pn, l.text, l.bbox)
        elif state == "cnl":
            if ea_rx.search(lab) and ans is not None and cnl_out["eod_triggered"] is None:
                cnl_out["eod_triggered"] = F(ans.text, pn, l.text, l.bbox)
        elif state == "ste":
            if ste_rx.search(lab) and ans is not None and cur["triggered"] is None:
                cur["triggered"] = F(ans.text, pn, l.text, l.bbox)
    for r in sec["ratios"]:
        got = ratios.get(r["key"])
        need = ("lockup_trigger", "eod_trigger", "lockup_triggered", "eod_triggered")
        if got is None or not got["history"] or not got["results"] or any(k not in got for k in need):
            out.unplaced.append((key, r["key"], pn))
    if not cnl_out["rows"]:
        out.unplaced.append((key, "cnl", pn))
    if len(stes) != len(ste_titles) or any(x["triggered"] is None for x in stes):
        out.unplaced.append((key, "servicer_termination", pn))
    out.extra[key] = {"page": pn, "ratios": ratios, "cnl": cnl_out, "servicer_termination": stes}


def _heading_page(doc: Doc, tpl: dict, key: str, out: Parsed):
    sec = tpl["sections"][key]
    hit = doc.find(sec["heading"], sec.get("page_hint"))
    if hit:
        out.extra[key] = {"page": hit[0].number}


def parse(pages: list[Page], page_count: int, tpl: dict) -> Parsed:
    doc = Doc(pages)
    out = Parsed(template=tpl, page_count=page_count)
    steps = [(_parse_cover, ()), (_rows_table, ("tranche_balances",)), (_total_only, ("outstanding_balances",)),
             (_lines, ("funding_costs",)), (_lines, ("enhancement",)), (_heading_page, ("concentration",)),
             (_ratio_tests, ()), (_rows_table, ("aging",))]
    for fn, args in steps:
        try:
            fn(doc, tpl, *args, out) if args else fn(doc, tpl, out)
        except Exception as e:     # a broken section must not sink the rest; it is reported as unplaced
            name = args[0] if args else fn.__name__.strip("_")
            out.unplaced.append((name, "*", None))
            out.notes.append(f"{name}: {type(e).__name__}: {e}")
    for k, sec_key in tpl["source_pages"].items():
        if sec_key:
            out.source_pages[k] = (out.extra.get(sec_key) or {}).get("page")
    return out


# ---------------------------------------------------------------- build
def _ym(month_label: str) -> str:
    d = datetime.strptime(_collapse(month_label).title(), "%B %Y")
    return f"{d.year:04d}-{d.month:02d}"


def _prev_ym(ym: str) -> str:
    y, m = map(int, ym.split("-"))
    return f"{y - 1:04d}-12" if m == 1 else f"{y:04d}-{m - 1:02d}"


def _v(f: Optional[F]):
    return None if f is None else f.value


def build(p: Parsed, rec: Recorder, *, prior: dict | None = None, partial: bool = False) -> dict:
    tpl = p.template
    tid = tpl["template_id"]
    der = tpl["derived"]
    const = tpl["constants"]
    cov = p.cover
    x = p.extra
    full = not partial

    # ---------------- identity and periods
    if "issuer" in cov:
        issuer = _collapse(cov["issuer"].value)
        for long, short in (tpl["program"].get("issuer_abbreviations") or {}).items():
            issuer = re.sub(rf"\b{re.escape(long)}\b", short, issuer, flags=re.I)
        name = tpl["program"]["deal_name_format"].format(program=tpl["program"]["name"], issuer=issuer)
        rec.derived("/deal_name", name, f"program name + issuer on the cover, abbreviated ({tid})", [cov["issuer"]])
        rec.derived("/deal_slug", slugify(name), "slug(deal_name)", [cov["issuer"]])
    elif full:
        rec.read("/deal_name", None)
        rec.read("/deal_slug", None)
    if full or p.source_file:
        rec.const("/source_file", Path(p.source_file).name.replace(" ", "_"), "uploaded file name, spaces -> _")
    cp = cov.get("collection_period")
    period = _ym(cp.value) if cp is not None else None
    if full or "settlement_date" in cov:
        rec.read("/settlement_date", cov.get("settlement_date"))
    if cp is not None:
        rec.read("/collection_period", F(_collapse(cp.value), cp.page, cp.raw, cp.bbox))
        rec.derived("/prior_period", _prev_ym(period), "collection period - 1 month", [cp])
    elif full:
        rec.read("/collection_period", None)
        rec.read("/prior_period", None)
    if full:
        rec.const("/terminology", tpl.get("terminology"), "terminology (layout default)")
        for k, sec_key in tpl["source_pages"].items():
            rec.const(f"/source_pages/{k}", p.source_pages.get(k) if sec_key else None,
                      f"page where the {sec_key} heading was found" if sec_key else "layout has no such section")
        rec.const("/watch_buffer_pct", der["watch_buffer_pct"], "derived.watch_buffer_pct")
        rec.empty("/ratio_history")
        rec.empty("/top10_obligors")
        rec.empty("/restatements")
        rec.empty("/balance_discontinuities")
        rec.const("/warehouse", const["warehouse"], "constants.warehouse (layout has no warehouse line)")
        for k, v in const["contracts"].items():
            rec.const(f"/contracts/{k}", v, f"constants.contracts.{k} (layout prints no contract counts)")
        rec.empty("/contracts/top_movers")
        rec.const("/prior_closing_contracts", const["prior_closing_contracts"], "constants.prior_closing_contracts")

    # ---------------- page 2: tranche contract balances
    tbx = x.get("tranche_balances")
    tb = "/tranche_balance"
    tot = (tbx or {}).get("total") or {}
    if tot:
        for key, col in (("opening", "opening"), ("closing", "closing"), ("principal", "principal"),
                         ("principal_prepayments", "prepayments"), ("losses", "deemed_defaults"),
                         ("charge_off", "charge_off"), ("interest", "interest"), ("recoveries", "recoveries")):
            rec.read(f"{tb}/{key}", tot.get(col))
        o, c = _v(tot.get("opening")), _v(tot.get("closing"))
        if o is not None and c is not None:
            rec.derived(f"{tb}/change_abs", c - o, "closing - opening", [tot["closing"], tot["opening"]])
            rec.derived(f"{tb}/change_pct", (c - o) / o if o else None, "(closing - opening) / opening",
                        [tot["closing"], tot["opening"]])
        rec.const(f"{tb}/by_currency", None, "single-currency facility")
        rec.const(f"{tb}/activity_by_currency", None, "single-currency facility")
        rows = tbx["rows"]
        rec.empty(f"{tb}/all_tranches")
        for i, r in enumerate(rows):
            rec.read(f"{tb}/all_tranches/{i}/tranche", r["tranche"])
            rec.read(f"{tb}/all_tranches/{i}/opening", r["opening"])
            rec.read(f"{tb}/all_tranches/{i}/closing", r["closing"])
        rec.empty(f"{tb}/top_movers")
        movers = sorted(rows, key=lambda r: -abs(r["closing"].value - r["opening"].value))[:der["top_movers"]]
        for i, r in enumerate(movers):
            base = f"{tb}/top_movers/{i}"
            rec.read(f"{base}/tranche", r["tranche"])
            rec.read(f"{base}/original_tranche_balance", r["original"])
            rec.read(f"{base}/opening_tranche_balance", r["opening"])
            for k, v in const["tranche_yields"].items():
                rec.const(f"{base}/{k}", v, f"constants.tranche_yields.{k} (layout prints no tranche yields)")
            rec.read(f"{base}/closing_tranche_balance", r["closing"])
            rec.read(f"{base}/funding_date", r["funding_date"])
    elif full:
        for key in ("opening", "closing", "change_abs", "change_pct", "principal", "principal_prepayments", "losses",
                    "charge_off", "interest", "recoveries"):
            rec.read(f"{tb}/{key}", None)
        rec.empty(f"{tb}/all_tranches")
        rec.empty(f"{tb}/top_movers")

    # ---------------- page 3: outstanding balances (tranche amounts); page 6: commitment
    ob = ((x.get("outstanding_balances") or {}).get("total")) or {}
    fc = x.get("funding_costs") or {}
    if ob or full:
        rec.read("/tranche_amount/opening", ob.get("opening"))
        rec.read("/tranche_amount/closing", ob.get("closing"))
        rec.const("/tranche_amount/by_currency", None, "single-currency facility")
        rec.read("/program/program_amount", ob.get("closing"))
    if fc or full:
        rec.read("/program/program_limit", fc.get("commitment"))
    if (ob and fc) or full:
        lim, amt = _v(fc.get("commitment")), _v(ob.get("closing"))
        if lim and amt is not None:
            rec.derived("/program/program_utilization_pct", round(amt / lim, der["program_utilization_round"]),
                        "closing outstanding balance / commitment", [ob["closing"], fc["commitment"]])
        else:
            rec.read("/program/program_utilization_pct", None)
    if full:
        for k, v in const["program"].items():
            rec.const(f"/program/{k}", v, f"constants.program.{k} (not printed on this layout)")

    # ---------------- page 7: enhancement
    en = x.get("enhancement") or {}
    if en or full:
        rec.read("/total_enhancement/ending_cash_reserve_amount", en.get("ending_cash_reserve"))
        rec.read("/total_enhancement/total_enhancement_amount", en.get("total_amount"))
        rec.read("/total_enhancement/total_enhancement_pct", en.get("total_pct"))

    # ---------------- period_history: the current period's row
    ph = "/period_history/0"
    if tot and ob and cp is not None:
        rec.derived(f"{ph}/period", period, "collection period (cover)", [cp])
        rec.read(f"{ph}/collection_period", F(_collapse(cp.value), cp.page, cp.raw, cp.bbox))
        for key, col in (("opening_balance", "opening"), ("closing_balance", "closing"), ("principal", "principal"),
                         ("principal_prepayments", "prepayments"), ("losses", "deemed_defaults"),
                         ("interest", "interest"), ("recoveries", "recoveries"),
                         # R05 roll-forward terms: charge_off = page 2 column f "Charge-Off Contracts" (positive,
                         # subtracted); balance_adjustment = "Tranche Contract Balance Adjustment" (signed, added)
                         ("charge_off", "charge_off"), ("balance_adjustment", "adjustment")):
            rec.read(f"{ph}/{key}", tot.get(col))
        rec.read(f"{ph}/opening_amount", ob.get("opening"))
        rec.read(f"{ph}/closing_amount", ob.get("closing"))
        for k in ("by_currency", "activity_by_currency", "amount_by_currency"):
            rec.const(f"{ph}/{k}", None, "single-currency facility")
        for k, v in const["period_contracts"].items():
            rec.const(f"{ph}/{k}", v, f"constants.period_contracts.{k} (layout prints no contract counts)")
    elif full:
        rec.empty("/period_history")

    # ---------------- aging_history: the current period's row
    ag = x.get("aging")
    if ag and ag.get("total") and cp is not None:
        base = "/aging_history/0"
        t = ag["total"]
        rec.derived(f"{base}/period", period, "collection period (cover)", [cp])
        rec.read(f"{base}/collection_period", F(_collapse(cp.value), cp.page, cp.raw, cp.bbox))
        rec.empty(f"{base}/tranche_rows")
        cols = tpl["sections"]["aging"]["columns"]
        for i, r in enumerate(ag["rows"]):
            rec.read(f"{base}/tranche_rows/{i}/funding_date", r["funding_date"])
            rec.read(f"{base}/tranche_rows/{i}/tranche", r["tranche"])
            for c in cols:
                rec.read(f"{base}/tranche_rows/{i}/{c}", r[c])
        rec.read(f"{base}/current_0_30", t["current"])
        rec.read(f"{base}/days_31_60", t["days_31_60"])
        rec.read(f"{base}/days_61_90", t["days_61_90"])
        rec.const(f"{base}/written_off_bucket_label", der["written_off_bucket_label"], "derived.written_off_bucket_label")
        rec.read(f"{base}/written_off", t["deemed_defaults"])
        rec.read(f"{base}/cumulative_net_losses", t["cumulative_net_losses"])
        rec.read(f"{base}/closing_balance", t["closing_tranche_contract_balance"])
        b = [t["current"], t["days_31_60"], t["days_61_90"]]
        s3 = sum(f.value for f in b)
        wo = t["deemed_defaults"].value or 0.0
        rec.derived(f"{base}/bucket_sum", s3, "current + 31-60 + 61-90", b)
        rec.derived(f"{base}/bucket_sum_with_writeoff", s3 + wo, "bucket_sum + deemed defaults", b + [t["deemed_defaults"]])
        cl = t["closing_tranche_contract_balance"].value
        tol = der["reconcile_tolerance"]
        ok = cl is not None and (abs(s3 - cl) <= tol or abs(s3 + wo - cl) <= tol)
        rec.derived(f"{base}/reconciles", bool(ok), f"bucket sum (with or without deemed defaults) within {tol} of closing",
                    b + [t["closing_tranche_contract_balance"]])
    elif full:
        rec.empty("/aging_history")

    # ---------------- page 11: ratio tests, CNL, covenants, financial ratios
    rt = x.get("ratio_tests")
    if rt:
        _build_ratio_tests(p, rec, rt, tpl, prior)
    elif full:
        rec.empty("/ratio_test_detail", "dict")
        rec.empty("/cnl_by_period")
        rec.empty("/covenants")
        rec.empty("/prior_covenants")
        rec.empty("/financial_ratios")
        for k in ("BREACH", "WATCH", "OK", "AVAILABLE"):
            rec.const(f"/covenant_summary/{k}", 0, "no ratio tests extracted")
        rec.read("/worst_status", None)

    # prior closing tranche balance: the prior published object when given, else this report's opening balance
    prior_deal = (prior or {}).get("deal") if prior and "deal" in prior else prior
    prior_tb = ((prior_deal or {}).get("tranche_balance") or {}).get("closing")
    if prior_tb is not None:
        rec.derived("/prior_closing_tranche_balance", prior_tb, "prior published extraction: tranche_balance.closing")
    elif tot or full:
        rec.read("/prior_closing_tranche_balance", tot.get("opening"))
    return rec.deal


def _build_ratio_tests(p: Parsed, rec: Recorder, rt: dict, tpl: dict, prior: dict | None):
    der = tpl["derived"]
    cv = tpl["covenants"]
    answers = cv["answers"]
    band, buf, rnd = der["trend_flat_band"], der["watch_buffer_pct"], der["utilization_round"]

    # ratio_test_detail
    rec.empty("/ratio_test_detail", "dict")
    for spec in tpl["sections"]["ratio_tests"]["ratios"]:
        r = rt["ratios"].get(spec["key"])
        if r is None:
            rec.const(f"/ratio_test_detail/{spec['key']}", None, "ratio block not found")
            continue
        base = f"/ratio_test_detail/{spec['key']}"
        rec.empty(f"{base}/history")
        for i, h in enumerate(r["history"]):
            for k, f in h.items():
                rec.read(f"{base}/history/{i}/{k}", f)
        rec.empty(f"{base}/test_result_history")
        for i, (_, f) in enumerate(r["results"]):
            rec.read(f"{base}/test_result_history/{i}", f)
        rec.read(f"{base}/current_test_result", r["results"][0][1] if r["results"] else None)
        rec.read(f"{base}/lockup_trigger", r.get("lockup_trigger"))
        rec.read(f"{base}/event_of_default_trigger", r.get("eod_trigger"))
        rec.read(f"{base}/lockup_event_triggered", r.get("lockup_triggered"))
        rec.read(f"{base}/event_of_default_triggered", r.get("eod_triggered"))

    # cnl_by_period
    cl = tpl["constants"]["cnl_limits"]
    rec.empty("/cnl_by_period")
    worst = None
    for i, r in enumerate(rt["cnl"]["rows"]):
        base = f"/cnl_by_period/{i}"
        rec.read(f"{base}/annual_period", r["annual_period"])
        for k in ("tranche_balance_funded", "losses_allocated", "cnl_ratio_pct", "event_of_default_trigger_pct"):
            rec.read(f"{base}/{k}", r[k])
        ratio, trig = r["cnl_ratio_pct"], r["event_of_default_trigger_pct"]
        if ratio.value is not None and trig.value is not None:
            rec.derived(f"{base}/spread_pct", round(trig.value - ratio.value, der["spread_round"]),
                        "event_of_default_trigger_pct - cnl_ratio_pct (printed spread is rounded)", [trig, ratio])
            u = ratio.value / trig.value if trig.value else ratio.value
            if worst is None or u > worst["util"]:
                worst = {"util": u, "ratio": ratio, "trigger": trig, "period": r["annual_period"]}
        else:
            rec.read(f"{base}/spread_pct", r.get("spread_printed"))
        for k, v in cl.items():
            rec.const(f"{base}/{k}", v, f"constants.cnl_limits.{k} (limit is per vintage: event_of_default_trigger_pct)")

    # covenants: current month and the month before (from the report's own test-result history)
    def ratio_covs(which: int):
        out = []
        for spec in tpl["sections"]["ratio_tests"]["ratios"]:
            r = rt["ratios"].get(spec["key"])
            if r is None or len(r["results"]) <= which:
                continue
            vf = r["results"][which][1]
            pf = r["results"][which + 1][1] if len(r["results"]) > which + 1 else None
            for kind, trig_key, ans_key in (("lockup", "lockup_trigger", "lockup_triggered"),
                                            ("eod", "eod_trigger", "eod_triggered")):
                tf = r.get(trig_key)
                thr = _v(tf)
                v = vf.value
                util = round(v / thr, rnd) if v is not None and thr else None
                c = {"category": cv["category"], "legal_ref": cv[kind]["legal_ref"],
                     "description": cv[kind]["description"].format(title=r["title"].value,
                                                                   trigger=tf.raw if tf else "n/a"),
                     "current_value": v, "threshold": thr, "kind": "ceiling", "utilization_pct": util,
                     "trend": _trend(v, _v(pf), band), "status": _status(v, thr, "ceiling", buf), "note": None}
                a = r.get(ans_key)
                if which == 0:
                    c["reported_triggered"] = answers.get(a.value.upper()) if a is not None else None
                srcs = {"current_value": vf, "threshold": tf, "_inputs": [vf, tf, r["title"]]}
                out.append((c, srcs))
        return out

    def cnl_cov(current: bool):
        a = rt["cnl"]["eod_triggered"]
        w = worst if current else None
        v = w["ratio"].value if w else None
        thr = worst["trigger"].value if worst else None
        c = {"category": cv["category"], "legal_ref": cv["cnl"]["legal_ref"], "description": cv["cnl"]["description"],
             "current_value": v, "threshold": thr, "kind": "ceiling",
             "utilization_pct": round(v / thr, rnd) if v is not None and thr else None, "trend": "n/a",
             "status": _status(v, thr, "ceiling", buf), "note": None,
             "worst_vintage": w["period"].value if w else None}
        if current:
            c["reported_triggered"] = answers.get(a.value.upper()) if a is not None else None
        srcs = {"current_value": w["ratio"] if w else None, "threshold": worst["trigger"] if worst else None,
                "worst_vintage": w["period"] if w else None,
                "_inputs": [f for f in ((w or worst or {}).get("ratio"), a) if f is not None]}
        return [(c, srcs)]

    def ste_covs(current: bool):
        out = []
        st = cv["servicer_termination"]
        for s in rt["servicer_termination"]:
            a = s["triggered"]
            rep = answers.get(a.value.upper()) if a is not None else None
            c = {"category": cv["category"], "legal_ref": st["legal_ref"],
                 "description": st["description"].format(title=s["title"].value),
                 "current_value": None, "threshold": None, "kind": "binary", "utilization_pct": None, "trend": "n/a",
                 "status": "BREACH" if rep == "YES" else "OK", "note": st["note"]}
            if current:
                c["reported_triggered"] = rep
            out.append((c, {"_inputs": [f for f in (a, s["title"]) if f is not None]}))
        return out

    covs = ratio_covs(0) + cnl_cov(True) + ste_covs(True)
    prior_covs = ratio_covs(1) + cnl_cov(False) + ste_covs(False)
    for name, lst in (("covenants", covs), ("prior_covenants", prior_covs)):
        rec.empty(f"/{name}")
        for i, (c, srcs) in enumerate(lst):
            for k, v in c.items():
                ptr = f"/{name}/{i}/{k}"
                f = srcs.get(k)
                if isinstance(f, F) and f.value == v:
                    rec.read(ptr, f)
                elif v is None:
                    rec.read(ptr, None)
                else:
                    rec.derived(ptr, v, f"{k} per covenant rules ({tpl['template_id']})", srcs.get("_inputs", []))

    counts = {"BREACH": 0, "WATCH": 0, "OK": 0, "AVAILABLE": 0}
    for c, _ in covs:
        if c["status"] in counts:
            counts[c["status"]] += 1
    ins = [f for _, s in covs for f in s.get("_inputs", [])][:1]
    for k, v in counts.items():
        rec.derived(f"/covenant_summary/{k}", v, f"count of covenants with status {k}", ins)
    rec.derived("/worst_status", "BREACH" if counts["BREACH"] else "WATCH" if counts["WATCH"] else "OK",
                "most severe covenant status", ins)

    # financial_ratios: the three rolling ratios (current test result), then the worst CNL vintage
    fr = tpl["financial_ratios"]
    rec.empty("/financial_ratios")
    j = 0
    for spec in tpl["sections"]["ratio_tests"]["ratios"]:
        r = rt["ratios"].get(spec["key"])
        if r is None or not r["results"]:
            continue
        base = f"/financial_ratios/{j}"
        rec.const(f"{base}/key", spec["financial_ratio_key"], f"sections.ratio_tests.ratios.{spec['key']}")
        rec.read(f"{base}/label", r["title"])
        rec.const(f"{base}/format", fr["format"], "financial_ratios.format")
        rec.const(f"{base}/group", fr["group"], "financial_ratios.group")
        rec.read(f"{base}/value", r["results"][0][1])
        j += 1
    if worst:
        base = f"/financial_ratios/{j}"
        for k in ("key", "label", "format", "group"):
            rec.const(f"{base}/{k}", fr["cnl"][k], f"financial_ratios.cnl.{k}")
        rec.read(f"{base}/value", worst["ratio"])
        rec.read(f"{base}/vintage", worst["period"])
