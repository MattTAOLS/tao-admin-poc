"""The four Dynamic Capital stories from the wave E test run, as regression cases (test data shaped like them, at
example.com). Before wave E all four were stored: a 2009 private equity page carried Google's 6 Nov 2026 pubDate, and
three stories used "dynamic capital" as an ordinary phrase. Now the 2009 page is dropped by the date rule (its page
says May 2009, outside the window) before any Claude call, and the other three are excluded by the Claude check
(mocked answers here; the live model is measured on demand, see news/README.md)."""
import datetime as dt
import urllib.parse

import check
import pages
import store
from main import Worker
from sources import google_news
from conftest import PAGES, UTC, Clock, FakeClaude, answer, provider_body, set_feeds, user_prompt

NOW = dt.datetime(2026, 11, 7, 15, 0, tzinfo=UTC)
PE_URL = "https://example.com/pe-magazine/2009/05/dynamic-capital"

RSS_TAIL = """
<item><title>Test item: Mexico City's newest market is a dynamic capital of street food - Test Travel</title>
<link>https://example.com/travel/mexico-city-market</link><pubDate>Thu, 05 Nov 2026 12:00:00 GMT</pubDate>
<description>Test item about a market</description><source url="https://example.com">Test Travel</source></item>
<item><title>Test item: a US fintech lender explains its dynamic capital strategy - Test Markets</title>
<link>https://example.com/markets/fintech-dynamic-capital-strategy</link><pubDate>Wed, 04 Nov 2026 12:00:00 GMT</pubDate>
<description>Test item about a capital strategy</description><source url="https://example.com">Test Markets</source></item>
<item><title>Test item: Tirana, Albania's dynamic capital, draws visitors - Test Europe</title>
<link>https://example.com/europe/tirana-dynamic-capital</link><pubDate>Tue, 03 Nov 2026 12:00:00 GMT</pubDate>
<description>Test item about a city</description><source url="https://example.com">Test Europe</source></item>
</channel></rss>"""

TEXTS = {
    "https://example.com/travel/mexico-city-market": "Test text: a food market in Mexico City, described as a dynamic "
                                                     "capital of street food. Nothing about lending.",
    "https://example.com/markets/fintech-dynamic-capital-strategy": "Test text: a US consumer fintech describes a "
                                                                    "dynamic capital strategy for its balance sheet.",
    "https://example.com/europe/tirana-dynamic-capital": "Test text: Tirana, the capital of Albania, is called a "
                                                         "dynamic capital by visitors.",
}
REASONS = {
    "Mexico City": "About a Mexico City food market, not the lender",
    "fintech": "About a US fintech's capital strategy, a generic phrase, not the lender",
    "Tirana": "About Albania's capital city, not the lender",
}


def rss():
    head = provider_body("google_news.xml").decode("utf-8").replace("</channel></rss>", "")
    return (head + RSS_TAIL).encode("utf-8")


def page_http(url, **kw):
    if url == PE_URL:
        return url, (PAGES / "pe-2009-dynamic-capital.html").read_bytes(), "text/html; charset=utf-8"
    return url, f"<html><body><p>{TEXTS[url]}</p></body></html>".encode(), "text/html"


def run_dynamic_capital(eng, monkeypatch, checker):
    set_feeds(eng, enabled=True, run_at="23:59", sources=["google_news"])
    asked = []

    def fake_get(url, limiter=None, timeout=None):
        asked.append(url)
        q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)["q"][0]
        return rss() if q == '"Dynamic Capital"' and "ceid=CA:en" in url else b"<rss><channel></channel></rss>"
    monkeypatch.setattr(google_news, "get", fake_get)

    def factory(names, env, paid=()):
        return [google_news.GoogleNews(limiter=None)], []
    clock = Clock(NOW)
    with eng.begin() as c:
        rid = store.insert_run(c, "manual", clock())
    Worker(eng, env={}, now=clock, source_factory=factory, checker=checker,
           page_reader=lambda url, now: pages.read(url, now, http=page_http)).tick()
    with eng.connect() as c:
        run = store.get_run(c, rid)
        rows = [dict(r) for r in c.execute(store.news_item.select()).mappings()]
    return run, rows


def wrong_company(kw):
    p = user_prompt(kw)
    for key, reason in REASONS.items():
        if key in p:
            return answer(about=False, confidence=0.97, reason=reason)
    raise AssertionError("unexpected story sent to the check: " + p[:200])


def test_the_2009_page_is_dropped_by_its_page_date_before_any_check(eng, monkeypatch):
    fake = FakeClaude(wrong_company)
    run, rows = run_dynamic_capital(eng, monkeypatch, check.ClaudeChecker(client=fake))
    assert all(r["company_slug"] == "dynamic-capital" for r in rows)
    assert PE_URL not in {r["url"] for r in rows} and not any("PE Magazine" in (r["publisher"] or "") for r in rows)
    assert not any("pe-magazine" in user_prompt(kw) for kw in fake.calls)
    assert run["status"] == "ok"


def test_the_three_ordinary_phrase_stories_are_excluded_with_reasons(eng, monkeypatch):
    fake = FakeClaude(wrong_company)
    run, rows = run_dynamic_capital(eng, monkeypatch, check.ClaudeChecker(client=fake))
    assert len(fake.calls) == 3
    by_url = {r["url"]: r for r in rows}
    assert set(by_url) == set(TEXTS)
    for url, r in by_url.items():
        assert r["check_status"] == "excluded", url
        assert r["check_reason"] in REASONS.values()
        assert r["date_status"] == "source_only" and r["published_at"] is None and r["source_date"] is not None
    with eng.connect() as c:
        assert c.execute(store.adverse_item.select()).first() is None
    assert run["items_added"] == 0 and run["stats"]["excluded"] == 3 and run["stats"]["kept"] == 0


def test_the_2009_page_date_comes_from_the_page_not_google():
    [it] = google_news.parse(provider_body("google_news.xml"), NOW, dt.timedelta(days=7))
    assert it["published_at"] is None and it["source_date"] == dt.datetime(2026, 11, 6, 8, 0, tzinfo=UTC)
    page = pages.read(PE_URL, NOW, http=page_http)
    assert page["date"] == dt.datetime(2009, 5, 12, 9, 30, tzinfo=UTC)


def test_context_terms_drop_the_three_before_the_check(eng, monkeypatch):
    from sqlalchemy import update
    with eng.begin() as c:
        c.execute(update(store.company).where(store.company.c.slug == "dynamic-capital").values(
            news_context_terms=["leasing", "equipment"]))
    fake = FakeClaude(wrong_company)
    TEXTS_BACKUP = dict(TEXTS)
    try:
        TEXTS["https://example.com/travel/mexico-city-market"] = "Test text: a food market in Mexico City."
        TEXTS["https://example.com/markets/fintech-dynamic-capital-strategy"] = "Test text: a capital strategy."
        run, rows = run_dynamic_capital(eng, monkeypatch, check.ClaudeChecker(client=fake))
    finally:
        TEXTS.update(TEXTS_BACKUP)
    assert rows == [] and fake.calls == []
