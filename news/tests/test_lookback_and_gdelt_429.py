"""Search windows (first search 90 days, or 12 months with a paid archive; later 7) and GDELT 429 handling (retry
once, skip after 3 requests in a row)."""
import datetime as dt
import io
import json
import urllib.error
import urllib.parse
import urllib.request

import pytest

import check
import store
from main import Worker
from sources import gdelt, google_news, net
from conftest import UTC, Clock, set_feeds

NOW = dt.datetime(2026, 11, 6, 17, 0, tzinfo=UTC)


def test_lookback_constants():
    assert net.FIRST_LOOKBACK_DAYS == 90 and net.LOOKBACK_DAYS == 7 and net.FIRST_ARCHIVE_DAYS == 365
    assert net.lookback(first=True) == dt.timedelta(days=90)
    assert net.lookback(first=True, archive=True) == dt.timedelta(days=365)
    assert net.lookback(first=False) == dt.timedelta(days=7)
    assert net.lookback(first=False, archive=True) == dt.timedelta(days=7)


# --- look-back through a run -------------------------------------------------------------------------------------

class Dated:
    """A fake network source that applies max_age like the real ones and records what it was asked for."""
    name = "google_news"
    fetch_pages = False

    def __init__(self, items):
        self.items, self.asked = items, []

    def queries(self, company):
        return [company["slug"]]

    def fetch(self, query, now, max_age=None):
        self.asked.append((query, max_age))
        return [dict(i) for i in self.items if now - i["published_at"] <= max_age]


def _item(n, days_old, name="TLFC"):
    return {"title": f"Test item: {name} fictional note {n}", "url": f"https://example.com/lb/{n}",
            "publisher": "Test Wire", "published_at": NOW - dt.timedelta(days=days_old), "description": ""}


def _run(eng, clock, src):
    with eng.begin() as c:
        rid = store.insert_run(c, "manual", clock())
    Worker(eng, env={}, now=clock, source_factory=lambda names, env, paid=(): ([src], []),
           checker=check.FixtureChecker()).tick()
    with eng.connect() as c:
        return store.get_run(c, rid)


def test_first_search_keeps_90_days_later_runs_keep_7(eng):
    set_feeds(eng, enabled=True, run_at="23:59")      # no scheduled run inside these ticks
    clock = Clock(NOW)
    src = Dated([_item(1, 2), _item(2, 42), _item(3, 89), _item(4, 120)])
    run = _run(eng, clock, src)
    assert run["status"] == "ok"
    with eng.connect() as c:
        urls = sorted(r[0] for r in c.execute(store.news_item.select().with_only_columns(store.news_item.c.url)
                                              .where(store.news_item.c.company_slug == "tlfc")))
    assert urls == ["https://example.com/lb/1", "https://example.com/lb/2", "https://example.com/lb/3"]
    assert dict(src.asked)["tlfc"] == dt.timedelta(days=90)

    # Second run: TLFC has rows now, so 7 days; a new 30-day-old story is not kept. Others still have none: 90 days.
    src2 = Dated([_item(5, 30), _item(6, 3)])
    run2 = _run(eng, clock, src2)
    assert run2["items_added"] == 1
    asked = dict(src2.asked)
    assert asked["tlfc"] == dt.timedelta(days=7)
    assert asked["stride-capital"] == dt.timedelta(days=90)


def test_google_parse_honours_max_age():
    rss = (b'<rss><channel>'
           b'<item><title>Test item: TLFC a</title><link>https://example.com/a</link>'
           b'<pubDate>Fri, 25 Sep 2026 10:00:00 GMT</pubDate></item>'
           b'<item><title>Test item: TLFC b</title><link>https://example.com/b</link>'
           b'<pubDate>Sat, 01 Aug 2026 10:00:00 GMT</pubDate></item>'
           b'</channel></rss>')
    assert google_news.parse(rss, NOW, dt.timedelta(days=7)) == []
    assert [i["url"] for i in google_news.parse(rss, NOW, dt.timedelta(days=90))] == ["https://example.com/a"]


def test_gdelt_timespan_follows_the_lookback(monkeypatch):
    seen = []
    monkeypatch.setattr(gdelt, "get", lambda url, limiter=None: seen.append(url) or b"{}")
    g = gdelt.Gdelt(limiter=None, sleep=lambda s: None)
    g.fetch('"TLFC"', NOW, dt.timedelta(days=90))
    g.fetch('"TLFC"', NOW, dt.timedelta(days=7))
    g.fetch('"TLFC"', NOW, dt.timedelta(days=365))                 # GDELT covers about 3 months: clamped
    spans = [urllib.parse.parse_qs(urllib.parse.urlparse(u).query)["timespan"][0] for u in seen]
    assert spans == ["90d", "7d", "90d"]


def test_gdelt_drops_items_older_than_max_age(monkeypatch):
    body = json.dumps({"articles": [
        {"url": "https://example.com/new", "title": "Test item: new", "seendate": "20261105T000000Z"},
        {"url": "https://example.com/old", "title": "Test item: old", "seendate": "20260901T000000Z"}]}).encode()
    monkeypatch.setattr(gdelt, "get", lambda url, limiter=None: body)
    items = gdelt.Gdelt(limiter=None).fetch('"x"', NOW, dt.timedelta(days=7))
    assert [i["url"] for i in items] == ["https://example.com/new"]


# --- GDELT 429 ---------------------------------------------------------------------------------------------------

class FakeResp(io.BytesIO):
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def scripted_urlopen(monkeypatch, script):
    """script: list of 200 bodies (bytes) or HTTP status codes (int) / exceptions, consumed in order."""
    calls = []

    def fake(req, timeout=None):
        calls.append(req.full_url)
        step = script.pop(0)
        if isinstance(step, int):
            raise urllib.error.HTTPError(req.full_url, step, "Too Many Requests", {}, None)
        if isinstance(step, Exception):
            raise step
        return FakeResp(step)
    monkeypatch.setattr(urllib.request, "urlopen", fake)
    return calls


class NoWait:
    def wait(self):
        pass


def test_spacing_is_10_seconds_and_retry_waits_20():
    assert gdelt._LIMIT.min_interval == gdelt.SPACING == 10
    assert gdelt.RETRY_WAIT == 20


def test_429_waits_20s_and_retries_once_then_succeeds(monkeypatch):
    calls = scripted_urlopen(monkeypatch, [429, b"{}"])
    slept = []
    g = gdelt.Gdelt(limiter=NoWait(), sleep=slept.append)
    assert g.fetch('"x"', NOW) == []
    assert len(calls) == 2 and calls[0] == calls[1]
    assert slept == [20]
    assert g.consecutive_429 == 0 and not g.skipped


def test_429_twice_is_one_error_and_no_third_request(monkeypatch):
    calls = scripted_urlopen(monkeypatch, [429, 429])
    g = gdelt.Gdelt(limiter=NoWait(), sleep=lambda s: None)
    with pytest.raises(net.SourceError) as e:
        g.fetch('"x"', NOW)
    assert e.value.status == 429 and len(calls) == 2 and g.consecutive_429 == 1


def test_other_http_errors_are_not_retried(monkeypatch):
    calls = scripted_urlopen(monkeypatch, [503])
    with pytest.raises(net.SourceError):
        gdelt.Gdelt(limiter=NoWait(), sleep=lambda s: None).fetch('"x"', NOW)
    assert len(calls) == 1


def test_a_success_or_timeout_resets_the_consecutive_count(monkeypatch):
    scripted_urlopen(monkeypatch, [429, 429, 429, 429, b"{}", 429, 429, 429, 429, TimeoutError("timed out"),
                                   429, 429])
    g = gdelt.Gdelt(limiter=NoWait(), sleep=lambda s: None)
    outcomes = []
    for _ in range(7):
        try:
            g.fetch('"x"', NOW)
            outcomes.append("ok")
        except net.SourceError as exc:
            outcomes.append(exc.status or "err")
    # two 429 companies, a success, two more, a timeout, one more: never three in a row
    assert not g.skipped
    assert outcomes == [429, 429, "ok", 429, 429, "err", 429]


def _gdelt_run(eng, monkeypatch, script):
    set_feeds(eng, enabled=True, run_at="23:59", sources=["gdelt"])
    calls = scripted_urlopen(monkeypatch, script)
    clock = Clock(NOW)
    with eng.begin() as c:
        rid = store.insert_run(c, "manual", clock())

    def factory(names, env, paid=()):
        return [gdelt.Gdelt(limiter=NoWait(), sleep=lambda s: None)], []
    Worker(eng, env={}, now=clock, source_factory=factory, checker=check.FixtureChecker()).tick()
    with eng.connect() as c:
        return store.get_run(c, rid), calls


def test_three_consecutive_429_requests_skip_gdelt_for_the_run(eng, monkeypatch):
    # GDELT asks 4 queries per company (names and names + adverse terms, in English and French). Companies in slug
    # order: dynamic-capital's 4 succeed, then Essex's first three requests each 429 twice, then nothing more is called.
    run, calls = _gdelt_run(eng, monkeypatch, [b"{}"] * 4 + [429] * 6)
    assert len(calls) == 10                                      # 4 + 3 requests x (try + retry)
    msgs = [e["message"] for e in run["errors"]]
    assert msgs.count(gdelt.SKIP_MESSAGE) == 1
    skip = [e for e in run["errors"] if e["message"] == gdelt.SKIP_MESSAGE][0]
    assert skip == {"company_slug": None, "source": "gdelt", "message": gdelt.SKIP_MESSAGE}
    per_company = [e for e in run["errors"] if e["company_slug"]]
    assert [e["company_slug"] for e in per_company] == ["essex-lease-financial-corp"] * 3
    assert run["status"] == "partial"                            # dynamic-capital succeeded
    assert run["stats"]["calls"] == {"gdelt": 7}


def test_all_429_is_a_failed_run(eng, monkeypatch):
    run, calls = _gdelt_run(eng, monkeypatch, [429] * 6)
    assert len(calls) == 6 and run["status"] == "failed"
    assert len(run["errors"]) == 4                               # three companies plus the one skip error


def test_timeouts_stay_one_error_per_request(eng, monkeypatch):
    run, calls = _gdelt_run(eng, monkeypatch, [TimeoutError("timed out")] * 40)
    assert len(calls) == 40 and run["status"] == "failed"
    assert len(run["errors"]) == 40 and gdelt.SKIP_MESSAGE not in [e["message"] for e in run["errors"]]
