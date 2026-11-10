"""Canonical URLs for pooling and de-duplication: lower-case scheme and host, no fragment, no tracking parameters,
no trailing slash, remaining query parameters sorted. Two links to the same story from different sources pool into one
candidate."""
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


def host(url):
    try:
        return (urllib.parse.urlsplit(url).hostname or "").lower()
    except ValueError:
        return ""
