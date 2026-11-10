"""News worker (waves D and E). Once a day, while `company_feeds.enabled` is true, search the free and paid sources for
each company, check every new story (date check and Claude check) and write what it finds; also run the API's requests.

Loop: every minute (and whenever the queue wakes it) read `company_feeds`, run any queued runs oldest first (manual and
recheck), then start the day's scheduled run if it is due. Queue messages on the Redis list NEWS_QUEUE:
  - a bare run id: the API inserted a news_run row (trigger manual or recheck, status queued). Only a wake-up: the queued
    rows are the source of truth, so a lost message still runs within a minute;
  - {"type": "test", "provider": "<p>"}: test that provider's stored credentials with one small query and write
    news_source.last_test_* (gives up after TEST_TIMEOUT seconds and records that).
One run at a time, because the loop is single-threaded. Nothing is searched while company_feeds.enabled is false; a
recheck run is allowed while it is off (it searches nothing)."""
import concurrent.futures
import datetime as dt
import json
import logging
import os
import time

import check
import feeds
import sources
import store
from credentials import CredentialError, decrypt, scrub
from queries import Query
from runner import execute, execute_recheck
from sources import paid as paid_sources

log = logging.getLogger("news")
SETTING_KEY = "company_feeds"
CHECK_EVERY = 60
TEST_TIMEOUT = 30
TEST_QUERY = "equipment leasing"
TEST_COUNT = 5


def parse_message(payload):
    """("test", provider) for a test message, else ("wake", None)."""
    if isinstance(payload, bytes):
        payload = payload.decode("utf-8", "replace")
    text = (payload or "").strip()
    if text.startswith("{"):
        try:
            msg = json.loads(text)
        except ValueError:
            return ("wake", None)
        if isinstance(msg, dict) and msg.get("type") == "test" and isinstance(msg.get("provider"), str):
            return ("test", msg["provider"])
    return ("wake", None)


class Worker:
    def __init__(self, eng, env=os.environ, now=store.utcnow, source_factory=sources.for_run, checker=None,
                 page_reader=None, resolver=None, paid_factory=paid_sources.build):
        self.eng, self.env, self.now, self.source_factory = eng, env, now, source_factory
        self.checker = checker                      # None: from the environment (check.for_env)
        self.page_reader, self.resolver = page_reader, resolver
        self.paid_factory = paid_factory

    def config(self):
        with self.eng.connect() as conn:
            return feeds.settings(store.read_setting(conn, SETTING_KEY))

    def recover(self):
        """At start-up: a run left `running` by a stopped worker is failed, so Run now is not blocked for ever."""
        with self.eng.begin() as conn:
            ids = store.fail_stale_running(conn, self.now())
        if ids:
            log.warning("marked %d interrupted run(s) failed: %s", len(ids), ids)

    def _fixture_mode(self):
        return self.env.get("NEWS_SOURCE", "").strip().lower() == "fixture"

    def _extras(self):
        kw = {"checker": self.checker or check.for_env(self.env), "read_pages": not self._fixture_mode()}
        if self.page_reader is not None:
            kw["page_reader"] = self.page_reader
        if self.resolver is not None:
            kw["resolver"] = self.resolver
        return kw

    def _fail(self, run_id, message):
        with self.eng.begin() as conn:
            store.finish_run(conn, run_id, "failed", self.now(), 0, 0, 0,
                             [{"company_slug": None, "source": "worker", "message": str(message)[:500]}])

    def _run(self, run_id, cfg):
        with self.eng.begin() as conn:
            if not store.claim_run(conn, run_id, self.now()):
                return None
            row = store.get_run(conn, run_id)
        trigger = (row or {}).get("trigger") or "manual"
        try:
            if trigger == "recheck":
                return execute_recheck(self.eng, run_id, now=self.now, **self._extras())["status"]
            if not cfg["enabled"]:
                self._fail(run_id, "company_feeds is off; nothing was fetched")
                log.info("news run %s not started: company_feeds is off", run_id)
                return "failed"
            with self.eng.connect() as conn:
                rows = [] if self._fixture_mode() else store.news_sources(conn)
            paid, paid_errors = sources.load_paid(rows, self.env)
            secrets = [v for p in paid for v in p["secrets"].values()]
            srcs, pre = self.source_factory(cfg["sources"], self.env, paid)
            return execute(self.eng, run_id, srcs, now=self.now, pre_errors=list(paid_errors) + list(pre), cfg=cfg,
                           archive=sources.has_archive(paid), secrets=secrets, **self._extras())["status"]
        except AssertionError as exc:     # the tests' network guard: fail the row, then let the test see it
            self._fail(run_id, exc)
            raise
        except Exception as exc:          # a bug or a lost database: never leave the row running
            log.exception("news run %s crashed", run_id)
            self._fail(run_id, exc)
            return "failed"

    def tick(self):
        """One pass: queued runs (manual, recheck), then the schedule. Returns the ids run, for tests."""
        cfg = self.config()
        done = []
        with self.eng.connect() as conn:
            queued = store.queued_runs(conn)
        for rid in queued:
            if self._run(rid, cfg) is not None:
                done.append(rid)
        now = self.now()
        with self.eng.connect() as conn:
            recent = store.schedule_run_times(conn, now - dt.timedelta(days=3))
        if feeds.schedule_due(now, cfg, recent):
            with self.eng.begin() as conn:
                rid = store.insert_run(conn, "schedule", now)
            self._run(rid, cfg)
            done.append(rid)
        return done

    # --- Test connection -----------------------------------------------------------------------------------------

    def _test(self, provider):
        """(ok, message) for one small query on the provider's stored credentials. Raises nothing."""
        with self.eng.connect() as conn:
            row = store.news_source_row(conn, provider)
        if row is None:
            return False, f"unknown provider {provider}"
        if provider in ("dow_jones", "lexisnexis"):
            return False, paid_sources.NEEDS_DOCS
        if not row.get("secrets_enc"):
            return False, "No credentials stored"
        try:
            secrets = decrypt(row["secrets_enc"], (self.env.get("NEWS_SECRET_KEY") or "").strip())
        except CredentialError as exc:
            return False, str(exc)
        values = list(secrets.values())
        try:
            srcs = self.paid_factory(provider, secrets, dict(row.get("config") or {}))
            if not srcs:
                return False, "Neither news nor web search is switched on for this provider"
            src = srcs[0]
            for attr in ("page_size", "count"):
                if hasattr(src, attr):
                    setattr(src, attr, TEST_COUNT)
            items = src.fetch(Query("name", TEST_QUERY, ("en",)), self.now(), dt.timedelta(days=7))
            return True, f"OK: {len(items)} results for the test query"
        except Exception as exc:
            return False, scrub(str(exc), values)

    def test_provider(self, provider, timeout=TEST_TIMEOUT):
        pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        fut = pool.submit(self._test, provider)
        try:
            ok, message = fut.result(timeout=timeout)
        except concurrent.futures.TimeoutError:
            ok, message = False, f"No answer from the provider within {timeout} seconds"
        except Exception as exc:
            ok, message = False, f"Test failed: {type(exc).__name__}"
        finally:
            pool.shutdown(wait=False)
        message = " ".join(str(message).split())[:300]
        with self.eng.begin() as conn:
            store.set_test_result(conn, provider, self.now(), ok, message)
        log.info("news source test %s: %s", provider, "ok" if ok else "failed")
        return ok, message

    def handle(self, payload):
        """One queue message. True when the loop should tick (a run id, or anything it does not recognise)."""
        kind, provider = parse_message(payload)
        if kind == "test":
            try:
                self.test_provider(provider)
            except Exception:
                log.exception("news source test %s could not be recorded", provider)
            return False
        return True


def _redis(url):
    try:
        import redis
        r = redis.Redis.from_url(url, socket_connect_timeout=3, socket_timeout=15)
        r.ping()
        return r
    except Exception as exc:
        log.warning("redis unavailable (%s); polling the database every %ss instead", exc, CHECK_EVERY)
        return None


def main():
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
    queue = os.environ.get("NEWS_QUEUE", "news")
    eng = store.engine()
    worker = Worker(eng)
    while True:                       # the API applies the migrations; wait for the tables
        try:
            worker.recover()
            break
        except Exception as exc:
            log.warning("database not ready (%s); retrying", type(exc).__name__)
            time.sleep(5)
    r = _redis(os.environ.get("REDIS_URL", "redis://localhost:6379/0"))
    log.info("news worker up; queue %s; source %s; check %s", queue, os.environ.get("NEWS_SOURCE") or "per company_feeds",
             getattr(check.for_env(os.environ), "mode", "?"))
    last = 0.0
    while True:
        woke = False
        if r is not None:
            try:
                popped = r.brpop(queue, timeout=5)
                woke = popped is not None and worker.handle(popped[1])
            except Exception as exc:
                log.warning("redis error (%s); reconnecting", type(exc).__name__)
                time.sleep(5)
                r = _redis(os.environ.get("REDIS_URL", "redis://localhost:6379/0"))
        else:
            time.sleep(5)
        if woke or time.monotonic() - last >= CHECK_EVERY:
            last = time.monotonic()
            try:
                worker.tick()
            except Exception:
                log.exception("news worker tick failed")


if __name__ == "__main__":
    main()
