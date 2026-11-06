import datetime as dt
import json

import pytest
from sqlalchemy import select

import store
from main import Worker
from sources.net import SourceError
from conftest import FIXTURE, UTC, Clock, set_feeds

FIX_ENV = {"NEWS_SOURCE": "fixture", "NEWS_FIXTURE": str(FIXTURE)}
NOON = dt.datetime(2026, 11, 6, 17, 0, tzinfo=UTC)      # 12:00 in Toronto, after the 06:00 run_at


def rows(eng, table, **where):
    q = select(table)
    for k, v in where.items():
        q = q.where(table.c[k] == v)
    with eng.connect() as c:
        return [dict(r) for r in c.execute(q).mappings()]


def queue_manual(eng, now):
    with eng.begin() as c:
        return store.insert_run(c, "manual", now)


def worker(eng, clock, env=FIX_ENV, **kw):
    return Worker(eng, env=env, now=clock, **kw)


def test_fixture_run_writes_items_adverse_and_counts(eng):
    set_feeds(eng, enabled=True)
    clock = Clock(NOON)
    rid = queue_manual(eng, clock())
    assert worker(eng, clock).tick()[0] == rid
    run = rows(eng, store.news_run, id=rid)[0]
    assert run["status"] == "ok" and run["trigger"] == "manual"
    assert run["companies"] == 10 and run["items_added"] == 10 and run["adverse_added"] == 7
    assert run["errors"] == [] and run["started_at"] is not None and run["finished_at"] is not None

    items = {i["url"].rsplit("/", 1)[1]: i for i in rows(eng, store.news_item)}
    assert {i["source"] for i in items.values()} == {"fixture"}
    assert items["01-litigation"]["company_slug"] == "essex-lease-financial-corp"
    assert items["03-fraud"]["company_slug"] == "tlfc"
    assert items["06-regulatory-and-fraud"]["company_slug"] == "vcc-iv-lp"          # matched in the description
    assert items["10-alias-in-description"]["company_slug"] == "tpine-leasing-capital-corporation"
    assert items["07-positive"]["sentiment"] == "positive"
    assert items["08-neutral"]["sentiment"] == "neutral"
    assert items["09-negative"]["sentiment"] == "negative"
    assert "11-false-friend" not in items and "12-false-friend" not in items       # TLFCX, Essex Lease Financing
    assert items["01-litigation"]["published_at"] is not None

    adverse = rows(eng, store.adverse_item)
    cats = sorted((a["company_slug"], a["category"]) for a in adverse)
    assert cats == sorted([("essex-lease-financial-corp", "litigation"), ("moneda-capital-corp", "regulatory"),
                           ("tlfc", "fraud"), ("finloc-2000-inc", "insolvency"), ("stride-capital", "sanctions"),
                           ("vcc-iv-lp", "regulatory"), ("vcc-iv-lp", "fraud")])
    assert {a["state"] for a in adverse} == {"open"}
    by_id = {i["id"]: i for i in items.values()}
    assert all(by_id[a["news_item_id"]]["url"] == a["url"] for a in adverse)


def test_second_run_dedupes_on_company_and_url(eng):
    set_feeds(eng, enabled=True)
    clock = Clock(NOON)
    w = worker(eng, clock)
    queue_manual(eng, clock())
    w.tick()
    clock.advance(minutes=5)
    rid = queue_manual(eng, clock())
    w.tick()
    run = rows(eng, store.news_run, id=rid)[0]
    assert run["status"] == "ok" and run["items_added"] == 0 and run["adverse_added"] == 0
    assert len(rows(eng, store.news_item)) == 10 and len(rows(eng, store.adverse_item)) == 7


def test_same_article_for_two_companies_is_two_rows(eng, tmp_path):
    f = tmp_path / "two.json"
    f.write_text(json.dumps({"items": [{"title": "Test item: TLFC and Stride Capital in a fictional joint note",
                                        "url": "https://example.com/t/joint", "published_at": "-1d"}]}))
    set_feeds(eng, enabled=True)
    clock = Clock(NOON)
    queue_manual(eng, clock())
    worker(eng, clock, env={"NEWS_SOURCE": "fixture", "NEWS_FIXTURE": str(f)}).tick()
    assert sorted(i["company_slug"] for i in rows(eng, store.news_item)) == ["stride-capital", "tlfc"]


def test_partial_when_some_companies_fail(eng, tmp_path):
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    data["fail_companies"] = ["tlfc", "stride-capital"]
    f = tmp_path / "partial.json"
    f.write_text(json.dumps(data))
    set_feeds(eng, enabled=True)
    clock = Clock(NOON)
    rid = queue_manual(eng, clock())
    worker(eng, clock, env={"NEWS_SOURCE": "fixture", "NEWS_FIXTURE": str(f)}).tick()
    run = rows(eng, store.news_run, id=rid)[0]
    assert run["status"] == "partial"
    assert run["items_added"] == 8
    assert sorted(e["company_slug"] for e in run["errors"]) == ["stride-capital", "tlfc"]
    assert all(e["source"] == "fixture" and e["message"] for e in run["errors"])


def test_failed_when_nothing_succeeds(eng):
    set_feeds(eng, enabled=True)
    clock = Clock(NOON)
    rid = queue_manual(eng, clock())
    worker(eng, clock, env={"NEWS_SOURCE": "fixture", "NEWS_FIXTURE": "/missing.json"}).tick()
    run = rows(eng, store.news_run, id=rid)[0]
    assert run["status"] == "failed" and len(run["errors"]) == 10 and run["items_added"] == 0


class Boom:
    def __init__(self, name, fail_on=()):
        self.name, self.fail_on, self.calls = name, set(fail_on), []

    def queries(self, company):
        return [company["slug"]]

    def fetch(self, query, now, max_age=None):
        self.calls.append(query)
        if query in self.fail_on or "*" in self.fail_on:
            raise SourceError(f"{self.name} down")
        return []


def test_per_source_errors_are_listed(eng):
    set_feeds(eng, enabled=True, sources=["google_news", "gdelt"])
    good, bad = Boom("google_news"), Boom("gdelt", fail_on={"*"})
    clock = Clock(NOON)
    rid = queue_manual(eng, clock())
    worker(eng, clock, env={}, source_factory=lambda names, env: ([good, bad], [])).tick()
    run = rows(eng, store.news_run, id=rid)[0]
    assert run["status"] == "partial"
    assert {e["source"] for e in run["errors"]} == {"gdelt"} and len(run["errors"]) == 10
    assert set(run["errors"][0]) == {"company_slug", "source", "message"}


def test_disabled_fetches_nothing_and_fails_a_queued_run(eng):
    calls = []
    clock = Clock(NOON)
    rid = queue_manual(eng, clock())
    w = worker(eng, clock, source_factory=lambda names, env: calls.append(1) or ([], []))
    w.tick()                                           # setting absent: defaults, enabled false
    run = rows(eng, store.news_run, id=rid)[0]
    assert run["status"] == "failed" and "off" in run["errors"][0]["message"]
    assert calls == []
    for _ in range(3):                                 # and no scheduled run either
        clock.advance(hours=8)
        assert w.tick() == []
    assert len(rows(eng, store.news_run)) == 1


def test_schedule_creates_one_run_per_local_day(eng):
    set_feeds(eng, enabled=True, run_at="06:00", time_zone="America/Toronto")
    clock = Clock(dt.datetime(2026, 11, 6, 10, 0, tzinfo=UTC))     # 05:00 Toronto
    w = worker(eng, clock)
    assert w.tick() == []
    clock.advance(hours=1)                                         # 06:00 Toronto
    first = w.tick()
    assert len(first) == 1
    for _ in range(23):                                            # rest of the local day, past UTC midnight
        clock.advance(hours=1)
        assert w.tick() == []
    clock.advance(hours=1)
    runs = rows(eng, store.news_run, trigger="schedule")
    assert len(runs) == 1 and runs[0]["status"] == "ok" and runs[0]["items_added"] == 10
    assert len(w.tick()) == 1                                      # 06:00 the next local day
    assert len(rows(eng, store.news_run, trigger="schedule")) == 2


def test_queued_manual_runs_go_one_at_a_time_oldest_first(eng):
    set_feeds(eng, enabled=True)
    clock = Clock(NOON)
    a = queue_manual(eng, clock())
    clock.advance(seconds=1)
    b = queue_manual(eng, clock())
    order = []

    class Spy(Boom):
        def fetch(self, query, now, max_age=None):
            with eng.connect() as c:
                running = [r for r in c.execute(select(store.news_run.c.id).where(store.news_run.c.status == "running"))]
            order.append(len(running))
            return []
    spy = Spy("fixture")
    done = worker(eng, clock, source_factory=lambda names, env: ([spy], [])).tick()
    assert done[:2] == [a, b]
    assert set(order) == {1}                     # never two running at once
    assert {r["status"] for r in rows(eng, store.news_run, trigger="manual")} == {"ok"}


def test_a_run_already_taken_is_not_run_twice(eng):
    set_feeds(eng, enabled=True)
    clock = Clock(NOON)
    rid = queue_manual(eng, clock())
    with eng.begin() as c:
        assert store.claim_run(c, rid, clock())
        assert not store.claim_run(c, rid, clock())


def test_restart_fails_a_run_left_running(eng):
    clock = Clock(NOON)
    with eng.begin() as c:
        rid = store.insert_run(c, "manual", clock(), status="running")
    worker(eng, clock).recover()
    run = rows(eng, store.news_run, id=rid)[0]
    assert run["status"] == "failed" and run["errors"][0]["source"] == "worker"


def test_crash_inside_a_run_marks_it_failed(eng):
    set_feeds(eng, enabled=True)
    clock = Clock(NOON)
    rid = queue_manual(eng, clock())

    class Broken(Boom):
        def queries(self, company):
            raise RuntimeError("bug")
    worker(eng, clock, source_factory=lambda names, env: ([Broken("fixture")], [])).tick()
    run = rows(eng, store.news_run, id=rid)[0]
    assert run["status"] == "failed" and "bug" in run["errors"][0]["message"]


def test_no_companies_is_an_ok_empty_run(eng):
    with eng.begin() as c:
        c.execute(store.company.delete())
    set_feeds(eng, enabled=True)
    clock = Clock(NOON)
    rid = queue_manual(eng, clock())
    worker(eng, clock).tick()
    run = rows(eng, store.news_run, id=rid)[0]
    assert (run["status"], run["companies"], run["items_added"]) == ("ok", 0, 0)


@pytest.mark.parametrize("setting", [None, {"enabled": False, "sources": ["google_news"]}])
def test_real_sources_are_never_built_while_off(eng, setting, monkeypatch):
    import sources
    built = []
    monkeypatch.setattr(sources.google_news, "GoogleNews", lambda *a, **k: built.append(1))
    if setting is not None:
        set_feeds(eng, **setting)
    clock = Clock(NOON)
    queue_manual(eng, clock())
    worker(eng, clock, env={}).tick()
    assert built == []
