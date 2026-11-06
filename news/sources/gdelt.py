"""GDELT DOC 2.0 article list: one request per company, the name and aliases quoted and OR-ed, over the look-back window.
https://api.gdeltproject.org/api/v2/doc/doc?query=<"name">&mode=artlist&format=json&maxrecords=50&timespan=7d
GDELT asks for at most one request every 5 seconds; we keep 10 s. On HTTP 429 we wait RETRY_WAIT and retry that request
once. After MAX_CONSECUTIVE_429 companies in a row end in 429 (after their retry), GDELT is skipped for the rest of the
run and the run records one error."""
import datetime as dt
import json
import time
import urllib.parse

from .net import LOOKBACK_DAYS, RateLimiter, SourceError, SourceSkipped, get

BASE = "https://api.gdeltproject.org/api/v2/doc/doc"
SPACING = 10.0
RETRY_WAIT = 20.0
MAX_CONSECUTIVE_429 = 3
SKIP_MESSAGE = "gdelt rate-limited; skipped remaining companies"
_LIMIT = RateLimiter(SPACING)


def query_for(company):
    from match import terms
    quoted = [f'"{t.rstrip(".")}"' for t in terms(company)]
    return quoted[0] if len(quoted) == 1 else "(" + " OR ".join(quoted) + ")"


def search_url(query, days=LOOKBACK_DAYS):
    return (f"{BASE}?query={urllib.parse.quote(query, safe='')}&mode=artlist&format=json&maxrecords=50"
            f"&timespan={int(days)}d")


def _date(s):
    try:
        return dt.datetime.strptime(s, "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.timezone.utc)
    except (TypeError, ValueError):
        return None


def parse(body):
    text = body.decode("utf-8", "replace").strip()
    if not text:
        return []
    if not text.startswith("{"):
        raise SourceError("GDELT: " + " ".join(text.split())[:160])      # rate-limit notices and query errors are plain text
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise SourceError(f"GDELT: bad JSON: {exc}") from exc
    items = []
    for a in data.get("articles") or []:
        title, url = (a.get("title") or "").strip(), (a.get("url") or "").strip()
        if title and url:
            items.append({"title": title, "url": url, "publisher": a.get("domain") or None,
                          "published_at": _date(a.get("seendate")), "description": ""})
    return items


class Gdelt:
    """One instance per run (sources.for_run builds a new one), so the 429 count and the skip last one run."""
    name = "gdelt"
    SKIP_MESSAGE = SKIP_MESSAGE

    def __init__(self, limiter=_LIMIT, sleep=time.sleep):
        self.limiter, self.sleep = limiter, sleep
        self.consecutive_429 = 0
        self.skipped = False

    def queries(self, company):
        return [query_for(company)]

    def _get(self, url):
        try:
            return get(url, self.limiter)
        except SourceError as exc:
            if exc.status != 429:
                raise
        self.sleep(RETRY_WAIT)
        return get(url, self.limiter)

    def fetch(self, query, now, max_age=dt.timedelta(days=LOOKBACK_DAYS)):
        if self.skipped:
            raise SourceSkipped(SKIP_MESSAGE)
        try:
            body = self._get(search_url(query, max_age.days))
        except SourceError as exc:
            if exc.status == 429:
                self.consecutive_429 += 1
                if self.consecutive_429 >= MAX_CONSECUTIVE_429:
                    self.skipped = True
            else:
                self.consecutive_429 = 0
            raise
        self.consecutive_429 = 0
        return [i for i in parse(body) if i["published_at"] is None or now - i["published_at"] <= max_age]
