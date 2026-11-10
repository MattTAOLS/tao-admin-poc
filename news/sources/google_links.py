"""Google News links to publisher URLs (decision E5).

Old-style article ids (base64 starting "CBMi") carry the publisher URL in a small protobuf: they decode offline.
New-style ids decode to a token starting "AU_yqL"; those need Google's unofficial batchexecute call: GET the article
page, read data-n-a-sg (signature) and data-n-a-ts (timestamp), POST them to
https://news.google.com/_/DotsSplashUi/data/batchexecute with rpcid Fbv4je. It is undocumented and often rate-limited,
so it is tried once with a 10-second timeout and any failure keeps the Google link (the date then stays unconfirmed
unless the page itself can be read). Both requests may be redirected, so they run under the public-hosts guard and the
10-second total deadline (sources.net)."""
import base64
import json
import re
import urllib.parse

from .net import PUBLIC, request

ARTICLE_RE = re.compile(r"^https?://news\.google\.com/(?:rss/)?(?:articles|read)/([A-Za-z0-9_\-]+)")
BATCH_URL = "https://news.google.com/_/DotsSplashUi/data/batchexecute"
TIMEOUT = 10


def article_id(url):
    m = ARTICLE_RE.match(url or "")
    return m.group(1) if m else None


def _varint(raw, i):
    shift = value = 0
    while i < len(raw):
        b = raw[i]
        value |= (b & 0x7F) << shift
        i += 1
        if not b & 0x80:
            return value, i
        shift += 7
    raise ValueError("truncated varint")


def decode_offline(aid):
    """The publisher URL for an old-style id; None for a new-style id or anything that does not decode."""
    try:
        raw = base64.urlsafe_b64decode(aid + "=" * (-len(aid) % 4))
    except (ValueError, TypeError):
        return None
    prefix = b"\x08\x13\x22"
    if raw.startswith(prefix):
        raw = raw[len(prefix):]
    try:
        n, i = _varint(raw, 0)
    except ValueError:
        return None
    try:
        url = raw[i:i + n].decode("utf-8")
    except UnicodeDecodeError:
        return None
    if url.startswith("AU_yqL") or not url.startswith(("http://", "https://")):
        return None
    return url


def _attrs(page):
    sg = re.search(r'data-n-a-sg="([^"]+)"', page)
    ts = re.search(r'data-n-a-ts="([^"]+)"', page)
    return (sg.group(1), ts.group(1)) if sg and ts else (None, None)


def decode_online(aid, http=request, timeout=TIMEOUT, guard=PUBLIC):
    """One try at the batchexecute call. None on any failure."""
    try:
        page = http(f"https://news.google.com/rss/articles/{aid}", timeout=timeout, guard=guard,
                    deadline=timeout)[1].decode("utf-8", "replace")
        sg, ts = _attrs(page)
        if not sg:
            return None
        inner = ('["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],'
                 f'"X","X",1,[1,1,1],1,1,null,0,0,null,0],"{aid}",{int(ts)},"{sg}"]')
        f_req = json.dumps([[["Fbv4je", inner, None, "generic"]]])
        body = urllib.parse.urlencode({"f.req": f_req}).encode("utf-8")
        raw = http(BATCH_URL, timeout=timeout, method="POST", data=body, guard=guard, deadline=timeout,
                   headers={"Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"})[1]
        text = raw.decode("utf-8", "replace")
        chunk = text.split("\n\n", 1)[1] if "\n\n" in text else text
        data = json.loads(chunk)
        url = json.loads(data[0][2])[1]
        return url if isinstance(url, str) and url.startswith(("http://", "https://")) else None
    except AssertionError:                    # the tests' network guard
        raise
    except Exception:
        return None


def resolve(url, http=request, online=True):
    """The publisher URL for a Google News link, or None (keep the Google link)."""
    aid = article_id(url)
    if not aid:
        return None
    found = decode_offline(aid)
    if found or not online:
        return found
    return decode_online(aid, http)
