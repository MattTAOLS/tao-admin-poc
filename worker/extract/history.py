"""Chain a deal's SetRep extractions (oldest first) into the cross-report fields dashboard.json carries:
period_history (oldest first), aging_history (newest first), ratio_history gaps filled from earlier reports,
restatements (a month's printed value changed between reports), balance_discontinuities (opening != prior
closing, with how much new advances explain), prior_covenants and prior closings from the previous report.

The extraction worker does not need this for one upload (the API keeps published history); it exists so the
reference objects can be reproduced end to end from the sample PDFs, and so the publisher can reuse it.
"""
from __future__ import annotations

import copy
from typing import Any

from .derive import _month_key

EPS = 1e-9


def _remap(sources: dict, old_prefix: str, new_prefix: str, period: str) -> dict:
    out = {}
    for k, v in sources.items():
        if k.startswith(old_prefix + "/") or k == old_prefix:
            nv = dict(v)
            nv["raw_text"] = f"{v['raw_text']} (report {period})"
            out[new_prefix + k[len(old_prefix):]] = nv
    return out


def chain(extractions: list[dict]) -> dict:
    if not extractions:
        raise ValueError("no extractions")
    exs = sorted(extractions, key=lambda e: e["deal"]["period_history"][0]["period"])
    newest = copy.deepcopy(exs[-1])
    deal, sources = newest["deal"], newest["sources"]
    periods = [e["deal"]["period_history"][0]["period"] for e in exs]

    # period_history oldest first, aging_history newest first
    for key, order in (("period_history", exs), ("aging_history", list(reversed(exs)))):
        for k in [k for k in sources if k.startswith(f"/{key}/")]:
            del sources[k]
        rows = []
        for e in order:
            if e["deal"].get(key):
                p = e["deal"][key][0]["period"]
                sources.update(_remap(e["sources"], f"/{key}/0", f"/{key}/{len(rows)}", p))
                rows.append(copy.deepcopy(e["deal"][key][0]))
        deal[key] = rows

    # ratio_history: fill fields the newest report no longer prints for its months from the latest earlier report
    by_report: list[tuple[str, dict[str, dict]]] = [
        (e["deal"]["period_history"][0]["period"], {r["month"]: r for r in e["deal"].get("ratio_history", [])}) for e in exs]
    for i, row in enumerate(deal.get("ratio_history", [])):
        for per, rows in reversed(by_report[:-1]):
            old = rows.get(row["month"])
            if not old:
                continue
            for k, v in old.items():
                if k not in row:
                    row[k] = v
                    src = next((e for e in exs if e["deal"]["period_history"][0]["period"] == per), None)
                    j = next(n for n, r in enumerate(src["deal"]["ratio_history"]) if r["month"] == row["month"])
                    sources.update(_remap(src["sources"], f"/ratio_history/{j}/{k}", f"/ratio_history/{i}/{k}", per))

    # restatements: the same month and field printed with different values in different reports
    seen: dict[tuple[str, str], list[dict]] = {}
    for per, rows in by_report:
        for m, r in rows.items():
            for k, v in r.items():
                if k == "month" or v is None:
                    continue
                seen.setdefault((m, k), []).append({"source_period": per, "value": v})
    rest = []
    for (m, k), vals in seen.items():
        if len(vals) > 1 and max(x["value"] for x in vals) - min(x["value"] for x in vals) > EPS:
            rest.append({"month": m, "field": k, "as_reported": vals})
    rest.sort(key=lambda r: (_month_key(r["month"]), r["field"]))
    deal["restatements"] = rest

    # balance discontinuities between consecutive reports
    disc = []
    for prev, cur in zip(exs, exs[1:]):
        pd, cd = prev["deal"], cur["deal"]
        pp, cp = pd["period_history"][0]["period"], cd["period_history"][0]["period"]
        prev_ids = {t["tranche"] for t in pd["tranche_balance"].get("all_tranches", [])}
        new = [t for t in cd["tranche_balance"].get("all_tranches", []) if t["tranche"] not in prev_ids] if prev_ids else []
        for label, pclose, copen, explain in (
                ("Tranche Balance", pd["tranche_balance"]["closing"], cd["tranche_balance"]["opening"],
                 sum(t["opening"] for t in new) if new else None),
                ("Tranche Amount", pd["tranche_amount"]["closing"], cd["tranche_amount"]["opening"], None)):
            if pclose is None or copen is None:
                continue
            gap = copen - pclose
            if abs(gap) <= 0.01:
                continue
            residual = gap - (explain or 0.0)
            disc.append({"field": label, "period": cp, "prior_period": pp, "prior_closing": pclose,
                         "current_opening": copen, "gap": gap, "new_tranche_count": len(new),
                         "new_tranche_ids": [t["tranche"] for t in new], "explained_by_new_tranches": explain,
                         "residual": residual, "fully_explained": abs(residual) <= 0.01})
    deal["balance_discontinuities"] = disc

    # previous report: covenants and closings
    if len(exs) > 1:
        prev = exs[-2]
        deal["prior_covenants"] = copy.deepcopy(prev["deal"]["covenants"])
        for k in [k for k in sources if k.startswith("/prior_covenants/")]:
            del sources[k]
        sources.update(_remap(prev["sources"], "/covenants", "/prior_covenants", periods[-2]))
        deal["prior_closing_tranche_balance"] = prev["deal"]["tranche_balance"]["closing"]
        deal["prior_closing_contracts"] = prev["deal"]["contracts"]["closing"]
        sources.update(_remap(prev["sources"], "/tranche_balance/closing", "/prior_closing_tranche_balance", periods[-2]))
        sources.update(_remap(prev["sources"], "/contracts/closing", "/prior_closing_contracts", periods[-2]))
    newest["meta"]["chained_periods"] = periods
    return newest


# ---------------------------------------------------------------- one month at a time
_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _reporting_month(ym: str, lag: int = -1) -> str:
    """The newest month a report for collection period YYYY-MM prints, as 'Mon-YY': `lag` months from the
    period (F-PIL: -1, the month before; MOVE Trust layouts: 0, the collection month itself)."""
    y, m = map(int, ym.split("-"))
    k = y * 12 + (m - 1) + lag
    return f"{_MON[k % 12]}-{(k // 12) % 100:02d}"


def _lag(extraction: dict) -> int:
    """Months from an extraction's period to the newest month its ratio_history prints."""
    rows = extraction["deal"].get("ratio_history") or []
    if not rows:
        return -1
    newest = max((r["month"] for r in rows), key=_month_key)
    ny, nm = _month_key(newest)
    y, m = map(int, extraction["deal"]["period_history"][0]["period"].split("-"))
    return (ny * 12 + nm) - (y * 12 + m)


def _months_between(a: str, b: str) -> int:
    (ya, ma), (yb, mb) = _month_key(a), _month_key(b)
    return (yb - ya) * 12 + (mb - ma)


def _latest_period(deal: dict):
    ps = [r.get("period") for r in deal.get("period_history") or [] if r.get("period")]
    return max(ps) if ps else None


def _shift_sources(sources: dict, old_prefix: str, new_prefix: str):
    if old_prefix == new_prefix:
        return
    moved = {new_prefix + k[len(old_prefix):]: v for k, v in sources.items() if k.startswith(old_prefix + "/")}
    for k in [k for k in sources if k.startswith(old_prefix + "/")]:
        del sources[k]
    sources.update(moved)


def extend(prior_deal: dict | None, extraction: dict) -> dict:
    """Add one month to a deal's history. `prior_deal` is the deal object last published before the
    extraction's period (an earlier extend() or chain() result, or a seeded reference object); `extraction` is
    one upload's extraction document. Returns the extraction document with every cross-report field filled as
    chain() fills it. Pure: no I/O, `extraction` is not modified; extend(None, ex) returns ex unchanged.

    Restatements need to know which earlier reports printed a month, which a deal object does not record. It is
    inferred from the report format: the report for period P prints field f for the months from
    (reporting month of P) - span_f up to that reporting month (reporting month = P + lag, the lag read from
    the new extraction: -1 for F-PIL, 0 for MOVE Trust), where span_f is how far back the new report
    prints f. Those reports printed the prior deal's value unless the prior deal already lists a restatement.

    Carried-over values have no page in this upload, so they get no `sources` entries (the schema requires a
    page). meta.history names the published period they came from and lists the pointers carried."""
    if prior_deal is None:
        return extraction
    out = copy.deepcopy(extraction)
    deal, sources = out["deal"], out["sources"]
    prior = copy.deepcopy(prior_deal)
    cur_period = deal["period_history"][0]["period"]
    prior_period = _latest_period(prior)
    if prior_period is None or prior_period >= cur_period:
        raise ValueError(f"prior deal's latest period {prior_period!r} is not before the extraction's {cur_period!r}")
    carried: list[str] = []

    # period_history oldest first, aging_history newest first
    old_ph = sorted([r for r in prior.get("period_history") or [] if r.get("period", "") < cur_period],
                    key=lambda r: r["period"])
    deal["period_history"] = old_ph + deal["period_history"][:1]
    _shift_sources(sources, "/period_history/0", f"/period_history/{len(old_ph)}")
    carried += [f"/period_history/{i}" for i in range(len(old_ph))]
    old_ag = sorted([r for r in prior.get("aging_history") or [] if r.get("period", "") < cur_period],
                    key=lambda r: r["period"], reverse=True)
    deal["aging_history"] = deal["aging_history"][:1] + old_ag
    carried += [f"/aging_history/{i + 1}" for i in range(len(old_ag))]

    # ratio_history gaps from the prior deal (its rows already hold the latest earlier value)
    prior_rows = {r["month"]: r for r in prior.get("ratio_history") or []}
    for i, row in enumerate(deal.get("ratio_history") or []):
        for k, v in (prior_rows.get(row["month"]) or {}).items():
            if k not in row:
                row[k] = v
                carried.append(f"/ratio_history/{i}/{k}")

    # restatements
    new_rows = {r["month"]: r for r in extraction["deal"].get("ratio_history") or []}
    report_periods = sorted({r["period"] for r in prior.get("period_history") or [] if r.get("period")})
    span: dict[str, int] = {}
    if new_rows:
        newest = max(new_rows, key=_month_key)
        for m, r in new_rows.items():
            for k in r:
                if k != "month":
                    span[k] = max(span.get(k, 0), _months_between(m, newest))
    rest = {(r["month"], r["field"]): r for r in prior.get("restatements") or []}
    lag = _lag(extraction)
    for m, r in new_rows.items():
        for k, v in r.items():
            if k == "month" or v is None:
                continue
            if (m, k) in rest:
                rest[(m, k)]["as_reported"].append({"source_period": cur_period, "value": v})
                continue
            pv = prior_rows.get(m, {}).get(k)
            if pv is None or abs(pv - v) <= EPS:
                continue
            printed_by = [p for p in report_periods if 0 <= _months_between(m, _reporting_month(p, lag)) <= span.get(k, 12)]
            rest[(m, k)] = {"month": m, "field": k,
                            "as_reported": [{"source_period": p, "value": pv} for p in printed_by]
                            + [{"source_period": cur_period, "value": v}]}
    deal["restatements"] = sorted(rest.values(), key=lambda r: (_month_key(r["month"]), r["field"]))

    # balance discontinuities: the prior deal's, plus the one between its period and this one
    disc = [d for d in prior.get("balance_discontinuities") or [] if d.get("period", "") < cur_period]
    ptb, ctb = prior.get("tranche_balance") or {}, deal.get("tranche_balance") or {}
    prev_ids = {t["tranche"] for t in ptb.get("all_tranches") or []}
    new = [t for t in ctb.get("all_tranches") or [] if t["tranche"] not in prev_ids] if prev_ids else []
    for label, pclose, copen, explain in (
            ("Tranche Balance", ptb.get("closing"), ctb.get("opening"), sum(t["opening"] for t in new) if new else None),
            ("Tranche Amount", (prior.get("tranche_amount") or {}).get("closing"),
             (deal.get("tranche_amount") or {}).get("opening"), None)):
        if pclose is None or copen is None or abs(copen - pclose) <= 0.01:
            continue
        gap = copen - pclose
        residual = gap - (explain or 0.0)
        disc.append({"field": label, "period": cur_period, "prior_period": prior_period, "prior_closing": pclose,
                     "current_opening": copen, "gap": gap, "new_tranche_count": len(new),
                     "new_tranche_ids": [t["tranche"] for t in new], "explained_by_new_tranches": explain,
                     "residual": residual, "fully_explained": abs(residual) <= 0.01})
    deal["balance_discontinuities"] = disc

    # the prior published period's covenants (with its CNL value) and closings
    deal["prior_covenants"] = copy.deepcopy(prior.get("covenants") or [])
    carried.append("/prior_covenants")
    for key, val in (("prior_closing_tranche_balance", ptb.get("closing")),
                     ("prior_closing_contracts", (prior.get("contracts") or {}).get("closing"))):
        if val is not None:
            deal[key] = val
            carried.append(f"/{key}")

    for k in [k for k in sources if any(k == c or k.startswith(c + "/") for c in carried)]:
        del sources[k]
    out["meta"]["history"] = {"extended_from": f"published {prior_period}", "carried": carried,
                              "periods": [r["period"] for r in deal["period_history"]]}
    return out
