"""Paid source adapters against recorded responses shaped from each provider's published docs (no network)."""
import datetime as dt
import io
import json
import urllib.error
import urllib.parse
import urllib.request

import pytest

from queries import Query, build
from sources import net, paid
from conftest import UTC, provider_body

NOW = dt.datetime(2026, 11, 6, 12, 0, tzinfo=UTC)
WEEK = dt.timedelta(days=7)
KEY = "TEST-ER-KEY-0000-SECRET"
CO = {"slug": "moneda-capital-corp", "name": "Moneda Capital Corp.", "aliases": ["Moneda Capital"]}


class Resp(io.BytesIO):
    status = 200
    headers = {"Content-Type": "application/json"}

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def geturl(self):
        return "https://example.com/"


class NoWait:
    def wait(self):
        pass


@pytest.fixture
def http(monkeypatch):
    calls = []

    def install(body=None, error=None):
        def fake(req, timeout=None):
            calls.append(req)
            if error is not None:
                raise error
            return Resp(body)
        monkeypatch.setattr(urllib.request, "urlopen", fake)
        return calls
    return install


def http_error(code, body):
    return urllib.error.HTTPError("https://x", code, "err", {}, io.BytesIO(body))


# --- Event Registry ----------------------------------------------------------------------------------------------

def test_event_registry_parses_recorded_response():
    items = paid.parse_event_registry(json.loads(provider_body("event_registry.json")))
    assert len(items) == 2                                       # the article without a URL is skipped
    a, b = items
    assert a["title"] == "Test item: Essex Lease Financial opens a fictional office"
    assert a["url"].startswith("https://example.com/er/essex-lease-financial-office")
    assert a["publisher"] == "Test Wire" and a["language"] == "en"
    assert a["published_at"] == dt.datetime(2026, 11, 5, 14, 20, tzinfo=UTC)          # date + time: confirmed
    assert a["source_date"] == dt.datetime(2026, 11, 5, 14, 35, 12, tzinfo=UTC)       # dateTimePub: first seen
    assert "equipment leasing" in a["text"]
    assert b["language"] == "fr" and b["published_at"] == dt.datetime(2026, 11, 4, 9, 0, tzinfo=UTC)


def test_event_registry_request_body_phrase_search_both_languages(http):
    calls = http(provider_body("event_registry.json"))
    src = paid.EventRegistry({"api_key": KEY}, {}, NoWait())
    qs = src.queries(CO)
    assert [(q.kind, q.langs) for q in qs] == [("name", ("en", "fr")), ("alias", ("en", "fr")),
                                                ("adverse", ("en",)), ("adverse", ("fr",))]
    items = src.fetch(qs[0], NOW, WEEK)
    req = calls[0]
    assert req.full_url == paid.ER_URL and req.get_method() == "POST"
    body = json.loads(req.data)
    assert body["apiKey"] == KEY and body["keyword"] == "Moneda Capital Corp."
    assert body["keywordLoc"] == "title,body" and body["keywordSearchMode"] == "phrase"
    assert body["lang"] == ["eng", "fra"] and body["articlesCount"] == 100 and body["articlesPage"] == 1
    assert body["isDuplicateFilter"] == "skipDuplicates"
    assert body["dateStart"] == "2026-10-30" and body["dateEnd"] == "2026-11-06"
    assert KEY not in req.full_url                                   # the key travels only in the body
    assert len(items) == 2


def test_event_registry_adverse_query_uses_the_query_language(http):
    calls = http(b'{"articles": {"results": []}}')
    src = paid.EventRegistry({"api_key": KEY}, {}, NoWait())
    fr = [q for q in src.queries(CO) if q.kind == "adverse" and q.langs == ("fr",)][0]
    src.fetch(fr, NOW, WEEK)
    q = json.loads(calls[0].data)["query"]["$query"]["$and"]
    assert q[0]["keyword"] == "Moneda Capital Corp."
    assert {"keyword": "faillite", "keywordLoc": "title,body"} in q[1]["$or"]
    assert q[2] == {"lang": "fra"}


def test_event_registry_drops_confirmed_dates_outside_the_window():
    data = json.loads(provider_body("event_registry.json"))
    items = paid.parse_event_registry(data, NOW, dt.timedelta(days=2))
    assert [i["published_at"].date().isoformat() for i in items] == ["2026-11-05"]


def test_event_registry_error_is_scrubbed(http):
    http(provider_body("event_registry_error.json"))
    with pytest.raises(net.SourceError) as e:
        paid.EventRegistry({"api_key": KEY}, {}, NoWait()).fetch(build(CO)[0], NOW, WEEK)
    assert KEY not in str(e.value) and "[redacted]" in str(e.value) and "Invalid API key" in str(e.value)


def test_http_error_body_echoing_the_key_is_scrubbed(http):
    http(error=http_error(401, json.dumps({"message": f"bad key {KEY}"}).encode()))
    with pytest.raises(net.SourceError) as e:
        paid.EventRegistry({"api_key": KEY}, {}, NoWait()).fetch(build(CO)[0], NOW, WEEK)
    assert e.value.status == 401 and KEY not in str(e.value) and "HTTP 401" in str(e.value)


def test_missing_key_is_an_error_without_a_call(http):
    calls = http(b"{}")
    with pytest.raises(net.SourceError, match="no api_key"):
        paid.EventRegistry({}, {}, NoWait()).fetch(build(CO)[0], NOW, WEEK)
    assert calls == []


# --- NewsCatcher -------------------------------------------------------------------------------------------------

def test_newscatcher_parses_recorded_response():
    a, b = paid.parse_newscatcher(json.loads(provider_body("newscatcher.json")))
    assert a["url"] == "https://example.com/nc/tlfc-quarter#comments" and a["publisher"] == "Test Wire"
    assert a["published_at"] == dt.datetime(2026, 11, 5, 13, 0, tzinfo=UTC)           # published_date: confirmed
    assert a["source_date"] == dt.datetime(2026, 11, 6, 2, 10, tzinfo=UTC)            # parse_date: crawl
    assert a["description"].startswith("Fictional") and "equipment finance" in a["text"] and a["language"] == "en"
    assert b["language"] == "fr" and b["published_at"].date() == dt.date(2026, 11, 2)


def test_newscatcher_request_header_and_params(http):
    calls = http(provider_body("newscatcher.json"))
    src = paid.NewsCatcher({"api_key": "nc-secret-token-1234"}, {}, NoWait())
    adverse = [q for q in src.queries(CO) if q.kind == "adverse"][0]
    src.fetch(adverse, NOW, WEEK)
    req = calls[0]
    assert req.full_url.startswith(paid.NC_URL + "?")
    assert req.get_header("X-api-token") == "nc-secret-token-1234"
    p = urllib.parse.parse_qs(urllib.parse.urlparse(req.full_url).query)
    assert p["q"] == ['"Moneda Capital Corp." AND (fraud OR lawsuit OR insolvency OR bankruptcy OR receivership OR '
                      'regulator OR sanction)']
    assert p["lang"] == ["en"] and p["page_size"] == ["100"] and p["page"] == ["1"] and p["sort_by"] == ["date"]
    assert p["from_"] == ["2026-10-30 12:00:00"] and p["to_"] == ["2026-11-06 12:00:00"]
    assert "nc-secret-token-1234" not in req.full_url


def test_newscatcher_default_limiter_respects_the_free_plan():
    assert paid.NewsCatcher({"api_key": "k"}).limiter.min_interval >= 1


# --- Brave -------------------------------------------------------------------------------------------------------

def test_brave_news_parses_and_page_age_is_never_confirmed():
    [it] = paid.parse_brave(json.loads(provider_body("brave_news.json")), "en")
    assert it["title"] == "Test item: Stride Capital funds a fictional fleet"                  # tags stripped
    assert it["publisher"] == "example.com" and it["published_at"] is None
    assert it["source_date"] == dt.datetime(2026, 11, 4, 16, 0, tzinfo=UTC)
    assert "equipment leasing" in it["text"] and it["language"] == "en"


def test_brave_web_parses_the_web_block():
    [it] = paid.parse_brave(json.loads(provider_body("brave_web.json")), "fr")
    assert it["url"] == "https://example.com/brave-web/vcc-filing" and it["published_at"] is None
    assert it["language"] == "fr"


def test_brave_requests(http):
    calls = http(provider_body("brave_news.json"))
    news = paid.BraveNews({"api_key": "brave-token-5678"}, {}, NoWait())
    qs = news.queries(CO)
    assert all(len(q.langs) == 1 for q in qs) and len(qs) == 6
    news.fetch(qs[1], NOW, WEEK)                                       # the French name query
    req = calls[0]
    assert req.full_url.startswith(paid.BRAVE_NEWS) and req.get_header("X-subscription-token") == "brave-token-5678"
    p = urllib.parse.parse_qs(urllib.parse.urlparse(req.full_url).query)
    assert p == {"q": ['"Moneda Capital Corp."'], "search_lang": ["fr"], "country": ["CA"], "count": ["50"],
                 "extra_snippets": ["true"], "freshness": ["pw"]}
    calls.clear()
    http(provider_body("brave_web.json"))
    web = paid.BraveWeb({"api_key": "brave-token-5678"}, {}, NoWait())
    web.fetch(qs[0], NOW, dt.timedelta(days=90))
    p = urllib.parse.parse_qs(urllib.parse.urlparse(calls[0].full_url).query)
    assert calls[0].full_url.startswith(paid.BRAVE_WEB) and p["count"] == ["20"]
    assert p["freshness"] == ["2026-08-08to2026-11-06"]


def test_brave_error_response(http):
    http(provider_body("brave_error.json"))
    with pytest.raises(net.SourceError, match="subscription token is invalid"):
        paid.BraveNews({"api_key": "brave-token-5678"}, {}, NoWait()).fetch(build(CO)[0], NOW, WEEK)


def test_brave_config_flags_choose_news_and_web():
    assert [s.name for s in paid.build("brave", {"api_key": "k"}, {})] == ["brave_news", "brave_web"]   # defaults: both on (API)
    assert [s.name for s in paid.build("brave", {"api_key": "k"}, {"web": False})] == ["brave_news"]
    assert [s.name for s in paid.build("brave", {"api_key": "k"}, {"news": True, "web": True})] == ["brave_news",
                                                                                                   "brave_web"]
    assert [s.name for s in paid.build("brave", {"api_key": "k"}, {"news": False, "web": True})] == ["brave_web"]


# --- Dow Jones and LexisNexis ------------------------------------------------------------------------------------

@pytest.mark.parametrize("provider", ["dow_jones", "lexisnexis"])
def test_slots_refuse_until_the_client_supplies_the_docs(provider, http):
    calls = http(b"{}")
    [src] = paid.build(provider, {"client_id": "abcd1234"}, {})
    with pytest.raises(net.SourceError, match="Needs the client's API documentation"):
        src.fetch(Query("name", "x", ("en",)), NOW, WEEK)
    assert calls == []


def test_archive_months():
    assert paid.archive_months({"archive_months": 12}) == 12
    assert paid.archive_months({"archive_months": "24"}) == 24
    assert paid.archive_months({}) == 0 and paid.archive_months({"archive_months": "x"}) == 0
