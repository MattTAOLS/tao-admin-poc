"""Compare an extracted deal object with a reference dashboard.json deal object.

Tolerances from the brief: $0.01 on amounts, 0.0001 on fractions/ratios (values with |reference| < 1 use the
fraction tolerance). Strings compare after folding whitespace and dash variants. Keys present only in the
extraction are ignored (it may carry more, e.g. covenants[].reported_triggered).

History arrays: one SetRep yields the current period's row; it is compared with the reference row for the same
period. Use `history.py` to chain several reports into the full arrays.

CLI:  python -m worker.extract.compare <pdf> <reference.dashboard.json>
"""
from __future__ import annotations

import json
import re
import sys
from typing import Any

AMOUNT_TOL = 0.01
FRACTION_TOL = 0.0001

# deal paths the rule catalogue reads (contracts/rules.yaml, phase 1 and 2 `fields`), as top-level keys
RULE_READ_KEYS = ["deal_slug", "deal_name", "settlement_date", "collection_period", "terminology", "tranche_balance",
                  "contracts", "period_history", "aging_history", "cnl_by_period", "covenants", "program",
                  "warehouse", "financial_ratios", "ratio_history", "total_enhancement", "watch_buffer_pct",
                  "worst_status", "covenant_summary"]

# Paths where the reference objects themselves are inconsistent across the three F-PIL deals, so no single
# extraction rule can match all of them. Each entry says why; the extraction keeps the printed / normalized form.
KNOWN_REFERENCE_QUIRKS = {
    r"^/source_pages/funding_costs$": "Stride prints 'COST OF FUND' (singular); the reference pipeline missed it (null)",
    r"^/covenants/\d+/legal_ref$": "reference spaces 'SLFA 9.1 (c)' for Moneda/Xpedite but not Stride; we always space",
    r"^/prior_covenants/\d+/legal_ref$": "same as covenants legal_ref",
    r"^/prior_covenants/\d+/(current_value|utilization_pct|status|worst_vintage)$":
        "prior-period CNL is not printed on this report; filled from the prior extraction when one is supplied",
    r"^/prior_covenants/\d+/trend$": "prior trend needs the month before the prior month; filled when available",
}


def _norm_s(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[‒–—]", "-", s)).strip()


def diff(ours: Any, ref: Any, path: str = "") -> list[tuple[str, Any, Any]]:
    out: list[tuple[str, Any, Any]] = []
    if isinstance(ref, dict):
        if not isinstance(ours, dict):
            return [(path, ours, ref)]
        for k, v in ref.items():
            if k not in ours:
                out.append((f"{path}/{k}", "<missing>", v))
            else:
                out += diff(ours[k], v, f"{path}/{k}")
        return out
    if isinstance(ref, list):
        if not isinstance(ours, list):
            return [(path, ours, ref)]
        if len(ours) != len(ref):
            out.append((f"{path}/#len", len(ours), len(ref)))
        for i, (a, b) in enumerate(zip(ours, ref)):
            out += diff(a, b, f"{path}/{i}")
        return out
    if isinstance(ref, bool) or isinstance(ours, bool):
        return [] if ours == ref else [(path, ours, ref)]
    if isinstance(ref, (int, float)) and isinstance(ours, (int, float)):
        tol = AMOUNT_TOL if abs(ref) >= 1 else FRACTION_TOL
        return [] if abs(ours - ref) <= tol + 1e-9 else [(path, ours, ref)]
    if isinstance(ref, str) and isinstance(ours, str):
        return [] if _norm_s(ours) == _norm_s(ref) else [(path, ours, ref)]
    return [] if ours == ref else [(path, ours, ref)]


def compare_current(ours: dict, ref: dict, keys: list[str] | None = None) -> list[tuple[str, Any, Any]]:
    """Compare one report's extraction with the reference object of the same period."""
    out = []
    for k in keys or list(ref):
        if k in ("period_history", "aging_history"):
            cur = ours.get(k) or []
            for row in cur:
                match = [r for r in ref.get(k, []) if r.get("period") == row.get("period")]
                if not match:
                    out.append((f"/{k}[{row.get('period')}]", row, "<no reference row>"))
                else:
                    out += diff(row, match[0], f"/{k}[{row.get('period')}]")
            continue
        if k not in ours:
            out.append((f"/{k}", "<missing>", ref.get(k)))
            continue
        out += diff(ours[k], ref[k], f"/{k}")
    return out


def split_known(diffs):
    real, known = [], []
    for d in diffs:
        (known if any(re.search(p, d[0]) for p in KNOWN_REFERENCE_QUIRKS) else real).append(d)
    return real, known


if __name__ == "__main__":
    from . import extract
    pdf, refp = sys.argv[1], sys.argv[2]
    ex = extract(pdf)
    ref = json.load(open(refp, encoding="utf-8"))
    real, known = split_known(compare_current(ex["deal"], ref))
    for d in real:
        print("DIFF ", d)
    for d in known:
        print("known", d)
    print(f"{len(real)} differences, {len(known)} known reference quirks")
