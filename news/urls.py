"""Canonical URLs for pooling and de-duplication: lower-case scheme and host, no fragment, no tracking parameters,
no trailing slash, remaining query parameters sorted. Two links to the same story from different sources pool into one
candidate.

`key` is what "the same story" is decided on (pooling, already on file): the canonical form without the scheme and
without a leading "www.", so http://pub.com/a, https://pub.com/a and https://www.pub.com/a are one story."""
import urllib.parse

TRACKING = {"fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "oc", "ocid", "cmpid", "ref", "ref_src",
            "igshid", "guccounter", "guce_referrer", "guce_referrer_sig", "_hsenc", "_hsmi", "at_medium",
            "at_campaign", "smid", "sr_share", "spm", "cmp", "rss", "feature"}
TRACKING_PREFIXES = ("utm_", "itm_", "pk_", "mtm_")


def _tracking(name):
    n = name.lower()
    return n in TRACKING or n.startswith(TRACKING_PREFIXES)


def canonical(url):
    if not url:
        return ""
    try:
        p = urllib.parse.urlsplit(url.strip())
    except ValueError:
        return url.strip()
    host = (p.hostname or "").lower()
    if p.port and not ((p.scheme == "http" and p.port == 80) or (p.scheme == "https" and p.port == 443)):
        host = f"{host}:{p.port}"
    params = [(k, v) for k, v in urllib.parse.parse_qsl(p.query, keep_blank_values=True) if not _tracking(k)]
    path = p.path or "/"
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/") or "/"
    query = urllib.parse.urlencode(sorted(params))
    return urllib.parse.urlunsplit(((p.scheme or "https").lower(), host, path, query, ""))


def key(url):
    """The canonical URL without its scheme and a leading "www.": the identity of a story's link."""
    c = canonical(url)
    if not c:
        return ""
    try:
        p = urllib.parse.urlsplit(c)
    except ValueError:
        return c
    netloc = p.netloc[4:] if p.netloc.startswith("www.") else p.netloc
    return netloc + p.path + (f"?{p.query}" if p.query else "")


def host(url):
    try:
        return (urllib.parse.urlsplit(url).hostname or "").lower()
    except ValueError:
        return ""
