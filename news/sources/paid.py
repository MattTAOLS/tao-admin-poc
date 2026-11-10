"""The paid sources (decision E1), built from each provider's published API documentation and tested against recorded
responses shaped from it (news/fixtures/providers/). Each is proven live only when a client key is entered; System
settings > News sources > Test connection exists for that.

Event Registry (newsapi.ai): POST https://eventregistry.org/api/v1/article/getArticles, apiKey in the JSON body.
  `date` + `time` are the publishing date and time (confirmed); `dateTimePub` is when it was first seen (source_date).
NewsCatcher v3: GET https://v3-api.newscatcherapi.com/api/search, header x-api-token. `published_date` is the
  publication date (confirmed); `parse_date` is the crawl date (source_date). Free plan: 1 request per second.
Brave Search: GET https://api.search.brave.com/res/v1/news/search and /res/v1/web/search, header
  X-Subscription-Token. `page_age` is not a publication date: source_date only.
Dow Jones (Factiva) and LexisNexis (Nexis Data+): documentation is released only to contracted clients, so these are
  slots that refuse until a client supplies it."""
import datetime as dt
import urllib.parse

from queries import boolean_text, per_language
from .base import PaidSource, item, lang_code, parse_dt, within
from .net import RateLimiter, SourceError, get_json, post_json

NEEDS_DOCS = "Needs the client's API documentation"


def _company_queries(company):
    from queries import build
    return build(company)


# --- Event Registry ----------------------------------------------------------------------------------------------

ER_URL = "https://eventregistry.org/api/v1/article/getArticles"
ER_LANG = {"en": "eng", "fr": "fra"}        # ISO 639-3, as Event Registry's lang filter uses


class EventRegistry(PaidSource):
    name = "event_registry"
    provider = "event_registry"
    REQUIRED = ("api_key",)
    page_size = 100

    def __init__(self, secrets=None, config=None, limiter=None):
        super().__init__(secrets, config, limiter or RateLimiter(1.0))

    def queries(self, company):
        return _company_queries(company)          # one request covers every language

    def body(self, query, now, window):
        start = (now - window).date().isoformat() if window else None
        langs = [ER_LANG[x] for x in query.langs if x in ER_LANG]
        common = {"apiKey": self.secrets.get("api_key"), "resultType": "articles", "articlesSortBy": "date",
                  "articlesCount": self.page_size, "articlesPage": 1, "isDuplicateFilter": "skipDuplicates"}
        if query.kind != "adverse":
            b = dict(common, keyword=query.term, keywordLoc="title,body", keywordSearchMode="phrase", lang=langs,
                     dateEnd=now.date().isoformat())
            if start:
                b["dateStart"] = start
            return b
        # name AND (any adverse term): the advanced query language ($query / $and / $or).
        parts = [{"keyword": query.term, "keywordLoc": "title,body", "keywordSearchMode": "phrase"},
                 {"$or": [{"keyword": t, "keywordLoc": "title,body"} for t in query.adverse]},
                 {"lang": langs[0] if len(langs) == 1 else {"$or": langs}}]
        if start:
            parts.append({"dateStart": start, "dateEnd": now.date().isoformat()})
        return dict(common, query={"$query": {"$and": parts}})

    def _fetch(self, query, now, window):
        data = post_json(ER_URL, self.body(query, now, window), self.limiter)
        return parse_event_registry(data, now, window)


def parse_event_registry(data, now=None, window=None):
    if isinstance(data, dict) and data.get("error"):
        raise SourceError(f"Event Registry: {data['error']}")
    results = (((data or {}).get("articles") or {}).get("results")) or []
    out = []
    for a in results:
        published = None
        if a.get("date"):
            published = parse_dt(f"{a['date']}T{a.get('time') or '00:00:00'}Z")
        it = item(a.get("title"), a.get("url"), ((a.get("source") or {}).get("title")), published,
                  parse_dt(a.get("dateTimePub")), (a.get("body") or "")[:400], a.get("body") or "",
                  lang_code(a.get("lang")))
        if it["title"] and it["url"] and (now is None or within(published, now, window)):
            out.append(it)
    return out


# --- NewsCatcher v3 ----------------------------------------------------------------------------------------------

NC_URL = "https://v3-api.newscatcherapi.com/api/search"


class NewsCatcher(PaidSource):
    name = "newscatcher"
    provider = "newscatcher"
    REQUIRED = ("api_key",)
    page_size = 100

    def __init__(self, secrets=None, config=None, limiter=None):
        super().__init__(secrets, config, limiter or RateLimiter(1.1))      # free plan: 1 request per second

    def queries(self, company):
        return _company_queries(company)

    def params(self, query, now, window):
        p = {"q": boolean_text(query), "lang": ",".join(query.langs), "to_": now.strftime("%Y-%m-%d %H:%M:%S"),
             "page_size": self.page_size, "page": 1, "sort_by": "date"}
        if window:
            p["from_"] = (now - window).strftime("%Y-%m-%d %H:%M:%S")
        return p

    def _fetch(self, query, now, window):
        url = NC_URL + "?" + urllib.parse.urlencode(self.params(query, now, window))
        data = get_json(url, self.limiter, headers={"x-api-token": self.secrets.get("api_key")})
        return parse_newscatcher(data, now, window)


def parse_newscatcher(data, now=None, window=None):
    if isinstance(data, dict) and data.get("status") not in (None, "ok") and not data.get("articles"):
        raise SourceError(f"NewsCatcher: {data.get('message') or data.get('status')}")
    out = []
    for a in (data or {}).get("articles") or []:
        published = parse_dt(a.get("published_date"))
        it = item(a.get("title"), a.get("link"), a.get("name_source") or a.get("domain_url"), published,
                  parse_dt(a.get("parse_date")), a.get("description") or "", a.get("content") or "",
                  lang_code(a.get("language")))
        if it["title"] and it["url"] and (now is None or within(published, now, window)):
            out.append(it)
    return out


# --- Brave Search ------------------------------------------------------------------------------------------------

BRAVE_NEWS = "https://api.search.brave.com/res/v1/news/search"
BRAVE_WEB = "https://api.search.brave.com/res/v1/web/search"


def brave_freshness(now, window):
    if window is None:
        return None
    if window <= dt.timedelta(days=7):
        return "pw"
    return f"{(now - window).date().isoformat()}to{now.date().isoformat()}"


class _Brave(PaidSource):
    provider = "brave"
    REQUIRED = ("api_key",)
    URL = None
    MAX_COUNT = 20

    def __init__(self, secrets=None, config=None, limiter=None):
        super().__init__(secrets, config, limiter or RateLimiter(1.1))
        self.count = self.MAX_COUNT

    def queries(self, company):
        return per_language(_company_queries(company))      # search_lang takes one language

    def params(self, query, now, window):
        p = {"q": boolean_text(query, and_word=" "), "search_lang": query.langs[0], "country": "CA",
             "count": min(self.count, self.MAX_COUNT), "extra_snippets": "true"}
        fresh = brave_freshness(now, window)
        if fresh:
            p["freshness"] = fresh
        return p

    def _fetch(self, query, now, window):
        url = self.URL + "?" + urllib.parse.urlencode(self.params(query, now, window))
        data = get_json(url, self.limiter, headers={"X-Subscription-Token": self.secrets.get("api_key")})
        return parse_brave(data, query.langs[0], now, window)


class BraveNews(_Brave):
    name = "brave_news"
    URL = BRAVE_NEWS
    MAX_COUNT = 50


class BraveWeb(_Brave):
    name = "brave_web"
    URL = BRAVE_WEB
    MAX_COUNT = 20


def parse_brave(data, lang=None, now=None, window=None):
    if isinstance(data, dict) and data.get("type") == "ErrorResponse":
        err = data.get("error") or {}
        raise SourceError(f"Brave: {err.get('detail') or err.get('code') or 'error'}")
    results = (data or {}).get("results")
    if results is None:
        results = ((data or {}).get("web") or {}).get("results") or []
    out = []
    for r in results:
        seen = parse_dt(r.get("page_age"))
        snippets = [r.get("description") or ""] + list(r.get("extra_snippets") or [])
        it = item(r.get("title"), r.get("url"), ((r.get("meta_url") or {}).get("hostname")), None, seen,
                  r.get("description") or "", " ".join(s for s in snippets if s), lang)
        it["title"] = _strip_tags(it["title"])
        it["description"] = _strip_tags(it["description"])
        it["text"] = _strip_tags(it["text"])
        if it["title"] and it["url"] and (now is None or within(seen, now, window)):
            out.append(it)
    return out


def _strip_tags(s):
    import html
    import re
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


# --- Dow Jones and LexisNexis: slots only ------------------------------------------------------------------------

class _NeedsDocs(PaidSource):
    REQUIRED = ()

    def queries(self, company):
        return _company_queries(company)

    def _fetch(self, query, now, window):
        raise SourceError(NEEDS_DOCS)


class DowJones(_NeedsDocs):
    name = "dow_jones"
    provider = "dow_jones"


class LexisNexis(_NeedsDocs):
    name = "lexisnexis"
    provider = "lexisnexis"


PROVIDERS = {"event_registry": [EventRegistry], "newscatcher": [NewsCatcher], "brave": [BraveNews, BraveWeb],
             "dow_jones": [DowJones], "lexisnexis": [LexisNexis]}


def build(provider, secrets, config):
    """The source objects for one provider row. Brave yields brave_news and/or brave_web per config flags news / web
    (default news on, web off)."""
    classes = PROVIDERS.get(provider)
    if not classes:
        raise SourceError(f"unknown provider {provider}")
    if provider == "brave":
        cfg = config or {}
        classes = ([BraveNews] if cfg.get("news", True) else []) + ([BraveWeb] if cfg.get("web", False) else [])
    return [c(secrets, config) for c in classes]


def archive_months(config):
    try:
        return int((config or {}).get("archive_months") or 0)
    except (TypeError, ValueError):
        return 0
