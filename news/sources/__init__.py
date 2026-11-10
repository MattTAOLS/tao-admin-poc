"""News sources. Each one has `name`, `queries(company)` (what to ask for one company), `fetch(query, now, window)`
(items for one query, or SourceError), and the flags `paid`, `fetch_pages` (read article pages in the date check) and
`ignore_window` (fixture only). Item format: sources/base.py.

Free sources come from company_feeds.sources; paid sources from the enabled news_source rows, with the client's
credentials decrypted for this run only."""
import os

from credentials import CredentialError, decrypt
from . import fixture, gdelt, google_news, paid as paid_mod

KNOWN = {"google_news": google_news.GoogleNews, "gdelt": gdelt.Gdelt}


def load_paid(rows, env=os.environ):
    """(providers, errors) from news_source rows: the enabled ones with their secrets decrypted. A provider whose
    credentials cannot be read is left out with one run error; the message never holds a secret."""
    out, errors = [], []
    key = (env.get("NEWS_SECRET_KEY") or "").strip()
    for r in rows:
        if not r.get("enabled"):
            continue
        try:
            secrets = decrypt(r.get("secrets_enc"), key) if r.get("secrets_enc") else {}
        except CredentialError as exc:
            errors.append({"company_slug": None, "source": r["provider"], "message": str(exc)})
            continue
        out.append({"provider": r["provider"], "config": dict(r.get("config") or {}), "secrets": secrets})
    return out, errors


def has_archive(paid):
    """An enabled paid source with an archive plan of at least 12 months: the first search goes back 12 months."""
    return any(paid_mod.archive_months(p.get("config")) >= 12 for p in paid or ())


def for_run(feed_sources, env=os.environ, paid=()):
    """(sources, errors). NEWS_SOURCE=fixture replaces every configured source, free and paid, with the fixture file."""
    if env.get("NEWS_SOURCE", "").strip().lower() == "fixture":
        return [fixture.Fixture(env.get("NEWS_FIXTURE", ""))], []
    out, errors = [], []
    for name in feed_sources:
        if name in KNOWN:
            out.append(KNOWN[name]())
        elif name not in paid_mod.PROVIDERS and name not in ("brave_news", "brave_web"):
            errors.append({"company_slug": None, "source": str(name), "message": "unknown source in company_feeds"})
    for p in paid:
        if p["provider"] in ("dow_jones", "lexisnexis"):
            errors.append({"company_slug": None, "source": p["provider"], "message": paid_mod.NEEDS_DOCS})
            continue
        try:
            out += paid_mod.build(p["provider"], p["secrets"], p["config"])
        except Exception as exc:
            errors.append({"company_slug": None, "source": p["provider"], "message": str(exc)[:300]})
    return out, errors
