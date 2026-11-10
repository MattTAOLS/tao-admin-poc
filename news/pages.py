"""Read an article page once (decision E3): its publication date from the page metadata and about 4,000 characters of
readable text for the Claude check. Standard library only (html.parser).

Date, first found wins: JSON-LD datePublished, meta article:published_time, og:published_time /
og:article:published_time, itemprop=datePublished, then the first <time datetime>. A date more than a day in the future
is ignored (a template or a wrong clock)."""
import datetime as dt
import json
import re
from html.parser import HTMLParser

from sources.base import parse_dt
from sources.net import SourceError, request

TIMEOUT = 10
MAX_BYTES = 1_500_000
TEXT_CHARS = 4000
SKIP = {"script", "style", "noscript", "template", "svg", "nav", "header", "footer", "aside", "form", "button",
        "iframe", "select"}
BLOCK = {"p", "div", "li", "h1", "h2", "h3", "h4", "br", "section", "article", "tr", "blockquote"}
META_DATE = ("article:published_time", "og:published_time", "og:article:published_time", "datepublished",
             "pubdate", "publishdate", "dc.date.issued", "parsely-pub-date", "sailthru.date")


class _Reader(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta = {}
        self.itemprop = None
        self.times = []
        self.ld = []
        self._ld_buf = None
        self.skip = 0
        self.parts = []
        self.para = []
        self._in_p = 0
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "meta":
            key = (a.get("property") or a.get("name") or "").strip().lower()
            if key and a.get("content") and key not in self.meta:
                self.meta[key] = a["content"].strip()
            if a.get("itemprop", "").lower() == "datepublished" and a.get("content") and not self.itemprop:
                self.itemprop = a["content"].strip()
            return
        if a.get("itemprop", "").lower() == "datepublished" and not self.itemprop:
            self.itemprop = a.get("datetime") or a.get("content") or None
        if tag == "time" and a.get("datetime"):
            self.times.append(a["datetime"].strip())
        if tag == "script":
            if "ld+json" in a.get("type", "").lower():
                self._ld_buf = []
            self.skip += 1
            return
        if tag == "title":
            self._in_title = True
        if tag in SKIP:
            self.skip += 1
        elif tag == "p":
            self._in_p += 1
        if tag in BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag == "script":
            if self._ld_buf is not None:
                self.ld.append("".join(self._ld_buf))
                self._ld_buf = None
            self.skip = max(0, self.skip - 1)
            return
        if tag == "title":
            self._in_title = False
        if tag in SKIP:
            self.skip = max(0, self.skip - 1)
        elif tag == "p" and self._in_p:
            self._in_p -= 1
            self.para.append("\n")
        if tag in BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if self._ld_buf is not None:
            self._ld_buf.append(data)
            return
        if self._in_title:
            self.title += data
        if self.skip:
            return
        self.parts.append(data)
        if self._in_p:
            self.para.append(data)


def _ld_dates(blob):
    try:
        data = json.loads(blob.strip())
    except ValueError:
        return []
    out = []

    def walk(x):
        if isinstance(x, dict):
            if x.get("datePublished"):
                out.append(str(x["datePublished"]))
            for k in ("@graph", "mainEntity", "mainEntityOfPage", "itemListElement"):
                if k in x:
                    walk(x[k])
        elif isinstance(x, list):
            for y in x:
                walk(y)
    walk(data)
    return out


def _clean(text):
    lines = [" ".join(line.split()) for line in text.split("\n")]
    return "\n".join(line for line in lines if line)


def extract(html, now=None):
    """{date: aware datetime or None, date_from: which tag, text: readable text (trimmed), title}."""
    r = _Reader()
    try:
        r.feed(html)
        r.close()
    except Exception:          # a broken page still gives what was read so far
        pass
    candidates = []
    for blob in r.ld:
        candidates += [("json-ld datePublished", d) for d in _ld_dates(blob)]
    for key in META_DATE:
        if r.meta.get(key):
            candidates.append((f"meta {key}", r.meta[key]))
    if r.itemprop:
        candidates.append(("itemprop datePublished", r.itemprop))
    candidates += [("time datetime", t) for t in r.times[:1]]
    date = date_from = None
    limit = (now or dt.datetime.now(dt.timezone.utc)) + dt.timedelta(days=1)
    for label, raw in candidates:
        d = parse_dt(raw)
        if d is not None and d.year >= 1990 and d <= limit:
            date, date_from = d, label
            break
    para = _clean("".join(r.para))
    text = para if len(para) >= 300 else _clean("".join(r.parts))
    return {"date": date, "date_from": date_from, "text": text[:TEXT_CHARS], "title": " ".join(r.title.split())}


def _charset(ctype, body):
    m = re.search(r"charset=([\w\-]+)", ctype or "", re.I) or re.search(rb'<meta[^>]+charset=["\']?([\w\-]+)',
                                                                          body[:4096], re.I)
    if not m:
        return "utf-8"
    cs = m.group(1)
    return cs.decode("ascii", "ignore") if isinstance(cs, bytes) else cs


def read(url, now=None, http=request):
    """Fetch and extract one page: 10-second timeout, at most 1.5 MB read. SourceError when it cannot be read."""
    final, body, ctype = http(url, timeout=TIMEOUT, max_bytes=MAX_BYTES, truncate=True,
                              headers={"Accept": "text/html,application/xhtml+xml"})
    if ctype and "html" not in ctype.lower() and "xml" not in ctype.lower():
        raise SourceError(f"not an HTML page ({ctype.split(';')[0]})")
    try:
        html = body.decode(_charset(ctype, body), "replace")
    except LookupError:
        html = body.decode("utf-8", "replace")
    out = extract(html, now)
    out["final_url"] = final
    return out
