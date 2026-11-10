"""Google News RSS search, a supporting free source: one request per query and language.
English: https://news.google.com/rss/search?q=<q>&hl=en-CA&gl=CA&ceid=CA:en
French:  https://news.google.com/rss/search?q=<q>&hl=fr-CA&gl=CA&ceid=CA:fr
pubDate is when Google indexed the story, not when it was written (the Dynamic Capital 2009 page carried a 2026
pubDate), so it is kept as source_date only; published_at comes from the article page (date check). Links are Google
redirects; sources/google_links.py resolves them to the publisher where it can."""
import datetime as dt
import email.utils
import html
import re
import urllib.parse
import xml.etree.ElementTree as ET

from queries import Query, boolean_text, build, per_language
from .base import item, within
from .net import LOOKBACK_DAYS, RateLimiter, SourceError, get

BASE = "https://news.google.com/rss/search"
EDITIONS = {"en": "hl=en-CA&gl=CA&ceid=CA:en", "fr": "hl=fr-CA&gl=CA&ceid=CA:fr"}
MAX_ITEMS = 50
_LIMIT = RateLimiter(2.0)             # a short pause between requests


def search_url(q, lang="en"):
    return f"{BASE}?q={urllib.parse.quote(q, safe='')}&{EDITIONS.get(lang, EDITIONS['en'])}"


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


def parse(body, now, max_age=dt.timedelta(days=LOOKBACK_DAYS), lang=None):
    """Items whose index date is inside the window (a story cannot be published after Google indexed it, so an index
    date before the window means the story is older too)."""
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
        seen = _date(el.findtext("pubDate"))
        if not within(seen, now, max_age):
            continue
        items.append(item(title, url, publisher, None, seen, _strip_html(el.findtext("description")), "", lang))
        if len(items) >= MAX_ITEMS:
            break
    return items


class GoogleNews:
    name = "google_news"
    paid = False
    fetch_pages = True
    ignore_window = False

    def __init__(self, limiter=_LIMIT):
        self.limiter = limiter

    def queries(self, company):
        return per_language(build(company))

    def fetch(self, query, now, max_age=dt.timedelta(days=LOOKBACK_DAYS)):
        if isinstance(query, str):
            query = Query("name", query, ("en",))
        lang = query.langs[0]
        return parse(get(search_url(boolean_text(query, and_word=" "), lang), self.limiter), now, max_age, lang)
