"""Re-check runs (E9), queue messages (run ids and Test connection), credentials and secret scrubbing."""
import datetime as dt
import json
import time

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select

import check
import credentials
import sources
import store
from main import Worker, parse_message
from sources import paid
from sources.net import SourceError
from conftest import UTC, Clock, FakeClaude, answer, set_feeds, user_prompt

NOW = dt.datetime(2026, 11, 6, 17, 0, tzinfo=UTC)
PATEL = "00000000-0000-0000-0000-0000000000a1"


def rows(eng, table):
    with eng.connect() as c:
        return [dict(r) for r in c.execute(select(table)).mappings()]


def seed_item(eng, slug, url, title, status="unchecked", cats=(), states=None, description=None):
    nid = store.new_id()
    with eng.begin() as c:
        store.insert_item(c, {"id": nid, "company_slug": slug, "run_id": None, "source": "google_news", "title": title,
                              "url": url, "publisher": "Test Wire", "published_at": None,
                              "source_date": NOW - dt.timedelta(days=2), "date_status": "source_only",
                              "sentiment": "negative", "found_at": NOW - dt.timedelta(days=2), "check_status": status,
                              "sources": ["google_news"], "description": description})
        for cat, state in zip(cats, states or ["open"] * len(cats)):
            c.execute(store.adverse_item.insert().values(
                id=store.new_id(), company_slug=slug, news_item_id=nid, category=cat, title=title, url=url,
                publisher="Test Wire", found_at=NOW - dt.timedelta(days=2), state=state,
                note=None if state == "open" else "reviewed earlier", state_by=None if state == "open" else PATEL,
                state_at=None if state == "open" else NOW - dt.timedelta(days=1)))
    return nid


def recheck(eng, checker, pages=None, env=None):
    clock = Clock(NOW)
    with eng.begin() as c:
        rid = store.insert_run(c, "recheck", clock())
    Worker(eng, env=env or {}, now=clock, checker=checker,
           page_reader=pages or (lambda url, now: (_ for _ in ()).throw(SourceError("HTTP 404"))),
           resolver=lambda url: None).tick()
    with eng.connect() as c:
        return store.get_run(c, rid)


def test_recheck_excludes_dismisses_open_adverse_only_and_never_deletes(eng):
    wrong = seed_item(eng, "dynamic-capital", "https://example.com/r1", "Test item: dynamic capital of a market",
                      cats=("fraud", "litigation", "regulatory"), states=("open", "reviewed", "dismissed"))
    right = seed_item(eng, "tlfc", "https://example.com/r2", "Test item: TLFC sued for fraud", cats=("litigation",))
    pend = seed_item(eng, "vcc-iv-lp", "https://example.com/r3", "Test item: VCC IV LP fictional", status="pending")
    done = seed_item(eng, "stride-capital", "https://example.com/r4", "Test item: Stride Capital", status="kept")

    def ans(kw):
        p = user_prompt(kw)
        if "market" in p:
            return answer(about=False, confidence=0.95, reason="About a city market, not the lender")
        if "TLFC" in p:
            return answer(adverse=True, categories=["litigation", "fraud"], sentiment="negative",
                          published_on="2026-11-04")
        return answer()
    fake = FakeClaude(ans)
    r = recheck(eng, check.ClaudeChecker(client=fake))     # company_feeds is off: a recheck still runs
    assert r["status"] == "ok" and r["trigger"] == "recheck"
    assert len(fake.calls) == 3                            # unchecked and pending only; kept is left alone
    items = {i["id"]: i for i in rows(eng, store.news_item)}
    assert len(items) == 4
    assert items[wrong]["check_status"] == "excluded" and items[wrong]["check_reason"].startswith("About a city")
    assert items[right]["check_status"] == "kept" and items[right]["date_status"] == "confirmed"
    assert items[pend]["check_status"] == "kept" and items[done]["check_status"] == "kept"
    adv = {(a["news_item_id"], a["category"]): a for a in rows(eng, store.adverse_item)}
    d = adv[(wrong, "fraud")]
    assert d["state"] == "dismissed" and d["note"] == "Excluded by the news check: About a city market, not the lender"
    assert d["state_by"] is None and store.as_utc(d["state_at"]) == NOW
    assert adv[(wrong, "litigation")]["state"] == "reviewed" and adv[(wrong, "litigation")]["state_by"] == PATEL
    assert adv[(wrong, "regulatory")]["state"] == "dismissed" and adv[(wrong, "regulatory")]["note"] == "reviewed earlier"
    assert adv[(right, "litigation")]["state"] == "open"
    assert adv[(right, "fraud")]["state"] == "open"                                   # the new category written
    assert r["adverse_added"] == 1 and r["items_added"] == 1                          # the pending one became visible
    assert (r["stats"]["kept"], r["stats"]["excluded"], r["stats"]["candidates"]) == (2, 1, 3)


def test_recheck_reads_the_page_for_unchecked_rows(eng):
    nid = seed_item(eng, "tlfc", "https://example.com/p1", "Test item: TLFC fictional")
    page = {"https://example.com/p1": {"date": dt.datetime(2026, 11, 2, 9, tzinfo=UTC), "text": "TLFC page text",
                                       "final_url": "https://example.com/p1"}}
    fake = FakeClaude(lambda kw: answer())
    recheck(eng, check.ClaudeChecker(client=fake), pages=lambda url, now: page[url])
    [row] = rows(eng, store.news_item)
    assert row["date_status"] == "confirmed" and store.as_utc(row["published_at"]) == dt.datetime(2026, 11, 2, 9, tzinfo=UTC)
    assert row["description"] == "TLFC page text" and "TLFC page text" in user_prompt(fake.calls[0])


def test_recheck_without_a_key_changes_nothing(eng):
    seed_item(eng, "tlfc", "https://example.com/n1", "Test item: TLFC a", cats=("fraud",))
    seed_item(eng, "vcc-iv-lp", "https://example.com/n2", "Test item: VCC IV LP b", status="pending")
    r = recheck(eng, check.for_env({}))
    got = {i["url"]: i["check_status"] for i in rows(eng, store.news_item)}
    assert got == {"https://example.com/n1": "unchecked", "https://example.com/n2": "pending"}
    assert rows(eng, store.adverse_item)[0]["state"] == "open"
    assert r["status"] == "failed" and r["errors"][0]["source"] == "claude"


def test_recheck_in_fixture_mode_keeps_everything_without_a_call(eng):
    seed_item(eng, "tlfc", "https://example.com/f1", "Test item: TLFC fraud", cats=("fraud",))
    r = recheck(eng, None, env={"NEWS_SOURCE": "fixture"})
    assert rows(eng, store.news_item)[0]["check_status"] == "kept" and r["status"] == "ok"


# --- queue messages ----------------------------------------------------------------------------------------------

def test_parse_message():
    assert parse_message(b"3f1c0f1e-0000-0000-0000-000000000000") == ("wake", None)
    assert parse_message('{"type":"test","provider":"brave"}') == ("test", "brave")
    assert parse_message(b'{"type":"test","provider":"newscatcher"}') == ("test", "newscatcher")
    assert parse_message("{not json") == ("wake", None)
    assert parse_message('{"type":"other"}') == ("wake", None)


KEY = Fernet.generate_key().decode()


def store_source(eng, provider, secrets=None, config=None, enabled=False):
    enc = Fernet(KEY).encrypt(json.dumps(secrets).encode()).decode() if secrets else None
    with eng.begin() as c:
        c.execute(store.news_source.insert().values(provider=provider, enabled=enabled, secrets_enc=enc,
                                                    secrets_last4={}, config=config or {}))


def source_row(eng, provider):
    with eng.connect() as c:
        return store.news_source_row(c, provider)


class Canned:
    def __init__(self, result=None, error=None, delay=0):
        self.result, self.error, self.delay, self.asked = result or [], error, delay, []
        self.page_size = 100

    def fetch(self, query, now, window):
        self.asked.append((query, window, self.page_size))
        if self.delay:
            time.sleep(self.delay)
        if self.error:
            raise self.error
        return self.result


def test_test_message_ok(eng):
    store_source(eng, "newscatcher", {"api_key": "nc-key-abcdef"})
    built, src = [], Canned(result=[{"title": "a"}, {"title": "b"}])
    w = Worker(eng, env={"NEWS_SECRET_KEY": KEY}, now=Clock(NOW),
               paid_factory=lambda p, s, c: built.append((p, s, c)) or [src])
    assert w.handle(b'{"type": "test", "provider": "newscatcher"}') is False        # no run tick for a test
    row = source_row(eng, "newscatcher")
    assert row["last_test_ok"] is True and row["last_test_message"] == "OK: 2 results for the test query"
    assert store.as_utc(row["last_test_at"]) == NOW
    assert built == [("newscatcher", {"api_key": "nc-key-abcdef"}, {})]
    q, window, size = src.asked[0]
    assert q.term == "equipment leasing" and window == dt.timedelta(days=7) and size == 5


def test_test_message_error_is_scrubbed_and_trimmed(eng):
    secret = "brave-secret-token-999"
    store_source(eng, "brave", {"api_key": secret}, {"news": True})
    src = Canned(error=SourceError(f"HTTP 401: token {secret} invalid " + "x" * 400))
    w = Worker(eng, env={"NEWS_SECRET_KEY": KEY}, now=Clock(NOW), paid_factory=lambda p, s, c: [src])
    w.handle('{"type":"test","provider":"brave"}')
    row = source_row(eng, "brave")
    assert row["last_test_ok"] is False and secret not in row["last_test_message"]
    assert row["last_test_message"].startswith("HTTP 401: token [redacted] invalid")
    assert len(row["last_test_message"]) == 300


def test_test_message_gives_up_after_the_timeout(eng):
    store_source(eng, "event_registry", {"api_key": "er-key-abcdef"})
    w = Worker(eng, env={"NEWS_SECRET_KEY": KEY}, now=Clock(NOW), paid_factory=lambda p, s, c: [Canned(delay=2)])
    ok, msg = w.test_provider("event_registry", timeout=0.2)
    assert not ok and msg == "No answer from the provider within 0.2 seconds"
    assert source_row(eng, "event_registry")["last_test_message"] == msg


def test_test_message_without_credentials_or_docs(eng):
    store_source(eng, "newscatcher")
    store_source(eng, "dow_jones", {"user_key": "dj-key-1234"})
    store_source(eng, "lexisnexis")
    store_source(eng, "brave", {"api_key": "b-key-1234"})
    w = Worker(eng, env={"NEWS_SECRET_KEY": KEY}, now=Clock(NOW))
    assert w.test_provider("newscatcher") == (False, "No credentials stored")
    assert w.test_provider("dow_jones") == (False, "Needs the client's API documentation")
    assert w.test_provider("lexisnexis") == (False, "Needs the client's API documentation")
    w2 = Worker(eng, env={"NEWS_SECRET_KEY": Fernet.generate_key().decode()}, now=Clock(NOW))
    ok, msg = w2.test_provider("brave")
    assert not ok and "cannot be decrypted" in msg and "b-key-1234" not in msg


def test_the_real_adapter_is_built_for_a_test(eng, monkeypatch):
    store_source(eng, "brave", {"api_key": "b-key-1234"}, {"news": False, "web": True})
    seen = []
    monkeypatch.setattr(paid, "get_json", lambda url, limiter=None, headers=None, **kw: seen.append((url, headers))
                        or {"web": {"results": []}})
    w = Worker(eng, env={"NEWS_SECRET_KEY": KEY}, now=Clock(NOW))
    assert w.test_provider("brave") == (True, "OK: 0 results for the test query")
    assert seen[0][0].startswith(paid.BRAVE_WEB) and "count=5" in seen[0][0]
    assert seen[0][1] == {"X-Subscription-Token": "b-key-1234"}


# --- credentials ---------------------------------------------------------------------------------------------------

def test_load_paid_decrypts_enabled_rows_only():
    enc = Fernet(KEY).encrypt(b'{"api_key": "er-key-123456"}').decode()
    rows_ = [{"provider": "event_registry", "enabled": True, "secrets_enc": enc, "config": {"archive_months": 12}},
             {"provider": "newscatcher", "enabled": False, "secrets_enc": enc, "config": {}},
             {"provider": "brave", "enabled": True, "secrets_enc": "garbage", "config": {}}]
    got, errors = sources.load_paid(rows_, {"NEWS_SECRET_KEY": KEY})
    assert got == [{"provider": "event_registry", "config": {"archive_months": 12}, "secrets": {"api_key": "er-key-123456"}}]
    assert errors[0]["source"] == "brave" and "cannot be decrypted" in errors[0]["message"]
    assert sources.has_archive(got)
    _, errors = sources.load_paid(rows_[:1], {})
    assert "NEWS_SECRET_KEY is not set" in errors[0]["message"]


def test_paid_sources_are_built_and_dow_jones_is_listed_not_run():
    srcs, errors = sources.for_run(["google_news"], {}, [
        {"provider": "event_registry", "config": {}, "secrets": {"api_key": "k123"}},
        {"provider": "brave", "config": {"news": True, "web": True}, "secrets": {"api_key": "k456"}},
        {"provider": "dow_jones", "config": {}, "secrets": {}}])
    assert [s.name for s in srcs] == ["google_news", "event_registry", "brave_news", "brave_web"]
    assert errors == [{"company_slug": None, "source": "dow_jones", "message": "Needs the client's API documentation"}]
    srcs, _ = sources.for_run(["google_news"], {"NEWS_SOURCE": "fixture"},
                              [{"provider": "event_registry", "config": {}, "secrets": {"api_key": "k"}}])
    assert [s.name for s in srcs] == ["fixture"]


def test_scrub():
    assert credentials.scrub("key abc123 and abc%2B1 x", ["abc123", "abc+1", "ab"]) == "key [redacted] and [redacted] x"
    assert credentials.scrub("nothing", []) == "nothing"


def test_run_errors_never_carry_a_secret(eng):
    secret = "er-secret-value-42"
    enc = Fernet(KEY).encrypt(json.dumps({"api_key": secret}).encode()).decode()
    with eng.begin() as c:
        c.execute(store.news_source.insert().values(provider="event_registry", enabled=True, secrets_enc=enc,
                                                    secrets_last4={}, config={}))
    set_feeds(eng, enabled=True, run_at="23:59", sources=[])
    clock = Clock(NOW)
    with eng.begin() as c:
        rid = store.insert_run(c, "manual", clock())

    def leaky_factory(names, env, paid_list=()):
        class Leaky:
            name, paid, fetch_pages, ignore_window = "event_registry", True, False, False
            secrets = {}

            def queries(self, company):
                return [company["slug"]]

            def fetch(self, q, now, window=None):
                raise RuntimeError(f"echo {paid_list[0]['secrets']['api_key']}")
        return [Leaky()], []
    Worker(eng, env={"NEWS_SECRET_KEY": KEY}, now=clock, source_factory=leaky_factory,
           checker=check.FixtureChecker()).tick()
    with eng.connect() as c:
        run = store.get_run(c, rid)
    assert len(run["errors"]) == 10 and all(secret not in e["message"] for e in run["errors"])
    assert "[redacted]" in run["errors"][0]["message"]
