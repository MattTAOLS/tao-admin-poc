"""Wave E news screening (contract lead/wave-e, docs/phase2/tao-admin-poc-news_Architecture_v1.md): /news/sources with
write-only encrypted credentials, the connection test and recheck on the news queue, NewsItem dates and the Claude check,
who sees which stories, news_7d and alerts on kept stories with a confirmed date, company news_search, daily_cap."""
import datetime as dt, json, logging, uuid
import pytest
from cryptography.fernet import Fernet
from conftest import TAO, ANALYST, INV, MGR
from test_users import A1, AN, IV, H, code
from test_companies import (V1, INV_ADMIN, MGR_ADMIN, PARTNERS, published, news_queue, setting, profiles_on, rows, finished_run, news,
                            adverse, audit, notes_of)
from app import db, jobs
from app.main import app
from app.models import NewsItem, NewsRun, NewsSource, utcnow

ESSEX = "essex-lease-financial-corp"
SECRET = "erk-live-0123456789abcdefWXYZ"          # 29 characters: last4 WXYZ
SHORT = "tiny-key"                                # under 12: set, no last4
REASON = "client supplied its key"


@pytest.fixture
def key(monkeypatch):
    k = Fernet.generate_key().decode()
    monkeypatch.setenv("NEWS_SECRET_KEY", k)
    return k


@pytest.fixture(autouse=True)
def no_key_by_default(monkeypatch):
    monkeypatch.delenv("NEWS_SECRET_KEY", raising=False)


def put(client, provider, body, headers=TAO):
    return client.put(V1 + f"/news/sources/{provider}", headers=headers, json={"reason": REASON, **body})


def sources(client, headers=TAO):
    r = client.get(V1 + "/news/sources", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def stored(provider) -> NewsSource:
    with db.session() as s:
        r = s.get(NewsSource, provider)
        if r is not None:
            s.expunge(r)
        return r


# ---------- /news/sources ----------
def test_list_sources_definitions_and_role_gate(client):
    got = sources(client)
    assert got["secret_key_set"] is False
    by = {x["provider"]: x for x in got["sources"]}
    assert list(by) == ["event_registry", "newscatcher", "brave", "dow_jones", "lexisnexis"]
    er = by["event_registry"]
    assert (er["label"], er["available"], er["enabled"]) == ("Event Registry (newsapi.ai)", True, False)
    assert er["note"].startswith("Free plan covers the last 30 days")
    assert [(f["name"], f["secret"], f["required"], f["kind"]) for f in er["fields"]] == [
        ("api_key", True, True, "text"), ("archive_months", False, False, "integer")]
    assert er["fields"][1]["label"] == "Archive on your plan (months)" and er["fields"][1]["help"].startswith("0 = last 30 days only")
    assert er["config"] == {"archive_months": 0} and er["secrets"] == {"api_key": {"set": False, "last4": None}}
    assert er["last_test"] == {"at": None, "ok": None, "message": None} and er["updated_at"] is None and er["updated_by"] is None
    assert by["newscatcher"]["label"] == "NewsCatcher (v3)" and by["newscatcher"]["config"] == {"archive_months": 0}
    assert by["brave"]["label"] == "Brave Search" and by["brave"]["config"] == {"news": True, "web": True}
    assert [(f["name"], f["kind"]) for f in by["brave"]["fields"]] == [("api_key", "text"), ("news", "boolean"), ("web", "boolean")]
    dj = by["dow_jones"]
    assert (dj["label"], dj["available"]) == ("Dow Jones (Factiva)", False) and "API documentation" in dj["note"]
    assert [(f["name"], f["secret"], f["required"]) for f in dj["fields"]] == [
        ("user_key", True, False), ("client_id", True, False), ("client_secret", True, False), ("username", True, False),
        ("password", True, False), ("base_url", False, False)]
    assert dj["fields"][-1]["kind"] == "url"
    ln = by["lexisnexis"]
    assert (ln["label"], ln["available"]) == ("LexisNexis (Nexis Data+)", False)
    assert [(f["name"], f["secret"]) for f in ln["fields"]] == [("client_id", True), ("client_secret", True), ("base_url", False)]
    for h in (ANALYST, INV, INV_ADMIN, MGR, MGR_ADMIN):
        assert client.get(V1 + "/news/sources", headers=h).status_code == 403
        assert put(client, "brave", {"enabled": False}, headers=h).status_code == 403
        assert client.post(V1 + "/news/sources/brave/test", headers=h).status_code == 403
    assert code(put(client, "bing", {"enabled": False})) == (404, "not_found")
    assert code(client.post(V1 + "/news/sources/bing/test", headers=TAO)) == (404, "not_found")


def test_secret_key_set_needs_a_valid_key(client, monkeypatch):
    monkeypatch.setenv("NEWS_SECRET_KEY", "not-a-fernet-key")
    assert sources(client)["secret_key_set"] is False
    assert code(put(client, "brave", {"secrets": {"api_key": SECRET}})) == (409, "no_secret_key")
    monkeypatch.setenv("NEWS_SECRET_KEY", Fernet.generate_key().decode())
    assert sources(client)["secret_key_set"] is True


def test_no_secret_key_refuses_storing_and_testing(client):
    r = put(client, "event_registry", {"secrets": {"api_key": SECRET}})
    assert code(r) == (409, "no_secret_key") and SECRET not in r.text
    assert stored("event_registry") is None or not stored("event_registry").secrets_enc
    assert code(client.post(V1 + "/news/sources/event_registry/test", headers=TAO)) == (409, "no_secret_key")
    # config alone needs no key
    r = put(client, "event_registry", {"config": {"archive_months": 12}})
    assert r.status_code == 200 and r.json()["config"] == {"archive_months": 12}


def test_encryption_round_trip_and_nothing_leaks(client, key, caplog):
    caplog.set_level(logging.DEBUG)
    r = client.put(V1 + "/news/sources/event_registry", headers=H(A1), json={"secrets": {"api_key": SECRET}, "enabled": True,
                                                                         "config": {"archive_months": 12}, "reason": REASON})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["enabled"] is True and out["secrets"] == {"api_key": {"set": True, "last4": "WXYZ"}}
    assert out["config"] == {"archive_months": 12} and out["updated_by"] == {"id": A1, "name": "A. Patel"} and out["updated_at"]
    row = stored("event_registry")
    assert row.secrets_last4 == {"api_key": "WXYZ"} and SECRET not in row.secrets_enc
    # the exact format the news worker decrypts
    assert json.loads(Fernet(key.encode()).decrypt(row.secrets_enc.encode()).decode()) == {"api_key": SECRET}
    # a short secret: set, no last four
    r = put(client, "newscatcher", {"secrets": {"api_key": SHORT}})
    assert r.json()["secrets"]["api_key"] == {"set": True, "last4": None}
    # nowhere in any read, the audit or the logs
    everything = [sources(client), client.get(V1 + "/audit", headers=TAO, params={"scope": "platform"}).json(),
                  client.get(V1 + "/audit/export.csv", headers=TAO).text]
    blob = json.dumps(everything) + caplog.text
    assert SECRET not in blob and SHORT not in blob and SECRET[-12:] not in blob


def test_put_merges_secrets_and_config(client, key):
    assert put(client, "dow_jones", {"secrets": {"user_key": "uk-0000000000001111", "client_id": "cid-000000002222"},
                                     "config": {"base_url": "https://api.example.test/dj"}}).status_code == 200
    r = put(client, "dow_jones", {"secrets": {"client_secret": "cs-000000000003333"}})
    got = r.json()
    assert {k: v["last4"] for k, v in got["secrets"].items() if v["set"]} == {"user_key": "1111", "client_id": "2222", "client_secret": "3333"}
    assert got["config"] == {"base_url": "https://api.example.test/dj"}                       # not sent: kept
    r = put(client, "dow_jones", {"secrets": {"client_id": None, "user_key": "uk-0000000000004444"}})
    got = r.json()["secrets"]
    assert (got["client_id"], got["user_key"]["last4"], got["client_secret"]["last4"]) == ({"set": False, "last4": None}, "4444", "3333")
    row = stored("dow_jones")
    assert json.loads(Fernet(key.encode()).decrypt(row.secrets_enc.encode())) == {"user_key": "uk-0000000000004444",
                                                                                   "client_secret": "cs-000000000003333"}
    # config null goes back to the default; removing every secret clears the token
    assert put(client, "brave", {"config": {"news": False}}).json()["config"] == {"news": False, "web": True}
    assert put(client, "brave", {"config": {"news": None}}).json()["config"] == {"news": True, "web": True}
    put(client, "dow_jones", {"secrets": {"user_key": None, "client_secret": None}})
    row = stored("dow_jones")
    assert row.secrets_enc is None and row.secrets_last4 == {}


def test_config_keys_not_sent_keep_their_stored_value(client, key):
    """UI-Admin sends only the changed config keys: each PUT merges into the stored config."""
    assert put(client, "brave", {"config": {"web": False}}).json()["config"] == {"news": True, "web": False}
    assert put(client, "brave", {"config": {"news": False}}).json()["config"] == {"news": False, "web": False}
    assert put(client, "brave", {"secrets": {"api_key": SECRET}}).json()["config"] == {"news": False, "web": False}
    assert put(client, "brave", {"enabled": True}).json()["config"] == {"news": False, "web": False}
    assert stored("brave").config == {"news": False, "web": False}
    put(client, "dow_jones", {"config": {"base_url": "https://api.example.test/dj"}})
    assert put(client, "dow_jones", {"config": {}}).json()["config"] == {"base_url": "https://api.example.test/dj"}


def test_removing_the_last_secret_needs_no_key(client, key, monkeypatch):
    put(client, "brave", {"secrets": {"api_key": SECRET}})
    monkeypatch.delenv("NEWS_SECRET_KEY")
    r = put(client, "brave", {"secrets": {"api_key": None}})
    assert r.status_code == 200 and r.json()["secrets"]["api_key"] == {"set": False, "last4": None}


def test_a_changed_key_drops_what_cannot_be_read(client, key, monkeypatch):
    put(client, "lexisnexis", {"secrets": {"client_id": "lx-client-00001111", "client_secret": "lx-secret-0002222"}})
    k2 = Fernet.generate_key().decode()
    monkeypatch.setenv("NEWS_SECRET_KEY", k2)
    r = put(client, "lexisnexis", {"secrets": {"client_id": "lx-client-00003333"}})
    assert r.status_code == 200
    assert {k: v["set"] for k, v in r.json()["secrets"].items()} == {"client_id": True, "client_secret": False}
    assert json.loads(Fernet(k2.encode()).decrypt(stored("lexisnexis").secrets_enc.encode())) == {"client_id": "lx-client-00003333"}


def test_409_rules(client, key):
    assert code(put(client, "dow_jones", {"enabled": True})) == (409, "not_available")
    assert code(put(client, "lexisnexis", {"enabled": True, "secrets": {"client_id": "x" * 20}})) == (409, "not_available")
    assert stored("lexisnexis") is None or not stored("lexisnexis").secrets_last4                 # refused: nothing stored
    assert put(client, "dow_jones", {"enabled": False}).status_code == 200                         # switching off is fine
    assert code(put(client, "event_registry", {"enabled": True})) == (409, "missing_credentials")
    assert code(client.post(V1 + "/news/sources/event_registry/test", headers=TAO)) == (409, "missing_credentials")
    assert code(client.post(V1 + "/news/sources/dow_jones/test", headers=TAO)) == (409, "not_available")
    assert put(client, "event_registry", {"enabled": True, "secrets": {"api_key": SECRET}}).json()["enabled"] is True
    # an enabled source cannot lose a required secret
    assert code(put(client, "event_registry", {"secrets": {"api_key": None}})) == (409, "missing_credentials")
    assert put(client, "event_registry", {"enabled": False, "secrets": {"api_key": None}}).status_code == 200


def test_422_invalid_never_echoes_a_secret(client, key):
    bad = [
        {"secrets": {"api_key": SECRET}, "colour": "red"},             # unknown field
        {"config": {"api_key": SECRET}},                               # a secret sent as config
        {"config": {"region": "us"}},                                  # not a field of the provider
        {"config": {"archive_months": "12"}},                          # wrong kind
        {"config": {"archive_months": True}},
        {"config": {"archive_months": -1}},
        {"secrets": {"archive_months": SECRET}},                       # not a secret field
        {"secrets": {"api_key": 12345678901234}},
        {"secrets": {"api_key": ""}},
        {"secrets": [SECRET]},
        {"enabled": "yes", "secrets": {"api_key": SECRET}},
        {"config": None},
    ]
    for body in bad:
        r = put(client, "event_registry", body)
        assert code(r) == (422, "invalid"), body
        assert SECRET not in r.text and "12345678901234" not in r.text, body
    for body in ({"config": {"news": "yes"}}, {"config": {"archive_months": 3}}):
        assert code(put(client, "brave", body)) == (422, "invalid"), body
    assert code(put(client, "dow_jones", {"config": {"base_url": "ftp://x"}})) == (422, "invalid")
    r = client.put(V1 + "/news/sources/brave", headers=TAO, json={"secrets": {"api_key": SECRET}})        # no reason
    assert code(r) == (422, "invalid") and SECRET not in r.text
    r = client.put(V1 + "/news/sources/brave", headers=TAO, json={"secrets": {"api_key": SECRET}, "reason": "x"})
    assert code(r) == (422, "invalid") and SECRET not in r.text
    r = client.put(V1 + "/news/sources/brave", headers=TAO, content=b"not json " + SECRET.encode())
    assert code(r) == (422, "invalid") and SECRET not in r.text
    assert stored("event_registry") is None or not stored("event_registry").secrets_last4


def test_audit_names_fields_and_on_off_never_values(client, key):
    client.put(V1 + "/news/sources/brave", headers=H(A1), json={"secrets": {"api_key": SECRET}, "enabled": True,
                                                                 "config": {"web": False}, "reason": REASON})
    put(client, "brave", {"secrets": {"api_key": None}, "enabled": False})
    put(client, "brave", {"config": {"news": True}})                                        # same as the default: no change, no entry
    e = audit(client, scope="platform", action="news_source_change")
    assert len(e) == 2
    first = e[1]
    assert first["reason"] == REASON and first["actor_user_id"] == A1
    assert first["detail"] == {"provider": "brave", "label": "Brave Search", "enabled": {"before": False, "after": True},
                               "config_changed": ["web"], "secrets_set": ["api_key"], "secrets_removed": []}
    assert e[0]["detail"]["secrets_removed"] == ["api_key"] and e[0]["detail"]["enabled"] == {"before": True, "after": False}
    assert SECRET not in json.dumps(e)


def test_connection_test_queues_a_json_message(client, key, news_queue):
    put(client, "brave", {"secrets": {"api_key": SECRET}})
    r = client.post(V1 + "/news/sources/brave/test", headers=TAO)
    assert r.status_code == 202 and r.json()["provider"] == "brave" and r.json()["secrets"]["api_key"]["set"] is True
    assert news_queue.jobs == ['{"type":"test","provider":"brave"}']
    assert json.loads(news_queue.jobs[0]) == {"type": "test", "provider": "brave"}
    assert SECRET not in r.text
    # the worker records the result on the row; the next read shows it
    with db.session() as s:
        row = s.get(NewsSource, "brave")
        row.last_test_at, row.last_test_ok, row.last_test_message = utcnow(), True, "OK: 12 results for the test query"
        s.commit()
    got = {x["provider"]: x for x in sources(client)["sources"]}["brave"]["last_test"]
    assert got["ok"] is True and got["message"].startswith("OK") and got["at"]


def test_connection_test_queue_down_is_recorded(client, key):
    class Down:
        def push(self, _):
            raise ConnectionError("redis unreachable")
    put(client, "newscatcher", {"secrets": {"api_key": SECRET}})
    app.dependency_overrides[jobs.get_news_queue] = lambda: Down()
    try:
        r = client.post(V1 + "/news/sources/newscatcher/test", headers=TAO)
        assert r.status_code == 202 and r.json()["last_test"]["ok"] is False and "unavailable" in r.json()["last_test"]["message"]
    finally:
        app.dependency_overrides.pop(jobs.get_news_queue, None)


def test_news_queue_pushes_the_test_message_as_is(monkeypatch):
    calls = []

    class FakeRedis:
        def lpush(self, name, value):
            calls.append((name, value))
    import redis
    from app import news_sources
    monkeypatch.setattr(redis.Redis, "from_url", staticmethod(lambda *a, **k: FakeRedis()))
    monkeypatch.delenv("NEWS_QUEUE", raising=False)
    jobs.NewsQueue().push(news_sources.test_message("event_registry"))
    assert calls == [("news", '{"type":"test","provider":"event_registry"}')]


# ---------- /news/recheck ----------
def test_recheck(client, news_queue):
    assert code(client.post(V1 + "/news/recheck", headers=ANALYST)) == (403, "admin_only")
    assert client.post(V1 + "/news/recheck", headers=INV).status_code == 403
    r = client.post(V1 + "/news/recheck", headers=H(A1))                         # feeds are off: allowed
    assert r.status_code == 202, r.text
    run = r.json()
    assert (run["trigger"], run["status"], run["stats"]) == ("recheck", "queued", {})
    assert news_queue.jobs == [run["id"]]
    assert code(client.post(V1 + "/news/recheck", headers=TAO)) == (409, "run_active")
    setting(client, "company_feeds", {"enabled": True})
    assert code(client.post(V1 + "/news/runs", headers=TAO)) == (409, "run_active")
    with db.session() as s:
        s.get(NewsRun, run["id"]).status = "ok"
        s.get(NewsRun, run["id"]).stats = {"candidates": 4, "kept": 3, "excluded": 1, "pending": 0, "claude_input_tokens": 900}
        s.commit()
    assert client.get(V1 + "/news/runs", headers=TAO).json()[0]["stats"]["kept"] == 3
    e = audit(client, scope="platform", action="news_run")
    assert e[0]["detail"] == {"run_id": run["id"], "trigger": "recheck"} and e[0]["actor_user_id"] == A1


# ---------- NewsItem output and who sees what ----------
def _list(client, headers, **params):
    r = client.get(V1 + f"/companies/{ESSEX}/news", headers=headers, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_news_item_fields_and_visibility(client, published):
    profiles_on(client)
    now = utcnow()
    kept = news(ESSEX, "Kept story", url="https://news.google.com/rss/articles/abc", resolved_url="https://publisher.example/story",
                sources=["google_news", "event_registry"], language="fr", check_confidence=0.92, check_reason="About the lender",
                check_model="claude-haiku-5-5", checked_at=now)
    old = news(ESSEX, "Unchecked story", check="unchecked", confirmed=False, found=now - dt.timedelta(days=2))
    exc = news(ESSEX, "Excluded story", check="excluded", check_reason="About a Mexico City property market, not the lender")
    pen = news(ESSEX, "Pending story", check="pending", confirmed=False)
    for h in PARTNERS:
        got = _list(client, h)
        assert [x["id"] for x in got] == [kept] and "check" not in got[0]
        assert [x["id"] for x in _list(client, h, include="all")] == [kept]                       # include ignored for partners
    item = _list(client, INV)[0]
    assert item["url"] == "https://publisher.example/story" and item["sources"] == ["google_news", "event_registry"]
    assert (item["language"], item["date_status"], item["source_date"]) == ("fr", "confirmed", None) and item["published_at"]
    assert set(item) == {"id", "company_slug", "title", "url", "publisher", "published_at", "source_date", "date_status", "source",
                         "sources", "language", "sentiment", "found_at"}
    tao = _list(client, TAO)
    assert [x["id"] for x in tao] == [kept, old]
    assert tao[0]["check"] == {"status": "kept", "confidence": 0.92, "reason": "About the lender", "model": "claude-haiku-5-5",
                               "checked_at": tao[0]["check"]["checked_at"]} and tao[0]["check"]["checked_at"]
    u = tao[1]
    assert u["check"] == {"status": "unchecked", "confidence": None, "reason": None, "model": None, "checked_at": None}
    assert (u["published_at"], u["date_status"], u["sources"], u["language"]) == (None, "source_only", ["fixture"], None) and u["source_date"]
    assert {x["id"] for x in _list(client, ANALYST, include="excluded")} == {kept, old, exc}
    assert {x["id"] for x in _list(client, TAO, include="pending")} == {kept, old, pen}
    every = _list(client, TAO, include="all")
    assert {x["id"] for x in every} == {kept, old, exc, pen}
    assert next(x for x in every if x["id"] == exc)["check"]["reason"].startswith("About a Mexico City")
    assert client.get(V1 + f"/companies/{ESSEX}/news", headers=TAO, params={"include": "everything"}).status_code == 422


def test_sort_and_days_use_published_then_source_date_then_found(client, published):
    now = utcnow()
    a = news(ESSEX, "Confirmed 3 days ago", found=now - dt.timedelta(days=3))
    b = news(ESSEX, "Source date 1 day ago", confirmed=False, found=now - dt.timedelta(days=1))
    with db.session() as s:                                            # found today, the source says 40 days ago
        n = NewsItem(company_slug=ESSEX, source="gdelt", title="Source date 40 days ago", url="https://example.com/old-gdelt",
                     sentiment="neutral", found_at=now, source_date=now - dt.timedelta(days=40), date_status="source_only", check_status="kept")
        m = NewsItem(company_slug=ESSEX, source="gdelt", title="No date at all", url="https://example.com/no-date", sentiment="neutral",
                     found_at=now - dt.timedelta(hours=1), date_status="unknown", check_status="kept")
        s.add_all([n, m]); s.commit()
        c, d = n.id, m.id
    assert [x["id"] for x in _list(client, TAO)] == [d, b, a]
    assert [x["id"] for x in _list(client, TAO, days=60)] == [d, b, a, c]
    assert [x["id"] for x in _list(client, TAO, days=2)] == [d, b]


def test_news_7d_counts_kept_confirmed_recent_only(client, published):
    finished_run("ok")
    now = utcnow()
    news(ESSEX, "kept, confirmed, 2 days")                                                             # counts
    news(ESSEX, "kept, confirmed, 6 days", found=now - dt.timedelta(days=6))                            # counts
    news(ESSEX, "kept, confirmed, 8 days", found=now - dt.timedelta(days=8))
    news(ESSEX, "kept, source date only", confirmed=False)
    news(ESSEX, "unchecked, confirmed", check="unchecked")
    news(ESSEX, "excluded, confirmed", check="excluded")
    news(ESSEX, "pending", check="pending")
    assert rows(client, TAO)[ESSEX]["news_7d"] == 2
    profiles_on(client)
    assert rows(client, INV)[ESSEX]["news_7d"] == 2


def test_adverse_lists_hide_excluded_and_pending_stories(client, published):
    finished_run("ok")
    profiles_on(client)
    kept = news(ESSEX, "Kept claim", "negative")
    old = news(ESSEX, "Unchecked claim", "negative", check="unchecked")
    exc = news(ESSEX, "Excluded claim", "negative", check="excluded")
    pen = news(ESSEX, "Pending claim", "negative", check="pending")
    ids = {k: adverse(ESSEX, f"Adverse {k}", "litigation", n) for k, n in (("kept", kept), ("old", old), ("exc", exc), ("pen", pen))}
    ids["none"] = adverse(ESSEX, "Adverse with no story", "regulatory")
    tao = {x["id"] for x in client.get(V1 + f"/companies/{ESSEX}/adverse", headers=TAO).json()}
    assert tao == {ids["kept"], ids["old"], ids["none"]}
    assert rows(client, TAO)[ESSEX]["adverse"] == {"state": "to_review", "to_review": 3}
    for k in ("kept", "exc"):
        with db.session() as s:
            from app.models import AdverseItem
            s.get(AdverseItem, ids[k]).state = "reviewed"; s.commit()
    for h in PARTNERS:                                                  # partners: reviewed only, as before, and never an excluded story
        assert [x["id"] for x in client.get(V1 + f"/companies/{ESSEX}/adverse", headers=h).json()] == [ids["kept"]]


# ---------- notifications ----------
def test_alerts_only_for_kept_stories_with_a_confirmed_recent_date(client, published):
    assert client.put(V1 + f"/companies/{ESSEX}/follow", headers=H(AN)).status_code == 204
    now = utcnow()
    skip = [news(ESSEX, "unchecked negative", "negative", check="unchecked"),
            news(ESSEX, "pending negative", "negative", check="pending"),
            news(ESSEX, "excluded negative", "negative", check="excluded"),
            news(ESSEX, "kept negative, date not confirmed", "negative", confirmed=False),
            news(ESSEX, "kept negative, confirmed 9 days ago", "negative", found=now - dt.timedelta(days=9))]
    for n in skip:
        adverse(ESSEX, "adverse on a skipped story", "fraud", n)
    adverse(ESSEX, "adverse with no story", "sanctions")
    assert notes_of(client, AN, "negative_news") == [] and notes_of(client, AN, "adverse_media") == []
    good = news(ESSEX, "kept negative, confirmed today", "negative")
    adverse(ESSEX, "adverse on the kept story", "litigation", good)
    assert [n["body"].split(" (")[0] for n in notes_of(client, AN, "negative_news")] == ["kept negative, confirmed today"]
    assert [n["body"].split(" (")[0] for n in notes_of(client, AN, "adverse_media")] == ["adverse on the kept story"]
    assert len(notes_of(client, AN, "negative_news")) == 1 and len(notes_of(client, AN, "adverse_media")) == 1          # once
    # the re-check turns an unchecked story into a kept one with a confirmed recent date: it alerts then, once
    with db.session() as s:
        n = s.get(NewsItem, skip[0])
        n.check_status, n.date_status, n.published_at = "kept", "confirmed", utcnow()
        s.commit()
    assert len(notes_of(client, AN, "negative_news")) == 2 and len(notes_of(client, AN, "adverse_media")) == 2
    assert len(notes_of(client, AN, "negative_news")) == 2


def test_reviewed_alert_to_partners_needs_a_kept_story_only(client, published):
    """Lead decision: the partner alert when TAO marks an item reviewed has no date rule (a person reviewed it); the story
    must still be kept. The TAO alert when the item opens keeps the full rule."""
    profiles_on(client)
    setting(client, "partner_notifications_enabled", True)
    assert client.put(V1 + f"/companies/{ESSEX}/follow", headers=H(AN)).status_code == 204
    assert client.put(V1 + f"/companies/{ESSEX}/follow", headers=H(IV)).status_code == 204
    now = utcnow()
    old = adverse(ESSEX, "old kept story", "litigation", news(ESSEX, "kept, confirmed 30 days ago", found=now - dt.timedelta(days=30)))
    undated = adverse(ESSEX, "kept, date not confirmed", "fraud", news(ESSEX, "kept undated", confirmed=False))
    unchecked = adverse(ESSEX, "unchecked story", "regulatory", news(ESSEX, "unchecked", check="unchecked"))
    nostory = adverse(ESSEX, "no story", "sanctions")
    assert notes_of(client, AN, "adverse_media") == []                         # none opens a TAO alert
    for a in (old, undated, unchecked, nostory):
        assert client.post(V1 + f"/adverse/{a}/review", headers=TAO, json={"note": "Reviewed, same entity."}).status_code == 200
    got = sorted(n["body"].split(".")[0] for n in notes_of(client, IV, "adverse_media"))
    assert got == ["kept, date not confirmed", "old kept story"]
    assert all("reviewed" in n["title"] for n in notes_of(client, IV, "adverse_media"))
    assert len(notes_of(client, IV, "adverse_media")) == 2 and notes_of(client, AN, "adverse_media") == []          # once; TAO none


# ---------- company news_search ----------
def test_company_news_search(client, published):
    got = client.get(V1 + f"/companies/{ESSEX}", headers=TAO).json()
    assert got["news_search"] == {"context_terms": [], "exclusions": [], "languages": ["en", "fr"]}
    assert "news_search" in client.get(V1 + f"/companies/{ESSEX}", headers=ANALYST).json()
    profiles_on(client)
    for h in PARTNERS:
        assert "news_search" not in client.get(V1 + f"/companies/{ESSEX}", headers=h).json()
    body = {"news_search": {"context_terms": [" leasing ", "Leasing", "equipment  finance", "LEASING"], "exclusions": ["Essex Lease Bermuda"],
                            "languages": ["en"]}, "reason": "generic name"}
    r = client.patch(V1 + f"/companies/{ESSEX}", headers=TAO, json=body)
    assert r.status_code == 200, r.text
    assert r.json()["news_search"] == {"context_terms": ["leasing", "equipment finance"], "exclusions": ["Essex Lease Bermuda"], "languages": ["en"]}
    r = client.patch(V1 + f"/companies/{ESSEX}", headers=TAO, json={"news_search": {"languages": ["fr", "en", "fr"]}, "reason": "both"})
    assert r.json()["news_search"]["languages"] == ["fr", "en"] and r.json()["news_search"]["context_terms"] == ["leasing", "equipment finance"]
    bad = [{"context_terms": ["x"]}, {"exclusions": [" a "]}, {"context_terms": "leasing"}, {"context_terms": [1]},
           {"context_terms": [f"term {i}" for i in range(31)]}, {"languages": []}, {"languages": ["de"]}, {"languages": "en"},
           {"other": []}, None, []]
    for v in bad:
        assert code(client.patch(V1 + f"/companies/{ESSEX}", headers=TAO, json={"news_search": v, "reason": "bad value"})) == (422, "invalid"), v
    ok30 = [f"term {i}" for i in range(30)] + ["TERM 0"]                       # 31 sent, 30 after dedupe
    assert len(client.patch(V1 + f"/companies/{ESSEX}", headers=TAO, json={"news_search": {"exclusions": ok30}, "reason": "many"}).json()
               ["news_search"]["exclusions"]) == 30
    assert client.patch(V1 + f"/companies/{ESSEX}", headers=ANALYST, json={"news_search": {"languages": ["en"]}, "reason": "x y z"}).status_code == 403
    e = [x for x in audit(client, scope="platform", action="company_change") if x["detail"]["change"] == "record"]
    first = e[-1]
    assert first["reason"] == "generic name"
    assert first["detail"]["before"] == {"news_search": {"context_terms": [], "exclusions": [], "languages": ["en", "fr"]}}
    assert first["detail"]["after"] == {"news_search": {"context_terms": ["leasing", "equipment finance"], "exclusions": ["Essex Lease Bermuda"],
                                                        "languages": ["en"]}}


# ---------- company_feeds.daily_cap ----------
def test_company_feeds_daily_cap(client):
    got = {x["key"]: x for x in client.get(V1 + "/settings", headers=TAO).json()}
    assert got["company_feeds"]["value"]["daily_cap"] == 200
    assert setting(client, "company_feeds", {"daily_cap": 50})["daily_cap"] == 50
    assert setting(client, "company_feeds", {"enabled": True})["daily_cap"] == 50                  # kept
    assert setting(client, "company_feeds", {"daily_cap": 5000})["daily_cap"] == 5000
    for v in (0, 5001, "200", 2.5, True, None):
        assert code(client.put(V1 + "/settings/company_feeds", headers=TAO, json={"value": {"daily_cap": v}, "reason": "bad cap"})) == (422, "invalid"), v
