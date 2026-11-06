"""Polite HTTP for the free sources: standard library only, a timeout, a plain User-Agent naming the app, no cookies and
no personal data, and a minimum gap between requests per source."""
import datetime as dt
import threading
import time
import urllib.error
import urllib.request

USER_AGENT = "tao-admin-poc news worker"
TIMEOUT = 20
MAX_BYTES = 5 * 1024 * 1024

# Look-back: a company with no news_item rows yet keeps items up to FIRST_LOOKBACK_DAYS old; after that LOOKBACK_DAYS.
FIRST_LOOKBACK_DAYS = 90
LOOKBACK_DAYS = 7


def lookback(first):
    return dt.timedelta(days=FIRST_LOOKBACK_DAYS if first else LOOKBACK_DAYS)


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


def get(url, limiter=None, timeout=TIMEOUT):
    if limiter is not None:
        limiter.wait()
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status = getattr(resp, "status", 200)
            body = resp.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as exc:
        raise SourceError(f"HTTP {exc.code}: {exc.reason}", status=exc.code) from exc
    except Exception as exc:                       # URLError, timeout
        raise SourceError(f"{type(exc).__name__}: {exc}") from exc
    if status >= 400:
        raise SourceError(f"HTTP {status}", status=status)
    if len(body) > MAX_BYTES:
        raise SourceError("response too large")
    return body
