"""Polite HTTP for the free sources: standard library only, a timeout, a plain User-Agent naming the app, no cookies and
no personal data, and a minimum gap between requests per source."""
import threading
import time
import urllib.request

USER_AGENT = "tao-admin-poc news worker"
TIMEOUT = 20
MAX_BYTES = 5 * 1024 * 1024


class SourceError(Exception):
    """One request to a source failed; the run records it and goes on."""


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
    except Exception as exc:                       # HTTPError, URLError, timeout
        raise SourceError(f"{type(exc).__name__}: {exc}") from exc
    if status >= 400:
        raise SourceError(f"HTTP {status}")
    if len(body) > MAX_BYTES:
        raise SourceError("response too large")
    return body
