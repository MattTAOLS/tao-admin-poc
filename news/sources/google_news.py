"""Google News RSS search: one quoted query per company name and alias.
https://news.google.com/rss/search?q=<"name">&hl=en-CA&gl=CA&ceid=CA:en"""
import datetime as dt
import email.utils
import html
import re
import urllib.parse
import xml.etree.ElementTree as ET

from .net import RateLimiter, SourceError, get

BASE = "https://news.google.com/rss/search"
MAX_AGE = dt.timedelta(days=7)        # the feed returns older stories too; keep the last week, as GDELT does
MAX_ITEMS = 50
_LIMIT = RateLimiter(2.0)             # a short pause between requests


def search_url(term):
    q = urllib.parse.quote(f'"{term}"', safe="")
    return f"{BASE}?q={q}&hl=en-CA&gl=CA&ceid=CA:en"


def _strip_html(s):
    return html.unescape(re.sub(r"<[^>]+>", " ", s or "")).replace("\xa0", " ").strip()


def _date(s):
    if not s:
        return None
    try:
        d = email.utils.parsedate_to_datetime(s)
    except (TypeError, ValueError):
        return None
    return d.replace(tzinfo=dt.timezone.utc) if d.tzinfo is None else d.astimezone(dt.timezone.utc)


def parse(body, now):
    try:
        root = ET.fromstring(body)
    except ET.ParseError as exc:
        raise SourceError(f"not RSS: {exc}") from exc
    items = []
    for el in root.iter("item"):
        title = (el.findtext("title") or "").strip()
        url = (el.findtext("link") or "").strip()
        if not title or not url:
            continue
        publisher = (el.findtext("source") or "").strip() or None
        if publisher and title.endswith(f" - {publisher}"):
            title = title[: -len(f" - {publisher}")].strip()
        published = _date(el.findtext("pubDate"))
        if published is not None and now - published > MAX_AGE:
            continue
        items.append({"title": title, "url": url, "publisher": publisher, "published_at": published,
                      "description": _strip_html(el.findtext("description"))})
        if len(items) >= MAX_ITEMS:
            break
    return items


class GoogleNews:
    name = "google_news"

    def __init__(self, limiter=_LIMIT):
        self.limiter = limiter

    def queries(self, company):
        from match import terms
        return terms(company)

    def fetch(self, query, now):
        return parse(get(search_url(query), self.limiter), now)
