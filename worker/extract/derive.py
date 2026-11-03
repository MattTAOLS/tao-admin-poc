"""Build the dashboard.json deal object from parsed sections, including the derived fields the dashboards expect:
the current-period rows of period_history and aging_history, ratio_history, cnl_by_period with limits, covenants
with status, trend and utilization, covenant_summary, financial_ratios.

Conventions reproduced from the 12 reference objects (docs/dashboard-json):
- collection_period = cover block month (= settlement month), e.g. "August 2026"; period = "2026-08".
- percentages are fractions (1.79% -> 0.0179); program_utilization_pct is rounded to 10 places, covenant
  utilization_pct to 4.
- covenant status: BREACH if the value is past the threshold (ceiling: >, floor: <); WATCH if within
  watch_buffer_pct x threshold of it; else OK. utilization = value / threshold (ceiling) or threshold / value
  (floor). trend compares to the previous month's printed value; within trend_flat_band (relative) is "flat".
- the CNL covenant reports the vintage with the highest ratio / limit; a vintage named as an exception in the
  covenant text gets its own limit.

Cross-report fields (restatements, balance_discontinuities, the earlier rows of period_history/aging_history)
need the deal's other reports and are filled by history.py, not here.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from pathlib import Path
from typing import Optional

from .mapper import F, Parsed
from .provenance import Recorder
from .text import norm

MONTHS = {m: i for i, m in enumerate(["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"], 1)}


def _month_key(mon_yy: str) -> tuple[int, int]:
    m, y = mon_yy.split("-")
    return 2000 + int(y), MONTHS[m[:3].upper()]


def _ym(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def _prev_month(ym: str) -> str:
    y, m = map(int, ym.split("-"))
    return f"{y - 1:04d}-12" if m == 1 else f"{y:04d}-{m - 1:02d}"


def parse_long_date(s: str) -> date:
    return datetime.strptime(re.sub(r"\s+", " ", s.strip()).title(), "%B %d, %Y").date()


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def _v(f: Optional[F]):
    return None if f is None else f.value


class Series:
    """Month-keyed values from the aggregate-performance and borrower tables, oldest first."""

    def __init__(self, p: Parsed):
        self.rows: dict[str, dict[str, F]] = {}
        for r in p.aggregate:
            m = r["month"].value
            self.rows.setdefault(m, {}).update({k: v for k, v in r.items() if k != "month"})
            self.rows[m]["_month"] = r["month"]
        for m, d in p.borrower.items():
            self.rows.setdefault(m, {}).update(d)
        self.months = sorted(self.rows, key=_month_key)

    def history(self, name: str) -> list[tuple[str, F]]:
        return [(m, self.rows[m][name]) for m in self.months if name in self.rows[m]]

    def at(self, name: str, month: str) -> Optional[F]:
        return self.rows.get(month, {}).get(name)

    def asof(self, name: str, month: str) -> Optional[F]:
        """Latest value printed for a month at or before `month` (quarterly series carry forward)."""
        h = [(m, f) for m, f in self.history(name) if _month_key(m) <= _month_key(month)]
        return h[-1][1] if h else None


def _prev_mon_yy(mon_yy: str) -> str:
    y, m = _month_key(mon_yy)
    y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    return f"{list(MONTHS)[m - 1].title()}-{y % 100:02d}"


def build(p: Parsed, rec: Recorder, *, prior: dict | None = None, partial: bool = False) -> dict:
    """Write the deal object into `rec`. `prior` is the deal's last published extraction (optional).
    `partial` (pass 2) skips blocks whose inputs were not re-read instead of writing nulls."""
    tpl = p.template
    der = tpl["derived"]
    tid = tpl["template_id"]
    prior_deal = (prior or {}).get("deal") if prior and "deal" in prior else prior

    # ---------------- identity and periods
    cov = p.cover
    period = coll_label = None
    if "borrower" in cov:
        borrower = re.sub(r"\s+", " ", cov["borrower"].value).strip()
        name = tpl["program"]["deal_name_format"].format(program=tpl["program"]["name"], borrower=borrower)
        rec.derived("/deal_name", name, f"program name + cover title ({tid})", [cov["borrower"]])
        rec.derived("/deal_slug", slugify(name), "slug(deal_name)", [cov["borrower"]])
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
        for k, v in tpl["terminology"].items():
            rec.const(f"/terminology/{k}", v, f"terminology.{k}")
        sp = {k: p.source_pages.get(k) for k in ["tranche_balance", "tranche_amounts", "outstanding_contracts",
                                                 "funding_costs", "enhancement", "top10_obligor", "aging_summary",
                                                 "aggregate_performance", "cumulative_losses", "quantitative_tests",
                                                 "financial_ratios"]}
        for k, v in sp.items():
            rec.const(f"/source_pages/{k}", v, "page where the section heading was found")
        rec.const("/watch_buffer_pct", der["watch_buffer_pct"], "derived.watch_buffer_pct")
        for k in ("ratio_test_detail",):
            rec.empty(f"/{k}", "dict")
        for k in ("top10_obligors", "restatements", "balance_discontinuities"):
            rec.empty(f"/{k}")

    # ---------------- page 2: funded contracts and contract counts
    ft = p.funded_total
    tb = "/tranche_balance"
    if ft:
        for key, col in [("opening", "opening"), ("closing", "closing"), ("principal", "principal"),
                         ("principal_prepayments", "prepayments"), ("losses", "defaults"),
                         ("interest", "interest"), ("recoveries", "recoveries")]:
            rec.read(f"{tb}/{key}", ft.get(col))
        o, c = _v(ft.get("opening")), _v(ft.get("closing"))
        if o is not None and c is not None:
            rec.derived(f"{tb}/change_abs", c - o, "closing - opening", [ft["closing"], ft["opening"]])
            rec.derived(f"{tb}/change_pct", (c - o) / o if o else None, "(closing - opening) / opening", [ft["closing"], ft["opening"]])
        rec.const(f"{tb}/by_currency", None, "single-currency facility")
        rec.const(f"{tb}/activity_by_currency", None, "single-currency facility")
        rec.empty(f"{tb}/top_movers")
        rec.empty(f"{tb}/all_tranches")
        adv = p.funded_advances
        for i, a in enumerate(adv):
            rec.read(f"{tb}/all_tranches/{i}/tranche", a["advance_no"])
            rec.read(f"{tb}/all_tranches/{i}/opening", a["opening"])
            rec.read(f"{tb}/all_tranches/{i}/closing", a["closing"])
        movers = sorted([a for a in adv if a["opening"].value is not None and a["closing"].value is not None],
                        key=lambda a: -abs(a["closing"].value - a["opening"].value))[:der["top_movers"]["tranche"]]
        for i, a in enumerate(movers):
            base = f"{tb}/top_movers/{i}"
            rec.read(f"{base}/leasing_date", a.get("advance_date"))
            rec.read(f"{base}/tranche", a["advance_no"])
            rec.read(f"{base}/original_tranche_balance", a.get("original"))
            rec.read(f"{base}/opening_tranche_balance", a["opening"])
            rec.read(f"{base}/original_tranche_yield", a.get("original_yield"))
            rec.read(f"{base}/current_period_effective_tranche_yield", a.get("effective_yield"))
            rec.read(f"{base}/closing_tranche_balance", a["closing"])
    elif not partial:
        for key in ("opening", "closing", "principal", "principal_prepayments", "losses", "interest", "recoveries",
                    "change_abs", "change_pct"):
            rec.read(f"{tb}/{key}", None)
        rec.empty(f"{tb}/top_movers")
        rec.empty(f"{tb}/all_tranches")

    ct = p.contracts_total
    if ct:
        rec.read("/contracts/opening", ct.get("opening"))
        rec.read("/contracts/closing", ct.get("closing"))
        o, c = _v(ct.get("opening")), _v(ct.get("closing"))
        if o is not None and c is not None:
            rec.derived("/contracts/change_abs", c - o, "closing - opening", [ct["closing"], ct["opening"]])
            rec.derived("/contracts/change_pct", (c - o) / o if o else None, "(closing - opening) / opening", [ct["closing"], ct["opening"]])
        rec.empty("/contracts/top_movers")
        moved = [a for a in p.contracts_advances if a["change"].value]
        moved.sort(key=lambda a: (-abs(a["change"].value), a["advance_no"].value))
        for i, a in enumerate(moved[:der["top_movers"]["contracts"]]):
            base = f"/contracts/top_movers/{i}"
            rec.read(f"{base}/tranche", a["advance_no"])
            rec.read(f"{base}/opening_contracts", a["opening"])
            rec.read(f"{base}/change_contracts", a["change"])
            rec.read(f"{base}/closing_contracts", a["closing"])
        prior_cc = (prior_deal or {}).get("contracts", {}).get("closing") if prior_deal else None
        if prior_cc is not None:
            rec.derived("/prior_closing_contracts", prior_cc, "prior published extraction: contracts.closing")
        else:
            rec.read("/prior_closing_contracts", ct.get("opening"))
    elif not partial:
        for k in ("opening", "closing", "change_abs", "change_pct"):
            rec.read(f"/contracts/{k}", None)
        rec.empty("/contracts/top_movers")
        rec.read("/prior_closing_contracts", None)

    # ---------------- principal balances, cost of funds, warehouse
    pr, cof = p.principal, p.cost_of_funds
    if pr or not partial:
        rec.read("/program/program_limit", pr.get("term_limit"))
        rec.read("/program/program_amount", pr.get("closing_principal"))
        rec.read("/program/unused_facility", pr.get("availability"))
        lim, amt = _v(pr.get("term_limit")), _v(pr.get("closing_principal"))
        if lim and amt is not None:
            rec.derived("/program/program_utilization_pct", round(amt / lim, 10), "closing principal / term facility limit",
                        [pr["closing_principal"], pr["term_limit"]])
        else:
            rec.read("/program/program_utilization_pct", None)
        rec.read("/program/maximum_program_limit", pr.get("max_term_limit") or pr.get("term_limit"))
        rec.read("/tranche_amount/closing", pr.get("closing_principal"))
        rec.const("/tranche_amount/by_currency", None, "single-currency facility")
        if p.warehouse is None and not partial:
            for k in ("opening_advances_outstanding", "closing_advances_outstanding", "maximum_warehouse_facility_limit"):
                rec.read(f"/warehouse/{k}", None)
        else:
            rec.read("/warehouse/maximum_warehouse_facility_limit", pr.get("max_warehouse_limit"))
    if p.warehouse:
        rec.read("/warehouse/opening_advances_outstanding", p.warehouse.get("opening"))
        rec.read("/warehouse/closing_advances_outstanding", p.warehouse.get("closing"))
    opening_amount = pr.get("opening_principal") or cof.get("opening_advances")
    if opening_amount is not None or not partial:
        rec.read("/tranche_amount/opening", opening_amount)

    # ---------------- enhancement
    en = p.enhancement
    if en.get("total_amount") is not None:
        rec.read("/total_enhancement/total_enhancement_amount", en["total_amount"])
        rec.read("/total_enhancement/total_enhancement_pct", en.get("total_pct"))
    elif en.get("unfunded_actual") is not None:
        amt = en["unfunded_actual"]
        rec.read("/total_enhancement/total_enhancement_amount", amt)
        cp = pr.get("closing_principal")
        if cp is not None and cp.value:
            rec.derived("/total_enhancement/total_enhancement_pct", (amt.value or 0.0) / cp.value,
                        "actual unfunded amount / closing principal balance", [amt, cp])
        else:
            rec.read("/total_enhancement/total_enhancement_pct", None)
    elif not partial:
        rec.read("/total_enhancement/total_enhancement_amount", None)
        rec.read("/total_enhancement/total_enhancement_pct", None)

    # ---------------- period_history: the current period's row
    if period and (ft or not partial):
        ph = "/period_history/0"
        rec.derived(f"{ph}/period", period, "collection period (cover)", [cov["collection_start"]])
        rec.derived(f"{ph}/collection_period", coll_label, "collection period (cover)", [cov["collection_start"]])
        for key, col in [("opening_balance", "opening"), ("closing_balance", "closing"), ("principal", "principal"),
                         ("principal_prepayments", "prepayments"), ("losses", "defaults"), ("interest", "interest"),
                         ("recoveries", "recoveries")]:
            rec.read(f"{ph}/{key}", ft.get(col))
        rec.read(f"{ph}/opening_amount", opening_amount)
        rec.read(f"{ph}/closing_amount", pr.get("closing_principal"))
        for k in ("by_currency", "activity_by_currency", "amount_by_currency"):
            rec.const(f"{ph}/{k}", None, "single-currency facility")
        rec.read(f"{ph}/closing_contracts", ct.get("closing"))
        rec.read(f"{ph}/opening_contracts", ct.get("opening"))
    elif not partial:
        rec.empty("/period_history")

    # ---------------- aging_history: the current period's row
    ag = p.aging
    if ag and period:
        base = "/aging_history/0"
        rec.derived(f"{base}/period", period, "collection period (cover)", [cov["collection_start"]])
        rec.derived(f"{base}/collection_period", coll_label, "collection period (cover)", [cov["collection_start"]])
        for key, col in [("current_0_30", "current_0_30"), ("days_31_60", "days_31_60"), ("days_61_90", "days_61_90")]:
            rec.read(f"{base}/{key}", ag.get(col))
        rec.const(f"{base}/written_off_bucket_label", der["written_off_bucket_label"], "derived.written_off_bucket_label")
        rec.read(f"{base}/written_off", ag.get("days_91_plus"))
        rec.read(f"{base}/cumulative_net_losses", ag.get("cumulative_losses"))
        rec.read(f"{base}/closing_balance", ag.get("closing"))
        if "payment_deferral" in ag:
            rec.read(f"{base}/payment_deferral", ag["payment_deferral"])
        b = [ag.get(k) for k in ("current_0_30", "days_31_60", "days_61_90")]
        if all(x is not None and x.value is not None for x in b):
            s3 = sum(x.value for x in b)
            wo = _v(ag.get("days_91_plus")) or 0.0
            rec.derived(f"{base}/bucket_sum", s3, "0-30 + 31-60 + 61-90", b)
            rec.derived(f"{base}/bucket_sum_with_writeoff", s3 + wo, "bucket_sum + 91+/defaults", b + [ag.get("days_91_plus")])
            cl = _v(ag.get("closing"))
            tol = der["reconcile_tolerance"]
            ok = cl is not None and (abs(s3 - cl) <= tol or abs(s3 + wo - cl) <= tol)
            rec.derived(f"{base}/reconciles", bool(ok), f"bucket sum (with or without 91+) within {tol} of closing", b + [ag.get("closing")])
    elif not partial:
        rec.empty("/aging_history")

    # ---------------- ratio history, CNL, covenants, financial ratios
    s = Series(p)
    cur_month = p.aggregate[0]["month"].value if p.aggregate else None
    if p.aggregate or not partial:
        rec.empty("/ratio_history")
        # one row per month of the aggregate-performance table (borrower-only months older than it are left out)
        agg_months = [m for m in s.months if "_month" in s.rows[m]]
        for i, m in enumerate(agg_months):
            rec.read(f"/ratio_history/{i}/month", s.rows[m]["_month"])
            for key, series in tpl["ratio_history_fields"].items():
                f = s.at(series, m)
                if f is not None:
                    rec.read(f"/ratio_history/{i}/{key}", f)

    prior_tb = ((prior_deal or {}).get("tranche_balance") or {}).get("closing")
    if prior_tb is not None:
        rec.derived("/prior_closing_tranche_balance", prior_tb, "prior published extraction: tranche_balance.closing")
    elif p.aggregate and cur_month:
        # the reporting month's row of the aggregate table is the portfolio balance at the prior period's close
        rec.read("/prior_closing_tranche_balance", s.at("portfolio_balance", cur_month))
    elif not partial:
        rec.read("/prior_closing_tranche_balance", None)

    limits = _cnl_limits(p) if p.tests else None
    if p.cnl:
        rec.empty("/cnl_by_period")
        for i, r in enumerate(p.cnl):
            base = f"/cnl_by_period/{i}"
            rec.read(f"{base}/period", r["period"])
            if r.get("advances") is not None:
                rec.read(f"{base}/advance_range", r["advances"])
            rec.read(f"{base}/{p.cnl_base_field}", r["base"])
            for k in ("gross_losses", "actual_recoveries", "estimated_recoveries", "cumulative_net_losses"):
                rec.read(f"{base}/{k}", r[k])
            rec.read(f"{base}/cnl_ratio_pct", r["cnl_ratio"])
            if limits:
                lim, exc, src = limits(r["period"].value)
                rec.derived(f"{base}/cnl_limit", lim, "CNL covenant limit for this vintage (page with quantitative tests)", [src])
                rec.derived(f"{base}/cnl_limit_is_exception", exc, "vintage named as an exception in the covenant text", [src])
                within = None if lim is None or r["cnl_ratio"].value is None else r["cnl_ratio"].value <= lim
                rec.derived(f"{base}/cnl_within_limit", within, "cnl_ratio_pct <= cnl_limit", [r["cnl_ratio"], src])
    elif not partial:
        rec.empty("/cnl_by_period")

    if p.tests and p.aggregate and (p.cnl or not partial):
        worst = _worst_vintage(p, limits)
        covs = _covenants(p, s, cur_month, worst, der, tpl)
        prev_month = _prev_mon_yy(cur_month)
        prior_covs = _covenants(p, s, prev_month, None, der, tpl, prior_deal=prior_deal, cnl_limit=(worst or {}).get("limit"))
        for name, lst in (("covenants", covs), ("prior_covenants", prior_covs)):
            rec.empty(f"/{name}")
            for i, (c, srcs) in enumerate(lst):
                for k, v in c.items():
                    ptr = f"/{name}/{i}/{k}"
                    f = srcs.get(k)
                    if isinstance(f, F):
                        rec.read(ptr, f)
                    else:
                        rec.derived(ptr, v, f"{k} per covenant rules ({tid})", srcs.get("_inputs", []))
        counts = {"BREACH": 0, "WATCH": 0, "OK": 0, "AVAILABLE": 0}
        for c, _ in covs:
            if c["status"] in counts:
                counts[c["status"]] += 1
        ins = [x for _, sr in covs for x in sr.get("_inputs", [])][:1]
        for k, v in counts.items():
            rec.derived(f"/covenant_summary/{k}", v, f"count of covenants with status {k}", ins)
        worst_status = "BREACH" if counts["BREACH"] else "WATCH" if counts["WATCH"] else "OK"
        rec.derived("/worst_status", worst_status, "most severe covenant status", ins)

        rec.empty("/financial_ratios")
        j = 0
        for spec in tpl["financial_ratios"]:
            if spec["series"] == "cnl_worst_vintage":
                if not worst:
                    continue
                f, period_f = worst["ratio"], worst["period"]
            else:
                f, period_f = s.at(spec["series"], cur_month), None
                if f is None:
                    continue
            base = f"/financial_ratios/{j}"
            for k in ("key", "label", "format", "group"):
                rec.const(f"{base}/{k}", spec[k], f"financial_ratios.{spec['key']}")
            rec.read(f"{base}/value", f)
            if period_f is not None:
                rec.read(f"{base}/vintage", period_f)
            j += 1
    elif not partial:
        rec.empty("/covenants")
        rec.empty("/prior_covenants")
        for k in ("BREACH", "WATCH", "OK", "AVAILABLE"):
            rec.const(f"/covenant_summary/{k}", 0, "no quantitative tests extracted")
        rec.read("/worst_status", None)
        rec.empty("/financial_ratios")
    return rec.deal


# ---------------------------------------------------------------- covenants
def _pct_in(text: str) -> list[float]:
    return [float(x) / 100 for x in re.findall(r"(\d+(?:\.\d+)?)\s?%", text)]


def _cnl_test(p: Parsed):
    for t in p.tests:
        if re.search(r"CUMULATIVE NET LOSS RATIO|CNL RATIO", norm(t["desc"])):
            return t
    return None


def _cnl_limits(p: Parsed):
    """-> fn(vintage label) -> (limit, is_exception, source F). Handles 'other than the period beginning X and
    ending Y, of <= a%, and for the period beginning X and ending Y, of <= b%'."""
    t = _cnl_test(p)
    if t is None:
        return None
    src = F(None, t["page"], t["raw"], t["bbox"])
    desc = t["desc"]
    pcts = _pct_in(desc)
    if not pcts:
        return None
    base = pcts[0]
    exc = re.search(r"AND FOR THE PERIOD BEGINNING (\w+)\.? \d{1,2}, (\d{4}) AND ENDING .*? OF LESS THAN OR EQUAL TO (\d+(?:\.\d+)?)%",
                    norm(desc))
    exc_key = None
    if exc:
        exc_key = (int(exc.group(2)), MONTHS[exc.group(1)[:3]])
        exc_pct = float(exc.group(3)) / 100

    def limit(vintage: str):
        start = vintage.split()[0]
        if exc_key and _month_key(start) == exc_key:
            return exc_pct, True, src
        return base, False, src
    return limit


def _worst_vintage(p: Parsed, limits) -> Optional[dict]:
    best = None
    for r in p.cnl:
        v = r["cnl_ratio"].value
        if v is None:
            continue
        lim = limits(r["period"].value)[0] if limits else None
        u = v / lim if lim else v
        if best is None or u > best["util"]:
            best = {"util": u, "ratio": r["cnl_ratio"], "period": r["period"], "limit": lim}
    return best


def _threshold(t: dict, series: str, s: Series, month: str, worst: Optional[dict]) -> tuple[Optional[float], Optional[F]]:
    src = F(None, t["page"], t["raw"], t["bbox"])
    if t["conditional"]:
        npv = s.at("portfolio_balance", month)
        if npv is None or npv.value is None:
            return None, src
        for c in t["conditional"]:
            if (c["op"] == "≤" and npv.value <= c["amount"]) or (c["op"] == ">" and npv.value > c["amount"]):
                return c["pct"], src
        return None, src
    d = t["desc"]
    if series == "cnl_worst_vintage":
        return (worst or {}).get("limit"), src
    if series == "total_equity":
        m = re.search(r"\$\s?([\d,]+(?:\.\d+)?)", d)
        return (float(m.group(1).replace(",", "")) if m else None), src
    if series in ("interest_coverage_ratio", "leverage_ratio"):
        m = re.search(r"(\d+(?:\.\d+)?):1", d)
        return (float(m.group(1)) if m else None), src
    pc = _pct_in(d)
    return (pc[-1] if pc else None), src


def _status(v, thr, kind, buffer) -> str:
    if v is None or thr is None:
        return "OK"
    if (kind == "ceiling" and v > thr) or (kind == "floor" and v < thr):
        return "BREACH"
    if abs(thr - v) <= buffer * abs(thr):
        return "WATCH"
    return "OK"


def _trend(cur, prev, band) -> str:
    if cur is None or prev is None:
        return "n/a"
    if abs(cur - prev) <= band * abs(prev):
        return "flat"
    return "rising" if cur > prev else "falling"


def _covenants(p: Parsed, s: Series, month: str, worst: Optional[dict], der: dict, tpl: dict,
               prior_deal: dict | None = None, cnl_limit: float | None = None) -> list[tuple[dict, dict]]:
    """Covenant rows for `month`. For the prior month (worst=None) the CNL value comes from the prior extraction
    when supplied (it is not on this report); its threshold is this report's limit for the current worst vintage."""
    sec = tpl["sections"]["quantitative_tests"]
    out = []
    for t in p.tests:
        nd = norm(t["desc"])
        metric = next((m for m in sec["metrics"] if re.search(m["match"], nd)), None)
        test_src = F(None, t["page"], t["raw"], t["bbox"])
        c = {"category": sec["category"], "legal_ref": t["ref"], "description": t["desc"]}
        srcs: dict = {"_inputs": [test_src]}
        if metric is None:
            pc = _pct_in(t["desc"])
            c.update({"current_value": None, "threshold": pc[0] if pc else None, "kind": "binary",
                      "utilization_pct": None, "trend": "n/a",
                      "status": "BREACH" if t["answer"] == "YES" else "OK", "note": sec["binary_note"]})
        else:
            series = metric["series"]
            if series == "cnl_worst_vintage":
                if worst is None and prior_deal:
                    pc = next((x for x in prior_deal.get("covenants", []) if x.get("legal_ref") == t["ref"]), None)
                    v = pc.get("current_value") if pc else None
                    vf, wv = None, (pc or {}).get("worst_vintage")
                elif worst is None:
                    v, vf, wv = None, None, None   # prior-period CNL is not on this report
                else:
                    vf, v, wv = worst["ratio"], worst["ratio"].value, worst["period"].value
                prev = None
            else:
                vf = s.asof(series, month)
                v = None if vf is None else vf.value
                pf = s.asof(series, _prev_mon_yy(month))
                prev = None if pf is None else pf.value
            thr, _ = _threshold(t, series, s, month, worst)
            if series == "cnl_worst_vintage" and worst is None:
                thr = cnl_limit
            kind = metric["kind"]
            util = None
            if v is not None and thr:
                util = round(v / thr, 4) if kind == "ceiling" else (round(thr / v, 4) if v else None)
            c.update({"current_value": v, "threshold": thr, "kind": kind, "utilization_pct": util,
                      "trend": "n/a" if series == "cnl_worst_vintage" else _trend(v, prev, der["trend_flat_band"]),
                      "status": _status(v, thr, kind, der["watch_buffer_pct"]), "note": None})
            if series == "cnl_worst_vintage":
                c["worst_vintage"] = wv
            if vf is not None:
                srcs["current_value"] = vf
                srcs["_inputs"] = [vf, test_src]
        c["reported_triggered"] = t["answer"]
        out.append((c, srcs))
    return out
