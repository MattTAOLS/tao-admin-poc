"""What every source returns, and the shared helpers.

An item is a dict: title, url (the link the source gave; the publisher URL for the paid sources), publisher,
published_at (a CONFIRMED publication date from a provider field built for it, aware UTC, or None), source_date (the
date the source attached: Google pubDate, GDELT seendate, Brave page_age, a crawl or first-seen date), description
(the snippet), text (a longer body the provider returned, or ""), language ("en", "fr" or None)."""
import datetime as dt
import re

from credentials import scrub
from .net import SourceError

_LANGS = {"en": "en", "eng": "en", "english": "en", "fr": "fr", "fra": "fr", "fre": "fr", "french": "fr"}


def lang_code(value):
    return _LANGS.get(str(value or "").strip().lower())


def parse_dt(value):
    """An aware UTC datetime from an ISO-like string ("2026-11-05", "2026-11-05T14:00:00Z", "2026-11-05 14:00:00",
    "2026-11-05T14:00:00+0000"), else None."""
    if value in (None, ""):
        return None
    if isinstance(value, dt.datetime):
        d = value
    else:
        s = str(value).strip().replace("Z", "+00:00")
        s = re.sub(r"([+-]\d{2})(\d{2})$", r"\1:\2", s)
        try:
            d = dt.datetime.fromisoformat(s)
        except ValueError:
            try:
                d = dt.datetime.combine(dt.date.fromisoformat(s[:10]), dt.time())
            except ValueError:
                return None
    return d.replace(tzinfo=dt.timezone.utc) if d.tzinfo is None else d.astimezone(dt.timezone.utc)


def item(title, url, publisher=None, published_at=None, source_date=None, description="", text="", language=None):
    return {"title": (title or "").strip(), "url": (url or "").strip(), "publisher": publisher or None,
            "published_at": published_at, "source_date": source_date, "description": (description or "").strip(),
            "text": (text or "").strip(), "language": language}


def within(d, now, window):
    return d is None or window is None or now - d <= window


class PaidSource:
    """A source that runs on the client's credentials (news_source row). Every error leaving fetch() has its secret
    values scrubbed, so nothing in a run error or a test message can carry a key."""
    paid = True
    fetch_pages = True
    ignore_window = False
    provider = None
    REQUIRED = ()

    def __init__(self, secrets=None, config=None, limiter=None):
        self.secrets = dict(secrets or {})
        self.config = dict(config or {})
        self.limiter = limiter
        missing = [f for f in self.REQUIRED if not self.secrets.get(f)]
        self.missing = missing

    def secret_values(self):
        return list(self.secrets.values())

    def fetch(self, query, now, window=None):
        if self.missing:
            raise SourceError(f"{self.provider}: no {', '.join(self.missing)} stored")
        try:
            return self._fetch(query, now, window)
        except SourceError as exc:
            raise SourceError(scrub(str(exc), self.secret_values()), status=exc.status) from None
        except Exception as exc:
            raise SourceError(scrub(f"{type(exc).__name__}: {exc}", self.secret_values())) from None

    def _fetch(self, query, now, window):
        raise NotImplementedError
