"""Program roll-up: rebuild docs/dashboard-json/program-<slug>.dashboard.json from published deal objects.
Pure function, no DB. The maths was reverse-engineered from the two real program files and is pinned by
tests/test_rollup.py, which rebuilds both from their own deals and compares every total.

- sums are over deals that carry the field (None is skipped, not zero)
- change_pct = change_abs / opening; utilization = total_program_amount / total_program_limit (limit-weighted)
- deals_with_warehouse = deals whose `warehouse` block exists (even with null values)
- deals_with_escalations = deals with any covenant whose status got worse than in prior_covenants
- terminology = the deals' shared terminology, or None when they differ"""
RANK = {"AVAILABLE": 0, "OK": 1, "WATCH": 2, "BREACH": 3}
HISTORY_POLICY = {"ratio_history_window_months": 48, "history_never_shrinks": True}


def _get(d, *path):
    for p in path:
        if not isinstance(d, dict):
            return None
        d = d.get(p)
    return d


def _sum(deals, *path):
    vals = [v for v in (_get(d, *path) for d in deals) if v is not None]
    return float(sum(vals)) if vals else None


def _missing(deals, *path):
    return [d.get("deal_name") for d in deals if _get(d, *path) is None]


def _pct(change, base):
    return change / base if change is not None and base else None


def _diff(a, b):
    return a - b if a is not None and b is not None else None


def escalated(deal: dict) -> bool:
    prior = {c.get("legal_ref"): c.get("status") for c in deal.get("prior_covenants") or []}
    for c in deal.get("covenants") or []:
        before = prior.get(c.get("legal_ref"))
        if before is not None and RANK.get(c.get("status"), 0) > RANK.get(before, 0):
            return True
    return False


def portfolio_totals(deals: list[dict]) -> dict:
    t = {
        "opening_tranche_balance": _sum(deals, "tranche_balance", "opening"),
        "closing_tranche_balance": _sum(deals, "tranche_balance", "closing"),
        "opening_contracts": _sum(deals, "contracts", "opening"),
        "closing_contracts": _sum(deals, "contracts", "closing"),
        "opening_tranche_amount": _sum(deals, "tranche_amount", "opening"),
        "closing_tranche_amount": _sum(deals, "tranche_amount", "closing"),
        "prior_period_closing_tranche_balance": _sum(deals, "prior_closing_tranche_balance"),
        "prior_period_closing_contracts": _sum(deals, "prior_closing_contracts"),
        "total_program_limit": _sum(deals, "program", "program_limit"),
        "total_program_amount": _sum(deals, "program", "program_amount"),
        "total_maximum_program_limit": _sum(deals, "program", "maximum_program_limit"),
        "total_warehouse_opening_advances": _sum(deals, "warehouse", "opening_advances_outstanding"),
        "total_warehouse_closing_advances": _sum(deals, "warehouse", "closing_advances_outstanding"),
        "total_maximum_warehouse_limit": _sum(deals, "warehouse", "maximum_warehouse_facility_limit"),
        "prior_period_deals_missing": _missing(deals, "prior_closing_tranche_balance"),
        "program_utilization_deals_missing": _missing(deals, "program", "program_utilization_pct"),
        "tranche_amount_deals_missing": _missing(deals, "tranche_amount", "closing"),
        "deals_with_warehouse": [d.get("deal_name") for d in deals if isinstance(d.get("warehouse"), dict)],
    }
    t["program_utilization_pct"] = _pct(t["total_program_amount"], t["total_program_limit"])
    for name, o, c in [("tranche_balance", "opening_tranche_balance", "closing_tranche_balance"),
                       ("contracts", "opening_contracts", "closing_contracts"),
                       ("tranche_amount", "opening_tranche_amount", "closing_tranche_amount")]:
        t[f"{name}_change_abs"] = _diff(t[c], t[o])
        t[f"{name}_change_pct"] = _pct(t[f"{name}_change_abs"], t[o])
    t["warehouse_advances_change_abs"] = _diff(t["total_warehouse_closing_advances"], t["total_warehouse_opening_advances"])
    return t


def covenant_totals(deals: list[dict]) -> dict:
    out = {"BREACH": 0, "WATCH": 0, "OK": 0, "AVAILABLE": 0}
    for d in deals:
        for k, v in (d.get("covenant_summary") or {}).items():
            out[k] = out.get(k, 0) + int(v or 0)
    return out


def build_program(period: str, deals: list[dict]) -> dict:
    """The program aggregate for one period: same keys as program-*.dashboard.json."""
    terms = [d.get("terminology") for d in deals]
    return {
        "period": period,
        "deal_count": len(deals),
        "portfolio_totals": portfolio_totals(deals),
        "covenant_totals": covenant_totals(deals),
        "deals_with_escalations": [d.get("deal_name") for d in deals if escalated(d)],
        "terminology": terms[0] if terms and all(t == terms[0] for t in terms) else None,
        "deals": deals,
        "history_policy": dict(HISTORY_POLICY),
    }
