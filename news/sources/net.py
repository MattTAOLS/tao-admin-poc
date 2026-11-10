"""Polite HTTP for every source: standard library only, a timeout, a plain User-Agent naming the app, no cookies and
no personal data, and a minimum gap between requests per source. Secrets (paid API keys) travel only in headers or
request bodies, never in a URL, and never in the message of a SourceError (see secrets.scrub)."""
import datetime as dt
import json
import threading
import time
import urllib.error
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


def request(url, limiter=None, timeout=TIMEOUT, method="GET", headers=None, data=None, max_bytes=MAX_BYTES,
            truncate=False):
    """(final_url, body bytes, content_type). `data`: bytes for a POST. `truncate`: read at most max_bytes and keep
    them (article pages) instead of failing on a larger response."""
    if limiter is not None:
        limiter.wait()
    h = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    h.update(headers or {})
    req = urllib.request.Request(url, headers=h, data=data, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status = getattr(resp, "status", 200)
            body = resp.read(max_bytes + 1)
            final = resp.geturl() if hasattr(resp, "geturl") else url
            ctype = ""
            try:
                ctype = resp.headers.get("Content-Type", "") or ""
            except Exception:
                pass
    except AssertionError:                          # tests forbid the network this way; never swallow it
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
