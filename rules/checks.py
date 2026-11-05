"""One function per rule, named by rules.yaml `fn`. Signature: (rule, extraction, ctx, tol) -> list[finding].
Each rule has a passing and a failing fixture under tests/fixtures/. Pure functions: no DB, no HTTP.

Conventions:
- money is compared within tol["currency"], ratios stored as fractions within tol["percent_points"], counts exactly,
  leverage / coverage multiples within tol["ratio"].
- `context` carries the terms of each identity so the FindingCard can show the arithmetic. It never carries the
  keys our_value / report_value / difference (those are top-level finding fields).
"""
import calendar, datetime as dt, math, re
from .engine import finding, load_rules, settings_of

EPS = 1e-9

_RULES_DOC = None
def _rules_doc():
    global _RULES_DOC
    if _RULES_DOC is None: _RULES_DOC = load_rules()
    return _RULES_DOC

def near(a, b, t): return a is not None and b is not None and abs(a - b) <= t + EPS

def _num(x): return isinstance(x, (int, float)) and not isinstance(x, bool)

def _r(x, n=2): return None if x is None else round(x, n)

def _uid(ex): return ex["meta"]["upload_id"]

def _get(obj, ptr):
    """JSON pointer lookup that returns None for anything missing."""
    cur = obj
    for part in ptr.strip("/").split("/"):
        if part == "": continue
        if isinstance(cur, dict): cur = cur.get(part)
        elif isinstance(cur, list) and part.isdigit() and int(part) < len(cur): cur = cur[int(part)]
        else: return None
        if cur is None: return None
    return cur

# ---------- periods ----------
_MONTHS = {m.lower(): i for i, m in enumerate(calendar.month_name) if m} | {m.lower(): i for i, m in enumerate(calendar.month_abbr) if m} | {"sept": 9}

def period_key(s) -> str | None:
    """'August 2026' | 'Aug 2026' | '2026-08' | 'Aug-26' -> '2026-08'. None if it does not parse."""
    if not isinstance(s, str): return None
    s = s.strip()
    if m := re.fullmatch(r"(\d{4})-(\d{2})", s):
        return s if 1 <= int(m[2]) <= 12 else None
    if m := re.fullmatch(r"([A-Za-z]+)\.?\s+(\d{4})", s):
        mo = _MONTHS.get(m[1].lower()); return f"{m[2]}-{mo:02d}" if mo else None
    if m := re.fullmatch(r"([A-Za-z]{3,4})-(\d{2})", s):
        mo = _MONTHS.get(m[1].lower()); return f"20{m[2]}-{mo:02d}" if mo else None
    return None

def add_months(key: str, n: int) -> str:
    y, m = int(key[:4]), int(key[5:7]) + n
    y += (m - 1) // 12; m = (m - 1) % 12 + 1
    return f"{y:04d}-{m:02d}"

def parse_date(s) -> dt.date | None:
    if not isinstance(s, str): return None
    for fmt in ("%B %d, %Y", "%b %d, %Y", "%Y-%m-%d", "%d %B %Y", "%d-%b-%y", "%d-%b-%Y"):
        try: return dt.datetime.strptime(s.strip(), fmt).date()
        except ValueError: pass
    return None

def _current_row(d):
    return next((p for p in d.get("period_history", []) if p.get("collection_period") == d.get("collection_period")), None)

def _current_index(d):
    """Index of the current period's row in period_history (3 in a chained 4-month object, 0 in a single upload)."""
    return next((i for i, p in enumerate(d.get("period_history", [])) if p.get("collection_period") == d.get("collection_period")), None)

def missing_terms(rule, ex, where, missing, fields, source_page=None):
    """A block finding for an arithmetic check whose required terms are null or not numbers: names them and asks for
    pass 2 / review instead of raising. The rule's own severity is kept (block for every arithmetic rule)."""
    return finding(rule, _uid(ex), unit=None, fields=fields, context={"missing": ", ".join(missing), "where": where, "missing_fields": list(missing)},
                   **({"source_page": source_page} if source_page else {}),
                   message="Cannot check: {missing} missing or not a number on {where}. Re-read the page (pass 2) or enter the values in review.")

# ---------- targets: where "use ours" / "use report" writes ----------
# A finding carries `targets` only when our_value and report_value are two candidate values of the same field and the
# reviewer's choice should replace it. Targets are the field plus every other copy of the same number in the deal
# (the same figure printed in several blocks); approve writes the chosen value to each. See docs/progress.md.
COPY_TOL = {"currency": 0.005, "count": 0.0, "ratio": EPS, "percent_points": EPS}   # "same number": to the cent, else exact

def _targets(d, primary, candidates, value, unit="currency"):
    """`primary` pointers always; each candidate only where the deal holds the same number as `value` there."""
    out, t = list(primary), COPY_TOL[unit]
    for ptr in candidates:
        v = _get(d, ptr)
        if ptr not in out and _num(v) and _num(value) and abs(v - value) <= t + EPS: out.append(ptr)
    return out

# ---------- R01 ----------
NUMERIC = {"/tranche_balance/opening", "/tranche_balance/closing", "/contracts/opening", "/contracts/closing", "/program/program_limit", "/program/program_amount"}

def required_fields_present(rule, ex, ctx, tol):
    missing = []
    for ptr in rule["fields"]:
        v = _get(ex["deal"], ptr)
        if v is None or (ptr in NUMERIC and not _num(v)): missing.append(ptr)
    return [finding(rule, _uid(ex), context={"count": len(missing), "missing": ", ".join(missing)}, fields=missing)] if missing else []

# ---------- R02 ----------
def _report_currency(d, meta):
    for c in (d.get("currency"), (d.get("terminology") or {}).get("currency"), meta.get("currency")):
        if isinstance(c, str) and c.strip(): return c.strip().upper()
    # Multi-currency reports (Finloc) carry a by_currency split and report totals as CAD equivalent.
    if d.get("tranche_balance", {}).get("by_currency"): return "CAD"
    return None

def currency_matches_master(rule, ex, ctx, tol):
    """The deal object has no explicit currency field yet (requested from Extraction). Until it does, the report
    currency is read from deal.currency / terminology.currency / meta.currency, or CAD for multi-currency reports
    that state CAD-equivalent totals; with no currency on either side there is nothing to compare."""
    ours = (ctx.master.get("program") or {}).get("currency")
    report = _report_currency(ex["deal"], ex["meta"])
    if not ours or not report or report == ours.upper(): return []
    return [finding(rule, _uid(ex), our_value=ours.upper(), report_value=report, unit="text", context={"program": (ctx.master.get("program") or {}).get("slug")})]

# ---------- R03 ----------
RANGES = {"pct": (-1.0, 1.0), "ratio": (-100.0, 100.0)}
LOSS_RANGE = (-5.0, 1.0)   # loss and CNL ratios: recoveries on a small base drive them well below -100%
_LOSS_KEY = re.compile(r"(^|_)(loss|cnl|annualized)(_|$)")

def is_loss_ratio(key) -> bool:
    """Loss and CNL ratios (loss_ratio, rolling_3month_loss_ratio, rolling_12month_loss_ratio, cnl_ratio, any
    annualized or cumulative-net-loss key) by their financial_ratios key."""
    return bool(_LOSS_KEY.search((key or "").lower()))

def ratio_range(r):
    if r.get("format") == "pct" and is_loss_ratio(r.get("key")): return LOSS_RANGE
    return RANGES.get(r.get("format"))

def plausible_ranges(rule, ex, ctx, tol):
    """Fractions stored for percentages must lie in [-1, 1], except loss and CNL ratios in [-5, 1] (they go negative
    when recoveries exceed losses: Moneda rolling 3-month -0.20%, TPine April / May -113.21% / -130.68%); multiples in
    [-100, 100]; balances and contract counts >= 0; utilization 0..1.5. Catches 179 read for 1.79%, and 113.21 read
    for -113.21% (not divided by 100)."""
    d = ex["deal"]; out = []
    def bad(field, value, rng, unit):
        out.append(finding(rule, _uid(ex), report_value=value, unit=unit, fields=[field], context={"field": field, "range": rng}))
    for i, r in enumerate(d.get("financial_ratios") or []):
        lo_hi = ratio_range(r); v = r.get("value")
        if lo_hi and _num(v) and not (lo_hi[0] <= v <= lo_hi[1]):
            bad(f"/financial_ratios/{i}/value ({r.get('key')})", v, f"{lo_hi[0]} to {lo_hi[1]}", "percent_points" if r.get("format") == "pct" else "ratio")
    for ptr in ("/tranche_balance/opening", "/tranche_balance/closing"):
        v = _get(d, ptr)
        if _num(v) and v < 0: bad(ptr, v, ">= 0", "currency")
    for ptr in ("/contracts/opening", "/contracts/closing"):
        v = _get(d, ptr)
        if _num(v) and (not math.isfinite(v) or v < 0 or v != int(v)): bad(ptr, v, "whole number >= 0", "count")
    v = _get(d, "/program/program_utilization_pct")
    if _num(v) and not (0 <= v <= 1.5): bad("/program/program_utilization_pct", v, "0 to 1.5", "percent_points")
    return out

# ---------- R04 ----------
DEFAULT_REPORTING_LAG = 1   # an unknown template_id assumes the F-PIL convention

def reporting_lag(rule, ex, ctx):
    """Months from meta.reporting_period to collection_period for this extraction's template (rules.yaml
    reporting_lag_months: F-PIL 1, MOVE Trust 0). The template is meta.template_id, else the master deal's."""
    lags = (rule.get("settings") or settings_of(_rules_doc())).get("reporting_lag_months") or {}
    tid = (ex.get("meta") or {}).get("template_id") or ((ctx.master or {}).get("deal") or {}).get("template_id")
    lag = lags.get(tid)
    return tid, (lag if isinstance(lag, int) and not isinstance(lag, bool) else DEFAULT_REPORTING_LAG)

def _months(n): return f"{n} month" if n == 1 else f"{n} months"

def periods_line_up(rule, ex, ctx, tol):
    """collection_period (cover block) and settlement_date parse; collection_period = meta.reporting_period + the
    template's reporting lag (F-PIL 1: the page header names the month before; MOVE Trust 0: "Settlement Date August
    20, 2026 for Collection Period July 2026") when the extractor captured that month; settlement falls in the
    collection month (F-PIL) or the month after (MOVE Trust); collection_period = prior published period + 1 month
    (prior from ctx, else the deal's own prior_period field)."""
    d = ex["deal"]; out = []
    def bad(detail, ours=None, report=None, fields=None):
        out.append(finding(rule, _uid(ex), our_value=ours, report_value=report, unit="months", fields=fields or rule["fields"], context={"detail": detail}))
    cp = period_key(d.get("collection_period")); sd = parse_date(d.get("settlement_date"))
    if cp is None: bad(f"Collection period '{d.get('collection_period')}' does not parse as a month", report=d.get("collection_period"), fields=["/collection_period"])
    if sd is None: bad(f"Settlement date '{d.get('settlement_date')}' does not parse as a date", report=d.get("settlement_date"), fields=["/settlement_date"])
    if cp is None: return out
    rp = period_key(ex["meta"].get("reporting_period"))
    tid, lag = reporting_lag(rule, ex, ctx)
    if rp and add_months(rp, lag) != cp:
        bad(f"Collection period {cp} should be {_months(lag)} after the reporting period {rp} for template {tid or 'unknown'} (expected {add_months(rp, lag)})",
            ours=add_months(rp, lag), report=cp, fields=["/collection_period", "meta:/reporting_period"])
    if sd:
        sk = f"{sd.year:04d}-{sd.month:02d}"
        if sk not in (cp, add_months(cp, 1)):
            bad(f"Settlement date {sd.isoformat()} is not in the collection month {cp} or the month after", ours=cp, report=sk, fields=["/settlement_date", "/collection_period"])
    prior_cp = period_key((ctx.prior or {}).get("collection_period")) if ctx.prior else period_key(d.get("prior_period"))
    if prior_cp and add_months(prior_cp, 1) != cp:
        bad(f"Collection period {cp} does not follow the prior published period {prior_cp} (expected {add_months(prior_cp, 1)})",
            ours=add_months(prior_cp, 1), report=cp, fields=["/collection_period", "prior:/collection_period"])
    return out

# ---------- R05 ----------
def tranche_rollforward(rule, ex, ctx, tol):
    """opening − principal − prepayments − defaults − NPV adjustment = closing on the current period_history row
    (page 2: k = b − c − d − e − i), plus new funded (+) and ineligible buyback (−) where the layout prints them:
    opening + new_funded − principal − prepayments − losses − charge_off − ineligible_buyback = closing. All terms
    are positive amounts; absent or null counts as 0. `charge_off` is the NPV adjustment, column i (Meridian OneCap
    closes to the cent in all four months only with it). The deal-level tranche_balance opening/closing must be
    the same numbers as that row. MOVE Trust adds two signed-column terms: adjustment_increase (+, the upward part of the
    page-2 portfolio / NBV adjustment column whose downward part is charge_off; TLFC LP July +2,782.68) and
    balance_adjustment (signed, Meridian's "Tranche Contract Balance Adjustment")."""
    d = ex["deal"]; period = _current_row(d)
    if not period: return []
    i = _current_index(d)
    need = [k for k in ("opening_balance", "principal", "principal_prepayments", "losses", "closing_balance") if not _num(period.get(k))]
    if need:
        return [missing_terms(rule, ex, f"the {d.get('collection_period')} roll-forward row (/period_history/{i})", need, [f"/period_history/{i}/{k}" for k in need])]
    out = []
    opt = lambda k: period[k] if _num(period.get(k)) else 0.0
    nf, co, ib = opt("new_funded"), opt("charge_off"), opt("ineligible_buyback")
    up, ba = opt("adjustment_increase"), opt("balance_adjustment")
    computed = period["opening_balance"] + nf - period["principal"] - period["principal_prepayments"] - period["losses"] - co - ib + up + ba
    if not near(computed, period["closing_balance"], tol["currency"]):
        c = {"opening": period["opening_balance"], "new_funded": nf, "principal": period["principal"], "prepayments": period["principal_prepayments"], "losses": period["losses"],
             "charge_off": co, "ineligible_buyback": ib, "adjustment_increase": up, "balance_adjustment": ba, "computed": round(computed, 2), "closing": period["closing_balance"]}
        kw = {}
        if nf or co or ib or up or ba:
            kw["message"] = ("Opening {opening}" + (" + new funded {new_funded}" if nf else "") + " − principal {principal} − prepayments {prepayments} − defaults {losses}"
                             + (" − NPV adjustment {charge_off}" if co else "") + (" − ineligible buyback {ineligible_buyback}" if ib else "")
                             + (" + upward adjustment {adjustment_increase}" if up else "") + (" + balance adjustment {balance_adjustment}" if ba else "")
                             + " = {computed}, report says closing {closing} (difference {difference})")
        tg = _targets(d, [f"/period_history/{i}/closing_balance"], ["/tranche_balance/closing", f"/period_history/{i}/closing_amount", "/tranche_amount/closing", "/program/program_amount"], period["closing_balance"])
        out.append(finding(rule, _uid(ex), our_value=round(computed, 2), report_value=period["closing_balance"], difference=round(period["closing_balance"] - computed, 2), tolerance=tol["currency"], unit="currency", context=c, targets=tg, **kw))
    tb = d.get("tranche_balance") or {}
    for side in ("opening", "closing"):
        if _num(tb.get(side)) and not near(tb[side], period[f"{side}_balance"], tol["currency"]):
            out.append(finding(rule, _uid(ex), our_value=period[f"{side}_balance"], report_value=tb[side], difference=_r(tb[side] - period[f"{side}_balance"]), tolerance=tol["currency"], unit="currency",
                               fields=[f"/tranche_balance/{side}", "/period_history"], context={"side": side}, targets=[f"/tranche_balance/{side}"],
                               message="Page 2 {side} balance {report_value} differs from the {side} balance on this period's roll-forward row {our_value} (difference {difference})"))
    return out

# ---------- R06 ----------
def contracts_rollforward(rule, ex, ctx, tol):
    """opening + change_abs = closing exactly (change_abs is signed); each top_movers row closes on
    opening − change (F-PIL prints decreases as positive) or opening + change (MOVE Trust prints them negative);
    the movers' decreases cannot exceed the deal's net decrease."""
    d = ex["deal"]; c = d.get("contracts") or {}; out = []
    o, cl, ch = c.get("opening"), c.get("closing"), c.get("change_abs")
    if _num(o) and _num(cl) and _num(ch) and not near(o + ch, cl, tol["count"]):
        i = _current_index(d)
        tg = _targets(d, ["/contracts/closing"], [f"/period_history/{i}/closing_contracts"] if i is not None else [], cl, "count")
        out.append(finding(rule, _uid(ex), our_value=o + ch, report_value=cl, difference=cl - (o + ch), tolerance=tol["count"], unit="count",
                           context={"opening": o, "change": -ch, "computed": o + ch, "closing": cl}, targets=tg))
    for j, m in enumerate(c.get("top_movers") or []):
        mo, mc, mcl = m.get("opening_contracts"), m.get("change_contracts"), m.get("closing_contracts")
        if not (_num(mo) and _num(mc) and _num(mcl)): continue
        if not (near(mo - mc, mcl, tol["count"]) or near(mo + mc, mcl, tol["count"])):
            out.append(finding(rule, _uid(ex), our_value=mo - abs(mc), report_value=mcl, difference=mcl - (mo - abs(mc)), tolerance=tol["count"], unit="count",
                               fields=["/contracts/top_movers"], context={"tranche": m.get("tranche"), "opening": mo, "change": abs(mc), "computed": mo - abs(mc), "closing": mcl},
                               targets=[f"/contracts/top_movers/{j}/closing_contracts"],
                               message="Tranche {tranche}: opening contracts {opening} − change {change} = {computed}, report says {closing}"))
    movers = [m for m in c.get("top_movers") or [] if _num(m.get("change_contracts"))]
    if movers and _num(o) and _num(cl):
        moved = sum(abs(m["change_contracts"]) for m in movers if (m.get("opening_contracts") or 0) >= (m.get("closing_contracts") or 0))
        if moved > (o - cl) + tol["count"] and o >= cl:
            out.append(finding(rule, _uid(ex), our_value=o - cl, report_value=moved, difference=moved - (o - cl), tolerance=tol["count"], unit="count",
                               fields=["/contracts/top_movers", "/contracts/opening", "/contracts/closing"], context={"opening": o, "closing": cl, "net_decrease": o - cl, "movers_decrease": moved},
                               message="Top movers show {movers_decrease} contracts paid out or written off, more than the deal's net decrease {net_decrease} (opening {opening}, closing {closing})"))
    return out

# ---------- R07 ----------
def aging_buckets_sum(rule, ex, ctx, tol):
    """R07. Two conventions seen in the 12 reference deals: F-PIL closes on the three live buckets; most MOVE Trust
    deals include the written-off / 91+ bucket in the closing balance. Either must tie to the aging closing balance.
    The aging closing vs page-2 tranche closing comparison is recorded in context (Meridian OneCap differs by its
    deemed defaults) and left to R17/R18, not blocked here."""
    d = ex["deal"]; a = (d.get("aging_history") or [None])[0]
    if not isinstance(a, dict): return []   # no aging table extracted: R01 owns presence
    need = [k for k in ("current_0_30", "days_31_60", "days_61_90", "closing_balance") if not _num(a.get(k))]
    if need: return [missing_terms(rule, ex, "the current aging row (/aging_history/0)", need, [f"/aging_history/0/{k}" for k in need])]
    sum3 = a["current_0_30"] + a["days_31_60"] + a["days_61_90"]
    sum4 = sum3 + a["written_off"] if _num(a.get("written_off")) else None
    if near(sum3, a["closing_balance"], tol["currency"]) or near(sum4, a["closing_balance"], tol["currency"]): return []
    with_wo = sum4 is not None and abs(sum4 - a["closing_balance"]) < abs(sum3 - a["closing_balance"])
    computed = sum4 if with_wo else sum3
    label = f"current + 31-60 + 61-90 + {a.get('written_off_bucket_label') or 'written off'}" if with_wo else "current + 31-60 + 61-90"
    return [finding(rule, _uid(ex), our_value=round(computed, 2), report_value=a["closing_balance"], difference=round(a["closing_balance"] - computed, 2), tolerance=tol["currency"], unit="currency",
                    context={"computed": round(computed, 2), "closing_balance": a["closing_balance"], "tranche_closing": _get(d, "/tranche_balance/closing"), "bucket_label": label,
                             "current_0_30": a["current_0_30"], "days_31_60": a["days_31_60"], "days_61_90": a["days_61_90"], "written_off": a.get("written_off")},
                    targets=["/aging_history/0/closing_balance"])]

# ---------- R08 / R17 shared: CNL per vintage ----------
_CNL_PAIRS = [("cumulative_net_losses", "original_finance_contract_npv"), ("cumulative_net_losses", "original_finance_contract_nbv"),
              ("losses_allocated", "tranche_balance_funded"), ("cumulative_net_losses", "tranche_balance_funded"),
              ("period_cumulative_net_losses", "period_original_balance")]

def vintage_label(row, i):
    return row.get("period") or row.get("annual_period") or (f"Semi-annual period {row['semi_annual_period']}" if row.get("semi_annual_period") else f"Vintage {i + 1}")

def cnl_ratio(row):
    """(numerator, base, computed ratio) for a cnl_by_period row, using whichever pair the template carries."""
    for n, b in _CNL_PAIRS:
        if _num(row.get(n)) and _num(row.get(b)) and row[b]:
            return row[n], row[b], row[n] / row[b]
    return None, None, None

def losses_tie_out(rule, ex, ctx, tol):
    """Per vintage: gross − actual − estimated recoveries = CNL (where the template prints the breakdown), and the
    CNL ratio = CNL ÷ original balance within 0.01 pp (the report's own rounded ratio, cnl_ratio_reported_pct when
    the pipeline stored a recomputed one). Where every vintage carries the breakdown (F-PIL page 12), the vintage
    CNL total must equal the page-11 cumulative net losses. Cross-page delta vs the prior CNL is recorded in context."""
    d = ex["deal"]; out = []; rows = d.get("cnl_by_period") or []
    for i, r in enumerate(rows):
        label = vintage_label(r, i)
        g, ar, er, cnl = r.get("gross_losses"), r.get("actual_recoveries"), r.get("estimated_recoveries"), r.get("cumulative_net_losses")
        reported_ratio = r.get("cnl_ratio_reported_pct") if _num(r.get("cnl_ratio_reported_pct")) else r.get("cnl_ratio_pct")
        num, base, ratio = cnl_ratio(r)
        ctx_row = {"vintage": label, "gross": g, "recoveries": None, "computed": None, "cnl": cnl if cnl is not None else num,
                   "ratio_report": reported_ratio, "ratio_ours": _r(ratio, 6), "base": base}
        if all(_num(x) for x in (g, ar, er, cnl)):
            computed = g - ar - er
            ctx_row.update(recoveries=_r(ar + er), computed=_r(computed), actual_recoveries=ar, estimated_recoveries=er)
            if not near(computed, cnl, tol["currency"]):
                out.append(finding(rule, _uid(ex), our_value=_r(computed), report_value=cnl, difference=_r(cnl - computed), tolerance=tol["currency"], unit="currency",
                                   fields=[f"/cnl_by_period/{i}"], context=dict(ctx_row), targets=[f"/cnl_by_period/{i}/cumulative_net_losses"]))
                continue
        if ratio is not None and _num(reported_ratio) and not near(ratio, reported_ratio, tol["percent_points"]):
            out.append(finding(rule, _uid(ex), our_value=_r(ratio, 6), report_value=reported_ratio, difference=_r(reported_ratio - ratio, 6), tolerance=tol["percent_points"], unit="percent_points",
                               fields=[f"/cnl_by_period/{i}"], context=dict(ctx_row),
                               targets=[f"/cnl_by_period/{i}/" + ("cnl_ratio_reported_pct" if _num(r.get("cnl_ratio_reported_pct")) else "cnl_ratio_pct")],
                               message="{vintage}: CNL {cnl} ÷ original balance {base} = {ratio_ours}, report says {ratio_report}"))
    aging = (d.get("aging_history") or [None])[0] or {}
    if rows and all(_num(r.get("gross_losses")) and _num(r.get("cumulative_net_losses")) for r in rows) and _num(aging.get("cumulative_net_losses")):
        total = sum(r["cumulative_net_losses"] for r in rows)
        if not near(total, aging["cumulative_net_losses"], tol["currency"]):
            out.append(finding(rule, _uid(ex), our_value=_r(total), report_value=aging["cumulative_net_losses"], difference=_r(aging["cumulative_net_losses"] - total), tolerance=tol["currency"], unit="currency",
                               fields=["/cnl_by_period", "/aging_history/0/cumulative_net_losses"], context={"vintage_total": _r(total), "aging_cnl": aging["cumulative_net_losses"], "vintages": len(rows)}, targets=["/aging_history/0/cumulative_net_losses"],
                               message="Vintage CNL total {vintage_total} does not equal the page-11 cumulative net losses {aging_cnl} (difference {difference})"))
    return out

# ---------- R09 ----------
def utilization_recomputes(rule, ex, ctx, tol):
    p = ex["deal"].get("program") or {}
    lim, amt, unused, util = p.get("program_limit"), p.get("program_amount"), p.get("unused_facility"), p.get("program_utilization_pct")
    if not (_num(lim) and _num(amt)) or not lim: return []
    c = {"limit": lim, "drawn": amt, "computed_unused": _r(lim - amt), "unused": unused, "computed_util": _r(amt / lim, 6), "util": util}
    out = []
    if _num(unused) and not near(lim - amt, unused, tol["currency"]):
        out.append(finding(rule, _uid(ex), our_value=_r(lim - amt), report_value=unused, difference=_r(unused - (lim - amt)), tolerance=tol["currency"], unit="currency",
                           fields=["/program/program_limit", "/program/program_amount", "/program/unused_facility"], context=c, targets=["/program/unused_facility"]))
    if _num(util) and not near(amt / lim, util, tol["percent_points"]):
        out.append(finding(rule, _uid(ex), our_value=_r(amt / lim, 6), report_value=util, difference=_r(util - amt / lim, 6), tolerance=tol["percent_points"], unit="percent_points",
                           fields=["/program/program_limit", "/program/program_amount", "/program/program_utilization_pct"], context=c, targets=["/program/program_utilization_pct"]))
    return out

# ---------- R10 ----------
def _fr(d, key):
    return next((r for r in d.get("financial_ratios") or [] if r.get("key") == key), None)

def _latest_history(d, field):
    """Value of `field` in the newest ratio_history row that carries it (page-12/13 history; the report month first)."""
    for row in reversed(d.get("ratio_history") or []):
        if _num(row.get(field)): return row[field], row.get("month")
    return None, None

def enhancement_and_coverage(rule, ex, ctx, tol):
    """Enhancement % = enhancement amount ÷ the closing balance it is measured on (tranche balance for most deals,
    tranche amount for Xpedite), within 0.01 pp. Coverage, leverage and total equity on page 13 must equal the
    current row of the ratio history the same report prints (EBITDA and interest are not extracted yet, so the
    multiples are compared, not rebuilt from components)."""
    d = ex["deal"]; out = []
    te = d.get("total_enhancement") or {}
    amt, pct = te.get("total_enhancement_amount"), te.get("total_enhancement_pct")
    bases = [("tranche balance", _get(d, "/tranche_balance/closing")), ("tranche amount", _get(d, "/tranche_amount/closing"))]
    cands = [(n, b, amt / b) for n, b in bases if _num(amt) and _num(b) and b]
    if cands and _num(pct) and not any(near(v, pct, tol["percent_points"]) for _, _, v in cands):
        n, b, v = min(cands, key=lambda c: abs(c[2] - pct))
        out.append(finding(rule, _uid(ex), our_value=_r(v, 6), report_value=pct, difference=_r(pct - v, 6), tolerance=tol["percent_points"], unit="percent_points",
                           fields=["/total_enhancement", "/tranche_balance/closing"], context={"metric": "Enhancement %", "enhancement_amount": amt, "base": b, "base_name": n},
                           targets=["/total_enhancement/total_enhancement_pct"]))
    for key, label, unit in (("interest_coverage_ratio", "Interest coverage ratio", "ratio"), ("debt_equity_ratio", "Leverage ratio", "ratio"), ("total_equity", "Total equity", "currency")):
        fr = _fr(d, key); hist, month = _latest_history(d, key)
        if not fr or not _num(fr.get("value")) or hist is None: continue
        t = tol["currency"] if unit == "currency" else tol["ratio"]
        if not near(hist, fr["value"], t):
            k = d["financial_ratios"].index(fr)
            tg = _targets(d, [f"/financial_ratios/{k}/value"], _covenant_copies(d, key), fr["value"], unit)
            out.append(finding(rule, _uid(ex), our_value=hist, report_value=fr["value"], difference=_r(fr["value"] - hist, 4), tolerance=t, unit=unit,
                               fields=["/financial_ratios", "/ratio_history"], context={"metric": label, "history_month": month}, targets=tg))
    return out

# ---------- R11 ----------
_PH_FIELDS = ("opening_balance", "closing_balance", "principal", "principal_prepayments", "losses", "opening_contracts", "closing_contracts")

_BY_CCY_KEY = re.compile(r"^([a-z]{3})_(opening|closing)(?:_(raw)|_([a-z]{3})_equivalent)?$")

def _by_currency(d):
    """(by_currency, spot_rate) for a deal object: tranche_balance first, else the current period_history row.
    Keys as the MOVE multicurrency layout writes them: cad_opening / cad_closing (the reporting currency),
    usd_closing_raw (native), usd_opening_cad_equivalent and usd_closing_cad_equivalent (at the report's spot rate,
    activity_by_currency.spot_rate)."""
    tb = d.get("tranche_balance") or {}; row = _current_row(d) or {}
    bc = tb.get("by_currency") or row.get("by_currency")
    act = tb.get("activity_by_currency") or row.get("activity_by_currency") or {}
    return (bc if isinstance(bc, dict) else None), (act.get("spot_rate") if _num(act.get("spot_rate")) and act.get("spot_rate") else None)

def _native(bc, spot, side):
    """{currency: amount in its own units} for one side ("opening" / "closing"): a plain or _raw key is native; an
    _<rep>_equivalent key divided by the spot rate when no native key exists."""
    plain, equiv = {}, {}
    for k, v in bc.items():
        m = _BY_CCY_KEY.match(k)
        if not m or m.group(2) != side or not _num(v): continue
        ccy = m.group(1).upper()
        if m.group(4): equiv[ccy] = v
        else: plain[ccy] = v
    for ccy, v in equiv.items():
        if ccy not in plain and spot: plain[ccy] = v / spot
    return plain

def _equivalent(bc, side):
    """Reporting-currency amounts for one side: plain keys (the reporting currency) and _<rep>_equivalent keys."""
    out = {}
    for k, v in bc.items():
        m = _BY_CCY_KEY.match(k)
        if m and m.group(2) == side and _num(v) and not m.group(3): out[m.group(1).upper()] = v
    return out

def _fx_continuity(d, p, tol):
    """Per-currency opening vs prior closing when both objects carry by_currency with more than one currency, else
    None (single-currency deals keep the reporting-currency check). Native amounts compared within tol.currency
    per currency (absorbs the cent from re-deriving a native opening from its equivalent at the 4-dp spot rate).
    revaluation = reporting-currency opening − reporting-currency prior closing on currencies that are continuous."""
    cur, spot = _by_currency(d); prv, pspot = _by_currency(p)
    if not cur or not prv: return None
    now, before = _native(cur, spot, "opening"), _native(prv, pspot, "closing")
    common = sorted(set(now) & set(before))
    if len(set(now) | set(before)) < 2 or not common: return None
    breaks = [{"currency": k, "opening": _r(now[k]), "prior_closing": _r(before[k]), "difference": _r(now[k] - before[k])}
              for k in common if not near(now[k], before[k], tol["currency"])]
    rep = {m.group(1).upper() for k in cur if (m := _BY_CCY_KEY.match(k)) and not m.group(3) and not m.group(4)}   # reporting currency: plain keys
    break_in_rep = sum(b["difference"] * (1 if b["currency"] in rep else (spot or 0)) for b in breaks)
    eq_now, eq_before = _equivalent(cur, "opening"), _equivalent(prv, "closing")
    reval = sum(eq_now[k] - eq_before[k] for k in common if k in eq_now and k in eq_before and not any(b["currency"] == k for b in breaks))
    return {"currencies": common, "breaks": breaks, "break_in_reporting_currency": _r(break_in_rep), "revaluation": _r(reval), "spot_rate": spot, "prior_spot_rate": pspot}

def opening_equals_prior_closing(rule, ex, ctx, tol):
    """Needs the prior published deal (ctx.prior); without one (first upload) there is nothing to compare.
    A gap equal to the opening balance of tranches funded since the prior report (present in all_tranches now,
    absent or zero before) is explained, as in the MOVE Trust reports that open new tranches at the period start.
    Second check: rows for months both reports print (period_history, ratio_history) must agree; a difference is a
    restatement the reviewer accepts or rejects."""
    if not ctx.prior: return []
    d, p = ex["deal"], ctx.prior; out = []
    op, pc = _get(d, "/tranche_balance/opening"), _get(p, "/tranche_balance/closing")
    oc, pcc = _get(d, "/contracts/opening"), _get(p, "/contracts/closing")
    prior_open = {t.get("tranche"): t.get("closing") or 0 for t in _get(p, "/tranche_balance/all_tranches") or []}
    new = [t for t in _get(d, "/tranche_balance/all_tranches") or [] if (t.get("opening") or 0) and not prior_open.get(t.get("tranche"))]
    if prior_open: explained = sum(t["opening"] for t in new)
    else:   # prior object without a tranche list: fall back to the pipeline's own discontinuity record for this period
        disc = next((x for x in d.get("balance_discontinuities") or [] if x.get("field") == "Tranche Balance" and period_key(x.get("period")) == period_key(d.get("collection_period"))), None)
        explained = (disc or {}).get("explained_by_new_tranches") or 0
    c = {"opening": op, "prior_closing": pc, "opening_contracts": oc, "prior_contracts": pcc, "new_tranches": [t.get("tranche") for t in new], "explained_by_new_tranches": _r(explained),
         "prior_period": p.get("collection_period")}
    fx = _fx_continuity(d, p, tol)
    if fx is not None:   # multi-currency deal: compare each currency in its own units; the reporting-currency gap is revaluation
        c.update(currencies=fx["currencies"], revaluation=fx["revaluation"])
        if fx["breaks"] and not (explained and near(fx["break_in_reporting_currency"], explained, tol["currency"] * len(fx["breaks"]))):   # new tranches explain it
            b = fx["breaks"][0]
            c.update(currency=b["currency"], native_opening=b["opening"], native_prior_closing=b["prior_closing"], native_difference=b["difference"])
            out.append(finding(rule, _uid(ex), our_value=b["prior_closing"], report_value=b["opening"], difference=b["difference"], tolerance=tol["currency"], unit="currency",
                               fields=["/tranche_balance/by_currency", "prior:/tranche_balance/by_currency"], context=c,
                               message="{currency} opening {native_opening} does not equal the prior period's {currency} closing {native_prior_closing} "
                                       "(difference {native_difference} {currency}, compared in {currency} so spot-rate revaluation is not counted)"))
        elif _num(oc) and _num(pcc) and oc != pcc and not (oc > pcc and explained):
            out.append(finding(rule, _uid(ex), our_value=pcc, report_value=oc, difference=oc - pcc, tolerance=tol["count"], unit="count", fields=["/contracts/opening", "prior:/contracts/closing"], context=c))
    elif _num(op) and _num(pc):
        residual = op - pc - explained
        balance_ok = near(residual, 0, tol["currency"])
        contracts_ok = not (_num(oc) and _num(pcc)) or oc == pcc or (oc > pcc and explained)
        if not balance_ok:
            out.append(finding(rule, _uid(ex), our_value=pc, report_value=op, difference=_r(residual), tolerance=tol["currency"], unit="currency", context=c))
        elif not contracts_ok:
            out.append(finding(rule, _uid(ex), our_value=pcc, report_value=oc, difference=oc - pcc, tolerance=tol["count"], unit="count", fields=["/contracts/opening", "prior:/contracts/closing"], context=c))
    # restatements: months both reports print
    prior_ph = {period_key(r.get("collection_period") or r.get("period")): r for r in p.get("period_history") or []}
    for r in d.get("period_history") or []:
        k = period_key(r.get("collection_period") or r.get("period")); pr = prior_ph.get(k)
        if not pr or k == period_key(d.get("collection_period")): continue
        for f in _PH_FIELDS:
            a, b = r.get(f), pr.get(f)
            t = tol["count"] if "contracts" in f else tol["currency"]
            if _num(a) and _num(b) and not near(a, b, t):
                out.append(_restatement(rule, ex, k, f"period_history.{f}", b, a, t, "count" if "contracts" in f else "currency", p))
    prior_rh = {period_key(r.get("month")): r for r in p.get("ratio_history") or []}
    for r in d.get("ratio_history") or []:
        k = period_key(r.get("month")); pr = prior_rh.get(k)
        if not pr: continue
        for f, a in r.items():
            b = pr.get(f)
            if f == "month" or not (_num(a) and _num(b)): continue
            unit = "currency" if f == "total_equity" else ("percent_points" if f.endswith("_pct") else "ratio")
            t = tol[unit]
            if not near(a, b, t): out.append(_restatement(rule, ex, k, f"ratio_history.{f}", b, a, t, unit, p))
    return out

def _restatement(rule, ex, month, field, prior_value, value, t, unit, prior):
    return finding(rule, _uid(ex), our_value=prior_value, report_value=value, difference=_r(value - prior_value, 6), tolerance=t, unit=unit, fields=["/period_history", "/ratio_history", "prior:/period_history"],
                   context={"month": month, "field": field, "prior_value": prior_value, "value": value, "prior_period": prior.get("collection_period"), "restatement": True},
                   message="Restatement: {field} for {month} was {prior_value} in the published {prior_period} report; this report says {value}")

# ---------- R12 ----------
def period_not_published(rule, ex, ctx, tol):
    """Blocks when the period is already published. On a corrected re-issue (ctx.upload.replaces_upload_id) it still
    blocks, naming the publication it replaces and any later published months, whose chained history still carries
    the earlier figures for this month; the reviewer acknowledges with a reason or rejects. No targets: nothing to write.
    published_periods may be a set or a dict {period: published_at}; only the dict gives the date in the message."""
    d = ex["deal"]; k = period_key(d.get("collection_period")); pp = ctx.published_periods
    if not k or not pp: return []
    hit = k in pp or (d.get("deal_slug"), k) in pp
    if not hit: return []
    at = (pp.get(k) if isinstance(pp, dict) else None) or "earlier"
    c = {"deal": d.get("deal_slug"), "period": k, "published_at": at}
    reissue = (ctx.upload or {}).get("replaces_upload_id")
    if not reissue:
        return [finding(rule, _uid(ex), report_value=k, unit="months", context=c)]
    later = sorted({period_key(p) for p in pp if isinstance(p, str) and period_key(p) and period_key(p) > k})
    c.update(replaces_upload_id=reissue, later_periods=later, later_list=", ".join(later), reissue=True)
    msg = "Corrected re-issue: replaces the {period} report published {published_at}."
    if later: msg += " Later published months ({later_list}) still carry the earlier figures for {period}."
    return [finding(rule, _uid(ex), report_value=k, unit="months", context=c, message=msg)]

# ---------- R13 ----------
def _norm(s): return re.sub(r"[^a-z0-9]", "", (s or "").lower())

def deal_matches_upload(rule, ex, ctx, tol):
    """The deal and period the analyst selected before uploading (ctx.upload) must be the deal and period on the
    cover page. Slugs are compared when both exist; otherwise the selected deal's name must appear in the cover name."""
    d, u = ex["deal"], ctx.upload; out = []
    if not u: return out
    slug_ok = (d.get("deal_slug") == u["deal_slug"]) if d.get("deal_slug") and u.get("deal_slug") else (
        _norm(u.get("deal_name")) in _norm(d.get("deal_name")) if u.get("deal_name") and d.get("deal_name") else True)
    if not slug_ok:
        out.append(finding(rule, _uid(ex), our_value=u.get("deal_slug") or u.get("deal_name"), report_value=d.get("deal_slug") or d.get("deal_name"), unit="text",
                           context={"report_deal": " / ".join(x for x in (d.get("deal_name"), d.get("deal_slug")) if x), "selected_deal": u.get("deal_slug") or u.get("deal_name")}))
    rk, uk = period_key(d.get("collection_period")), period_key(u.get("collection_period"))
    if rk and uk and rk != uk:
        out.append(finding(rule, _uid(ex), our_value=uk, report_value=rk, unit="months", fields=["/collection_period", "meta:/upload_id"],
                           context={"report_period": rk, "selected_period": uk}, message="Report is for collection period {report_period} but was uploaded against {selected_period}"))
    return out

# ---------- R14 ----------
def _ref(s): return re.sub(r"\s+", "", (s or "")).lower()

def resolve_threshold(defn, deal):
    """A definition's threshold, or its threshold_rule resolved against the pointer in `on`.
    Bands use lte / lt / gte / gt bounds; the first band that matches wins."""
    rule = defn.get("threshold_rule")
    if not rule: return defn.get("threshold")
    v = _get(deal, rule.get("on", ""))
    if not _num(v): return None
    for b in rule.get("bands", []):
        if ("lte" in b and not v <= b["lte"]) or ("lt" in b and not v < b["lt"]) or ("gte" in b and not v >= b["gte"]) or ("gt" in b and not v > b["gt"]): continue
        return b["threshold"]
    return None

def _effective(defs, period):
    """Latest definition per legal_ref with effective_from on or before the last day of the period month."""
    end = None
    if period:
        y, m = int(period[:4]), int(period[5:7]); end = dt.date(y, m, calendar.monthrange(y, m)[1])
    best = {}
    for x in defs:
        ef = x.get("effective_from"); ef = ef if isinstance(ef, dt.date) else (dt.date.fromisoformat(str(ef)[:10]) if ef else None)
        if end and ef and ef > end: continue
        k = _ref(x.get("legal_ref"))
        if k not in best or (ef and (best[k][0] is None or ef > best[k][0])): best[k] = (ef, x)
    return {k: v[1] | {"_effective_from": v[0].isoformat() if v[0] else None} for k, v in best.items()}

def thresholds_match_master(rule, ex, ctx, tol):
    """Report threshold vs the master definition in force at the period end (latest effective_from per legal_ref).
    A ceiling / floor covenant on the report with no definition in force (none recorded for its legal_ref, or the first
    version starts after the period end, e.g. Stride before 2026-01-22) is a `note` naming the covenant. Binary
    tests carry no threshold and are not noted. No master record at all in the context (no "covenants" key: the
    master was not loaded) means nothing to compare and no notes.
    A deal with no covenant definitions recorded at all (any effective date; e.g. every MOVE Trust deal today) gets ONE
    note per report listing the unchecked legal_refs, not one per covenant. "Recorded" is master["covenants_recorded"]
    (the count of current definitions for the deal, which worker/validate passes because its "covenants" list holds only
    the rows in force at the period end) and otherwise the length of the covenants list given."""
    if "covenants" not in ctx.master and "covenant_definitions" not in ctx.master: return []
    d = ex["deal"]; period = period_key(d.get("collection_period")); out = []
    raw = ctx.master.get("covenants") or ctx.master.get("covenant_definitions") or []
    recorded = ctx.master.get("covenants_recorded")
    if not (recorded if isinstance(recorded, int) else len(raw)):
        idx = [i for i, c in enumerate(d.get("covenants") or []) if c.get("kind") in ("ceiling", "floor")]
        if not idx: return []
        refs = list(dict.fromkeys(d["covenants"][i].get("legal_ref") for i in idx))
        name = (ctx.master.get("deal") or {}).get("name") or d.get("deal_name") or d.get("deal_slug")
        return [finding({**rule, "severity": "note"}, _uid(ex), unit=None, fields=["/covenants", "master:/covenant_definitions"],
                        context={"deal": name, "deal_slug": d.get("deal_slug"), "count": len(idx), "legal_refs": refs, "period": period},
                        message="No covenant definitions recorded for {deal}: {count} covenants on the report were not checked")]
    defs = _effective(raw, period)
    for i, c in enumerate(d.get("covenants") or []):
        if c.get("kind") not in ("ceiling", "floor"): continue
        m = defs.get(_ref(c.get("legal_ref")))
        if not m:
            out.append(finding({**rule, "severity": "note"}, _uid(ex), report_value=c.get("threshold"), unit=None, fields=[f"/covenants/{i}", "master:/covenant_definitions"],
                               context={"legal_ref": c.get("legal_ref"), "description": c.get("description"), "period": period, "kind": c.get("kind")},
                               message="{legal_ref} ({description}): no master covenant definition is in force for {period} (none recorded, or its first version "
                                       "starts after the period end), so the report's threshold {report_value} was not checked. Record the definition in master data."))
            continue
        # no threshold and no threshold_rule: the master record does not fix one number for this test (Stride SLFA
        # 9.1 (g) CNL is set per vintage), so there is nothing to compare; skipped, kind included
        if m.get("threshold") is None and not m.get("threshold_rule"): continue
        ours = resolve_threshold(m, d); theirs = c.get("threshold")
        ctxd = {"legal_ref": c.get("legal_ref"), "effective_from": m["_effective_from"], "description": c.get("description"), "master_description": m.get("description"),
                "threshold_rule": m.get("threshold_rule"), "master_source": m.get("source")}
        if _num(ours) and _num(theirs) and abs(ours - theirs) > max(EPS, 1e-9 * abs(ours)):
            out.append(finding(rule, _uid(ex), our_value=ours, report_value=theirs, difference=_r(theirs - ours, 6), tolerance=0, unit="ratio" if ours >= 1 else "percent_points",
                               fields=[f"/covenants/{i}/threshold", "master:/covenant_definitions"], context=ctxd))
        elif m.get("kind") and m["kind"] != c.get("kind"):
            out.append(finding(rule, _uid(ex), our_value=m["kind"], report_value=c.get("kind"), unit="text", fields=[f"/covenants/{i}/kind", "master:/covenant_definitions"], context=ctxd,
                               message="{legal_ref}: report treats the test as a {report_value}, master record says {our_value} (effective {effective_from})"))
    return out

# ---------- R15 ----------
def limits_match_master(rule, ex, ctx, tol):
    """Deal facility limit: the report's maximum_program_limit (else program_limit) equals the master deal record's
    facility_limit when the master carries one; otherwise it may not exceed the program limit (the seed holds the
    program limit only; the Moneda report's $50M is the deal facility inside the $150M F-PIL 2.0 program).
    Warehouse limit equals the master program's warehouse_limit when both exist."""
    d = ex["deal"]; prog = ctx.master.get("program") or {}; mdeal = ctx.master.get("deal") or {}; out = []
    rep = _get(d, "/program/maximum_program_limit")
    rep = rep if _num(rep) else _get(d, "/program/program_limit")
    if _num(rep):
        if _num(mdeal.get("facility_limit")):
            if not near(rep, mdeal["facility_limit"], tol["currency"]):
                out.append(finding(rule, _uid(ex), our_value=mdeal["facility_limit"], report_value=rep, difference=_r(rep - mdeal["facility_limit"]), tolerance=tol["currency"], unit="currency",
                                   context={"limit_name": "Deal facility limit"}))
        elif _num(prog.get("limit")) and rep > prog["limit"] + tol["currency"]:
            out.append(finding(rule, _uid(ex), our_value=prog["limit"], report_value=rep, difference=_r(rep - prog["limit"]), tolerance=tol["currency"], unit="currency",
                               context={"limit_name": "Deal facility limit exceeds the program limit"}))
    wh = _get(d, "/warehouse/maximum_warehouse_facility_limit")
    if _num(wh) and _num(prog.get("warehouse_limit")) and not near(wh, prog["warehouse_limit"], tol["currency"]):
        out.append(finding(rule, _uid(ex), our_value=prog["warehouse_limit"], report_value=wh, difference=_r(wh - prog["warehouse_limit"]), tolerance=tol["currency"], unit="currency",
                           fields=["/warehouse/maximum_warehouse_facility_limit", "master:/program/warehouse_limit"], context={"limit_name": "Warehouse facility limit"}))
    return out

# ---------- R17 ----------
METRICS = [  # (regex on the covenant description, metric key, ratio_history field, financial_ratios key, unit)
    (r"rolling\s+(three|3)[\s-]+month\s+loss", "rolling_3month_loss_ratio", "rolling_3month_loss_ratio_pct", "rolling_3month_loss_ratio", "percent_points"),
    (r"rolling\s+(twelve|12)[\s-]+month\s+loss", "rolling_12month_loss_ratio", "rolling_12month_loss_ratio_pct", "rolling_12month_loss_ratio", "percent_points"),
    (r"cnl ratio|cumulative net loss", "cnl_ratio", None, "cnl_ratio", "percent_points"),
    (r"deemed default ratio", "deemed_default_ratio", None, "deemed_default_ratio", "percent_points"),
    (r"charge-?off ratio", "charge_off_ratio", None, "charge_off_ratio", "percent_points"),
    (r"delinquency ratio", "delinquency_ratio", "delinquency_ratio_pct", "delinquency_ratio", "percent_points"),
    (r"rvl ratio", "rvl_ratio", "rvl_ratio_pct", "rvl_ratio", "percent_points"),
    (r"loss ratio", "loss_ratio", "loss_ratio_pct", "loss_ratio", "percent_points"),
    (r"interest coverage", "interest_coverage_ratio", "interest_coverage_ratio", "interest_coverage_ratio", "ratio"),
    (r"leverage ratio|debt/equity", "debt_equity_ratio", "debt_equity_ratio", "debt_equity_ratio", "ratio"),
    (r"total equity|tangible net worth", "total_equity", "total_equity", "total_equity", "currency"),
]
_RTD = {"delinquency_ratio": "portfolio_delinquency_ratio", "deemed_default_ratio": "portfolio_deemed_default_ratio", "charge_off_ratio": "portfolio_charge_off_ratio"}

def _covenant_copies(d, key):
    """current_value pointers of every ceiling / floor covenant measuring metric `key` (same-number copies are picked
    by _targets). "(Definitions)" trigger tests are excluded: they measure on another basis (see covenants_recompute)."""
    return [f"/covenants/{i}/current_value" for i, c in enumerate(d.get("covenants") or [])
            if c.get("kind") in ("ceiling", "floor") and "definitions" not in (c.get("legal_ref") or "").lower() and (covenant_metric(c) or (None,))[0] == key]

def covenant_metric(c):
    desc = (c.get("description") or "").lower()
    for rx, key, hist, fr, unit in METRICS:
        if re.search(rx, desc): return key, hist, fr, unit
    return None

def recompute_metric(d, key, hist, frk):
    """(value, basis) for a covenant metric, from the most primitive components the deal object carries:
    CNL from cnl_by_period (worst vintage); Meridian rolling ratios from ratio_test_detail numerators and bases;
    otherwise the current-month row of the ratio history, else the page-13 / page-14 financial ratio."""
    if key == "cnl_ratio":
        best = None
        for i, r in enumerate(d.get("cnl_by_period") or []):
            _, _, v = cnl_ratio(r)
            if v is not None and (best is None or v > best[0]): best = (v, vintage_label(r, i))
        if best: return best[0], f"worst vintage {best[1]} recomputed from cnl_by_period"
    if key in _RTD and (rt := (d.get("ratio_test_detail") or {}).get(_RTD[key])):
        rows = [h for h in rt.get("history") or [] if _num(h.get("numerator_amount")) and _num(h.get("base_amount")) and h["base_amount"]]
        if rows:
            # Meridian prints the charge-off ratio annualized (×12): a row whose printed ratio matches 12 × n ÷ b, and
            # not n ÷ b, is taken as annualized. Every other row is the plain monthly ratio.
            def monthly(h):
                v = h["numerator_amount"] / h["base_amount"]; rp = h.get("ratio_pct")
                return v * 12 if _num(rp) and not near(v, rp, 0.0001) and near(v * 12, rp, 0.0001) else v
            return sum(monthly(h) for h in rows) / len(rows), f"average of {len(rows)} monthly ratios recomputed from ratio_test_detail"
    if hist and (rh := d.get("ratio_history")) and _num(rh[-1].get(hist)):
        return rh[-1][hist], f"ratio history {rh[-1].get('month')}"
    fr = _fr(d, frk)
    if fr and _num(fr.get("value")): return fr["value"], "financial ratios"
    return None, None

def covenants_recompute(rule, ex, ctx, tol):
    """Each ceiling / floor covenant value equals the value recomputed from the blocks it is defined on, within
    0.01 pp (multiples: tol.ratio; money: tol.currency). Covenants under a "(Definitions)" legal ref are lock-up /
    trigger tests measured on a different basis (Finloc's Loss Trigger Ratio, TLFC's lock-up RVL ratio) that the
    deal object does not yet carry; they are skipped until Extraction captures that basis."""
    d = ex["deal"]; out = []
    for i, c in enumerate(d.get("covenants") or []):
        if c.get("kind") not in ("ceiling", "floor") or not _num(c.get("current_value")) or "definitions" in (c.get("legal_ref") or "").lower(): continue
        m = covenant_metric(c)
        if not m: continue
        key, hist, frk, unit = m
        ours, basis = recompute_metric(d, key, hist, frk)
        if ours is None: continue
        t = tol[unit]
        if not near(ours, c["current_value"], t):
            frs = [f"/financial_ratios/{k}/value" for k, r in enumerate(d.get("financial_ratios") or []) if r.get("key") == frk]
            tg = _targets(d, [f"/covenants/{i}/current_value"], _covenant_copies(d, key) + frs, c["current_value"], unit)
            out.append(finding(rule, _uid(ex), our_value=_r(ours, 6), report_value=c["current_value"], difference=_r(c["current_value"] - ours, 6), tolerance=t, unit=unit,
                               fields=[f"/covenants/{i}/current_value"], context={"legal_ref": c.get("legal_ref"), "metric": key, "basis": basis, "description": c.get("description")}, targets=tg))
    return out

# ---------- R18 ----------
ORDER = {"OK": 0, "WATCH": 1, "BREACH": 2}

def derive_status(value, threshold, kind, buffer):
    """ceiling: BREACH if value > threshold, WATCH if value ≥ threshold × (1 − buffer);
    floor: BREACH if value < threshold, WATCH if value ≤ threshold ÷ (1 − buffer), i.e. utilization
    (threshold ÷ value) ≥ 1 − buffer. The floor form reproduces Essex (ICR 1.11 vs 1.00 → WATCH); the symmetric
    |threshold − value| ≤ buffer × threshold in rules.yaml would call it OK (see docs/requests.md)."""
    if kind == "ceiling":
        if value > threshold + EPS: return "BREACH"
        return "WATCH" if value >= threshold * (1 - buffer) - EPS else "OK"
    if kind == "floor":
        if value < threshold - EPS: return "BREACH"
        return "WATCH" if value <= threshold / (1 - buffer) + EPS else "OK"
    return None

def covenant_status_matches(rule, ex, ctx, tol):
    """Per ceiling / floor covenant: derived status = covenants[].status. Then worst_status and covenant_summary must
    agree with the statuses listed (binary tests carry the report's own status; AVAILABLE is not a severity).
    Where the report's own YES / NO is extracted (covenants[].reported_triggered), YES must mean BREACH and NO must
    mean not BREACH: our derived status for ceiling / floor tests, the report's status for binary ones."""
    d = ex["deal"]; buf = d.get("watch_buffer_pct") if _num(d.get("watch_buffer_pct")) else 0.1; out = []
    for i, c in enumerate(d.get("covenants") or []):
        v, th, k = c.get("current_value"), c.get("threshold"), c.get("kind")
        if k not in ("ceiling", "floor") or not (_num(v) and _num(th)) or c.get("status") == "AVAILABLE": continue
        ours = derive_status(v, th, k, buf)
        if ours != c.get("status"):
            out.append(finding(rule, _uid(ex), our_value=ours, report_value=c.get("status"), unit="text", fields=[f"/covenants/{i}"],
                               context={"legal_ref": c.get("legal_ref"), "value": v, "threshold": th, "kind": k, "watch_buffer_pct": buf, "description": c.get("description")}))
    for i, c in enumerate(d.get("covenants") or []):
        rt = c.get("reported_triggered")
        if rt not in ("YES", "NO") or c.get("status") == "AVAILABLE": continue
        v, th, k = c.get("current_value"), c.get("threshold"), c.get("kind")
        derived = derive_status(v, th, k, buf) if k in ("ceiling", "floor") and _num(v) and _num(th) else c.get("status")
        if derived is None or (rt == "YES") == (derived == "BREACH"): continue
        out.append(finding(rule, _uid(ex), our_value="YES" if derived == "BREACH" else "NO", report_value=rt, unit="text", fields=[f"/covenants/{i}/reported_triggered", f"/covenants/{i}"],
                           context={"legal_ref": c.get("legal_ref"), "value": v, "threshold": th, "kind": k, "status": derived, "watch_buffer_pct": buf, "description": c.get("description")},
                           message="{legal_ref}: report answers {report_value} on its triggered test, but value {value} vs threshold {threshold} ({kind}) is {status}, so the answer should be {our_value}"))
    statuses = [c.get("status") for c in d.get("covenants") or []]
    sev = [s for s in statuses if s in ORDER]
    worst = max(sev, key=ORDER.get) if sev else None
    if worst and d.get("worst_status") and worst != d["worst_status"]:
        out.append(finding(rule, _uid(ex), our_value=worst, report_value=d["worst_status"], unit="text", fields=["/worst_status", "/covenants"], context={"statuses": statuses},
                           message="Worst covenant status is {our_value} from the covenants listed; the deal object says {report_value}"))
    summ = d.get("covenant_summary") or {}
    counts = {s: statuses.count(s) for s in ("BREACH", "WATCH", "OK", "AVAILABLE")}
    diff = {s: (summ.get(s), counts[s]) for s in counts if s in summ and summ.get(s) != counts[s]}
    if diff:
        out.append(finding(rule, _uid(ex), our_value=str(counts), report_value=str({s: summ.get(s) for s in counts}), unit="count", fields=["/covenant_summary", "/covenants"],
                           context={"counted": counts, "summary": {s: summ.get(s) for s in counts}},
                           message="Covenant summary counts {summary} do not match the covenants listed {counted}"))
    return out

# ---------- R19 ----------
def status_changed(rule, ex, ctx, tol):
    """Note per covenant whose status differs from the prior published report (ctx.prior.covenants), falling back to
    the deal's own prior_covenants. Matched on legal ref + description, then legal ref + position."""
    d = ex["deal"]
    prior = (ctx.prior or {}).get("covenants") if ctx.prior else d.get("prior_covenants")
    if not prior: return []
    by_key = {(_ref(p.get("legal_ref")), _norm(p.get("description"))): p for p in prior}
    out = []
    for i, c in enumerate(d.get("covenants") or []):
        p = by_key.get((_ref(c.get("legal_ref")), _norm(c.get("description"))))
        if p is None and i < len(prior) and _ref(prior[i].get("legal_ref")) == _ref(c.get("legal_ref")): p = prior[i]
        if p and p.get("status") and c.get("status") and p["status"] != c["status"]:
            out.append(finding(rule, _uid(ex), our_value=p["status"], report_value=c["status"], unit="text", fields=[f"/covenants/{i}/status", "prior:/covenants"],
                               context={"legal_ref": c.get("legal_ref"), "prior_status": p["status"], "status": c["status"], "value": c.get("current_value"), "prior_value": p.get("current_value")}))
    return out
