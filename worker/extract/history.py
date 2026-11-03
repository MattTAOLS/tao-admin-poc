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
