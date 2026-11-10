"""GDELT DOC 2.0 article list, a supporting free source. Per company and language: the name and aliases quoted and
OR-ed, and the name plus the adverse terms, each limited to that source language.
https://api.gdeltproject.org/api/v2/doc/doc?query=<q> sourcelang:<lang>&mode=artlist&format=json&maxrecords=250&timespan=<n>d
seendate is when GDELT saw the story, not when it was written: source_date only. GDELT covers about the last three
months, so the timespan is clamped to MAX_DAYS.
GDELT asks for at most one request every 5 seconds; we keep 10 s. On HTTP 429 we wait RETRY_WAIT and retry that request
once. After MAX_CONSECUTIVE_429 requests in a row end in 429 (after their retry), GDELT is skipped for the rest of the
run and the run records one error."""
import datetime as dt
import json
import time
import urllib.parse

from queries import Query, build, quote
from .base import item, lang_code, within
from .net import LOOKBACK_DAYS, RateLimiter, SourceError, SourceSkipped, get

BASE = "https://api.gdeltproject.org/api/v2/doc/doc"
SPACING = 10.0
RETRY_WAIT = 20.0
MAX_CONSECUTIVE_429 = 3
MAX_DAYS = 90
MAX_RECORDS = 250
SKIP_MESSAGE = "gdelt rate-limited; skipped remaining companies"
SOURCELANG = {"en": "english", "fr": "french"}
_LIMIT = RateLimiter(SPACING)


def query_for(company):
    """The names part: "name" or ("name" OR "alias")."""
    from match import terms
    quoted = [quote(t.rstrip(".")) for t in terms(company)]
    return quoted[0] if len(quoted) == 1 else "(" + " OR ".join(quoted) + ")"


def render(q):
    if q.kind == "adverse":
        alts = " OR ".join(quote(t) if " " in t else t for t in q.adverse)
        text = f"{quote(q.term.rstrip('.'))} ({alts})"
    else:
        text = q.term
    lang = SOURCELANG.get(q.langs[0]) if len(q.langs) == 1 else None
    return f"{text} sourcelang:{lang}" if lang else text


def search_url(query, days=LOOKBACK_DAYS):
    days = max(1, min(int(days), MAX_DAYS))
    return (f"{BASE}?query={urllib.parse.quote(query, safe='')}&mode=artlist&format=json&maxrecords={MAX_RECORDS}"
            f"&timespan={days}d")


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
            items.append(item(title, url, a.get("domain") or None, None, _date(a.get("seendate")), "", "",
                              lang_code(a.get("language"))))
    return items


class Gdelt:
    """One instance per run (sources.for_run builds a new one), so the 429 count and the skip last one run."""
    name = "gdelt"
    paid = False
    fetch_pages = True
    ignore_window = False
    SKIP_MESSAGE = SKIP_MESSAGE

    def __init__(self, limiter=_LIMIT, sleep=time.sleep):
        self.limiter, self.sleep = limiter, sleep
        self.consecutive_429 = 0
        self.skipped = False

    def queries(self, company):
        names = query_for(company)
        adverse = [q for q in build(company) if q.kind == "adverse"]
        out = []
        for a in adverse:                         # one per language
            out.append(Query("name", names, a.langs))
            out.append(a)
        return out

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
        text = render(query) if isinstance(query, Query) else str(query)
        try:
            body = self._get(search_url(text, max_age.days if max_age else LOOKBACK_DAYS))
        except SourceError as exc:
            if exc.status == 429:
                self.consecutive_429 += 1
                if self.consecutive_429 >= MAX_CONSECUTIVE_429:
                    self.skipped = True
            else:
                self.consecutive_429 = 0
            raise
        self.consecutive_429 = 0
        return [i for i in parse(body) if within(i["source_date"], now, max_age)]
