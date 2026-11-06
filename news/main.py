"""News worker (wave D). Once a day, while `company_feeds.enabled` is true, search the free sources for each company and
screen what comes back; also run Run-now requests from the API.

Loop: every minute (and whenever the queue wakes it) read `company_feeds`, run any queued manual runs oldest first, then
start the day's scheduled run if it is due. Manual runs: the API inserts a news_run row (trigger manual, status queued)
and LPUSHes its id to NEWS_QUEUE; the worker BRPOPs it. The queue is only a wake-up: the queued rows in news_run are the
source of truth, so a lost message still runs. One run at a time, because the loop is single-threaded. Nothing is
fetched while company_feeds.enabled is false."""
import datetime as dt
import logging
import os
import time

import feeds
import sources
import store
from runner import execute

log = logging.getLogger("news")
SETTING_KEY = "company_feeds"
CHECK_EVERY = 60


class Worker:
    def __init__(self, eng, env=os.environ, now=store.utcnow, source_factory=sources.for_run):
        self.eng, self.env, self.now, self.source_factory = eng, env, now, source_factory

    def config(self):
        with self.eng.connect() as conn:
            return feeds.settings(store.read_setting(conn, SETTING_KEY))

    def recover(self):
        """At start-up: a run left `running` by a stopped worker is failed, so Run now is not blocked for ever."""
        with self.eng.begin() as conn:
            ids = store.fail_stale_running(conn, self.now())
        if ids:
            log.warning("marked %d interrupted run(s) failed: %s", len(ids), ids)

    def _run(self, run_id, cfg):
        with self.eng.begin() as conn:
            if not store.claim_run(conn, run_id, self.now()):
                return None
        if not cfg["enabled"]:
            with self.eng.begin() as conn:
                store.finish_run(conn, run_id, "failed", self.now(), 0, 0, 0, [
                    {"company_slug": None, "source": "worker", "message": "company_feeds is off; nothing was fetched"}])
            log.info("news run %s not started: company_feeds is off", run_id)
            return "failed"
        srcs, pre = self.source_factory(cfg["sources"], self.env)
        try:
            return execute(self.eng, run_id, srcs, now=self.now, pre_errors=pre)["status"]
        except Exception as exc:          # a bug or a lost database: never leave the row running
            log.exception("news run %s crashed", run_id)
            with self.eng.begin() as conn:
                store.finish_run(conn, run_id, "failed", self.now(), 0, 0, 0,
                                 [{"company_slug": None, "source": "worker", "message": str(exc)[:500]}])
            return "failed"

    def tick(self):
        """One pass: queued manual runs, then the schedule. Returns the ids run, for tests."""
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
    log.info("news worker up; queue %s; source %s", queue, os.environ.get("NEWS_SOURCE") or "per company_feeds")
    last = 0.0
    while True:
        woke = False
        if r is not None:
            try:
                woke = r.brpop(queue, timeout=5) is not None
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
