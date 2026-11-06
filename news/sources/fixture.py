"""Fixture source for tests and the e2e demo: NEWS_SOURCE=fixture, NEWS_FIXTURE=<path to a JSON file>. Every item in the
file is offered for every company; the normal matcher decides which company it belongs to. Format: news/README.md."""
import datetime as dt
import json
import pathlib
import re

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

    def fetch(self, query, now):
        data = self._load()
        if query in (data.get("fail_companies") or []):
            raise SourceError("fixture: simulated source failure")
        items = []
        for it in data.get("items") or []:
            items.append({"title": it["title"], "url": it["url"], "publisher": it.get("publisher"),
                          "published_at": _date(it.get("published_at"), now),
                          "description": it.get("description") or ""})
        return items
