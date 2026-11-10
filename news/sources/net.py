"""Polite HTTP for every source: standard library only, a timeout, a plain User-Agent naming the app, no cookies and
no personal data, and a minimum gap between requests per source. Secrets (paid API keys) travel only in headers or
request bodies, never in a URL, and never in the message of a SourceError (see secrets.scrub).

Two protections for URLs that come from the web rather than from this code (article pages, Google link resolution):
  - `guard` (PublicOnly): before the request and on every redirect hop, only http and https, and only hosts that
    resolve to public addresses. Loopback, private, link-local, unique-local, multicast and unspecified addresses and
    hostnames without a dot (compose service names: postgres, api, redis) are refused, so an article link cannot make
    the worker read an internal page (audit M10). The address actually connected to is checked as well.
  - `deadline`: a total wall-clock limit for the whole fetch (connect, redirects, headers and body), because the
    socket timeout only limits each read (audit M11).
The provider API hosts are fixed in the code and use neither."""
import datetime as dt
import http.client
import ipaddress
import json
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

USER_AGENT = "tao-admin-poc news worker"
TIMEOUT = 20
MAX_BYTES = 5 * 1024 * 1024

# Search windows (decision E4). A company with no news_item rows yet is a first search: FIRST_ARCHIVE_DAYS when an
# enabled paid source has an archive plan (config.archive_months >= 12), else FIRST_LOOKBACK_DAYS. Later runs:
# LOOKBACK_DAYS, so late-indexed stories and a missed run leave no hole.
FIRST_LOOKBACK_DAYS = 90
FIRST_ARCHIVE_DAYS = 365
LOOKBACK_DAYS = 7


def lookback(first, archive=False):
    if not first:
        return dt.timedelta(days=LOOKBACK_DAYS)
    return dt.timedelta(days=FIRST_ARCHIVE_DAYS if archive else FIRST_LOOKBACK_DAYS)


class SourceError(Exception):
    """One request to a source failed; the run records it and goes on. `status` is the HTTP status, if any."""

    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


class SourceSkipped(SourceError):
    """The source gave up for the rest of this run (for example rate-limited); the run records it once."""


class RateLimiter:
    def __init__(self, min_interval, clock=time.monotonic, sleep=time.sleep):
        self.min_interval = min_interval
        self.clock, self.sleep = clock, sleep
        self._last = None
        self._lock = threading.Lock()

    def wait(self):
        with self._lock:
            if self._last is not None:
                gap = self.min_interval - (self.clock() - self._last)
                if gap > 0:
                    self.sleep(gap)
            self._last = self.clock()


def _error_text(exc):
    """A short provider message from an HTTP error body (JSON `error`/`message`/`detail`), else the reason."""
    try:
        raw = exc.read(4096).decode("utf-8", "replace")
    except Exception:
        raw = ""
    msg = ""
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            for k in ("error", "message", "detail", "msg"):
                v = data.get(k)
                if isinstance(v, dict):
                    v = v.get("message") or v.get("detail") or json.dumps(v)
                if v:
                    msg = str(v)
                    break
    except (ValueError, TypeError):
        msg = " ".join(raw.split())[:200] if raw and not raw.lstrip().startswith("<") else ""
    return msg or str(getattr(exc, "reason", "") or "")


class Refused(SourceError):
    """The URL may not be fetched: not http(s), or its host is not a public internet address."""


def _public(address):
    try:
        ip = ipaddress.ip_address(str(address).split("%")[0])
    except ValueError:
        return False
    if getattr(ip, "ipv4_mapped", None) is not None:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


class PublicOnly:
    """The guard for URLs taken from the web. `check(url)` raises Refused unless the URL is http(s) on a host whose
    every address is public. `allow` exempts exact "host:port" pairs; it exists for the tests (a server on loopback)
    and is only ever set in code, never from the environment or a setting."""

    def __init__(self, resolve=socket.getaddrinfo, allow=()):
        self.resolve = resolve
        self.allow = {a.lower() for a in allow}
        self._checked = set()

    def check(self, url):
        try:
            p = urllib.parse.urlsplit(url)
            host = (p.hostname or "").lower().rstrip(".")
            port = p.port or (443 if p.scheme.lower() == "https" else 80)
        except ValueError:
            raise Refused("not a valid URL") from None
        if p.scheme.lower() not in ("http", "https"):
            raise Refused("only http and https links are read")
        if not host:
            raise Refused("the link has no host")
        if f"{host}:{port}" in self.allow:
            return
        try:
            addresses = [str(ipaddress.ip_address(host))]
        except ValueError:
            if "." not in host or host.endswith((".localhost", ".local", ".internal")):
                raise Refused("the host is not a public internet name") from None
            try:
                addresses = [info[4][0] for info in self.resolve(host, port, type=socket.SOCK_STREAM)]
            except OSError as exc:
                raise SourceError(f"the host could not be resolved ({type(exc).__name__})") from None
        if not addresses or not all(_public(a) for a in addresses):
            raise Refused("the host is not a public internet address")
        self._checked.add(host)

    def peer_ok(self, host, port, address):
        """The address a connection really reached (a name can resolve differently the second time)."""
        host = (host or "").lower().rstrip(".")
        if f"{host}:{port}" in self.allow or host not in self._checked:      # not checked: a configured proxy
            return True
        return _public(address)


PUBLIC = PublicOnly()


def _guarded(base, guard):
    class Connection(base):
        def connect(self):
            super().connect()
            try:
                address = self.sock.getpeername()[0]
            except (OSError, AttributeError):
                return
            if not guard.peer_ok(self.host, self.port, address):
                self.close()
                raise Refused("the host is not a public internet address")
    return Connection


class _Redirects(urllib.request.HTTPRedirectHandler):
    def __init__(self, guard):
        self.guard = guard

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        self.guard.check(newurl)                      # every hop, before it is requested
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class _Http(urllib.request.HTTPHandler):
    def __init__(self, guard):
        super().__init__()
        self.guard = guard

    def http_open(self, req):
        return self.do_open(_guarded(http.client.HTTPConnection, self.guard), req)


class _Https(urllib.request.HTTPSHandler):
    def __init__(self, guard):
        super().__init__()
        self.guard = guard

    def https_open(self, req):
        return self.do_open(_guarded(http.client.HTTPSConnection, self.guard), req,
                            context=getattr(self, "_context", None))


def _open(req, timeout, guard):
    if guard is None:
        return urllib.request.urlopen(req, timeout=timeout)
    return urllib.request.build_opener(_Http(guard), _Https(guard), _Redirects(guard)).open(req, timeout=timeout)


def _read(resp, limit, end):
    """Up to `limit` bytes. With a deadline: in pieces, giving up when the time is over."""
    if end is None:
        return resp.read(limit)
    chunks, size = [], 0
    while size < limit:
        if time.monotonic() >= end:
            raise SourceError("the response took too long")
        chunk = resp.read1(min(65536, limit - size))
        if not chunk:
            break
        chunks.append(chunk)
        size += len(chunk)
    return b"".join(chunks)


def request(url, limiter=None, timeout=TIMEOUT, method="GET", headers=None, data=None, max_bytes=MAX_BYTES,
            truncate=False, guard=None, deadline=None):
    """(final_url, body bytes, content_type). `data`: bytes for a POST. `truncate`: read at most max_bytes and keep
    them (article pages) instead of failing on a larger response. `guard`: a PublicOnly for a URL that came from the
    web; a refused URL raises Refused (a SourceError). `deadline`: seconds for the whole fetch; past it the fetch is
    abandoned with a SourceError, whatever the server is doing."""
    if limiter is not None:
        limiter.wait()
    if guard is not None:
        guard.check(url)
    args = (url, timeout, method, headers, data, max_bytes, truncate, guard)
    if deadline is None:
        return _fetch(*args, None)
    end = time.monotonic() + deadline
    box = {}

    def work():
        try:
            box["out"] = _fetch(*args, end)
        except BaseException as exc:              # handed to the caller, the tests' AssertionError included
            box["exc"] = exc
    worker = threading.Thread(target=work, name="news-fetch", daemon=True)
    worker.start()
    worker.join(deadline)
    if worker.is_alive():                         # the thread ends by itself at its next read (see _read)
        raise SourceError(f"no complete response within {deadline:g} seconds")
    if "exc" in box:
        raise box["exc"]
    return box["out"]


def _fetch(url, timeout, method, headers, data, max_bytes, truncate, guard, end):
    h = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    h.update(headers or {})
    req = urllib.request.Request(url, headers=h, data=data, method=method)
    if end is not None:
        timeout = max(0.05, min(timeout, end - time.monotonic()))
    try:
        with _open(req, timeout, guard) as resp:
            status = getattr(resp, "status", 200)
            body = _read(resp, max_bytes + 1, end)
            final = resp.geturl() if hasattr(resp, "geturl") else url
            ctype = ""
            try:
                ctype = resp.headers.get("Content-Type", "") or ""
            except Exception:
                pass
    except AssertionError:                          # tests forbid the network this way; never swallow it
        raise
    except SourceError:                             # a refused redirect hop, or the deadline
        raise
    except urllib.error.HTTPError as exc:
        detail = _error_text(exc)
        raise SourceError(f"HTTP {exc.code}" + (f": {detail}" if detail else ""), status=exc.code) from exc
    except Exception as exc:                       # URLError, timeout
        raise SourceError(f"{type(exc).__name__}: {exc}") from exc
    if status >= 400:
        raise SourceError(f"HTTP {status}", status=status)
    if len(body) > max_bytes:
        if not truncate:
            raise SourceError("response too large")
        body = body[:max_bytes]
    return final or url, body, ctype


def get(url, limiter=None, timeout=TIMEOUT):
    return request(url, limiter, timeout)[1]


def get_json(url, limiter=None, headers=None, timeout=TIMEOUT):
    body = request(url, limiter, timeout, headers=dict({"Accept": "application/json"}, **(headers or {})))[1]
    return _json(body)


def post_json(url, payload, limiter=None, headers=None, timeout=TIMEOUT):
    h = {"Accept": "application/json", "Content-Type": "application/json"}
    h.update(headers or {})
    body = request(url, limiter, timeout, method="POST", headers=h, data=json.dumps(payload).encode("utf-8"))[1]
    return _json(body)


def _json(body):
    try:
        return json.loads(body.decode("utf-8", "replace"))
    except ValueError as exc:
        raise SourceError(f"bad JSON: {exc}") from exc
