"""Audit M10 and M11: article links and their redirects are fetched only from public hosts, and a fetch has a total
time limit. The servers here listen on loopback only; the guard's `allow` list (set in code, never from the
environment) lets a test reach its own first hop, and nothing else."""
import datetime as dt
import http.server
import socket
import threading
import time

import pytest

import check
import pages
from sources import google_links, net
from sources.net import PublicOnly, Refused, SourceError, request
from conftest import UTC, set_feeds
from test_pipeline import Fake, items, run, story

NOW = dt.datetime(2026, 11, 6, 17, 0, tzinfo=UTC)
REAL_CONNECT = socket.create_connection           # captured before the no_network fixture replaces it
PUBLIC_IP = "93.184.216.34"


def fake_dns(mapping):
    def resolve(host, port, type=None):
        if host not in mapping:
            raise socket.gaierror("unknown host")
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (a, port)) for a in mapping[host]]
    return resolve


def no_dns(host, port, type=None):
    raise AssertionError(f"DNS lookup for {host}")


class Servers:
    """An "internal" page and a public-looking page that redirects, drips or stalls. Loopback only."""

    def __init__(self):
        self.internal_hits = 0
        outer = self

        class Internal(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                outer.internal_hits += 1
                body = b"<html><body><p>" + b"INTERNAL ADMIN PAGE secret-token-123 " * 12 + b"</p></body></html>"
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        class Outside(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                try:
                    if self.path == "/drip":                    # a byte or two at a time, for ever
                        self.send_response(200)
                        self.send_header("Content-Type", "text/html")
                        self.end_headers()
                        for _ in range(100):
                            self.wfile.write(b"<p>x</p>")
                            self.wfile.flush()
                            time.sleep(0.2)
                        return
                    if self.path == "/stall":                   # headers never arrive in time
                        time.sleep(4)
                        self.send_response(200)
                        self.end_headers()
                        return
                    target = {"/to-loopback": f"http://127.0.0.1:{outer.internal}/admin",
                              "/to-service": "http://api:8000/api/v1/settings",
                              "/to-file": "file:///etc/passwd"}[self.path]
                    self.send_response(302)
                    self.send_header("Location", target)
                    self.end_headers()
                except OSError:
                    pass

        self._servers = [http.server.ThreadingHTTPServer(("127.0.0.1", 0), h) for h in (Internal, Outside)]
        for s in self._servers:
            s.daemon_threads = True
            threading.Thread(target=s.serve_forever, daemon=True).start()
        self.internal, self.outside = (s.server_address[1] for s in self._servers)
        self.guard = PublicOnly(resolve=no_dns, allow=(f"127.0.0.1:{self.outside}",))

    def url(self, path):
        return f"http://127.0.0.1:{self.outside}{path}"

    def close(self):
        for s in self._servers:
            s.shutdown()
            s.server_close()


@pytest.fixture
def servers(monkeypatch):
    monkeypatch.setattr(socket, "create_connection", REAL_CONNECT)       # loopback only, by the URLs used below
    s = Servers()
    yield s
    s.close()


# --- the guard itself ----------------------------------------------------------------------------------------------

@pytest.mark.parametrize("url", [
    "file:///etc/passwd", "ftp://example.com/a", "gopher://example.com/", "//example.com/a", "http:///a",
    "http://localhost/", "http://localhost:8000/", "http://postgres:5432/", "http://api:8000/", "http://redis/",
    "http://app.localhost/", "http://db.internal/", "http://printer.local/",
    "http://127.0.0.1/", "http://127.8.9.1:8000/", "http://10.0.0.5/", "http://172.16.4.1/", "http://192.168.1.10/",
    "http://169.254.169.254/latest/meta-data/", "http://0.0.0.0/", "http://100.64.0.1/", "http://224.0.0.1/",
    "http://[::1]/", "http://[::]/", "http://[fe80::1]/", "http://[fc00::1]/", "http://[fd12:3456::1]/",
    "http://[ff02::1]/", "http://[::ffff:127.0.0.1]/", "http://[::ffff:10.0.0.1]/", "http://2130706433/",
])
def test_non_public_urls_are_refused_without_a_lookup(url):
    with pytest.raises(Refused):
        PublicOnly(resolve=no_dns).check(url)


def test_names_are_judged_by_every_address_they_resolve_to():
    guard = PublicOnly(resolve=fake_dns({"news.example.com": [PUBLIC_IP], "intranet.example.com": ["10.1.2.3"],
                                         "mixed.example.com": [PUBLIC_IP, "127.0.0.1"], "six.example.com": ["fe80::1"],
                                         "0x7f.1": ["127.0.0.1"]}))
    guard.check("https://news.example.com/story")
    guard.check("http://NEWS.example.com.:80/story")
    guard.check(f"http://{PUBLIC_IP}/story")
    for host in ("intranet.example.com", "mixed.example.com", "six.example.com", "0x7f.1"):
        with pytest.raises(Refused):
            guard.check(f"https://{host}/")
    with pytest.raises(SourceError):                   # does not resolve: not readable, and not a Refused
        guard.check("https://nowhere.example.com/")


def test_the_page_reader_and_the_google_resolver_use_the_guard_and_the_total_deadline():
    seen = []

    def fake(url, **kw):
        seen.append(kw)
        return url, b"<html><body><p>hello</p></body></html>", "text/html"
    pages.read("https://example.com/x", NOW, http=fake)
    google_links.decode_online("CBMiABC", http=fake)
    assert len(seen) == 2
    for kw in seen:
        assert kw["guard"] is net.PUBLIC and kw["deadline"] == 10
    assert net.PUBLIC.allow == set()


# --- audit M10: redirects --------------------------------------------------------------------------------------------

def test_a_redirect_to_loopback_is_refused_and_the_internal_page_is_never_requested(servers):
    with pytest.raises(Refused):
        pages.read(servers.url("/to-loopback"), NOW, guard=servers.guard)
    assert servers.internal_hits == 0


def test_a_redirect_to_a_compose_service_name_or_a_file_is_refused(servers):
    with pytest.raises(Refused):
        pages.read(servers.url("/to-service"), NOW, guard=servers.guard)
    with pytest.raises(SourceError):                   # urllib itself follows redirects to http(s) only
        pages.read(servers.url("/to-file"), NOW, guard=servers.guard)


def test_the_first_url_is_checked_too(servers):
    with pytest.raises(Refused):
        pages.read(f"http://127.0.0.1:{servers.internal}/admin", NOW, guard=servers.guard)
    with pytest.raises(Refused):
        pages.read(servers.url("/to-loopback"), NOW)                 # the production guard allows nothing local
    assert servers.internal_hits == 0


def test_a_name_that_resolves_public_but_connects_to_loopback_is_refused(servers, monkeypatch):
    """DNS answering differently the second time: the address really reached is checked before the request is sent."""
    def rebound(address, *a, **k):
        return REAL_CONNECT(("127.0.0.1", servers.internal), *a, **k)
    monkeypatch.setattr(socket, "create_connection", rebound)
    guard = PublicOnly(resolve=fake_dns({"rebind.example.com": [PUBLIC_IP]}))
    with pytest.raises(Refused):
        request("http://rebind.example.com/admin", guard=guard, timeout=5)
    assert servers.internal_hits == 0


def test_a_refused_page_is_only_an_unreadable_page_the_story_keeps_its_snippet(eng, servers):
    set_feeds(eng, enabled=True, run_at="23:59")
    link = servers.url("/to-loopback")
    src = Fake("gdelt", {"tlfc": [story("TLFC wins a mandate", link, source_date=NOW - dt.timedelta(days=1),
                                        description="TLFC snippet from the search result")]})
    r = run(eng, [src], checker=check.FixtureChecker(),
            pages=lambda url, now: pages.read(url, now, guard=servers.guard))
    assert r["status"] == "ok" and r["errors"] == []
    [row] = items(eng)
    assert row["description"] == "TLFC snippet from the search result" and row["date_status"] == "source_only"
    assert servers.internal_hits == 0


# --- audit M11: a total time limit ----------------------------------------------------------------------------------

def test_a_slow_drip_is_abandoned_at_the_deadline(servers):
    start = time.monotonic()
    with pytest.raises(SourceError):
        request(servers.url("/drip"), timeout=5, max_bytes=1_500_000, truncate=True, guard=servers.guard,
                deadline=1)
    assert time.monotonic() - start < 2.5              # every read is quick; only the total is slow


def test_slow_headers_are_abandoned_at_the_deadline(servers):
    start = time.monotonic()
    with pytest.raises(SourceError):
        request(servers.url("/stall"), timeout=10, guard=servers.guard, deadline=1)
    assert time.monotonic() - start < 2.5


def test_a_page_that_drips_is_not_readable(servers, monkeypatch):
    monkeypatch.setattr(pages, "TIMEOUT", 1)
    start = time.monotonic()
    with pytest.raises(SourceError):
        pages.read(servers.url("/drip"), NOW, guard=servers.guard)
    assert time.monotonic() - start < 2.5
