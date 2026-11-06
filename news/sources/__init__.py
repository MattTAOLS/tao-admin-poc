"""News sources. Each one has `name`, `queries(company)` (what to ask for one company) and `fetch(query, now)` (items for
one query, or SourceError). An item is a dict: title, url, publisher, published_at (aware datetime or None), description."""
import os

from . import fixture, gdelt, google_news

KNOWN = {"google_news": google_news.GoogleNews, "gdelt": gdelt.Gdelt}


def for_run(feed_sources, env=os.environ):
    """(sources, errors). NEWS_SOURCE=fixture replaces every configured source with the fixture file."""
    if env.get("NEWS_SOURCE", "").strip().lower() == "fixture":
        return [fixture.Fixture(env.get("NEWS_FIXTURE", ""))], []
    out, errors = [], []
    for name in feed_sources:
        if name in KNOWN:
            out.append(KNOWN[name]())
        else:
            errors.append({"company_slug": None, "source": str(name), "message": "unknown source in company_feeds"})
    return out, errors
