import datetime as dt
import io
import json
import urllib.error
import urllib.parse
import urllib.request

import pytest

import sources
from sources import fixture, gdelt, google_news, net
from conftest import FIXTURE, UTC

NOW = dt.datetime(2026, 11, 6, 12, 0, tzinfo=UTC)
ESSEX = {"slug": "essex-lease-financial-corp", "name": "Essex Lease Financial Corp.", "aliases": ["Essex Lease Financial"]}

RSS = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Google News</title>
<item><title>Test item: Essex Lease Financial opens office - Test Wire</title>
<link>https://news.google.com/rss/articles/abc?oc=5</link>
<pubDate>Thu, 05 Nov 2026 14:00:00 GMT</pubDate>
<description>&lt;a href="https://example.com/x"&gt;Test item: Essex Lease Financial opens office&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font&gt;Test Wire&lt;/font&gt;</description>
<source url="https://example.com">Test Wire</source></item>
<item><title>Test item: an old story - Test Wire</title>
<link>https://news.google.com/rss/articles/old</link>
<pubDate>Mon, 05 Oct 2026 14:00:00 GMT</pubDate><description>old</description><source url="https://example.com">Test Wire</source></item>
</channel></rss>"""

GDELT_JSON = json.dumps({"articles": [
    {"url": "https://example.com/a", "title": "Test item: Essex Lease Financial news", "seendate": "20261105T121500Z",
     "domain": "example.com", "language": "English"},
    {"url": "", "title": "no url"}]}).encode()


class FakeResp(io.BytesIO):
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture
def capture(monkeypatch):
    calls = []

    def install(body):
        def fake(req, timeout=None):
            calls.append((req, timeout))
            if isinstance(body, Exception):
                raise body
            return FakeResp(body)
        monkeypatch.setattr(urllib.request, "urlopen", fake)
        return calls
    return install


class NoWait:
    def wait(self):
        pass


def test_google_url_is_quoted_with_canada_edition():
    url = google_news.search_url('"Essex Lease Financial"')
    q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    assert q == {"q": ['"Essex Lease Financial"'], "hl": ["en-CA"], "gl": ["CA"], "ceid": ["CA:en"]}
    fr = urllib.parse.parse_qs(urllib.parse.urlparse(google_news.search_url('"x"', "fr")).query)
    assert fr["hl"] == ["fr-CA"] and fr["gl"] == ["CA"] and fr["ceid"] == ["CA:fr"]


def test_google_queries_per_language_name_alias_and_adverse(capture):
    qs = google_news.GoogleNews().queries(ESSEX)
    assert [(q.kind, q.term, q.langs) for q in qs] == [
        ("name", "Essex Lease Financial Corp.", ("en",)), ("name", "Essex Lease Financial Corp.", ("fr",)),
        ("alias", "Essex Lease Financial", ("en",)), ("alias", "Essex Lease Financial", ("fr",)),
        ("adverse", "Essex Lease Financial Corp.", ("en",)), ("adverse", "Essex Lease Financial Corp.", ("fr",))]
    calls = capture(b"<rss><channel></channel></rss>")
    g = google_news.GoogleNews(limiter=NoWait())
    g.fetch(qs[5], NOW)
    q = urllib.parse.parse_qs(urllib.parse.urlparse(calls[0][0].full_url).query)
    assert q["q"] == ['"Essex Lease Financial Corp." (fraude OR poursuite OR faillite OR insolvabilité OR séquestre OR '
                      '"Autorité des marchés financiers" OR sanction)']
    assert q["ceid"] == ["CA:fr"]


def test_google_fetch_parses_rss_and_sends_plain_user_agent(capture):
    calls = capture(RSS)
    items = google_news.GoogleNews(limiter=NoWait()).fetch("Essex Lease Financial", NOW)
    req, timeout = calls[0]
    assert req.get_header("User-agent") == "tao-admin-poc news worker"
    assert timeout == net.TIMEOUT
    assert set(req.headers) <= {"User-agent", "Accept"}             # nothing personal, no cookies
    assert len(items) == 1                                           # the October story is older than 7 days
    it = items[0]
    assert it["title"] == "Test item: Essex Lease Financial opens office"
    assert it["publisher"] == "Test Wire"
    assert it["url"] == "https://news.google.com/rss/articles/abc?oc=5"
    assert it["published_at"] is None                                # pubDate is when Google indexed it
    assert it["source_date"] == dt.datetime(2026, 11, 5, 14, 0, tzinfo=UTC)
    assert "Essex Lease Financial opens office" in it["description"] and "<" not in it["description"]


def test_google_bad_body_is_a_source_error(capture):
    capture(b"<html>sorry</html")
    with pytest.raises(net.SourceError):
        google_news.GoogleNews(limiter=NoWait()).fetch("x", NOW)


def test_http_error_is_a_source_error(capture):
    capture(urllib.error.HTTPError("u", 503, "busy", {}, None))
    with pytest.raises(net.SourceError, match="503"):
        net.get("https://example.com/")


def test_gdelt_queries_names_or_ed_and_adverse_per_language():
    qs = gdelt.Gdelt().queries(ESSEX)
    rendered = [gdelt.render(q) for q in qs]
    assert rendered[0] == '("Essex Lease Financial Corp" OR "Essex Lease Financial") sourcelang:english'
    assert rendered[1].startswith('"Essex Lease Financial Corp" (fraud OR lawsuit') and rendered[1].endswith("sourcelang:english")
    assert rendered[2] == '("Essex Lease Financial Corp" OR "Essex Lease Financial") sourcelang:french'
    assert '"Autorité des marchés financiers"' in rendered[3] and rendered[3].endswith("sourcelang:french")
    tlfc = [gdelt.render(q) for q in gdelt.Gdelt().queries({"name": "TLFC", "aliases": [], "news_languages": ["en"]})]
    assert tlfc[0] == '"TLFC" sourcelang:english' and len(tlfc) == 2
    q = urllib.parse.parse_qs(urllib.parse.urlparse(gdelt.search_url('"TLFC"')).query)
    assert q == {"query": ['"TLFC"'], "mode": ["artlist"], "format": ["json"], "maxrecords": ["250"], "timespan": ["7d"]}


def test_gdelt_parses_articles(capture):
    capture(GDELT_JSON)
    items = gdelt.Gdelt(limiter=NoWait()).fetch('"x"', NOW)
    assert items == [{"title": "Test item: Essex Lease Financial news", "url": "https://example.com/a",
                      "publisher": "example.com", "published_at": None,
                      "source_date": dt.datetime(2026, 11, 5, 12, 15, tzinfo=UTC), "description": "", "text": "",
                      "language": "en"}]


def test_gdelt_plain_text_notice_is_a_source_error(capture):
    capture(b"Please limit requests to one every 5 seconds.")
    with pytest.raises(net.SourceError, match="limit requests"):
        gdelt.Gdelt(limiter=NoWait()).fetch('"x"', NOW)


def test_gdelt_empty_body_is_no_items(capture):
    capture(b"{}")
    assert gdelt.Gdelt(limiter=NoWait()).fetch('"x"', NOW) == []


def test_rate_limiter_keeps_the_gap():
    t = [100.0]
    slept = []

    def sleep(s):
        slept.append(s)
        t[0] += s
    lim = net.RateLimiter(5, clock=lambda: t[0], sleep=sleep)
    lim.wait()
    t[0] += 1
    lim.wait()
    t[0] += 10
    lim.wait()
    assert slept == [4]


def test_default_limiters_are_polite():
    assert gdelt._LIMIT.min_interval >= 5
    assert google_news._LIMIT.min_interval >= 1


def test_fixture_relative_and_absolute_dates_and_simulated_failure(tmp_path):
    f = tmp_path / "f.json"
    f.write_text(json.dumps({"fail_companies": ["tlfc"], "items": [
        {"title": "Test item: a", "url": "https://example.com/a", "published_at": "-2d"},
        {"title": "Test item: b", "url": "https://example.com/b", "published_at": "2026-11-01T10:00:00Z"},
        {"title": "Test item: c", "url": "https://example.com/c"}]}))
    src = fixture.Fixture(str(f))
    items = src.fetch("essex", NOW)
    assert [i["published_at"] for i in items] == [NOW - dt.timedelta(days=2), dt.datetime(2026, 11, 1, 10, tzinfo=UTC), None]
    with pytest.raises(net.SourceError):
        src.fetch("tlfc", NOW)


def test_fixture_missing_file_is_a_source_error():
    with pytest.raises(net.SourceError):
        fixture.Fixture("/nope.json").fetch("x", NOW)


def test_source_choice():
    srcs, errs = sources.for_run(["google_news", "gdelt"], env={})
    assert [s.name for s in srcs] == ["google_news", "gdelt"] and errs == []
    srcs, errs = sources.for_run(["google_news", "bing"], env={})
    assert [s.name for s in srcs] == ["google_news"] and errs[0]["source"] == "bing"
    srcs, _ = sources.for_run(["google_news", "gdelt"], env={"NEWS_SOURCE": "fixture", "NEWS_FIXTURE": str(FIXTURE)})
    assert [s.name for s in srcs] == ["fixture"]


def test_example_fixture_is_clearly_test_data():
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for it in data["items"]:
        assert it["title"].startswith("Test item:"), it["title"]
        assert urllib.parse.urlparse(it["url"]).hostname == "example.com"
