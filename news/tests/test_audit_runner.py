"""The bug audit's news findings in the run itself (docs/audit/tao-admin-poc-bug-audit_Report_v1.md): H9 a redirecting
link is one story, H10 a stub page never replaces the provider's text, M9 confirmed dates are plausible, L8 the first
search is tracked per company and source, L9 a check that keeps failing gives up, L10 two workers. No network."""
import datetime as dt

import pytest
from sqlalchemy import select, update

import check
import feeds
import main
import store
import urls
from main import Worker
from sources.net import SourceError
from conftest import UTC, Clock, FakeClaude, answer, set_feeds, user_prompt
from test_pipeline import Fake, adverse, items, run, story
from test_run import FIX_ENV

NOW = dt.datetime(2026, 11, 6, 17, 0, tzinfo=UTC)
DAY = dt.timedelta(days=1)


@pytest.fixture
def on(eng):
    set_feeds(eng, enabled=True, run_at="23:59")
    return eng


def claude(a=None):
    client = FakeClaude(a if a is not None else answer())
    return client, check.ClaudeChecker(client=client)


def counting(fn):
    calls = []

    def wrapped(*a):
        calls.append(a[0])
        return fn(*a)
    wrapped.calls = calls
    return wrapped


def no_page(url, now):
    raise SourceError("HTTP 404")


# --- H9 --------------------------------------------------------------------------------------------------------------

def test_url_key_ignores_scheme_and_www_only():
    same = ["http://pub.com/a", "https://pub.com/a", "https://www.pub.com/a", "HTTPS://WWW.PUB.COM/a/?utm_source=x#top"]
    assert len({urls.key(u) for u in same}) == 1
    assert urls.key("https://pub.com/a?id=3") != urls.key("https://pub.com/a")
    assert urls.key("https://pub.com/A") != urls.key("https://pub.com/a")
    assert urls.key("https://news.pub.com/a") != urls.key("https://pub.com/a")
    assert urls.key("http://pub.com:8080/a") != urls.key("http://pub.com/a")
    assert urls.key("") == ""


def test_a_redirecting_link_is_on_file_on_the_next_run(on):
    """The audit's repro: http://pub.com/a answers from https://www.pub.com/a."""
    client, checker = claude()
    page = counting(lambda url, now: {"date": NOW - DAY, "text": "TLFC story text", "final_url": "https://www.pub.com/a"})
    src = Fake("gdelt", {"tlfc": [story("TLFC wins", "http://pub.com/a", source_date=NOW - DAY)]})
    clock = Clock(NOW)
    r1 = run(on, [src], checker=checker, pages=page, clock=clock)
    assert (r1["status"], r1["items_added"], r1["errors"]) == ("ok", 1, [])
    [row] = items(on)
    assert (row["url"], row["resolved_url"]) == ("http://pub.com/a", "https://www.pub.com/a")

    clock.advance(days=1)
    r2 = run(on, [src], checker=checker, pages=page, clock=clock)
    assert (r2["status"], r2["items_added"], r2["errors"]) == ("ok", 0, [])
    assert len(client.calls) == 1 and len(page.calls) == 1          # not read again, not checked again
    assert len(items(on)) == 1 and r2["stats"]["kept"] == 0


def test_a_link_that_redirects_to_a_different_address_is_on_file_by_its_source_link(on):
    client, checker = claude()
    page = counting(lambda url, now: {"date": NOW - DAY, "text": "TLFC story text",
                                      "final_url": "https://www.pub.com/news/2026/tlfc-wins"})
    src = Fake("gdelt", {"tlfc": [story("TLFC wins", "http://pub.com/r?id=77", source_date=NOW - DAY)]})
    clock = Clock(NOW)
    run(on, [src], checker=checker, pages=page, clock=clock)
    clock.advance(days=1)
    r2 = run(on, [src], checker=checker, pages=page, clock=clock)
    assert (r2["status"], r2["errors"]) == ("ok", [])
    assert len(client.calls) == 1 and len(page.calls) == 1 and len(items(on)) == 1
    # A different link to the same article: the page is read (its final URL is the only way to know), Claude is not.
    other = Fake("google_news", {"tlfc": [story("TLFC wins", "https://t.co/xyz", source_date=NOW - DAY)]})
    clock.advance(days=1)
    r3 = run(on, [other], checker=checker, pages=page, clock=clock)
    assert (r3["status"], r3["errors"], r3["items_added"]) == ("ok", [], 0)
    assert len(client.calls) == 1 and len(page.calls) == 2 and len(items(on)) == 1


def test_http_and_https_variants_in_one_run_are_one_story(on):
    client, checker = claude()
    page = counting(lambda url, now: {"date": NOW - DAY, "text": "TLFC t", "final_url": "https://pub.com/a"})
    src = Fake("gdelt", {"tlfc": [story("TLFC wins", "http://pub.com/a"), story("TLFC wins", "https://pub.com/a"),
                                  story("TLFC wins", "https://www.pub.com/a/")]})
    r = run(on, [src], checker=checker, pages=page)
    assert (r["status"], r["items_added"], r["errors"]) == ("ok", 1, [])
    assert len(items(on)) == 1 and len(client.calls) == 1 and len(page.calls) == 1


def test_two_links_that_end_at_one_page_in_one_run_are_checked_once(on):
    client, checker = claude()
    page = counting(lambda url, now: {"date": NOW - DAY, "text": "TLFC t", "final_url": "https://pub.com/final"})
    src = Fake("gdelt", {"tlfc": [story("TLFC wins", "https://short.example/1"),
                                  story("TLFC wins big", "https://short.example/2")]})
    r = run(on, [src], checker=checker, pages=page)
    assert (r["status"], r["items_added"], r["errors"]) == ("ok", 1, [])
    assert len(items(on)) == 1 and len(client.calls) == 1


def test_a_google_link_resolved_on_run_1_is_not_resolved_read_or_checked_again(on):
    client, checker = claude()
    link = "https://news.google.com/rss/articles/CBMiNEW"
    resolver = counting(lambda url: "https://publisher.example/tlfc-story")
    page = counting(lambda url, now: {"date": NOW - DAY, "text": "TLFC story text", "final_url": url})
    src = Fake("google_news", {"tlfc": [story("TLFC wins", link + "?oc=5", source_date=NOW - DAY)]})
    clock = Clock(NOW)
    r1 = run(on, [src], checker=checker, pages=page, resolver=resolver, clock=clock)
    assert (r1["status"], r1["items_added"]) == ("ok", 1)
    [row] = items(on)
    assert row["url"].startswith(link) and row["resolved_url"] == "https://publisher.example/tlfc-story"
    assert page.calls == ["https://publisher.example/tlfc-story"]

    clock.advance(days=1)
    r2 = run(on, [src], checker=checker, pages=page, resolver=resolver, clock=clock)
    assert (r2["status"], r2["errors"], r2["items_added"]) == ("ok", [], 0)
    assert len(resolver.calls) == 1 and len(page.calls) == 1 and len(client.calls) == 1 and len(items(on)) == 1
    # The same article straight from a paid source: on file by the publisher URL, nothing fetched.
    paid = Fake("event_registry", {"tlfc": [story("TLFC wins", "http://www.publisher.example/tlfc-story/",
                                                  published_at=NOW - DAY)]}, paid=True)
    clock.advance(days=1)
    r3 = run(on, [paid], checker=checker, pages=page, resolver=resolver, clock=clock)
    assert (r3["status"], r3["items_added"]) == ("ok", 0)
    assert len(page.calls) == 1 and len(client.calls) == 1 and len(items(on)) == 1


def test_a_story_stored_before_this_change_is_on_file_by_scheme_and_www(on):
    """Old rows hold the final URL in `url` and no source link."""
    with on.begin() as c:
        store.insert_item(c, {"id": store.new_id(), "company_slug": "tlfc", "source": "gdelt", "title": "TLFC wins",
                              "url": "https://www.pub.com/a", "resolved_url": "https://www.pub.com/a",
                              "sentiment": "neutral", "found_at": NOW - DAY, "sources": ["gdelt"],
                              "date_status": "confirmed", "published_at": NOW - DAY, "check_status": "kept"})
    client, checker = claude()
    page = counting(lambda url, now: {"text": "TLFC", "final_url": url})
    src = Fake("gdelt", {"tlfc": [story("TLFC wins", "http://pub.com/a")]})
    r = run(on, [src], checker=checker, pages=page)
    assert (r["status"], r["errors"], r["items_added"]) == ("ok", [], 0)
    assert page.calls == [] and client.calls == [] and len(items(on)) == 1


def test_a_unique_violation_is_on_file_not_an_error(on, monkeypatch):
    """Another run stored the story between this run's on-file read and its insert."""
    client, checker = claude(answer(adverse=True, categories=["fraud"]))
    src = Fake("gdelt", {"tlfc": [story("TLFC wins", "https://pub.com/race", source_date=NOW - DAY)]})
    real = store.existing_urls
    state = {"first": True}

    def stale(conn, slug):
        out = real(conn, slug)
        if slug == "tlfc" and state.pop("first", False):
            with on.begin() as c2:
                store.insert_item(c2, {"id": store.new_id(), "company_slug": "tlfc", "source": "gdelt",
                                       "title": "TLFC wins", "url": "https://pub.com/race", "sentiment": "neutral",
                                       "found_at": NOW, "sources": ["gdelt"], "check_status": "kept"})
        return out
    monkeypatch.setattr(store, "existing_urls", stale)
    r = run(on, [src], checker=checker, pages=no_page)
    assert (r["status"], r["errors"], r["items_added"], r["adverse_added"]) == ("ok", [], 0, 0)
    assert len(items(on)) == 1 and adverse(on) == [] and r["stats"]["kept"] == 0


def test_adverse_items_carry_the_publisher_url_and_a_recheck_adds_no_duplicate(on):
    client, checker = claude(answer(adverse=True, categories=["fraud"], sentiment="negative"))
    link = "https://news.google.com/rss/articles/CBMiADV"
    src = Fake("google_news", {"tlfc": [story("TLFC accused of fraud", link, source_date=NOW - DAY)]})
    run(on, [src], checker=checker, pages=no_page, resolver=lambda url: "https://publisher.example/fraud")
    [a] = adverse(on)
    assert a["url"] == "https://publisher.example/fraud" and a["category"] == "fraud"
    with on.begin() as c:
        c.execute(update(store.news_item).values(check_status="unchecked"))
    r = run(on, [], checker=checker, pages=no_page, trigger="recheck")
    assert r["status"] == "ok" and len(adverse(on)) == 1


# --- H10 -------------------------------------------------------------------------------------------------------------

BODY = "TLFC was sued for fraud by the regulator. " * 40


def er_story(**kw):
    return story("TLFC sued for fraud", "https://pub.com/x", published_at=NOW - DAY, description=BODY[:400], text=BODY,
                 **kw)


def text_sent(client):
    p = user_prompt(client.calls[0])
    return p[p.index("Text:"):p.index("</story>")]


def test_a_cookie_notice_does_not_replace_the_provider_body(on):
    """The audit's Event Registry case."""
    client, checker = claude(answer(adverse=True, categories=["fraud", "regulatory"], sentiment="negative"))
    src = Fake("event_registry", {"tlfc": [er_story()]}, paid=True)
    stub = {"date": None, "text": "Please enable JavaScript and cookies to continue", "final_url": "https://pub.com/x"}
    r = run(on, [src], checker=checker, pages=lambda url, now: stub)
    assert "sued for fraud by the regulator" in text_sent(client) and "enable JavaScript" not in text_sent(client)
    [row] = items(on)
    assert row["description"].startswith("TLFC was sued for fraud") and row["check_status"] == "kept"
    assert r["adverse_added"] == 2


def test_a_long_page_that_never_names_the_company_does_not_replace_the_provider_body(on):
    client, checker = claude()
    wall = "Subscribe to continue reading. Our journalism is supported by readers like you. " * 60
    src = Fake("event_registry", {"tlfc": [er_story()]}, paid=True)
    run(on, [src], checker=checker, pages=lambda url, now: {"text": wall, "title": "Subscribe", "final_url": url})
    assert "sued for fraud by the regulator" in text_sent(client) and "Subscribe to continue" not in text_sent(client)


def test_a_longer_page_that_names_the_company_is_used_and_the_page_date_is_always_taken(on):
    client, checker = claude()
    full = "The court filing names TLFC and three of its directors. " * 60
    src = Fake("gdelt", {"tlfc": [story("TLFC sued", "https://pub.com/full", source_date=NOW - DAY,
                                        description="TLFC sued, says filing")]})
    run(on, [src], checker=checker,
        pages=lambda url, now: {"date": NOW - 2 * DAY, "text": full, "title": "TLFC sued", "final_url": url})
    assert "The court filing names TLFC" in text_sent(client)
    [row] = items(on)
    assert row["description"].startswith("The court filing names TLFC") and row["date_status"] == "confirmed"

    # A stub still gives its metadata date; the snippet stays.
    client2, checker2 = claude()
    src2 = Fake("gdelt", {"tlfc": [story("TLFC expands", "https://pub.com/stub", source_date=NOW - DAY,
                                         description="TLFC expands its leasing book in Ontario")]})
    run(on, [src2], checker=checker2,
        pages=lambda url, now: {"date": NOW - 3 * DAY, "text": "Enable cookies", "final_url": url})
    [row2] = items(on, url="https://pub.com/stub")
    assert row2["description"] == "TLFC expands its leasing book in Ontario"
    assert row2["date_status"] == "confirmed" and store.as_utc(row2["published_at"]) == NOW - 3 * DAY


def test_a_recheck_does_not_swap_a_stored_body_for_a_stub(on):
    with on.begin() as c:
        store.insert_item(c, {"id": store.new_id(), "company_slug": "tlfc", "source": "event_registry",
                              "title": "TLFC sued for fraud", "url": "https://pub.com/x", "sentiment": "neutral",
                              "found_at": NOW, "sources": ["event_registry"], "check_status": "unchecked",
                              "date_status": "unknown", "description": BODY[:4000]})
    client, checker = claude()
    run(on, [], checker=checker, trigger="recheck",
        pages=lambda url, now: {"text": "Please enable JavaScript and cookies to continue", "final_url": url})
    assert "sued for fraud by the regulator" in text_sent(client)
    assert items(on)[0]["description"].startswith("TLFC was sued for fraud")


# --- M9 --------------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("published_on", ["2031-01-01", "0001-01-01", "1989-12-31", "2026-11-09"])
def test_an_implausible_date_from_claude_is_not_confirmed(on, published_on):
    client, checker = claude(answer(published_on=published_on))
    src = Fake("gdelt", {"tlfc": [story("TLFC to open in 2031", "https://pub.com/b", source_date=NOW - DAY)]})
    r = run(on, [src], checker=checker, pages=no_page)
    [row] = items(on)
    assert (row["published_at"], row["date_status"], row["check_status"]) == (None, "source_only", "kept")
    assert r["stats"]["date_confirmed"] == 0


def test_a_plausible_date_from_claude_is_confirmed_up_to_tomorrow(on):
    client, checker = claude(lambda kw: answer(published_on="2026-11-07" if "ahead" in user_prompt(kw) else "2026-11-03"))
    src = Fake("gdelt", {"tlfc": [story("TLFC a day ahead", "https://pub.com/c1"),
                                  story("TLFC three days ago", "https://pub.com/c2")]})
    run(on, [src], checker=checker, pages=no_page)
    got = {r["url"]: (store.as_utc(r["published_at"]), r["date_status"]) for r in items(on)}
    assert got["https://pub.com/c1"] == (dt.datetime(2026, 11, 7, tzinfo=UTC), "confirmed")       # a time-zone day ahead
    assert got["https://pub.com/c2"] == (dt.datetime(2026, 11, 3, tzinfo=UTC), "confirmed")


def test_an_implausible_date_from_a_paid_provider_is_not_confirmed(on):
    src = Fake("event_registry", {"tlfc": [
        story("TLFC future", "https://pub.com/f", published_at=dt.datetime(2031, 1, 1, tzinfo=UTC), source_date=NOW - DAY),
        story("TLFC ancient", "https://pub.com/g", published_at=dt.datetime(1970, 1, 1, tzinfo=UTC)),
        story("TLFC fine", "https://pub.com/h", published_at=NOW - DAY)]}, paid=True)
    run(on, [src], pages=no_page)
    got = {r["url"]: (r["published_at"] is not None, r["date_status"]) for r in items(on)}
    assert got == {"https://pub.com/f": (False, "source_only"), "https://pub.com/g": (False, "unknown"),
                   "https://pub.com/h": (True, "confirmed")}


def test_an_implausible_page_date_and_a_recheck_date_are_not_confirmed(on):
    src = Fake("gdelt", {"tlfc": [story("TLFC page date", "https://pub.com/p", source_date=NOW - DAY)]})
    run(on, [src], pages=lambda url, now: {"date": dt.datetime(2040, 1, 1, tzinfo=UTC), "text": "", "final_url": url})
    assert items(on)[0]["date_status"] == "source_only"
    # The audit's recheck repro, and a stored bad date is cleared by a recheck.
    with on.begin() as c:
        c.execute(update(store.news_item).values(check_status="unchecked", date_status="confirmed",
                                                 published_at=dt.datetime(2031, 1, 1, tzinfo=UTC)))
    client, checker = claude(answer(published_on="2031-01-01"))
    run(on, [], checker=checker, pages=lambda url, now: {}, trigger="recheck")
    [row] = items(on)
    assert (row["published_at"], row["date_status"], row["check_status"]) == (None, "source_only", "kept")


# --- L8 --------------------------------------------------------------------------------------------------------------

def windows(src):
    return {q: w.days for q, w in src.asked}


def test_a_first_search_cut_short_by_the_daily_cap_gets_its_long_window_again(eng):
    """The audit's repro: cap 2, four queries."""
    set_feeds(eng, enabled=True, run_at="23:59", daily_cap=2)
    clock = Clock(NOW)
    src = Fake("gdelt", {"tlfc": [story("TLFC wins", "https://pub.com/y", published_at=NOW - DAY)]},
               queries_per_company=4)
    r1 = run(eng, [src], pages=no_page, clock=clock)
    assert r1["stats"]["capped"] == ["gdelt"] and r1["items_added"] == 1 and len(src.asked) == 2
    assert r1["stats"]["first_search"] == {}

    set_feeds(eng, enabled=True, run_at="23:59", daily_cap=200)
    clock.advance(days=1)
    src.asked = []
    r2 = run(eng, [src], pages=no_page, clock=clock)
    assert windows(src) == {f"tlfc#{i}": 90 for i in range(4)}          # the company has a row, and still 90 days
    assert r2["stats"]["first_search"] == {"gdelt": ["tlfc"]}

    clock.advance(days=1)
    src.asked = []
    run(eng, [src], pages=no_page, clock=clock)
    assert windows(src) == {f"tlfc#{i}": 7 for i in range(4)}


def test_a_source_that_errors_or_is_skipped_has_not_completed_its_first_search(on):
    class Flaky(Fake):
        fail = True

        def fetch(self, query, now, window=None):
            self.asked.append((query, window))
            if self.fail:
                raise SourceError("HTTP 503")
            return []
    clock = Clock(NOW)
    bad, good = Flaky("gdelt", {"tlfc": []}), Fake("google_news", {"tlfc": []})
    r1 = run(on, [bad, good], clock=clock)
    assert r1["status"] == "partial" and r1["stats"]["first_search"] == {"google_news": ["tlfc"]}
    clock.advance(days=1)
    bad.fail, bad.asked, good.asked = False, [], []
    run(on, [bad, good], clock=clock)
    assert windows(bad) == {"tlfc#0": 90} and windows(good) == {"tlfc#0": 7}


def test_a_source_added_later_gets_the_first_search_window_and_its_stories_are_kept(on):
    clock = Clock(NOW)
    free = Fake("google_news", {"tlfc": [story("TLFC wins", "https://pub.com/1", published_at=NOW - DAY)]})
    run(on, [free], pages=no_page, clock=clock)
    clock.advance(days=1)
    free.asked = []
    archive = Fake("event_registry", {"tlfc": [story("TLFC in the summer", "https://pub.com/old",
                                                     published_at=clock() - dt.timedelta(days=60))]}, paid=True)
    r = run(on, [free, archive], pages=no_page, clock=clock)
    assert windows(free) == {"tlfc#0": 7} and windows(archive) == {"tlfc#0": 90}
    assert r["items_added"] == 1                 # 60 days old: inside the window of the source that found it


def test_runs_from_before_the_record_count_a_stored_story_as_a_completed_first_search(on):
    """Legacy data: stats without first_search. Per source: a stored story found by it means done."""
    with on.begin() as c:
        rid = store.insert_run(c, "schedule", NOW - DAY, status="ok")
        store.insert_item(c, {"id": store.new_id(), "company_slug": "tlfc", "run_id": rid, "source": "google_news",
                              "title": "TLFC", "url": "https://pub.com/legacy", "sentiment": "neutral",
                              "found_at": NOW - DAY, "sources": ["google_news", "gdelt"], "check_status": "kept"})
    with on.connect() as c:
        done = store.first_searches_done(c)
    assert done == {("tlfc", "google_news"), ("tlfc", "gdelt")}
    a, b, n = Fake("google_news", {"tlfc": []}), Fake("gdelt", {"tlfc": []}), Fake("brave_news", {"tlfc": []})
    run(on, [a, b, n])
    assert (windows(a), windows(b), windows(n)) == ({"tlfc#0": 7}, {"tlfc#0": 7}, {"tlfc#0": 90})


def test_a_one_company_run_records_only_that_company(on):
    src = Fake("gdelt", {"tlfc": [], "vcc-iv-lp": []})
    with on.begin() as c:
        rid = store.insert_run(c, "manual", NOW)
        c.execute(update(store.news_run).where(store.news_run.c.id == rid).values(company_slug="tlfc"))
    Worker(on, env={}, now=Clock(NOW), source_factory=lambda names, env, paid=(): ([src], []),
           checker=check.FixtureChecker(), page_reader=no_page, resolver=lambda url: None).tick()
    with on.connect() as c:
        assert store.get_run(c, rid)["stats"]["first_search"] == {"gdelt": ["tlfc"]}
        assert store.first_searches_done(c) == {("tlfc", "gdelt")}


# --- L9 --------------------------------------------------------------------------------------------------------------

def test_a_refused_check_gives_up_after_three_attempts(on):
    """The audit's repro: a refusal on every run."""
    client, checker = claude(("refusal", None))
    src = Fake("gdelt", {"tlfc": [story("TLFC wins", "https://pub.com/z", published_at=NOW - DAY, text="TLFC body")]})
    clock = Clock(NOW)
    seen = []
    for _ in range(5):
        r = run(on, [src], checker=checker, pages=no_page, clock=clock)
        [row] = items(on)
        seen.append((row["check_status"], row["check_reason"], len(client.calls), r["stats"]["pending"],
                     r["stats"]["excluded"]))
        clock.advance(days=1)
    assert seen[0] == ("pending", "The news check could not read this story (attempt 1 of 3)", 1, 1, 0)
    assert seen[1] == ("pending", "The news check could not read this story (attempt 2 of 3)", 2, 1, 0)
    assert seen[2] == ("excluded", "The news check could not read this story after 3 attempts", 3, 0, 1)
    assert seen[3][2] == 3 and seen[4][:3] == seen[2][:3]                # never asked again
    assert items(on)[0]["checked_at"] is not None and r["items_added"] == 0


@pytest.mark.parametrize("bad", [("max_tokens", None), answer(about="false"), answer(confidence=85)])
def test_cut_off_and_unusable_answers_count_as_attempts(on, bad):
    client, checker = claude(bad)
    src = Fake("gdelt", {"tlfc": [story("TLFC wins", "https://pub.com/z", published_at=NOW - DAY, text="TLFC body")]})
    clock = Clock(NOW)
    for _ in range(3):
        run(on, [src], checker=checker, pages=no_page, clock=clock)
        clock.advance(days=1)
    [row] = items(on)
    assert (row["check_status"], row["check_reason"]) == ("excluded", check.GAVE_UP)


def test_an_outage_or_a_missing_key_is_not_an_attempt_and_never_gives_up(on):
    src = Fake("gdelt", {"tlfc": [story("TLFC wins", "https://pub.com/z", published_at=NOW - DAY, text="TLFC body")]})
    clock = Clock(NOW)
    for _ in range(5):
        run(on, [src], checker=check.Unavailable("ANTHROPIC_API_KEY is not set; stories wait as pending"),
            pages=no_page, clock=clock)
        clock.advance(days=1)
    [row] = items(on)
    assert (row["check_status"], row["check_reason"]) == ("pending", None)
    client, checker = claude()                                           # the key arrives: checked and kept
    r = run(on, [src], checker=checker, pages=no_page, clock=clock)
    assert items(on)[0]["check_status"] == "kept" and r["items_added"] == 1


def test_a_story_that_fails_twice_then_passes_is_kept(on):
    answers = [("refusal", None), ("refusal", None), answer()]
    client, checker = claude(lambda kw: answers.pop(0))
    src = Fake("gdelt", {"tlfc": [story("TLFC wins", "https://pub.com/z", published_at=NOW - DAY, text="TLFC body")]})
    clock = Clock(NOW)
    for _ in range(3):
        r = run(on, [src], checker=checker, pages=no_page, clock=clock)
        clock.advance(days=1)
    [row] = items(on)
    assert (row["check_status"], row["check_reason"]) == ("kept", "About the lender") and r["items_added"] == 1


def test_attempt_notes_round_trip():
    assert check.attempts(None) == 0 and check.attempts("About the lender") == 0
    assert check.attempts(check.attempt_note(2)) == 2


# --- L10 -------------------------------------------------------------------------------------------------------------

def schedule_runs(eng):
    with eng.connect() as c:
        return [dict(r) for r in c.execute(select(store.news_run).where(store.news_run.c.trigger == "schedule")).mappings()]


def test_the_schedule_insert_happens_once_per_local_day(eng):
    tz = "America/Toronto"
    morning = dt.datetime(2026, 11, 6, 11, 0, tzinfo=UTC)                   # 06:00 in Toronto
    bounds = lambda t: (feeds.day_start_utc(t, tz), feeds.day_end_utc(t, tz))      # noqa: E731
    with eng.begin() as c:
        first = store.insert_schedule_run(c, morning, *bounds(morning))
    with eng.begin() as c:
        again = store.insert_schedule_run(c, morning + dt.timedelta(seconds=5), *bounds(morning))
    late = dt.datetime(2026, 11, 7, 4, 30, tzinfo=UTC)                      # 23:30 Toronto, still 6 November
    with eng.begin() as c:
        still = store.insert_schedule_run(c, late, *bounds(late))
    next_day = dt.datetime(2026, 11, 7, 11, 0, tzinfo=UTC)
    with eng.begin() as c:
        tomorrow = store.insert_schedule_run(c, next_day, *bounds(next_day))
    assert first and tomorrow and again is None and still is None
    rows = schedule_runs(eng)
    assert sorted(r["id"] for r in rows) == sorted([first, tomorrow])
    assert all(r["status"] == "queued" and r["errors"] == [] and r["items_added"] == 0 for r in rows)
    assert bounds(morning)[1] - bounds(morning)[0] == dt.timedelta(hours=24)


def test_two_workers_that_both_see_the_schedule_due_start_one_run(eng, monkeypatch):
    set_feeds(eng, enabled=True, run_at="06:00")
    clock = Clock(dt.datetime(2026, 11, 6, 11, 0, tzinfo=UTC))
    monkeypatch.setattr(feeds, "schedule_due", lambda now, cfg, recent: cfg["enabled"])     # both read "no run yet"
    a, b = Worker(eng, env=FIX_ENV, now=clock), Worker(eng, env=FIX_ENV, now=clock)
    done_a = a.tick()
    done_b = b.tick()
    assert len(done_a) == 1 and done_b == []
    assert len(schedule_runs(eng)) == 1


def test_a_second_worker_starting_up_leaves_a_live_run_alone(eng):
    clock = Clock(NOW)
    with eng.begin() as c:
        live = store.insert_run(c, "schedule", clock())
        assert store.claim_run(c, live, clock())
    clock.advance(minutes=30)
    other = Worker(eng, env={}, now=clock)
    other.recover()
    other.tick()
    with eng.connect() as c:
        assert store.get_run(c, live)["status"] == "running"
    # The first worker finishes its run normally.
    with eng.begin() as c:
        store.finish_run(c, live, "ok", clock(), 3, 1, 0, [], {})
    clock.advance(hours=3)
    other.recover()
    with eng.connect() as c:
        assert store.get_run(c, live)["status"] == "ok"


def test_a_run_left_running_past_the_bound_is_failed_at_start_up_and_on_a_tick(eng):
    clock = Clock(NOW)
    with eng.begin() as c:
        dead = store.insert_run(c, "manual", clock())
        assert store.claim_run(c, dead, clock())
    clock.advance(hours=1, minutes=59)
    w = Worker(eng, env={}, now=clock)
    w.recover()
    with eng.connect() as c:
        assert store.get_run(c, dead)["status"] == "running"
    clock.advance(minutes=2)
    w.tick()
    with eng.connect() as c:
        row = store.get_run(c, dead)
    assert row["status"] == "failed" and row["errors"][0]["source"] == "worker" and row["finished_at"] is not None
    assert main.STALE_AFTER == dt.timedelta(hours=2)
