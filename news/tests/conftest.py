"""News worker tests: SQLite per test, no network (any real request fails the test)."""
import datetime as dt
import json
import pathlib
import socket
import sys
import urllib.request

import pytest

NEWS = pathlib.Path(__file__).resolve().parents[1]
if str(NEWS) not in sys.path:
    sys.path.insert(0, str(NEWS))

import store  # noqa: E402

FIXTURE = NEWS / "fixtures" / "example.json"
SEED = NEWS.parent / "seed" / "companies.json"
UTC = dt.timezone.utc


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def refuse(*a, **k):
        raise AssertionError("network access in a test")
    monkeypatch.setattr(urllib.request, "urlopen", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)


@pytest.fixture
def eng(tmp_path):
    e = store.engine(f"sqlite:///{(tmp_path / 'news.sqlite').as_posix()}")
    store.create_all(e)
    companies = json.loads(SEED.read_text(encoding="utf-8"))
    with e.begin() as c:
        for co in companies:
            c.execute(store.company.insert().values(slug=co["slug"], name=co["name"], aliases=co["aliases"]))
    return e


def set_feeds(eng, **value):
    with eng.begin() as c:
        c.execute(store.system_setting.delete().where(store.system_setting.c.key == "company_feeds"))
        c.execute(store.system_setting.insert().values(key="company_feeds", value=value))


class Clock:
    def __init__(self, start):
        self.t = start

    def __call__(self):
        return self.t

    def advance(self, **kw):
        self.t += dt.timedelta(**kw)
