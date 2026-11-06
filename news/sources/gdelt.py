"""GDELT DOC 2.0 article list: one request per company, the name and aliases quoted and OR-ed, last 7 days.
https://api.gdeltproject.org/api/v2/doc/doc?query=<"name">&mode=artlist&format=json&maxrecords=50&timespan=7d
GDELT asks for at most one request every 5 seconds."""
import datetime as dt
import json
import urllib.parse

from .net import RateLimiter, SourceError, get

BASE = "https://api.gdeltproject.org/api/v2/doc/doc"
_LIMIT = RateLimiter(5.5)


def query_for(company):
    from match import terms
    quoted = [f'"{t.rstrip(".")}"' for t in terms(company)]
    return quoted[0] if len(quoted) == 1 else "(" + " OR ".join(quoted) + ")"


def search_url(query):
    return f"{BASE}?query={urllib.parse.quote(query, safe='')}&mode=artlist&format=json&maxrecords=50&timespan=7d"


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
    name = "gdelt"

    def __init__(self, limiter=_LIMIT):
        self.limiter = limiter

    def queries(self, company):
        return [query_for(company)]

    def fetch(self, query, now):
        return parse(get(search_url(query), self.limiter))
