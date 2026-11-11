"""Covenant status for every extraction engine: the same function rule R18 runs (rules/covenant_status.py), so
the extractor and the rule cannot disagree on a band (audit M7).

The function lives in the rules package. It is imported from there when `rules` is importable (the container
mounts it at /app/rules beside this package; from the repo root it is a top-level package), and otherwise loaded
from that one file by path (`python main.py` run from worker/ in a checkout, where rules/ is one level up). It
has no imports of its own, so loading the file needs nothing else from the rules package.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path


def _load():
    try:
        from rules.covenant_status import covenant_status
        return covenant_status
    except ImportError:
        pass
    here = Path(__file__).resolve()
    for base in (here.parents[1], here.parents[2]):          # worker/rules (container), <repo>/rules
        f = base / "rules" / "covenant_status.py"
        if f.exists():
            spec = importlib.util.spec_from_file_location("_rules_covenant_status", f)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod.covenant_status
    raise ImportError("rules/covenant_status.py not found beside worker/ or inside it")


covenant_status = _load()
UNREAD_CONFIDENCE = 0.5      # provenance confidence of a covenant status that could not be derived


def status(v, thr, kind, buffer, prior_month: bool = False):
    """covenants[].status: 'OK' | 'WATCH' | 'BREACH', or None when it cannot be derived.

    A ceiling / floor covenant with no value or no threshold has NO status for the current period: an unreadable
    value is not "OK" (audit M4); rule R18 raises a review finding for it. Two cases keep the earlier "OK":
    a prior_covenants row (`prior_month`): the prior month's CNL value is not printed on this report, and the row
    is replaced by the prior publication's covenants when history is chained; and a kind that is neither ceiling
    nor floor, which no band applies to."""
    s = covenant_status(v, thr, kind, buffer)
    if s is None and (prior_month or kind not in ("ceiling", "floor")):
        return "OK"
    return s
