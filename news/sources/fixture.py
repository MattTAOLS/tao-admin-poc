"""Fixture source for tests and the e2e demo: NEWS_SOURCE=fixture, NEWS_FIXTURE=<path to a JSON file>. Every item in the
file is offered for every company; the normal matcher decides which company it belongs to. Format: news/README.md.

No network: article pages are never fetched (fetch_pages False) and items are never dropped for age (ignore_window),
so the demo keeps its outcomes whatever the date. An item may carry `_check` (the labelled stand-in for the Claude
answer, used when NEWS_CHECK=fixture) and `_date_status` (confirmed / source_only / unknown; default confirmed when
published_at is set, else unknown)."""
import datetime as dt
import json
import pathlib
import re

from .base import item
from .net import SourceError

_REL = re.compile(r"^-(\d+)([dhm])$")


def _date(value, now):
    if value in (None, ""):
        return None
    m = _REL.match(str(value).strip())
    if m:
        n, unit = int(m.group(1)), m.group(2)
        return now - {"d": dt.timedelta(days=n), "h": dt.timedelta(hours=n), "m": dt.timedelta(minutes=n)}[unit]
    d = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return d.replace(tzinfo=dt.timezone.utc) if d.tzinfo is None else d


class Fixture:
    name = "fixture"
    paid = False
    fetch_pages = False
    ignore_window = True

    def __init__(self, path):
        self.path = path
        self._data = None

    def _load(self):
        if self._data is None:
            if not self.path:
                raise SourceError("NEWS_FIXTURE is not set")
            p = pathlib.Path(self.path)
            if not p.is_file():
                raise SourceError(f"fixture file not found: {self.path}")
            try:
                self._data = json.loads(p.read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc:
                raise SourceError(f"fixture is not JSON: {exc}") from exc
        return self._data

    def queries(self, company):
        return [company["slug"]]

    def fetch(self, query, now, max_age=None):
        data = self._load()
        if query in (data.get("fail_companies") or []):
            raise SourceError("fixture: simulated source failure")
        items = []
        for it in data.get("items") or []:
            when = _date(it.get("published_at"), now)
            status = it.get("_date_status") or ("confirmed" if when else "unknown")
            published = when if status == "confirmed" else None
            source_date = when if status == "source_only" else None
            x = item(it["title"], it["url"], it.get("publisher"), published, source_date, it.get("description") or "",
                     "", it.get("language") or "en")
            x["_date_status"] = status
            if isinstance(it.get("_check"), dict):
                x["_check"] = dict(it["_check"])
            items.append(x)
        return items
