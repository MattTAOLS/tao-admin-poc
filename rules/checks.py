"""One function per rule, named by rules.yaml `fn`. Signature: (rule, extraction, ctx, tol) -> list[finding].
Rules agent fills these in; each gets a passing and a failing fixture under tests/fixtures/."""
from .engine import finding

def near(a, b, t): return a is not None and b is not None and abs(a - b) <= t

def required_fields_present(rule, ex, ctx, tol):
    missing = []
    for ptr in rule["fields"]:
        cur = ex["deal"]
        for part in ptr.strip("/").split("/"):
            cur = cur.get(part) if isinstance(cur, dict) else (cur[int(part)] if isinstance(cur, list) and part.isdigit() and int(part) < len(cur) else None)
            if cur is None: break
        if cur is None: missing.append(ptr)
    return [finding(rule, ex["meta"]["upload_id"], context={"count": len(missing), "missing": ", ".join(missing)}, fields=missing)] if missing else []

def tranche_rollforward(rule, ex, ctx, tol):
    d = ex["deal"]; period = next((p for p in d.get("period_history", []) if p.get("collection_period") == d.get("collection_period")), None)
    if not period: return []
    computed = period["opening_balance"] - period["principal"] - period["principal_prepayments"] - period["losses"]
    if near(computed, period["closing_balance"], tol["currency"]): return []
    return [finding(rule, ex["meta"]["upload_id"], our_value=round(computed, 2), report_value=period["closing_balance"], difference=round(period["closing_balance"] - computed, 2), tolerance=tol["currency"], unit="currency",
                    context={"opening": period["opening_balance"], "principal": period["principal"], "prepayments": period["principal_prepayments"], "losses": period["losses"], "computed": round(computed, 2), "closing": period["closing_balance"]})]

def aging_buckets_sum(rule, ex, ctx, tol):
    """R07. Two conventions seen in the 12 reference deals: F-PIL closes on the three live buckets; most MOVE Trust
    deals include the written-off / 91+ bucket in the closing balance. Either must tie to the aging closing balance.
    The aging closing vs page-2 tranche closing comparison is recorded in context (Meridian OneCap differs by its
    deemed defaults) and left to R17/R18, not blocked here."""
    d = ex["deal"]; a = d["aging_history"][0]
    sum3 = a["current_0_30"] + a["days_31_60"] + a["days_61_90"]; sum4 = sum3 + a["written_off"]
    if near(sum3, a["closing_balance"], tol["currency"]) or near(sum4, a["closing_balance"], tol["currency"]): return []
    computed = sum4 if abs(sum4 - a["closing_balance"]) < abs(sum3 - a["closing_balance"]) else sum3
    return [finding(rule, ex["meta"]["upload_id"], our_value=round(computed, 2), report_value=a["closing_balance"], difference=round(a["closing_balance"] - computed, 2), tolerance=tol["currency"], unit="currency",
                    context={"computed": round(computed, 2), "closing_balance": a["closing_balance"], "tranche_closing": d["tranche_balance"]["closing"], "bucket_label": a["written_off_bucket_label"]})]
