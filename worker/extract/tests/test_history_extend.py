"""history.extend: one month at a time onto the last published deal object."""
import copy
import functools
import json

import pytest

from worker.extract import extract
from worker.extract.compare import diff, split_known
from worker.extract.history import chain, extend

from .conftest import DEALS, REFS, needs_samples, sample_pdfs

pytestmark = needs_samples


@functools.lru_cache(maxsize=None)
def _exs(prefix):
    return tuple(extract(p) for p in sample_pdfs(prefix))


def _stepwise(prefix):
    exs = _exs(prefix)
    doc = extend(None, exs[0])
    for ex in exs[1:]:
        doc = extend(doc["deal"], ex)
    return doc


@pytest.mark.parametrize("slug,prefix", DEALS.items())
def test_month_by_month_equals_chain(slug, prefix):
    step = _stepwise(prefix)["deal"]
    full = chain(list(_exs(prefix)))["deal"]
    assert diff(step, full) == [] and diff(full, step) == []


@pytest.mark.parametrize("slug,prefix", DEALS.items())
def test_month_by_month_equals_reference(slug, prefix):
    ref = json.loads((REFS / f"{slug}.dashboard.json").read_text(encoding="utf-8"))
    real, _known = split_known(diff(_stepwise(prefix)["deal"], ref))
    assert real == [], real


def test_extend_onto_a_multi_month_published_object():
    # prior = what the publisher holds after July (several months already), then August arrives
    exs = _exs("Xpedite")
    published = chain(list(exs[:3]))["deal"]
    out = extend(published, exs[3])
    assert [r["period"] for r in out["deal"]["period_history"]] == ["2026-05", "2026-06", "2026-07", "2026-08"]
    assert [r["period"] for r in out["deal"]["aging_history"]] == ["2026-08", "2026-07", "2026-06", "2026-05"]
    assert out["deal"]["prior_covenants"] == published["covenants"]
    assert diff(out["deal"], chain(list(exs))["deal"]) == []


def test_sources_and_meta_for_carried_months():
    out = _stepwise("Moneda")
    assert out["meta"]["history"]["extended_from"] == "published 2026-07"
    assert out["meta"]["history"]["periods"] == ["2026-05", "2026-06", "2026-07", "2026-08"]
    # the new month keeps its page-level provenance at its new index; carried months have none (no page to cite)
    assert out["sources"]["/period_history/3/closing_balance"]["page"] == 2
    assert not any(k.startswith(("/period_history/0/", "/aging_history/1/", "/prior_covenants/")) for k in out["sources"])
    assert "/period_history/0" in out["meta"]["history"]["carried"]


def test_extend_none_is_identity():
    ex = _exs("Stride")[-1]
    before = copy.deepcopy(ex)
    assert extend(None, ex) is ex and ex == before


def test_out_of_order_prior_raises():
    exs = _exs("Stride")
    later = chain(list(exs))["deal"]               # latest period 2026-08
    with pytest.raises(ValueError):
        extend(later, exs[2])                       # a July report onto an August deal
    with pytest.raises(ValueError):
        extend(later, exs[3])                       # same period


def test_extend_does_not_mutate_inputs():
    exs = _exs("Moneda")
    prior, ex = copy.deepcopy(exs[0]["deal"]), copy.deepcopy(exs[1])
    extend(prior, ex)
    assert prior == exs[0]["deal"] and ex == exs[1]
