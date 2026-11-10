"""Covenant status from value, threshold, kind and watch buffer: the one function the extraction engines
(worker/extract) and rule R18 (rules/checks.py) both call, so the extractor and the rule cannot disagree.

ceiling: BREACH if value > threshold; WATCH if value >= threshold x (1 - buffer); else OK.
floor:   BREACH if value < threshold; WATCH if value <= threshold / (1 - buffer); else OK.

Both are "utilization >= 1 - buffer", with utilization = value / threshold for a ceiling and threshold / value for a
floor: the same number the deal object stores as covenants[].utilization_pct and the portal's watch-threshold slider
reads (web/src/portfolio/fmt.ts displayStatus). The floor band is threshold / (1 - buffer), not the symmetric
|threshold - value| <= buffer x threshold: the published Essex object has interest coverage 1.11 against a floor of
1.00 at a 10% buffer as WATCH (1.11 <= 1.1111), which the symmetric band (<= 1.10) would call OK.

No number to judge (value or threshold missing, or a kind that is not ceiling / floor) gives None: an unreadable value
is not "OK". Pure: no I/O, no imports from the rest of the package.
"""
import math

EPS = 1e-9


def _num(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def covenant_status(value, threshold, kind, buffer):
    """'OK' | 'WATCH' | 'BREACH', or None when the status cannot be derived."""
    if not _num(value) or not _num(threshold) or kind not in ("ceiling", "floor"):
        return None
    buffer = buffer if _num(buffer) else 0.0
    if kind == "ceiling":
        if value > threshold + EPS:
            return "BREACH"
        return "WATCH" if value >= threshold * (1 - buffer) - EPS else "OK"
    if value < threshold - EPS:
        return "BREACH"
    return "WATCH" if buffer < 1 and value <= threshold / (1 - buffer) + EPS else "OK"
